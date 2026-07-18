/**
 * API Plugin
 *
 * Transforms the API package into a Datrix plugin.
 * Manages authentication schema, user sync, and auth routes.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { BasePlugin } from "@datrix/core";
import type {
	PluginContext,
	QueryContext,
	SchemaDefinition,
} from "@datrix/core";
import { DefaultPermission, defineSchema } from "@datrix/core";
import { DEFAULT_API_AUTH_CONFIG } from "@datrix/core";
import { AuthManager } from "./auth/manager";
import { createUnifiedAuthHandler } from "./handler/auth-handler";
import { handleCrudRequest } from "./handler/unified";
import { handlerError } from "./errors/api-error";
import { ApiConfig } from "./types";
import { Datrix } from "@datrix/core";
import type { IApiPlugin } from "@datrix/core";
import type { DatrixEntry, DatrixRecord } from "@datrix/core";
import { datrixErrorResponse } from "./handler/utils";
import type { AuthUser, AuthenticatedUser, IUpload } from "@datrix/core";
import { QueryObject } from "@datrix/core";
import { FallbackInput } from "@datrix/core";

/**
 * Per-request state stored in AsyncLocalStorage so concurrent requests
 * never observe each other's authenticated user.
 */
interface RequestStore {
	user: AuthUser | null;
}

export class ApiPlugin<TRole extends string = string>
	extends BasePlugin<ApiConfig<TRole>>
	implements IApiPlugin<TRole> {
	readonly name = "api";
	readonly version = "1.0.0";

	public authManager?: AuthManager<TRole>;
	private datrixInstance?: Datrix;
	private readonly requestStore = new AsyncLocalStorage<RequestStore>();
	private authHandler?: (request: Request) => Promise<Response>;

	public get datrix(): Datrix {
		return this.datrixInstance as Datrix;
	}

	public get upload(): IUpload | undefined {
		return this.options.upload;
	}

	public get user(): AuthUser | null {
		return this.requestStore.getStore()?.user ?? null;
	}

	public setUser(user: AuthUser | null) {
		const store = this.requestStore.getStore();
		if (store) {
			store.user = user;
		}
	}

	private get authConfig(): ApiConfig<TRole>["auth"] | undefined {
		return this.options.auth;
	}

	private get apiConfig(): ApiConfig<TRole> {
		return this.options;
	}

	private get authSchemaName(): string {
		return this.authConfig?.authSchemaName ?? "authentication";
	}

	private get userSchemaName(): string {
		return this.authConfig?.userSchema?.name ?? "user";
	}

	private get userSchemaEmailField(): string {
		return this.authConfig?.userSchema?.email ?? "email";
	}

	public get authDefaultPermission(): DefaultPermission<TRole> | undefined {
		return this.authConfig?.defaultPermission;
	}

	public get authDefaultRole(): TRole | undefined {
		return this.authConfig?.defaultRole;
	}

	public get excludeSchemas(): readonly string[] {
		return [
			...(this.apiConfig.excludeSchemas ?? []),
			"_datrix",
			"_datrix_migrations",
		];
	}

	private getTableName(schemaName: string): string {
		const tableName = this.datrix.getSchema(schemaName)?.tableName;
		if (!tableName) {
			// The registry always sets tableName — a miss is a real error, and a
			// local pluralizer fallback could disagree with core's.
			throw this.createError(
				`Schema not found: ${schemaName}`,
				"SCHEMA_NOT_FOUND",
			);
		}
		return tableName;
	}

	override async onCreateQueryContext(
		context: QueryContext,
	): Promise<QueryContext> {
		// Add authenticated user to context metadata
		const user = this.user;
		if (user) {
			context.user = user;
		}

		return context;
	}

	async init(context: PluginContext): Promise<void> {
		this.context = context;
		this.datrixInstance = context.datrix as Datrix;

		// Auth is disabled if authConfig is undefined
		if (!this.authConfig) {
			return;
		}

		if (context.schemas.has("auth")) {
			throw this.createError(
				"Schema name 'auth' is reserved for API authentication routes",
				"RESERVED_SCHEMA_NAME",
			);
		}

		if (!context.schemas.has(this.userSchemaName)) {
			throw this.createError(
				`User schema '${this.userSchemaName}' not found. Create it before enabling auth.`,
				"USER_SCHEMA_NOT_FOUND",
			);
		}

		const userSchema = context.schemas.get(this.userSchemaName);
		const emailField = this.userSchemaEmailField;
		if (!userSchema?.fields[emailField]) {
			throw this.createError(
				`User schema must have an '${emailField}' field`,
				"MISSING_EMAIL_FIELD",
			);
		}

		if (this.authConfig.jwt) {
			if (this.authConfig.jwt.secret.length < 32) {
				throw this.createError(
					"JWT secret must be at least 32 characters long for security",
					"WEAK_JWT_SECRET",
				);
			}
		}

		this.authManager = new AuthManager(this.authConfig);
	}

	async destroy(): Promise<void> {
		await this.authManager?.destroy();
	}

	override async getSchemas(): Promise<SchemaDefinition[]> {
		const schemas: SchemaDefinition[] = [];

		if (this.options.upload) {
			const uploadSchemas = await this.options.upload.getSchemas();
			schemas.push(...uploadSchemas);
		}

		if (!this.authConfig) {
			return schemas;
		}

		const authSchema = defineSchema({
			name: this.authSchemaName,
			fields: {
				user: {
					type: "relation",
					required: true,
					kind: "belongsTo",
					model: this.userSchemaName,
				},
				email: {
					type: "string",
					required: true,
				},
				password: {
					type: "string",
					required: true,
				},
				passwordSalt: {
					type: "string",
					required: true,
				},
				role: {
					type: "string",
					required: true,
					default: this.authDefaultRole ?? "user",
				},
				resetToken: {
					type: "string",
				},
				resetTokenExpiry: {
					type: "date",
				},
			},
			indexes: [
				{
					name: `${this.authSchemaName}_email_idx`,
					fields: ["email"],
					unique: true,
				},
				{
					name: `${this.authSchemaName}_userId_idx`,
					fields: ["user"],
					unique: true,
				},
				{
					name: `${this.authSchemaName}_resetToken_idx`,
					fields: ["resetToken"],
				},
			],
		});

		schemas.push(authSchema);
		return schemas;
	}

	override async onBeforeQuery<T extends DatrixEntry>(
		query: QueryObject<T>,
		context: QueryContext,
	): Promise<QueryObject<T>> {
		if (!this.authConfig) {
			return query;
		}

		const userTable = this.getTableName(this.userSchemaName);

		// User insert → store the full data array in metadata (bulk-safe)
		if (query.type === "insert" && query.table === userTable) {
			context.metadata["api:createAuth"] = true;
			context.metadata["api:userData"] = query.data;
		}

		// User email update → flag only; affected ids come from the result rows
		if (query.type === "update" && query.table === userTable) {
			const data = query.data;
			const emailField = this.userSchemaEmailField;
			if (data && emailField in data) {
				context.metadata["api:syncEmail"] = true;
			}
		}

		return query;
	}

	override async onAfterQuery<TResult>(
		result: TResult,
		context: QueryContext,
	): Promise<TResult> {
		if (!this.authConfig) {
			return result;
		}

		// User created → create one authentication record per inserted row
		if (context.metadata["api:createAuth"]) {
			const rows = (Array.isArray(result) ? result : [result]) as Record<
				string,
				unknown
			>[];
			const inputs = (context.metadata["api:userData"] ?? []) as Record<
				string,
				unknown
			>[];

			for (let i = 0; i < rows.length; i++) {
				const row = rows[i];
				const userId = row?.["id"];
				if (typeof userId !== "number") {
					continue;
				}
				await this.createAuthenticationRecord(userId, row!, inputs[i] ?? {});
			}
		}

		// User email updated → sync authentication email for all affected rows
		if (context.metadata["api:syncEmail"]) {
			const emailField = this.userSchemaEmailField;
			const rows = (Array.isArray(result) ? result : [result]) as Record<
				string,
				unknown
			>[];
			const ids = rows
				.map((row) => row?.["id"])
				.filter((id): id is number => typeof id === "number");

			if (ids.length > 0) {
				const newEmail = rows[0]?.[emailField];
				if (typeof newEmail === "string") {
					await this.datrix.raw.updateMany(
						this.authSchemaName,
						{ user: { id: { $in: ids } } },
						{ email: newEmail },
					);
				}
			}
		}

		return result;
	}

	/**
	 * Create the authentication record for a newly inserted user row (D3).
	 *
	 * - Password from the insert payload is hashed; without one a passwordless
	 *   record is created (activated via the reset-password flow).
	 * - Role always comes from defaultRole — never from client input.
	 */
	private async createAuthenticationRecord(
		userId: number,
		row: Record<string, unknown>,
		input: Record<string, unknown>,
	): Promise<void> {
		if (!this.authManager) {
			return;
		}

		const emailField = this.userSchemaEmailField;
		const email = row[emailField] ?? input[emailField];
		if (typeof email !== "string" || !email) {
			return;
		}

		const existing = await this.datrix.raw.findOne(this.authSchemaName, {
			email,
		});
		if (existing) {
			console.warn(
				`[Datrix API] Authentication record for '${email}' already exists — skipping auto-creation.`,
			);
			return;
		}

		let password = "";
		let passwordSalt = "";
		const rawPassword = input["password"];
		if (typeof rawPassword === "string" && rawPassword.length > 0) {
			const { hash, salt } = await this.authManager.hashPassword(rawPassword);
			password = hash;
			passwordSalt = salt;
		}

		const authData: FallbackInput = {
			user: userId,
			email,
			password,
			passwordSalt,
			role: this.authConfig?.defaultRole ?? "user",
		};

		await this.datrix.raw.create(this.authSchemaName, authData);
	}

	/**
	 * Resolve the authenticated user for a request (decision D1).
	 *
	 * Token/session verification yields the auth record id; email and role are
	 * then read from the DB (so role changes apply immediately) and the user
	 * relation is populated. FK comparisons in permission functions must use
	 * `ctx.user.user.id` — `ctx.user.id` is the authentication record's id.
	 */
	async resolveAuthUser(request: Request): Promise<AuthUser | null> {
		if (!this.authManager) {
			return null;
		}

		const authContext = await this.authManager.authenticate(request);
		if (!authContext?.user) {
			return null;
		}

		const authRecord = await this.datrix.raw.findById<AuthenticatedUser>(
			this.authSchemaName,
			authContext.user.id,
			{ select: ["email", "role"], populate: { user: "*" } },
		);

		if (!authRecord) {
			return null;
		}

		return {
			id: authRecord.id,
			email: authRecord.email,
			role: this.resolveRole(authRecord.role),
			user: authRecord.user as DatrixRecord,
		};
	}

	/**
	 * Validate a stored role against the configured roles list.
	 * Unknown roles fall back to defaultRole with a logged warning.
	 */
	private resolveRole(role: string): string {
		const roles = this.authConfig?.roles;
		if (!roles || roles.includes(role as TRole)) {
			return role;
		}

		const fallback = this.authConfig?.defaultRole ?? "user";
		console.warn(
			`[Datrix API] Unknown role '${role}' — falling back to '${fallback}'. Check config.roles.`,
		);
		return fallback;
	}

	/**
	 * Handle HTTP request
	 *
	 * Main entry point for all API requests.
	 * Routes to auth handlers or CRUD handlers.
	 */
	async handleRequest(request: Request, datrix: Datrix): Promise<Response> {
		if (!this.isInitialized()) {
			return datrixErrorResponse(
				handlerError.internalError("API plugin not initialized"),
			);
		}

		this.datrixInstance = datrix;

		// Request-scoped store: everything below (including plugin hooks fired
		// by queries) reads the authenticated user from this store.
		return this.requestStore.run({ user: null }, async () => {
			const url = new URL(request.url);
			const prefix = this.apiConfig.prefix ?? "/api";

			if (!url.pathname.startsWith(prefix)) {
				return datrixErrorResponse(handlerError.routeNotFound(url.pathname));
			}

			const pathAfterPrefix = url.pathname.slice(prefix.length);
			const segments = pathAfterPrefix.split("/").filter(Boolean);
			const model = segments[0];

			if (this.authConfig && this.isAuthPath(pathAfterPrefix)) {
				return this.handleAuthRequest(request, datrix);
			}

			if (
				model === "upload" &&
				this.apiConfig.upload &&
				!["GET", "QUERY"].includes(request.method)
			) {
				return this.apiConfig.upload.handleRequest(request, datrix);
			}

			return handleCrudRequest(request, datrix, this, {
				apiPrefix: prefix,
				defaultPageSize: this.apiConfig.defaultPageSize,
				maxPageSize: this.apiConfig.maxPageSize,
				maxPopulateDepth: this.apiConfig.maxPopulateDepth,
			});
		});
	}

	/**
	 * Effective auth endpoint paths (config value or default).
	 */
	private getAuthEndpointPaths(): string[] {
		const e = this.authConfig?.endpoints;
		const d = DEFAULT_API_AUTH_CONFIG.endpoints;
		return [
			e?.login ?? d.login,
			e?.register ?? d.register,
			e?.logout ?? d.logout,
			e?.me ?? d.me,
			e?.forgotPassword ?? d.forgotPassword,
			e?.resetPassword ?? d.resetPassword,
		];
	}

	private isAuthPath(pathname: string): boolean {
		if (this.getAuthEndpointPaths().includes(pathname)) {
			return true;
		}

		// Fallback: unknown /auth/x paths get the auth handler's 404 instead of
		// a confusing "schema not found" from the CRUD handler.
		return pathname === "/auth" || pathname.startsWith("/auth/");
	}

	/**
	 * Handle authentication requests
	 */
	private async handleAuthRequest(
		request: Request,
		datrix: Datrix,
	): Promise<Response> {
		if (!this.authManager) {
			return datrixErrorResponse(
				handlerError.internalError("Authentication not configured"),
			);
		}

		// Handler is pure configuration — build once, reuse for every request
		this.authHandler ??= createUnifiedAuthHandler(
			{
				datrix,
				authManager: this.authManager,
				authConfig: this.authConfig!,
			},
			this.apiConfig.prefix ?? "/api",
		);

		return this.authHandler(request);
	}

	/**
	 * Check if API is enabled
	 */
	isEnabled(): boolean {
		return !(this.apiConfig.disabled ?? false);
	}

	/**
	 * Check if authentication is enabled
	 */
	isAuthEnabled(): boolean {
		return this.authConfig !== undefined;
	}

	/**
	 * Get auth manager (for external use)
	 */
	getAuthManager(): AuthManager<TRole> | undefined {
		return this.authManager;
	}
}
