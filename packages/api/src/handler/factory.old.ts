/**
 * Handler Factory
 *
 * Creates CRUD handlers for HTTP endpoints.
 * Framework-agnostic - returns handler functions that can be adapted to any framework.
 */

import type {
  HandlerConfig,
  HandlerFunction,
  RequestContext,
  HandlerResponse,
  Middleware,
  PermissionCheck,
  CrudHandler
} from 'forja-types/api/handler';
import { findMany, findOne, create, update, deleteRecord, count } from './crud';

/**
 * Create CRUD handler
 *
 * @param config - Handler configuration
 * @returns CRUD handler with all operations
 */
export function createCrudHandler<TUser = unknown>(
  config: HandlerConfig<TUser>
): CrudHandler<TUser> {
  return {
    findMany: createProtectedHandler(config, findMany, 'read'),
    findOne: createProtectedHandler(config, findOne, 'read'),
    create: createProtectedHandler(config, create, 'create'),
    update: createProtectedHandler(config, update, 'update'),
    delete: createProtectedHandler(config, deleteRecord, 'delete'),
    count: createProtectedHandler(config, count, 'read') // Count uses same permissions as read
  };
}

/**
 * Create a protected handler with middleware and permissions
 */
function createProtectedHandler<TUser = unknown>(config: HandlerConfig<TUser>, handler: (context: RequestContext<TUser>, config: HandlerConfig<TUser>) => Promise<HandlerResponse>, operation: 'read' | 'create' | 'update' | 'delete'): HandlerFunction<TUser> {
  return async (context: RequestContext<TUser>): Promise<HandlerResponse> => {
    // Check permissions
    const permissionCheck = config.permissions?.[operation];
    if (permissionCheck !== undefined) {
      const hasPermission = await checkPermission(context, permissionCheck);
      if (!hasPermission) {
        return {
          status: 403,
          body: {
            error: {
              message: 'Forbidden',
              code: 'FORBIDDEN'
            }
          }
        };
      }
    }

    // Apply middleware
    if (config.middleware && config.middleware.length > 0) {
      return await applyMiddleware(
        context,
        config.middleware,
        () => handler(context, config)
      );
    }

    // Execute handler directly
    return await handler(context, config);
  };
}

/**
 * Check permission
 */
async function checkPermission<TUser = unknown>(context: RequestContext<TUser>, check: PermissionCheck<TUser>): Promise<boolean> {
  // Array of required roles
  if (Array.isArray(check)) {
    if (!context.user) {
      return false;
    }

    // Check if user has any of the required roles
    // Assumes user object has a 'role' or 'roles' property
    const user = context.user;
    if (!user || typeof user !== 'object') {
      return false;
    }

    const userRecord = user as Record<string, unknown>;
    const userRole = typeof userRecord['role'] === 'string' ? userRecord['role'] : undefined;
    const userRoles = Array.isArray(userRecord['roles']) ? userRecord['roles'] as readonly string[] : undefined;

    if (userRole && check.includes(userRole)) {
      return true;
    }

    if (userRoles && userRoles.some((role) => check.includes(role))) {
      return true;
    }

    return false;
  }

  // Custom function
  if (typeof check === 'function') {
    return await check(context);
  }

  return false;
}

/**
 * Apply middleware chain
 */
async function applyMiddleware<TUser = unknown>(context: RequestContext<TUser>, middleware: readonly Middleware<TUser>[], handler: () => Promise<HandlerResponse>): Promise<HandlerResponse> {
  let index = 0;

  async function next(): Promise<HandlerResponse> {
    if (index >= middleware.length) {
      return await handler();
    }

    const currentMiddleware = middleware[index];
    index++;

    if (!currentMiddleware) {
      return await handler();
    }

    return await currentMiddleware(context, next);
  }

  return await next();
}

/**
 * Create handler for a single HTTP method
 *
 * @param config - Handler configuration
 * @param method - HTTP method
 * @returns Handler function
 */
export function createMethodHandler<TUser = unknown>(config: HandlerConfig<TUser>, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'): HandlerFunction<TUser> {
  const crud = createCrudHandler(config);

  return async (context: RequestContext<TUser>): Promise<HandlerResponse> => {
    switch (method) {
      case 'GET': {
        // Check if this is a collection or single resource
        if (context.params['id']) {
          return await crud.findOne(context);
        }
        return await crud.findMany(context);
      }

      case 'POST':
        return await crud.create(context);

      case 'PUT':
      case 'PATCH':
        return await crud.update(context);

      case 'DELETE':
        return await crud.delete(context);

      default:
        return {
          status: 405,
          body: {
            error: {
              message: 'Method not allowed',
              code: 'METHOD_NOT_ALLOWED'
            }
          }
        };
    }
  };
}

/**
 * Create handlers for all HTTP methods
 * Returns an object with GET, POST, PUT, DELETE handler functions
 *
 * @param config - Handler configuration
 * @returns Object with HTTP method handlers
 */
export function createHandlers<TUser = unknown>(config: HandlerConfig<TUser>): {
  readonly GET: HandlerFunction<TUser>;
  readonly POST: HandlerFunction<TUser>;
  readonly PUT: HandlerFunction<TUser>;
  readonly PATCH: HandlerFunction<TUser>;
  readonly DELETE: HandlerFunction<TUser>;
} {
  return {
    GET: createMethodHandler(config, 'GET'),
    POST: createMethodHandler(config, 'POST'),
    PUT: createMethodHandler(config, 'PUT'),
    PATCH: createMethodHandler(config, 'PATCH'),
    DELETE: createMethodHandler(config, 'DELETE')
  };
}

/**
 * Create a unified handler that routes based on HTTP method
 * Useful for frameworks that use a single handler for all methods
 *
 * @param config - Handler configuration
 * @returns Unified handler function
 */
export function createUnifiedHandler<TUser = unknown>(config: HandlerConfig<TUser>): HandlerFunction<TUser> {
  const handlers = createHandlers(config);

  return async (context: RequestContext<TUser>): Promise<HandlerResponse> => {
    const method = context.method;

    switch (method) {
      case 'GET':
        return await handlers.GET(context);
      case 'POST':
        return await handlers.POST(context);
      case 'PUT':
        return await handlers.PUT(context);
      case 'PATCH':
        return await handlers.PATCH(context);
      case 'DELETE':
        return await handlers.DELETE(context);
      default:
        return {
          status: 405,
          body: {
            error: {
              message: 'Method not allowed',
              code: 'METHOD_NOT_ALLOWED'
            }
          }
        };
    }
  };
}
