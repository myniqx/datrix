/**
 * API Plugin
 *
 * Transforms the API package into a Forja plugin.
 * Manages authentication schema, user sync, and auth routes.
 */

import { BasePlugin } from "forja-core/plugin/plugin";
import type {
	PluginContext,
	QueryContext,
	SchemaDefinition,
} from "forja-types/plugin";
import { DefaultPermission, defineSchema } from "forja-types/core/schema";
import { DEFAULT_API_AUTH_CONFIG } from "forja-types/config";
import { AuthManager } from "./auth/manager";
import { createUnifiedAuthHandler } from "./handler/auth-handler";
import { handleCrudRequest } from "./handler/unified";
import { handlerError } from "./errors/api-error";
import { ApiConfig } from "./types";
import { Forja } from "forja-core";
import type { IApiPlugin } from "./interface";
import type { ForjaEntry, ForjaRecord } from "forja-types/core/schema";
import { forjaErrorResponse } from "./handler/utils";
import type { AuthUser, IUpload } from "forja-types/api";
import { QueryObject } from "forja-types";
import { FallbackInput } from "forja-types/forja";

export class ApiPlugin<TRole extends string = string>
	extends BasePlugin<ApiConfig<TRole>>
	implements IApiPlugin<TRole>
{
	readonly name = "api";
	readonly version = "1.0.0";

	public authManager?: AuthManager;
	public user: AuthUser | null = null;
	private forjaInstance?: Forja;

	public get forja(): Forja {
		return this.forjaInstance as Forja;
	}

	public get upload(): IUpload | undefined {
		return this.options.upload;
	}

	public setUser(user: AuthUser | null) {
		this.user = user;
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
			"_forja",
			"_forja_migrations",
		];
	}

	private getTableName(schemaName: string): string {
		const schema = this.forja.getSchema(schemaName);
		return schema?.tableName || `${schemaName.toLowerCase()}s`;
	}

	override async onCreateQueryContext(
		context: QueryContext,
	): Promise<QueryContext> {
		// Add authenticated user to context metadata
		if (this.user) {
			context.user = this.user;
		}

		return context;
	}

	async init(context: PluginContext): Promise<void> {
		this.context = context;

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

	async destroy(): Promise<void> {}

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
			],
		});

		schemas.push(authSchema);
		return schemas;
	}

	override async onBeforeQuery<T extends ForjaEntry>(
		query: QueryObject<T>,
		context: QueryContext,
	): Promise<QueryObject<T>> {
		if (!this.authConfig) {
			return query;
		}

		const userTable = this.getTableName(this.userSchemaName);

		// User insert → store flag in metadata
		if (query.type === "insert" && query.table === userTable) {
			context.metadata["api:createAuth"] = true;
			context.metadata["api:userData"] = query.data[0];
		}

		// User email update → store flag in metadata
		if (query.type === "update" && query.table === userTable) {
			const data = query.data;
			const emailField = this.userSchemaEmailField;
			if (data && emailField in data) {
				context.metadata["api:syncEmail"] = (
					query.data as Record<string, unknown>
				)[emailField];
				context.metadata["api:userId"] = query.where?.["id"];
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

		const pluginContext = this.getContext();

		// User created → create authentication record
		if (context.metadata["api:createAuth"]) {
			const { id: userId } = Array.isArray(result) ? result[0] : result;
			if (typeof userId === "number") {
				const user: Partial<ForjaRecord> = {
					...(context.metadata["api:userData"] as Record<string, unknown>),
					userId,
				};
				await this.createAuthenticationRecord(user, pluginContext);
			}
		}

		// User email updated → sync authentication email
		if (context.metadata["api:syncEmail"] && context.metadata["api:userId"]) {
			const newEmail = context.metadata["api:syncEmail"] as string;
			const userId = context.metadata["api:userId"] as string;
			await this.syncAuthenticationEmail(userId, newEmail, pluginContext);
		}

		return result;
	}

	private async createAuthenticationRecord(
		_user: Partial<ForjaRecord>,
		_context: PluginContext,
	): Promise<void> {
		const emailField = this.userSchemaEmailField;
		const user = _user as FallbackInput;
		const authData: FallbackInput = {
			user: user["userId"]!,
			email: user[emailField]!,
			password: user["password"] || "",
			passwordSalt: user["passwordSalt"] || "",
			role: user["role"] || this.authConfig?.defaultRole || "user",
		};

		await this.forjaInstance!.raw.create(this.authSchemaName, authData);
	}

	private async syncAuthenticationEmail(
		userId: string,
		newEmail: string,
		_context: PluginContext,
	): Promise<void> {
		await this.forja.raw.updateMany(
			this.authSchemaName,
			{ user: { id: { $eq: userId } } },
			{ email: newEmail },
		);
	}

	/**
	 * Handle HTTP request
	 *
	 * Main entry point for all API requests.
	 * Routes to auth handlers or CRUD handlers.
	 */
	async handleRequest(request: Request, forja: Forja): Promise<Response> {
		if (!this.isInitialized()) {
			return forjaErrorResponse(
				handlerError.internalError("API plugin not initialized"),
			);
		}

		this.forjaInstance = forja;

		const url = new URL(request.url);
		const prefix = this.apiConfig.prefix ?? "/api";

		if (!url.pathname.startsWith(prefix)) {
			return forjaErrorResponse(
				handlerError.internalError("Invalid API prefix"),
			);
		}

		const pathAfterPrefix = url.pathname.slice(prefix.length);
		const segments = pathAfterPrefix.split("/").filter(Boolean);
		const model = segments[0];

		if (this.authConfig && this.isAuthPath(url.pathname)) {
			return this.handleAuthRequest(request, forja);
		}

		if (
			model === "upload" &&
			this.apiConfig.upload &&
			request.method !== "GET"
		) {
			return this.apiConfig.upload.handleRequest(request, forja);
		}

		return handleCrudRequest(request, forja, this, {
			apiPrefix: prefix,
		});
	}

	private isAuthPath(pathname: string): boolean {
		const e = this.authConfig?.endpoints;
		const d = DEFAULT_API_AUTH_CONFIG.endpoints;
		const login = e?.login ?? d.login;
		const register = e?.register ?? d.register;
		const logout = e?.logout ?? d.logout;
		const me = e?.me ?? d.me;
		return (
			pathname === login ||
			pathname === register ||
			pathname === logout ||
			pathname === me
		);
	}

	/**
	 * Handle authentication requests
	 */
	private async handleAuthRequest(
		request: Request,
		forja: Forja,
	): Promise<Response> {
		if (!this.authManager) {
			return forjaErrorResponse(
				handlerError.internalError("Authentication not configured"),
			);
		}

		const handler = createUnifiedAuthHandler({
			forja,
			authManager: this.authManager,
			authConfig: this.authConfig!,
		});

		return handler(request);
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
	getAuthManager(): AuthManager | undefined {
		return this.authManager;
	}
}
