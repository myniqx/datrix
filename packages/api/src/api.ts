/**
 * API Plugin
 *
 * Transforms the API package into a Forja plugin.
 * Manages authentication schema, user sync, and auth routes.
 */

import { BasePlugin } from "forja-core/plugin/plugin";
import type {
  PluginContext,
  PluginError,
  QueryContext,
  SchemaDefinition,
} from "forja-types/plugin";
import type { QueryObject } from "forja-types/core/query-builder";
import type { Result } from "forja-types/utils";
import { DefaultPermission, defineSchema } from "forja-types/core/schema";
import { AuthManager } from "./auth/manager";
import { createAuthHandlers } from "./handler/auth-handler";
import { handleRequest as handleCrudRequest } from "./handler/unified";
import { handlerError } from "./errors/api-error";
import { ApiConfig } from "./types";
import { Forja } from "forja-core";
import type { IApiPlugin } from "./interface";
import type { ForjaEntry } from "forja-types/core/schema";
import { forjaErrorResponse } from "./handler/utils";
import { AuthUser } from "forja-types/api";

export class ApiPlugin<TRole extends string = string>
  extends BasePlugin<ApiConfig<TRole>>
  implements IApiPlugin<TRole> {
  readonly name = "api";
  readonly version = "1.0.0";

  public authManager?: AuthManager;
  public user: AuthUser | null = null;
  private forjaInstance?: Forja;

  public get forja(): Forja {
    return this.forjaInstance as Forja;
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

  async init(context: PluginContext): Promise<Result<void, PluginError>> {
    this.context = context;

    // Auth is disabled if authConfig is undefined
    if (!this.authConfig) {
      return { success: true, data: undefined };
    }

    if (context.schemas.has("auth")) {
      return {
        success: false,
        error: this.createError(
          "Schema name 'auth' is reserved for API authentication routes",
          "RESERVED_SCHEMA_NAME",
        ),
      };
    }

    if (!context.schemas.has(this.userSchemaName)) {
      return {
        success: false,
        error: this.createError(
          `User schema '${this.userSchemaName}' not found. Create it before enabling auth.`,
          "USER_SCHEMA_NOT_FOUND",
        ),
      };
    }

    const userSchema = context.schemas.get(this.userSchemaName);
    const emailField = this.userSchemaEmailField;
    if (!userSchema?.fields[emailField]) {
      return {
        success: false,
        error: this.createError(
          `User schema must have an '${emailField}' field`,
          "MISSING_EMAIL_FIELD",
        ),
      };
    }

    if (this.authConfig.jwt) {
      if (this.authConfig.jwt.secret.length < 32) {
        return {
          success: false,
          error: this.createError(
            "JWT secret must be at least 32 characters long for security",
            "WEAK_JWT_SECRET",
          ),
        };
      }
    }

    this.authManager = new AuthManager(this.authConfig);

    return { success: true, data: undefined };
  }

  async destroy(): Promise<Result<void, PluginError>> {
    return { success: true, data: undefined };
  }

  override async getSchemas(): Promise<SchemaDefinition[]> {
    if (!this.authConfig) {
      return [];
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
      timestamps: true,
    });

    return [authSchema];
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
      context.metadata["api:userData"] = query.data;
    }

    // User email update → store flag in metadata
    if (query.type === "update" && query.table === userTable) {
      const emailField = this.userSchemaEmailField;
      if (query.data && emailField in query.data) {
        context.metadata["api:syncEmail"] = (query.data as Record<string, unknown>)[
          emailField
        ];
        context.metadata["api:userId"] = query.where?.["id"];
      }
    }

    // User delete → store flag in metadata
    if (query.type === "delete" && query.table === userTable) {
      context.metadata["api:deleteAuth"] = true;
      context.metadata["api:userId"] = query.where?.["id"];
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
    if (!pluginContext.success) {
      return result;
    }

    // User created → create authentication record
    if (
      context.metadata["api:createAuth"] &&
      result &&
      typeof result === "object"
    ) {
      const user = result as Record<string, unknown>;
      await this.createAuthenticationRecord(user, pluginContext.data);
    }

    // User email updated → sync authentication email
    if (context.metadata["api:syncEmail"] && context.metadata["api:userId"]) {
      const newEmail = context.metadata["api:syncEmail"] as string;
      const userId = context.metadata["api:userId"] as string;
      await this.syncAuthenticationEmail(userId, newEmail, pluginContext.data);
    }

    // User deleted → delete authentication record
    if (context.metadata["api:deleteAuth"] && context.metadata["api:userId"]) {
      const userId = context.metadata["api:userId"] as string;
      await this.deleteAuthenticationRecord(userId, pluginContext.data);
    }

    return result;
  }

  private async createAuthenticationRecord(
    user: Record<string, unknown>,
    context: PluginContext,
  ): Promise<void> {
    const emailField = this.userSchemaEmailField;

    const authData = {
      user: String(user["id"]),
      email: user[emailField] as string,
      password: (user["password"] as string) || "",
      passwordSalt: (user["passwordSalt"] as string) || "",
      role: (user["role"] as string) || this.authConfig?.defaultRole || "user",
    };

    const query: QueryObject<ForjaEntry> = {
      type: "insert",
      table: this.authSchemaName,
      data: authData as unknown as Partial<ForjaEntry>,
    };

    await context.adapter.executeQuery(query);
  }

  private async syncAuthenticationEmail(
    userId: string,
    newEmail: string,
    context: PluginContext,
  ): Promise<void> {
    const query: QueryObject<{ email: string } & ForjaEntry> = {
      type: "update",
      table: this.authSchemaName,
      where: { userId },
      data: { email: newEmail },
    };

    await context.adapter.executeQuery(query);
  }

  private async deleteAuthenticationRecord(
    userId: string,
    context: PluginContext,
  ): Promise<void> {
    // TODO: add a test for this
    const query: QueryObject<ForjaEntry> = {
      type: "delete",
      table: this.authSchemaName,
      where: { user: { $eq: userId } },
    };

    await context.adapter.executeQuery(query);
  }

  /**
   * Handle HTTP request
   *
   * Main entry point for all API requests.
   * Routes to auth handlers or CRUD handlers.
   */
  async handleRequest(request: Request, forja: Forja): Promise<Response> {
    if (!this.isInitialized()) {
      const result = handlerError.internalError("API plugin not initialized");
      return forjaErrorResponse(result);
    }

    this.forjaInstance = forja;

    const url = new URL(request.url);
    const prefix = this.apiConfig.prefix ?? "/api";

    if (!url.pathname.startsWith(prefix)) {
      const result = handlerError.internalError("Invalid API prefix");
      return forjaErrorResponse(result);
    }

    const pathAfterPrefix = url.pathname.slice(prefix.length);
    const segments = pathAfterPrefix.split("/").filter(Boolean);
    const model = segments[0];

    if (model === "auth" && this.authConfig) {
      return this.handleAuthRequest(request, forja);
    }

    return handleCrudRequest(request, forja, this, {
      apiPrefix: prefix,
    });
  }

  /**
   * Handle authentication requests
   */
  private async handleAuthRequest(
    request: Request,
    forja: Forja,
  ): Promise<Response> {
    if (!this.authManager) {
      const result = handlerError.internalError("Authentication not configured");
      return forjaErrorResponse(result);
    }

    const authHandlers = createAuthHandlers({
      forja,
      authManager: this.authManager,
      authConfig: this.authConfig!,
    });

    const url = new URL(request.url);
    const method = request.method;

    if (url.pathname.endsWith("/register") && method === "POST") {
      return authHandlers.register(request);
    }
    if (url.pathname.endsWith("/login") && method === "POST") {
      return authHandlers.login(request);
    }
    if (url.pathname.endsWith("/logout") && method === "POST") {
      return authHandlers.logout(request);
    }
    if (url.pathname.endsWith("/me") && method === "GET") {
      return authHandlers.me(request);
    }

    const res = handlerError.recordNotFound("Auth Route", url.pathname);
    return forjaErrorResponse(res);
  }

  /**
   * Check if API is enabled
   */
  isEnabled(): boolean {
    return this.apiConfig.enabled ?? true;
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
