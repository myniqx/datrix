/**
 * Forja API Class
 *
 * Main API handler - manages authentication, routing, and CRUD operations.
 */

import type { IForjaApi } from 'forja-types/api';
import type { ApiConfig } from 'forja-types/config';
import type { AuthManager } from './auth/manager';
import type { ApiLifecycleManager } from './lifecycle/manager';
import { createAuthManager } from './auth/manager';
import { createApiLifecycleManager } from './lifecycle/manager';
import { createAuthHandlers } from './handler/auth-handler';
import { handleRequest as handleCrudRequest } from './handler/unified';
import { errorResponse } from './handler/utils';

/**
 * ForjaApi
 *
 * Implements IForjaApi interface for REST API functionality.
 *
 * Features:
 * - Authentication (JWT + Session)
 * - Authorization (RBAC)
 * - CRUD operations
 * - Auto-generated routes
 *
 * @example
 * ```ts
 * import { ForjaApi } from 'forja-api';
 *
 * const api = new ForjaApi({
 *   enabled: true,
 *   prefix: '/api',
 *   auth: {
 *     enabled: true,
 *     jwt: { secret: 'your-secret' },
 *     rbac: { roles: [...] }
 *   }
 * });
 * ```
 */
export class ForjaApi<TForja = unknown> implements IForjaApi<TForja> {
  private initialized = false;
  private authManager?: AuthManager;
  private lifecycleManager?: ApiLifecycleManager;

  constructor(private readonly config: ApiConfig) {
    this.validateConfig();
  }

  /**
   * Initialize API
   *
   * Called automatically on first request.
   * Sets up user schema injection and auth manager.
   */
  async init(forja: TForja): Promise<void> {
    if (this.initialized) return;

    // Initialize lifecycle manager (user schema injection)
    if (this.config.auth?.enabled) {
      this.lifecycleManager = createApiLifecycleManager(this.config.auth);

      // Type assertion - we know forja has getSchemaRegistry
      const forjaWithRegistry = forja as unknown as {
        getSchemaRegistry(): {
          has(name: string): boolean;
          get(name: string): unknown;
          register(schema: unknown): void;
          update(name: string, schema: unknown): void;
        };
      };

      const result = await this.lifecycleManager.init(
        forjaWithRegistry.getSchemaRegistry()
      );

      if (!result.success) {
        throw result.error;
      }

      // Create auth manager
      this.authManager = createAuthManager(this.config.auth);
    }

    this.initialized = true;
  }

  /**
   * Handle HTTP request
   *
   * Main entry point for all API requests.
   * Routes to auth handlers or CRUD handlers.
   */
  async handleRequest(request: Request, forja: TForja): Promise<Response> {
    // Auto-initialize on first request
    await this.init(forja);

    // Extract model from URL
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const model = segments[1]; // /api/[model]

    // Handle auth endpoints
    if (model === 'auth' && this.config.auth?.enabled) {
      return this.handleAuthRequest(request, forja);
    }

    // Handle CRUD endpoints
    return handleCrudRequest(
      request,
      forja as never,
      this.authManager,
      {
        apiPrefix: this.config.prefix ?? '/api',
      }
    );
  }

  /**
   * Check if API is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled ?? true;
  }

  /**
   * Check if authentication is enabled
   */
  isAuthEnabled(): boolean {
    return this.config.auth?.enabled ?? false;
  }

  /**
   * Get auth manager (internal use)
   */
  getAuthManager(): AuthManager | undefined {
    return this.authManager;
  }

  /**
   * Get API configuration (internal use)
   */
  getConfig(): ApiConfig {
    return this.config;
  }

  /**
   * Handle authentication requests
   */
  private async handleAuthRequest(
    request: Request,
    forja: TForja
  ): Promise<Response> {
    const authHandlers = createAuthHandlers({
      forja: forja as never,
      authManager: this.authManager!,
      authConfig: this.config.auth!,
    });

    const url = new URL(request.url);
    const method = request.method;

    // Route to appropriate auth handler
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
   * Validate configuration
   */
  private validateConfig(): void {
    if (!this.config.enabled) return;

    // Validate JWT secret
    if (this.config.auth?.enabled && this.config.auth.jwt) {
      if (this.config.auth.jwt.secret.length < 32) {
        throw new Error(
          'JWT secret must be at least 32 characters long for security'
        );
      }
    }
  }
}
