/**
 * API Handler - CRUD Tests
 *
 * Tests the core CRUD handlers:
 * - findMany with pagination and hooks
 * - findOne with error handling
 * - create with validation
 * - update and delete
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findMany, findOne, create, update, deleteRecord } from '@api/handler/crud';
import type { RequestContext, HandlerConfig } from '@api/handler/types';
import type { DatabaseAdapter } from '@adapters/base/types';
import type { SchemaDefinition } from '@core/schema/types';

describe('API Handler - CRUD', () => {
  let mockAdapter: any;
  let mockSchema: SchemaDefinition;

  beforeEach(() => {
    mockAdapter = {
      executeQuery: vi.fn()
    };

    mockSchema = {
      name: 'User',
      tableName: 'users',
      fields: {
        id: { type: 'number', primary: true },
        name: { type: 'string', required: true },
        email: { type: 'string', required: true }
      }
    };
  });

  describe('findMany', () => {
    it('should return many records successfully', async () => {
      const mockRows = [
        { id: 1, name: 'John' },
        { id: 2, name: 'Jane' }
      ];

      mockAdapter.executeQuery.mockResolvedValue({
        success: true,
        data: { rows: mockRows, metadata: { rowCount: 2, affectedRows: 0 } }
      });

      const context: RequestContext = {
        params: {},
        query: {},
        body: undefined,
        user: undefined
      };

      const config: HandlerConfig = {
        adapter: mockAdapter as DatabaseAdapter,
        schema: mockSchema
      };

      const response = await findMany(context, config);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(mockRows);
      expect(mockAdapter.executeQuery).toHaveBeenCalled();
    });

    it('should handle pagination and return total count', async () => {
      // First call for records, second for count
      mockAdapter.executeQuery
        .mockResolvedValueOnce({
          success: true,
          data: { rows: [{ id: 1 }], metadata: { rowCount: 1, affectedRows: 0 } }
        })
        .mockResolvedValueOnce({
          success: true,
          data: { rows: [{ count: 100 }], metadata: { rowCount: 1, affectedRows: 0 } }
        });

      const context: RequestContext = {
        params: {},
        query: { page: '1', pageSize: '10' },
        body: undefined,
        user: undefined
      };

      const config: HandlerConfig = {
        adapter: mockAdapter as DatabaseAdapter,
        schema: mockSchema
      };

      const response = await findMany(context, config);

      expect(response.status).toBe(200);
      expect(response.body.meta?.pagination).toEqual({
        page: 1,
        pageSize: 10,
        total: 100,
        pageCount: 10
      });
      // Verify two queries were executed
      expect(mockAdapter.executeQuery).toHaveBeenCalledTimes(2);
    });

    it('should execute beforeFind and afterFind hooks', async () => {
      const mockRows = [{ id: 1, name: 'John' }];
      mockAdapter.executeQuery.mockResolvedValue({
        success: true,
        data: { rows: mockRows, metadata: { rowCount: 1, affectedRows: 0 } }
      });

      const beforeFindHook = vi.fn().mockImplementation((ctx, query) => ({ ...query, limit: 123 }));
      const afterFindHook = vi.fn().mockImplementation((ctx, results) =>
        results.map((r: any) => ({ ...r, hooked: true }))
      );

      const context: RequestContext = {
        params: {},
        query: {},
        body: undefined,
        user: undefined
      };

      const config: HandlerConfig = {
        adapter: mockAdapter as DatabaseAdapter,
        schema: mockSchema,
        hooks: {
          beforeFind: beforeFindHook,
          afterFind: afterFindHook
        }
      };

      const response = await findMany(context, config);

      expect(beforeFindHook).toHaveBeenCalled();
      expect(afterFindHook).toHaveBeenCalled();
      expect(response.body.data[0].hooked).toBe(true);

      // Verify beforeFind modified the query (check query builder call indirectly through adapter)
      const lastCall = mockAdapter.executeQuery.mock.calls[0][0];
      expect(lastCall.limit).toBe(123);
    });
  });

  describe('findOne', () => {
    it('should return a single record by ID', async () => {
      const mockRow = { id: 1, name: 'John' };
      mockAdapter.executeQuery.mockResolvedValue({
        success: true,
        data: { rows: [mockRow], metadata: { rowCount: 1, affectedRows: 0 } }
      });

      const context: RequestContext = {
        params: { id: '1' },
        query: {},
        body: undefined,
        user: undefined
      };

      const config: HandlerConfig = {
        adapter: mockAdapter as DatabaseAdapter,
        schema: mockSchema
      };

      const response = await findOne(context, config);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(mockRow);
    });

    it('should return 404 when record not found', async () => {
      mockAdapter.executeQuery.mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } }
      });

      const context: RequestContext = {
        params: { id: '999' },
        query: {},
        body: undefined,
        user: undefined
      };

      const config: HandlerConfig = {
        adapter: mockAdapter as DatabaseAdapter,
        schema: mockSchema
      };

      const response = await findOne(context, config);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('create', () => {
    it('should create a new record', async () => {
      const mockInput = { name: 'New User', email: 'new@example.com' };
      const mockOutput = { id: 10, ...mockInput };

      mockAdapter.executeQuery.mockResolvedValue({
        success: true,
        data: { rows: [mockOutput], metadata: { rowCount: 1, affectedRows: 1 } }
      });

      const context: RequestContext = {
        params: {},
        query: {},
        body: mockInput,
        user: undefined
      };

      const config: HandlerConfig = {
        adapter: mockAdapter as DatabaseAdapter,
        schema: mockSchema
      };

      const response = await create(context, config);

      expect(response.status).toBe(201);
      expect(response.body.data).toEqual(mockOutput);
    });

    it('should return 400 on validation failure', async () => {
      const invalidInput = { name: '' }; // Missing email, empty name (if validation supports it)

      const context: RequestContext = {
        params: {},
        query: {},
        body: invalidInput,
        user: undefined
      };

      const config: HandlerConfig = {
        adapter: mockAdapter as DatabaseAdapter,
        schema: mockSchema
      };

      const response = await create(context, config);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('update', () => {
    it('should update a record', async () => {
      const mockInput = { name: 'Updated Name' };
      const mockOutput = { id: 1, name: 'Updated Name', email: 'john@example.com' };

      mockAdapter.executeQuery.mockResolvedValue({
        success: true,
        data: { rows: [mockOutput], metadata: { rowCount: 1, affectedRows: 1 } }
      });

      const context: RequestContext = {
        params: { id: '1' },
        query: {},
        body: mockInput,
        user: undefined
      };

      const config: HandlerConfig = {
        adapter: mockAdapter as DatabaseAdapter,
        schema: mockSchema
      };

      const response = await update(context, config);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(mockOutput);
    });
  });

  describe('delete', () => {
    it('should delete a record', async () => {
      const mockDeleted = { id: 1, name: 'John' };

      mockAdapter.executeQuery.mockResolvedValue({
        success: true,
        data: { rows: [mockDeleted], metadata: { rowCount: 1, affectedRows: 1 } }
      });

      const context: RequestContext = {
        params: { id: '1' },
        query: {},
        body: undefined,
        user: undefined
      };

      const config: HandlerConfig = {
        adapter: mockAdapter as DatabaseAdapter,
        schema: mockSchema
      };

      const response = await deleteRecord(context, config);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(mockDeleted);
    });
  });
});
