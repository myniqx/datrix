/**
 * API Handler - Factory Tests
 *
 * Tests the creation of protected handlers:
 * - Permission checking (roles, custom functions)
 * - Middleware execution and chaining
 * - Method-based routing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCrudHandler, createUnifiedHandler } from '@api/handler/factory';
import type { RequestContext, HandlerConfig, Middleware } from '@api/handler/types';
import type { DatabaseAdapter } from '@adapters/base/types';
import type { SchemaDefinition } from '@core/schema/types';

describe('API Handler - Factory', () => {
  let mockAdapter: any;
  let mockSchema: SchemaDefinition;

  beforeEach(() => {
    mockAdapter = {
      executeQuery: vi.fn()
    };

    mockSchema = {
      name: 'User',
      fields: {
        id: { type: 'number', primary: true }
      }
    };
  });

  describe('Permissions', () => {
    it('should allow access if no permissions are defined', async () => {
      mockAdapter.executeQuery.mockResolvedValue({ success: true, data: { rows: [] } });

      const config: HandlerConfig = {
        adapter: mockAdapter as DatabaseAdapter,
        schema: mockSchema
      };

      const crud = createCrudHandler(config);
      const response = await crud.findMany({ params: {}, query: {}, body: undefined, user: undefined });

      expect(response.status).toBe(200);
    });

    it('should forbid access if user role is not in allowed roles', async () => {
      const config: HandlerConfig = {
        adapter: mockAdapter as DatabaseAdapter,
        schema: mockSchema,
        permissions: {
          read: ['admin'] // Only admin can read
        }
      };

      const crud = createCrudHandler(config);

      // Case 1: No user
      const res1 = await crud.findMany({ params: {}, query: {}, body: undefined, user: undefined });
      expect(res1.status).toBe(403);

      // Case 2: Wrong role
      const res2 = await crud.findMany({
        params: {}, query: {}, body: undefined,
        user: { role: 'user' }
      });
      expect(res2.status).toBe(403);
    });

    it('should allow access if user has one of the required roles', async () => {
      mockAdapter.executeQuery.mockResolvedValue({ success: true, data: { rows: [] } });

      const config: HandlerConfig = {
        adapter: mockAdapter as DatabaseAdapter,
        schema: mockSchema,
        permissions: {
          read: ['admin', 'manager']
        }
      };

      const crud = createCrudHandler(config);
      const response = await crud.findMany({
        params: {}, query: {}, body: undefined,
        user: { role: 'manager' }
      });

      expect(response.status).toBe(200);
    });

    it('should support custom permission functions', async () => {
      const customCheck = vi.fn().mockImplementation(async (ctx) => {
        return ctx.params['secret'] === 'open-sesame';
      });

      const config: HandlerConfig = {
        adapter: mockAdapter as DatabaseAdapter,
        schema: mockSchema,
        permissions: {
          read: customCheck
        }
      };

      const crud = createCrudHandler(config);

      // Deny
      const res1 = await crud.findMany({ params: { secret: 'wrong' }, query: {}, body: undefined, user: undefined });
      expect(res1.status).toBe(403);

      // Allow
      mockAdapter.executeQuery.mockResolvedValue({ success: true, data: { rows: [] } });
      const res2 = await crud.findMany({ params: { secret: 'open-sesame' }, query: {}, body: undefined, user: undefined });
      expect(res2.status).toBe(200);
    });
  });

  describe('Middleware', () => {
    it('should execute middleware in order', async () => {
      const executionOrder: string[] = [];
      mockAdapter.executeQuery.mockResolvedValue({ success: true, data: { rows: [] } });

      const m1: Middleware = async (ctx, next) => {
        executionOrder.push('m1-start');
        const res = await next();
        executionOrder.push('m1-end');
        return res;
      };

      const m2: Middleware = async (ctx, next) => {
        executionOrder.push('m2-start');
        const res = await next();
        executionOrder.push('m2-end');
        return res;
      };

      const config: HandlerConfig = {
        adapter: mockAdapter as DatabaseAdapter,
        schema: mockSchema,
        middleware: [m1, m2]
      };

      const crud = createCrudHandler(config);
      await crud.findMany({ params: {}, query: {}, body: undefined, user: undefined });

      expect(executionOrder).toEqual(['m1-start', 'm2-start', 'm2-end', 'm1-end']);
    });

    it('should allow middleware to short-circuit the request', async () => {
      const m1: Middleware = async (ctx, next) => {
        return { status: 418, body: { message: "I'm a teapot" } };
      };

      const m2 = vi.fn().mockImplementation(async (ctx, next) => await next());

      const config: HandlerConfig = {
        adapter: mockAdapter as DatabaseAdapter,
        schema: mockSchema,
        middleware: [m1, m2]
      };

      const crud = createCrudHandler(config);
      const response = await crud.findMany({ params: {}, query: {}, body: undefined, user: undefined });

      expect(response.status).toBe(418);
      expect(m2).not.toHaveBeenCalled();
      expect(mockAdapter.executeQuery).not.toHaveBeenCalled();
    });
  });

  describe('Unified Handler Routing', () => {
    it('should route GET method correctly (Many vs One)', async () => {
      mockAdapter.executeQuery.mockResolvedValue({ success: true, data: { rows: [] } });

      const config: HandlerConfig = {
        adapter: mockAdapter as DatabaseAdapter,
        schema: mockSchema
      };

      const handler = createUnifiedHandler(config);

      // GET Many
      await handler({ method: 'GET', params: {}, query: {}, body: undefined, user: undefined });
      // findMany executes a select without ID or with specific limit (check SQL directly is better but here we mock)

      // GET One
      await handler({ method: 'GET', params: { id: '1' }, query: {}, body: undefined, user: undefined });

      // Verify adapter called 3 times (2 for Many - data+count, 1 for One)
      expect(mockAdapter.executeQuery).toHaveBeenCalledTimes(3);
    });

    it('should return 405 for unsupported methods', async () => {
      const config: HandlerConfig = {
        adapter: mockAdapter as DatabaseAdapter,
        schema: mockSchema
      };

      const handler = createUnifiedHandler(config);

      const response = await handler({
        method: 'OPTIONS',
        params: {}, query: {}, body: undefined, user: undefined
      });

      expect(response.status).toBe(405);
    });
  });
});
