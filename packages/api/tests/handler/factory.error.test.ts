/**
 * API Handler - Factory Tests (Error Path)
 *
 * Tests error handling for factory functions:
 * - Permission denial (missing user, wrong role)
 * - Middleware errors
 * - Invalid method routing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCrudHandler, createUnifiedHandler } from '../../src/handler/factory';
import { crudTestData, factoryTestData } from '../../../types/src/test/fixtures';
import type { DatabaseAdapter } from '../../../types/src/adapter';
import type { HandlerConfig, RequestContext, Middleware } from '../../../types/src/api/handler';
import type { SchemaDefinition } from '../../../types/src/core/schema';

describe('API Handler - Factory (Error Path)', () => {
  let mockAdapter: DatabaseAdapter;
  let mockSchema: SchemaDefinition;
  let baseContext: RequestContext;
  let baseConfig: HandlerConfig;

  beforeEach(() => {
    mockAdapter = {
      name: 'mock-adapter',
      connect: vi.fn(),
      disconnect: vi.fn(),
      executeQuery: vi.fn(),
      introspect: vi.fn(),
      startTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
    } as unknown as DatabaseAdapter;

    mockSchema = crudTestData.mockUserSchema;
    baseContext = { ...crudTestData.validRequestContext };
    baseConfig = {
      adapter: mockAdapter,
      schema: mockSchema,
    };

    vi.clearAllMocks();
  });

  describe('Permissions - Denial Cases', () => {
    it('should deny access when no user provided and permissions required', async () => {
      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {
          read: ['admin'],
        },
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
        user: undefined,
      };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(403);
      expect(response.body.error?.code).toBe('FORBIDDEN');
      expect(mockAdapter.executeQuery).not.toHaveBeenCalled();
    });

    it('should deny access when user has wrong role', async () => {
      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {
          read: ['admin'],
        },
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
        user: factoryTestData.regularUser,
      };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(403);
      expect(response.body.error?.code).toBe('FORBIDDEN');
      expect(mockAdapter.executeQuery).not.toHaveBeenCalled();
    });

    it('should deny access when user role not in allowed list', async () => {
      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {
          create: ['admin', 'manager'],
        },
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: crudTestData.validUserInput,
        user: factoryTestData.regularUser,
      };

      const response = await crudHandler.create(context);

      expect(response.status).toBe(403);
      expect(mockAdapter.executeQuery).not.toHaveBeenCalled();
    });

    it('should deny access when user object has no role property', async () => {
      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {
          read: ['admin'],
        },
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
        user: { id: 1, username: 'noRole' },
      };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(403);
    });

    it('should deny access when custom permission function returns false', async () => {
      const denyPermission = vi.fn().mockResolvedValue(false);

      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {
          read: denyPermission,
        },
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
        user: factoryTestData.adminUser,
      };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(403);
      expect(denyPermission).toHaveBeenCalledWith(context);
      expect(mockAdapter.executeQuery).not.toHaveBeenCalled();
    });

    it('should deny access for all operations when permissions defined', async () => {
      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {
          read: ['admin'],
          create: ['admin'],
          update: ['admin'],
          delete: ['admin'],
        },
      };

      const crudHandler = createCrudHandler(config);
      const regularUserContext = { ...baseContext, user: factoryTestData.regularUser };

      const findManyResponse = await crudHandler.findMany(regularUserContext);
      expect(findManyResponse.status).toBe(403);

      const findOneResponse = await crudHandler.findOne({ ...regularUserContext, params: { id: '1' } });
      expect(findOneResponse.status).toBe(403);

      const createResponse = await crudHandler.create({ ...regularUserContext, body: crudTestData.validUserInput });
      expect(createResponse.status).toBe(403);

      const updateResponse = await crudHandler.update({ ...regularUserContext, params: { id: '1' }, body: { name: 'Updated' } });
      expect(updateResponse.status).toBe(403);

      const deleteResponse = await crudHandler.delete({ ...regularUserContext, params: { id: '1' } });
      expect(deleteResponse.status).toBe(403);

      expect(mockAdapter.executeQuery).not.toHaveBeenCalled();
    });

    it('should deny when user has role as string but empty', async () => {
      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {
          read: ['admin'],
        },
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
        user: { id: 1, role: '' },
      };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(403);
    });

    it('should deny when user roles array is empty', async () => {
      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {
          read: ['admin'],
        },
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
        user: { id: 1, roles: [] },
      };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(403);
    });

    it('should deny when user object is not an object', async () => {
      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {
          read: ['admin'],
        },
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
        user: 'not-an-object' as any,
      };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(403);
    });
  });

  describe('Middleware Error Handling', () => {
    it('should propagate errors thrown by middleware', async () => {
      const errorMiddleware: Middleware = vi.fn().mockRejectedValue(new Error('Middleware error'));

      const config: HandlerConfig = {
        ...baseConfig,
        middleware: [errorMiddleware],
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = { ...baseContext, method: 'GET' };

      await expect(crudHandler.findMany(context)).rejects.toThrow('Middleware error');
      expect(mockAdapter.executeQuery).not.toHaveBeenCalled();
    });

    it('should handle middleware returning error response', async () => {
      const errorMiddleware: Middleware = vi.fn().mockImplementation(async () => {
        return {
          status: 400,
          body: { error: { message: 'Bad Request', code: 'BAD_REQUEST' } },
        };
      });

      const config: HandlerConfig = {
        ...baseConfig,
        middleware: [errorMiddleware],
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = { ...baseContext, method: 'GET' };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('BAD_REQUEST');
      expect(mockAdapter.executeQuery).not.toHaveBeenCalled();
    });

    it('should stop at first middleware that returns response', async () => {
      const middleware1: Middleware = vi.fn().mockImplementation(async () => {
        return {
          status: 401,
          body: { error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } },
        };
      });

      const middleware2 = vi.fn();
      const middleware3 = vi.fn();

      const config: HandlerConfig = {
        ...baseConfig,
        middleware: [middleware1, middleware2, middleware3],
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = { ...baseContext, method: 'GET' };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(401);
      expect(middleware1).toHaveBeenCalled();
      expect(middleware2).not.toHaveBeenCalled();
      expect(middleware3).not.toHaveBeenCalled();
      expect(mockAdapter.executeQuery).not.toHaveBeenCalled();
    });

    it('should handle middleware that does not call next', async () => {
      const hangingMiddleware: Middleware = vi.fn().mockImplementation(async (ctx, next) => {
        return {
          status: 429,
          body: { error: { message: 'Rate limit exceeded', code: 'RATE_LIMIT' } },
        };
      });

      const config: HandlerConfig = {
        ...baseConfig,
        middleware: [hangingMiddleware],
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = { ...baseContext, method: 'GET' };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(429);
      expect(mockAdapter.executeQuery).not.toHaveBeenCalled();
    });
  });

  describe('Unified Handler Error Cases', () => {
    it('should return 405 for unsupported HTTP methods', async () => {
      const handler = createUnifiedHandler(baseConfig);

      const unsupportedMethods = ['OPTIONS', 'HEAD', 'TRACE', 'CONNECT'];

      for (const method of unsupportedMethods) {
        const context: RequestContext = {
          ...baseContext,
          method: method as any,
        };

        const response = await handler(context);

        expect(response.status).toBe(405);
        expect(response.body.error?.code).toBe('METHOD_NOT_ALLOWED');
        expect(response.body.error?.message).toBe('Method not allowed');
      }

      expect(mockAdapter.executeQuery).not.toHaveBeenCalled();
    });

    it('should handle undefined method gracefully', async () => {
      const handler = createUnifiedHandler(baseConfig);
      const context: RequestContext = {
        ...baseContext,
        method: undefined as any,
      };

      const response = await handler(context);

      expect(response.status).toBe(405);
    });

    it('should handle null method gracefully', async () => {
      const handler = createUnifiedHandler(baseConfig);
      const context: RequestContext = {
        ...baseContext,
        method: null as any,
      };

      const response = await handler(context);

      expect(response.status).toBe(405);
    });
  });

  describe('Permission and Middleware Combined', () => {
    it('should check permissions before running middleware', async () => {
      const middleware = vi.fn().mockImplementation(async (ctx, next) => next());

      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {
          read: ['admin'],
        },
        middleware: [middleware],
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
        user: factoryTestData.regularUser,
      };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(403);
      expect(middleware).not.toHaveBeenCalled();
      expect(mockAdapter.executeQuery).not.toHaveBeenCalled();
    });

    it('should run middleware after permission check passes', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const middleware = vi.fn().mockImplementation(async (ctx, next) => next());

      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {
          read: ['admin'],
        },
        middleware: [middleware],
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
        user: factoryTestData.adminUser,
      };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(200);
      expect(middleware).toHaveBeenCalled();
    });

    it('should deny in middleware even if permissions pass', async () => {
      const denyMiddleware: Middleware = vi.fn().mockImplementation(async () => {
        return {
          status: 403,
          body: { error: { message: 'Custom deny', code: 'CUSTOM_DENY' } },
        };
      });

      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {
          read: ['admin'],
        },
        middleware: [denyMiddleware],
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
        user: factoryTestData.adminUser,
      };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(403);
      expect(response.body.error?.code).toBe('CUSTOM_DENY');
      expect(mockAdapter.executeQuery).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle context with missing params', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const crudHandler = createCrudHandler(baseConfig);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
        params: undefined as any,
      };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(200);
    });

    it('should handle empty permissions object', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {},
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = { ...baseContext, method: 'GET' };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(200);
    });

    it('should handle empty middleware array', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const config: HandlerConfig = {
        ...baseConfig,
        middleware: [],
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = { ...baseContext, method: 'GET' };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(200);
    });
  });
});
