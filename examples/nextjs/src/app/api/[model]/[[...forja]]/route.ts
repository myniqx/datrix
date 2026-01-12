/**
 * Next.js API Route - Forja Unified Handler
 *
 * OPTIMIZED IMPLEMENTATION: Minimal code, maximum functionality
 *
 * This route handles ALL API requests through a unified handler:
 * - Authentication (JWT/Session) - happens ONCE in middleware
 * - Permission checking (RBAC) - happens ONCE in middleware
 * - Request parsing - happens ONCE in middleware
 * - CRUD operations - routed automatically
 *
 * Examples:
 * - GET    /api/user              -> List users
 * - GET    /api/user/123          -> Get user by ID
 * - POST   /api/user              -> Create user
 * - PATCH  /api/user/123          -> Update user
 * - DELETE /api/user/123          -> Delete user
 * - GET    /api/user?where[role]=admin&populate[topics]=*
 *
 * Auth endpoints (automatically handled):
 * - POST /api/auth/register      -> Register new user
 * - POST /api/auth/login         -> Login user
 * - POST /api/auth/logout        -> Logout user
 * - GET  /api/auth/me            -> Get current user
 */

import { getForja } from 'forja-core';
import {
  handleRequest,
  createAuthHandlers,
  createAuthManager,
  createApiLifecycleManager,
} from 'forja-api';

// Import config to initialize Forja
import '../../../../../forja.config';

/**
 * Initialize API (runs once on first request)
 */
let isInitialized = false;
async function ensureInitialized(forja: ReturnType<typeof getForja>) {
  if (isInitialized) return;

  const config = forja.getConfig();

  // Initialize API lifecycle (user schema injection)
  if (config.api?.auth?.enabled) {
    const lifecycleManager = createApiLifecycleManager(config.api.auth);
    const initResult = await lifecycleManager.init(forja.getSchemaRegistry());

    if (!initResult.success) {
      throw initResult.error;
    }
  }

  isInitialized = true;
}

/**
 * Unified request handler
 *
 * Handles both auth endpoints and CRUD endpoints
 */
async function handler(request: Request): Promise<Response> {
  try {
    const forja = await getForja();
    const config = forja.getConfig();
    const url = new URL(request.url);

    // Check if API is enabled
    if (!config.api?.enabled) {
      return new Response(
        JSON.stringify({ error: { message: 'API is not enabled', code: 'API_DISABLED' } }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Initialize API (once)
    await ensureInitialized(forja);

    // Extract model from URL
    const segments = url.pathname.split('/').filter(Boolean);
    const model = segments[1]; // /api/[model]

    // Handle auth endpoints
    if (model === 'auth' && config.api.auth?.enabled) {
      const authManager = createAuthManager(config.api.auth);
      const authHandlers = createAuthHandlers({
        forja,
        authManager,
        authConfig: config.api.auth,
      });

      const path = url.pathname;
      const method = request.method;

      // Route to appropriate auth handler
      if (path.endsWith('/register') && method === 'POST') {
        return authHandlers.register(request);
      }
      if (path.endsWith('/login') && method === 'POST') {
        return authHandlers.login(request);
      }
      if (path.endsWith('/logout') && method === 'POST') {
        return authHandlers.logout(request);
      }
      if (path.endsWith('/me') && method === 'GET') {
        return authHandlers.me(request);
      }

      return new Response(
        JSON.stringify({ error: { message: 'Not found', code: 'NOT_FOUND' } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create auth manager (once per request)
    const authManager = config.api.auth?.enabled
      ? createAuthManager(config.api.auth)
      : undefined;

    // Handle CRUD endpoints with unified handler
    // ✅ Authentication - happens ONCE in buildRequestContext()
    // ✅ Permission check - happens ONCE in checkPermission()
    // ✅ Context building - happens ONCE in buildRequestContext()
    // ✅ CRUD operation - routed by method
    return handleRequest(request, forja, authManager, {
      apiPrefix: config.api.prefix ?? '/api',
    });
  } catch (error) {
    console.error('API Error:', error);
    return new Response(
      JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : 'Internal server error',
          code: 'INTERNAL_ERROR',
        },
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// Export for all HTTP methods (single handler for all!)
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
