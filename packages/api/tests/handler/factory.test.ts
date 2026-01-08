/**
 * API Handler - Factory Tests (Happy Path)
 *
 * Tests handler factory creation and routing:
 * - Permission checking (roles, custom functions)
 * - Middleware execution and chaining
 * - Method-based routing (GET, POST, PUT, DELETE)
 * - Unified handler
 * - CRUD handler creation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCrudHandler, createUnifiedHandler, createHandlers, createMethodHandler } from '../../src/handler/factory';
import { crudTestData, factoryTestData } from '../../../types/src/test/fixtures';
import type { DatabaseAdapter } from '../../../types/src/adapter';
import type { HandlerConfig, RequestContext, Middleware } from '../../../types/src/api/handler';
import type { SchemaDefinition } from '../../../types/src/core/schema';

describe('API Handler - Factory (Happy Path)', () => {
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

  describe('createCrudHandler', () => {
    it('should create handler with all CRUD methods', () => {
      const crudHandler = createCrudHandler(baseConfig);

      expect(crudHandler.findMany).toBeDefined();
      expect(crudHandler.findOne).toBeDefined();
      expect(crudHandler.create).toBeDefined();
      expect(crudHandler.update).toBeDefined();
      expect(crudHandler.delete).toBeDefined();
      expect(crudHandler.count).toBeDefined();
    });

    it('should allow access when no permissions defined', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const crudHandler = createCrudHandler(baseConfig);
      const context: RequestContext = { ...baseContext, method: 'GET' };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(200);
    });

    it('should execute findMany successfully', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [crudTestData.validUserRecord], metadata: { rowCount: 1, affectedRows: 0 } },
      });

      const crudHandler = createCrudHandler(baseConfig);
      const context: RequestContext = { ...baseContext, method: 'GET' };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([crudTestData.validUserRecord]);
    });

    it('should execute findOne successfully', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [crudTestData.validUserRecord], metadata: { rowCount: 1, affectedRows: 0 } },
      });

      const crudHandler = createCrudHandler(baseConfig);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
        params: { id: '1' },
      };

      const response = await crudHandler.findOne(context);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(crudTestData.validUserRecord);
    });

    it('should execute create successfully', async () => {
      const createdRecord = { id: 10, ...crudTestData.validUserInput };

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [createdRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const crudHandler = createCrudHandler(baseConfig);
      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: crudTestData.validUserInput,
      };

      const response = await crudHandler.create(context);

      expect(response.status).toBe(201);
      expect(response.body.data).toEqual(createdRecord);
    });

    it('should execute update successfully', async () => {
      const updatedRecord = { ...crudTestData.validUserRecord, name: 'Updated' };

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [updatedRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const crudHandler = createCrudHandler(baseConfig);
      const context: RequestContext = {
        ...baseContext,
        method: 'PUT',
        params: { id: '1' },
        body: { name: 'Updated' },
      };

      const response = await crudHandler.update(context);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(updatedRecord);
    });

    it('should execute delete successfully', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [crudTestData.validUserRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const crudHandler = createCrudHandler(baseConfig);
      const context: RequestContext = {
        ...baseContext,
        method: 'DELETE',
        params: { id: '1' },
      };

      const response = await crudHandler.delete(context);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(crudTestData.validUserRecord);
    });

    it('should execute count successfully', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [{ count: 42 }], metadata: { rowCount: 1, affectedRows: 0 } },
      });

      const crudHandler = createCrudHandler(baseConfig);
      const context: RequestContext = { ...baseContext, method: 'GET' };

      const response = await crudHandler.count(context);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ count: 42 });
    });
  });

  describe('Permissions - Role-based', () => {
    it('should allow access if user has required role', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

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
        user: factoryTestData.adminUser,
      };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(200);
    });

    it('should allow access if user has one of multiple required roles', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {
          read: ['admin', 'manager', 'user'],
        },
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
        user: factoryTestData.managerUser,
      };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(200);
    });

    it('should support users with multiple roles array', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {
          read: ['editor', 'admin'],
        },
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
        user: factoryTestData.userWithMultipleRoles,
      };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(200);
    });

    it('should have different permissions for different operations', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {
          read: ['user', 'admin'],
          create: ['admin'],
          update: ['admin'],
          delete: ['admin'],
        },
      };

      const crudHandler = createCrudHandler(config);

      const readContext: RequestContext = {
        ...baseContext,
        method: 'GET',
        user: factoryTestData.regularUser,
      };

      const readResponse = await crudHandler.findMany(readContext);
      expect(readResponse.status).toBe(200);

      const createContext: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: crudTestData.validUserInput,
        user: factoryTestData.regularUser,
      };

      const createResponse = await crudHandler.create(createContext);
      expect(createResponse.status).toBe(403);
    });
  });

  describe('Permissions - Custom Functions', () => {
    it('should allow access with custom permission function', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const customPermission = vi.fn().mockResolvedValue(true);

      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {
          read: customPermission,
        },
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
        user: factoryTestData.regularUser,
      };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(200);
      expect(customPermission).toHaveBeenCalledWith(context);
    });

    it('should support context-based permission logic', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const ownershipCheck = vi.fn().mockImplementation(async (ctx) => {
        return ctx.params['userId'] === ctx.user?.id?.toString();
      });

      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {
          read: ownershipCheck,
        },
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
        params: { userId: '2' },
        user: factoryTestData.regularUser,
      };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(200);
      expect(ownershipCheck).toHaveBeenCalledWith(context);
    });

    it('should support async custom permission functions', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const asyncPermission = vi.fn().mockImplementation(async (ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return true;
      });

      const config: HandlerConfig = {
        ...baseConfig,
        permissions: {
          read: asyncPermission,
        },
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
      };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(200);
      expect(asyncPermission).toHaveBeenCalled();
    });
  });

  describe('Middleware Execution', () => {
    it('should execute single middleware', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const middleware = vi.fn().mockImplementation(async (ctx, next) => {
        return await next();
      });

      const config: HandlerConfig = {
        ...baseConfig,
        middleware: [middleware],
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = { ...baseContext, method: 'GET' };

      await crudHandler.findMany(context);

      expect(middleware).toHaveBeenCalledWith(context, expect.any(Function));
    });

    it('should execute multiple middleware in order', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const executionOrder: string[] = [];

      const middleware1: Middleware = vi.fn().mockImplementation(async (ctx, next) => {
        executionOrder.push('m1-before');
        const result = await next();
        executionOrder.push('m1-after');
        return result;
      });

      const middleware2: Middleware = vi.fn().mockImplementation(async (ctx, next) => {
        executionOrder.push('m2-before');
        const result = await next();
        executionOrder.push('m2-after');
        return result;
      });

      const config: HandlerConfig = {
        ...baseConfig,
        middleware: [middleware1, middleware2],
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = { ...baseContext, method: 'GET' };

      await crudHandler.findMany(context);

      expect(executionOrder).toEqual(['m1-before', 'm2-before', 'm2-after', 'm1-after']);
    });

    it('should allow middleware to modify context', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const contextModifier: Middleware = vi.fn().mockImplementation(async (ctx, next) => {
        ctx.metadata = { ...ctx.metadata, injected: true };
        return await next();
      });

      const config: HandlerConfig = {
        ...baseConfig,
        middleware: [contextModifier],
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = { ...baseContext, method: 'GET' };

      await crudHandler.findMany(context);

      expect(context.metadata).toEqual({ injected: true });
    });

    it('should allow middleware to short-circuit request', async () => {
      const shortCircuitMiddleware: Middleware = vi.fn().mockImplementation(async (ctx, next) => {
        return {
          status: 418,
          body: { message: "I'm a teapot" },
        };
      });

      const middleware2 = vi.fn();

      const config: HandlerConfig = {
        ...baseConfig,
        middleware: [shortCircuitMiddleware, middleware2],
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = { ...baseContext, method: 'GET' };

      const response = await crudHandler.findMany(context);

      expect(response.status).toBe(418);
      expect(response.body).toEqual({ message: "I'm a teapot" });
      expect(middleware2).not.toHaveBeenCalled();
      expect(mockAdapter.executeQuery).not.toHaveBeenCalled();
    });

    it('should allow middleware to modify response', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [crudTestData.validUserRecord], metadata: { rowCount: 1, affectedRows: 0 } },
      });

      const responseModifier: Middleware = vi.fn().mockImplementation(async (ctx, next) => {
        const response = await next();
        return {
          ...response,
          body: {
            ...response.body,
            metadata: { enhanced: true },
          },
        };
      });

      const config: HandlerConfig = {
        ...baseConfig,
        middleware: [responseModifier],
      };

      const crudHandler = createCrudHandler(config);
      const context: RequestContext = { ...baseContext, method: 'GET' };

      const response = await crudHandler.findMany(context);

      expect(response.body).toHaveProperty('metadata');
      expect((response.body as any).metadata.enhanced).toBe(true);
    });
  });

  describe('createUnifiedHandler', () => {
    it('should route GET without ID to findMany', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [crudTestData.validUserRecord], metadata: { rowCount: 1, affectedRows: 0 } },
      });

      const handler = createUnifiedHandler(baseConfig);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
        params: {},
      };

      const response = await handler(context);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should route GET with ID to findOne', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [crudTestData.validUserRecord], metadata: { rowCount: 1, affectedRows: 0 } },
      });

      const handler = createUnifiedHandler(baseConfig);
      const context: RequestContext = {
        ...baseContext,
        method: 'GET',
        params: { id: '1' },
      };

      const response = await handler(context);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(crudTestData.validUserRecord);
    });

    it('should route POST to create', async () => {
      const createdRecord = { id: 10, ...crudTestData.validUserInput };

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [createdRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const handler = createUnifiedHandler(baseConfig);
      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: crudTestData.validUserInput,
      };

      const response = await handler(context);

      expect(response.status).toBe(201);
    });

    it('should route PUT to update', async () => {
      const updatedRecord = { ...crudTestData.validUserRecord, name: 'Updated' };

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [updatedRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const handler = createUnifiedHandler(baseConfig);
      const context: RequestContext = {
        ...baseContext,
        method: 'PUT',
        params: { id: '1' },
        body: { name: 'Updated' },
      };

      const response = await handler(context);

      expect(response.status).toBe(200);
    });

    it('should route PATCH to update', async () => {
      const updatedRecord = { ...crudTestData.validUserRecord, age: 26 };

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [updatedRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const handler = createUnifiedHandler(baseConfig);
      const context: RequestContext = {
        ...baseContext,
        method: 'PATCH',
        params: { id: '1' },
        body: { age: 26 },
      };

      const response = await handler(context);

      expect(response.status).toBe(200);
    });

    it('should route DELETE to delete', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [crudTestData.validUserRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const handler = createUnifiedHandler(baseConfig);
      const context: RequestContext = {
        ...baseContext,
        method: 'DELETE',
        params: { id: '1' },
      };

      const response = await handler(context);

      expect(response.status).toBe(200);
    });

    it('should return 405 for unsupported methods', async () => {
      const handler = createUnifiedHandler(baseConfig);
      const context: RequestContext = {
        ...baseContext,
        method: 'OPTIONS' as any,
      };

      const response = await handler(context);

      expect(response.status).toBe(405);
      expect(response.body.error?.code).toBe('METHOD_NOT_ALLOWED');
    });
  });

  describe('createHandlers', () => {
    it('should create handlers for all HTTP methods', () => {
      const handlers = createHandlers(baseConfig);

      expect(handlers.GET).toBeDefined();
      expect(handlers.POST).toBeDefined();
      expect(handlers.PUT).toBeDefined();
      expect(handlers.PATCH).toBeDefined();
      expect(handlers.DELETE).toBeDefined();
    });

    it('should create independent handlers', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const handlers = createHandlers(baseConfig);
      const context: RequestContext = { ...baseContext, method: 'GET' };

      await handlers.GET(context);
      await handlers.POST({ ...context, method: 'POST', body: crudTestData.validUserInput });

      expect(mockAdapter.executeQuery).toHaveBeenCalled();
      expect(mockAdapter.executeQuery.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('createMethodHandler', () => {
    it('should create GET handler', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const handler = createMethodHandler(baseConfig, 'GET');
      const context: RequestContext = { ...baseContext, method: 'GET' };

      const response = await handler(context);

      expect(response.status).toBe(200);
    });

    it('should create POST handler', async () => {
      const createdRecord = { id: 10, ...crudTestData.validUserInput };

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [createdRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const handler = createMethodHandler(baseConfig, 'POST');
      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: crudTestData.validUserInput,
      };

      const response = await handler(context);

      expect(response.status).toBe(201);
    });
  });
});
