/**
 * API Plugin
 *
 * Transforms the API package into a Forja plugin.
 * Manages authentication schema, user sync, and auth routes.
 */

import { BasePlugin } from 'forja-core/plugin/plugin';
import type {
  PluginContext,
  PluginError,
  SchemaDefinition
} from 'forja-types/plugin';
import type { QueryObject } from 'forja-types/core/query-builder';
import type { Result } from 'forja-types/utils';
import { defineSchema } from 'forja-types/core/schema';
import { AuthManager } from './auth/manager';
import { createAuthHandlers } from './handler/auth-handler';
import { handleRequest as handleCrudRequest } from './handler/unified';
import { errorResponse } from './handler/utils';
import { ApiConfig } from './types';
import { Forja } from 'forja-core';


export class ApiPlugin extends BasePlugin<ApiConfig> {
  readonly name = 'api';
  readonly version = '1.0.0';

  private authManager?: AuthManager;
  private forjaInstance?: Forja;

  private get authConfig() {
    return this.options.auth;
  }

  private get apiConfig() {
    return this.options;
  }

  private get authSchemaName(): string {
    return this.authConfig?.authSchemaName ?? 'authentication';
  }

  private get userSchemaName(): string {
    return this.authConfig?.userSchema?.name ?? 'user';
  }

  private get userSchemaEmailField(): string {
    return this.authConfig?.userSchema?.email ?? 'email';
  }

  async init(context: PluginContext): Promise<Result<void, PluginError>> {
    this.context = context;

    if (!this.authConfig?.enabled) {
      return { success: true, data: undefined };
    }

    if (context.schemas.has('auth')) {
      return {
        success: false,
        error: this.createError(
          "Schema name 'auth' is reserved for API authentication routes",
          'RESERVED_SCHEMA_NAME'
        ),
      };
    }

    if (!context.schemas.has(this.userSchemaName)) {
      return {
        success: false,
        error: this.createError(
          `User schema '${this.userSchemaName}' not found. Create it before enabling auth.`,
          'USER_SCHEMA_NOT_FOUND'
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
          'MISSING_EMAIL_FIELD'
        ),
      };
    }

    if (this.authConfig.jwt) {
      if (this.authConfig.jwt.secret.length < 32) {
        return {
          success: false,
          error: this.createError(
            'JWT secret must be at least 32 characters long for security',
            'WEAK_JWT_SECRET'
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
    if (!this.authConfig?.enabled) {
      return [];
    }

    const authSchema = defineSchema({
      name: this.authSchemaName,
      fields: {
        id: {
          type: 'string',
          required: true,
        },
        userId: {
          type: 'string',
          required: true,
        },
        email: {
          type: 'string',
          required: true,
        },
        password: {
          type: 'string',
          required: true,
        },
        passwordSalt: {
          type: 'string',
          required: true,
        },
        role: {
          type: 'string',
          required: true,
          default: this.authConfig.rbac?.defaultRole ?? 'user',
        },
      },
      indexes: [
        {
          name: `${this.authSchemaName}_email_idx`,
          fields: ['email'],
          unique: true,
        },
        {
          name: `${this.authSchemaName}_userId_idx`,
          fields: ['userId'],
          unique: true,
        },
      ],
      timestamps: true,
    });

    return [authSchema];
  }

  override async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
    /*
     * TODO: QueryContext ihtiyacı (opsiyonel - şu an onBeforeQuery çalışıyor)
     *
     * Core'da eklenmesi gerekenler (future enhancement):
     * 1. packages/core/src/dispatcher.ts
     *    - dispatchBeforeQuery metoduna QueryContext parametresi ekle (optional)
     *    - QueryContext objesi oluştur: { operation, modelName, user?, metadata }
     *
     * Şu anlık onBeforeQuery query objesinden bilgiyi alabildiği için sorun yok.
     * Ama consistency için gelecekte eklenebilir.
     */

    if (!this.authConfig?.enabled) {
      return query;
    }

    // User insert → authentication record create edilmeli
    if (query.type === 'insert' && query.table === this.userSchemaName) {
      (query as any)._apiPlugin_createAuth = true;
    }

    // User email update → authentication email sync edilmeli
    if (query.type === 'update' && query.table === this.userSchemaName) {
      const emailField = this.userSchemaEmailField;
      if (query.data && emailField in query.data) {
        (query as any)._apiPlugin_syncEmail = query.data[emailField];
      }
    }

    // User delete → authentication cascade delete edilmeli
    if (query.type === 'delete' && query.table === this.userSchemaName) {
      (query as any)._apiPlugin_deleteAuth = true;
    }

    return query;
  }

  override async onAfterQuery<TResult>(result: TResult): Promise<TResult> {
    /*
     * TODO: QueryResultContext ihtiyacı
     *
     * Core'da eklenmesi gerekenler:
     * 1. packages/types/src/plugin.ts
     *    - QueryContext interface ekle (operation, modelName, user, metadata)
     *    - QueryResultContext interface ekle (extends QueryContext + originalQuery)
     *    - ForjaPlugin.onAfterQuery signature: onAfterQuery?<TResult>(result: TResult, context?: QueryResultContext)
     *
     * 2. packages/core/src/dispatcher.ts
     *    - dispatchAfterQuery metoduna QueryResultContext parametresi ekle
     *    - QueryResultContext objesi oluştur (query bilgisi ile)
     *    - Her plugin.onAfterQuery çağrısına context'i geç
     *
     * 3. İhtiyacımız olan context bilgileri:
     *    - context.originalQuery.type ('insert' | 'update' | 'delete' olduğunu bilmek için)
     *    - context.originalQuery.table (hangi tabloda işlem yapıldığını bilmek için)
     *    - context.originalQuery.data (insert/update'te ne eklendiğini bilmek için)
     *    - context.originalQuery.where (delete'te hangi id silindiğini bilmek için)
     *
     * Şu anki workaround: Query objesine custom flag'ler ekliyoruz (_apiPlugin_*)
     */

    if (!this.authConfig?.enabled) {
      return result;
    }

    // TODO: Bu kısım QueryResultContext ile şöyle olacak:
    // if (context.originalQuery.type === 'insert' && context.originalQuery.table === this.userSchemaName)

    return result;

    /* COMMENTED OUT - QueryResultContext gelince aktif edilecek
    const contextResult = this.getContext();
    if (!contextResult.success) {
      return result;
    }
    const context = contextResult.data;

    if ((query as any)._apiPlugin_createAuth && result && typeof result === 'object') {
      const user = result as any;
      await this.createAuthenticationRecord(user, context);
    }

    if ((query as any)._apiPlugin_syncEmail && result && typeof result === 'object') {
      const user = result as any;
      const newEmail = (query as any)._apiPlugin_syncEmail;
      await this.syncAuthenticationEmail(user.id, newEmail, context);
    }

    if ((query as any)._apiPlugin_deleteAuth && result) {
      const userId = (query as any).where?.id;
      if (userId) {
        await this.deleteAuthenticationRecord(userId, context);
      }
    }

    return result;
    */
  }

  private async createAuthenticationRecord(
    user: any,
    context: PluginContext
  ): Promise<void> {
    const emailField = this.authFieldNames.email;

    const authData = {
      id: this.generateId(),
      userId: user.id,
      email: user[emailField],
      password: user.password || '',
      passwordSalt: user.passwordSalt || '',
      role: user.role || this.authConfig!.rbac?.defaultRole || 'user',
    };

    const query: QueryObject = {
      type: 'insert',
      table: this.authSchemaName,
      data: authData,
    };

    await context.adapter.executeQuery(query);
  }

  private async syncAuthenticationEmail(
    userId: string,
    newEmail: string,
    context: PluginContext
  ): Promise<void> {
    const query: QueryObject = {
      type: 'update',
      table: this.authSchemaName,
      where: { userId },
      data: { email: newEmail },
    };

    await context.adapter.executeQuery(query);
  }

  private async deleteAuthenticationRecord(
    userId: string,
    context: PluginContext
  ): Promise<void> {
    const query: QueryObject = {
      type: 'delete',
      table: this.authSchemaName,
      where: { userId },
    };

    await context.adapter.executeQuery(query);
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Handle HTTP request
   *
   * Main entry point for all API requests.
   * Routes to auth handlers or CRUD handlers.
   */
  async handleRequest(request: Request, forja: any): Promise<Response> {
    if (!this.isInitialized()) {
      return errorResponse(
        'API plugin not initialized',
        'NOT_INITIALIZED',
        500
      );
    }

    this.forjaInstance = forja;

    const url = new URL(request.url);
    const prefix = this.apiConfig.prefix ?? '/api';

    if (!url.pathname.startsWith(prefix)) {
      return errorResponse('Invalid API prefix', 'INVALID_PREFIX', 400);
    }

    const pathAfterPrefix = url.pathname.slice(prefix.length);
    const segments = pathAfterPrefix.split('/').filter(Boolean);
    const model = segments[0];

    if (model === 'auth' && this.authConfig?.enabled) {
      return this.handleAuthRequest(request, forja);
    }

    return handleCrudRequest(
      request,
      forja,
      this.authManager,
      {
        apiPrefix: prefix,
      }
    );
  }

  /**
   * Handle authentication requests
   */
  private async handleAuthRequest(
    request: Request,
    forja: any
  ): Promise<Response> {
    if (!this.authManager) {
      return errorResponse(
        'Authentication not configured',
        'AUTH_NOT_CONFIGURED',
        500
      );
    }

    const authHandlers = createAuthHandlers({
      forja,
      authManager: this.authManager,
      authConfig: this.authConfig!,
    });

    const url = new URL(request.url);
    const method = request.method;

    if (url.pathname.endsWith('/register') && method === 'POST') {
      return authHandlers.register(request);
    }
    if (url.pathname.endsWith('/login') && method === 'POST') {
      return authHandlers.login(request);
    }
    if (url.pathname.endsWith('/logout') && method === 'POST') {
      return authHandlers.logout(request);
    }
    if (url.pathname.endsWith('/me') && method === 'GET') {
      return authHandlers.me(request);
    }

    return errorResponse('Not found', 'NOT_FOUND', 404);
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
    return this.authConfig?.enabled ?? false;
  }

  /**
   * Get auth manager (for external use)
   */
  getAuthManager(): AuthManager | undefined {
    return this.authManager;
  }
}
