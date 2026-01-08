/**
 * API Handler - CRUD Tests (Error Path)
 *
 * Tests error handling for CRUD operations:
 * - Validation errors
 * - Missing required data
 * - Not found errors (404)
 * - Invalid IDs
 * - Database query failures
 * - Invalid request body
 * - Hook failures
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create, deleteRecord, findMany, findOne, update, count } from '../../src/handler/crud';
import { crudTestData, edgeCases } from '../../../types/src/test/fixtures';
import type { DatabaseAdapter } from '../../../types/src/adapter';
import type { HandlerConfig, RequestContext } from '../../../types/src/api/handler';
import type { SchemaDefinition } from '../../../types/src/core/schema';

describe('API Handler - CRUD (Error Path)', () => {
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

  describe('findMany - Error Cases', () => {
    it('should return 400 for invalid query parameters', async () => {
      const context: RequestContext = {
        ...baseContext,
        query: { page: 'invalid', pageSize: 'abc' },
      };

      const response = await findMany(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('INVALID_QUERY');
    });

    it('should return 500 when database query fails', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: false,
        error: new Error('Database connection failed'),
      });

      const context: RequestContext = { ...baseContext };
      const response = await findMany(context, baseConfig);

      expect(response.status).toBe(500);
      expect(response.body.error?.code).toBe('QUERY_ERROR');
    });

    it('should return 400 for invalid field names in select', async () => {
      const context: RequestContext = {
        ...baseContext,
        query: { 'fields[0]': 'nonExistentField' },
      };

      const response = await findMany(context, baseConfig);

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid where operator', async () => {
      const context: RequestContext = {
        ...baseContext,
        query: { 'where[age][$invalidOp]': '25' },
      };

      const response = await findMany(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('INVALID_QUERY');
    });

    it('should return 400 for negative page number', async () => {
      const context: RequestContext = {
        ...baseContext,
        query: { page: '-1', pageSize: '10' },
      };

      const response = await findMany(context, baseConfig);

      expect(response.status).toBe(400);
    });

    it('should return 400 for zero page size', async () => {
      const context: RequestContext = {
        ...baseContext,
        query: { page: '1', pageSize: '0' },
      };

      const response = await findMany(context, baseConfig);

      expect(response.status).toBe(400);
    });

    it('should return 400 for excessively large page size', async () => {
      const context: RequestContext = {
        ...baseContext,
        query: { page: '1', pageSize: '10000' },
      };

      const response = await findMany(context, baseConfig);

      expect(response.status).toBe(400);
    });

    it('should handle beforeFind hook throwing error', async () => {
      const beforeFindHook = vi.fn().mockRejectedValue(new Error('Hook failed'));

      const context: RequestContext = { ...baseContext };
      const config: HandlerConfig = {
        ...baseConfig,
        hooks: { beforeFind: beforeFindHook },
      };

      const response = await findMany(context, config);

      expect(response.status).toBe(500);
      expect(response.body.error?.code).toBe('INTERNAL_ERROR');
    });

    it('should handle afterFind hook throwing error', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [crudTestData.validUserRecord], metadata: { rowCount: 1, affectedRows: 0 } },
      });

      const afterFindHook = vi.fn().mockRejectedValue(new Error('Hook failed'));

      const context: RequestContext = { ...baseContext };
      const config: HandlerConfig = {
        ...baseConfig,
        hooks: { afterFind: afterFindHook },
      };

      const response = await findMany(context, config);

      expect(response.status).toBe(500);
      expect(response.body.error?.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('findOne - Error Cases', () => {
    it('should return 400 when ID parameter is missing', async () => {
      const context: RequestContext = {
        ...baseContext,
        params: {},
      };

      const response = await findOne(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('MISSING_ID');
      expect(response.body.error?.message).toContain('ID parameter is required');
    });

    it('should return 404 when record not found', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const context: RequestContext = {
        ...baseContext,
        params: { id: '999' },
      };

      const response = await findOne(context, baseConfig);

      expect(response.status).toBe(404);
      expect(response.body.error?.code).toBe('NOT_FOUND');
      expect(response.body.error?.message).toBe('Record not found');
    });

    it('should return 500 when database query fails', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: false,
        error: new Error('Database error'),
      });

      const context: RequestContext = {
        ...baseContext,
        params: { id: '1' },
      };

      const response = await findOne(context, baseConfig);

      expect(response.status).toBe(500);
      expect(response.body.error?.code).toBe('QUERY_ERROR');
    });

    it('should return 400 for invalid query parameters', async () => {
      const context: RequestContext = {
        ...baseContext,
        params: { id: '1' },
        query: { 'fields[0]': 'nonExistentField' },
      };

      const response = await findOne(context, baseConfig);

      expect(response.status).toBe(400);
    });

    it('should return 500 when result is not a valid object', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [null], metadata: { rowCount: 1, affectedRows: 0 } },
      });

      const context: RequestContext = {
        ...baseContext,
        params: { id: '1' },
      };

      const response = await findOne(context, baseConfig);

      expect(response.status).toBe(500);
      expect(response.body.error?.code).toBe('INVALID_RESULT');
    });

    it('should return 500 when result is an array instead of object', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [[]], metadata: { rowCount: 1, affectedRows: 0 } },
      });

      const context: RequestContext = {
        ...baseContext,
        params: { id: '1' },
      };

      const response = await findOne(context, baseConfig);

      expect(response.status).toBe(500);
      expect(response.body.error?.code).toBe('INVALID_RESULT');
    });
  });

  describe('create - Validation Errors', () => {
    it('should return 400 when body is missing', async () => {
      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: undefined,
      };

      const response = await create(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('INVALID_BODY');
    });

    it('should return 400 when body is not an object', async () => {
      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: 'string body',
      };

      const response = await create(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('INVALID_BODY');
    });

    it('should return 400 when body is an array', async () => {
      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: [{ name: 'User' }],
      };

      const response = await create(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('INVALID_BODY');
    });

    it('should return 400 for missing required field (email)', async () => {
      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: crudTestData.invalidUserInput.missingEmail,
      };

      const response = await create(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing required field (name)', async () => {
      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: crudTestData.invalidUserInput.missingName,
      };

      const response = await create(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when hook adds unknown field to schema', async () => {
      const beforeCreateHook = vi.fn().mockImplementation((ctx, data) => ({
        ...data,
        unknownField: 'should not be allowed',
      }));

      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: crudTestData.validUserInput,
      };

      const config: HandlerConfig = {
        ...baseConfig,
        hooks: { beforeCreate: beforeCreateHook },
      };

      const response = await create(context, config);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('VALIDATION_ERROR');
      expect(response.body.error?.details).toBeDefined();
      if (Array.isArray(response.body.error?.details)) {
        expect(response.body.error.details.some((err: any) => err.field === 'unknownField')).toBe(true);
      }
    });

    it('should return 400 for invalid email format', async () => {
      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: crudTestData.invalidUserInput.invalidEmail,
      };

      const response = await create(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for name too short', async () => {
      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: crudTestData.invalidUserInput.tooShortName,
      };

      const response = await create(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for age below minimum', async () => {
      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: crudTestData.invalidUserInput.tooYoung,
      };

      const response = await create(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid enum value', async () => {
      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: crudTestData.invalidUserInput.invalidRole,
      };

      const response = await create(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should return 500 when database insert fails', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: false,
        error: new Error('Insert failed'),
      });

      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: crudTestData.validUserInput,
      };

      const response = await create(context, baseConfig);

      expect(response.status).toBe(500);
      expect(response.body.error?.code).toBe('QUERY_ERROR');
    });

    it('should return 500 when no data returned from insert', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: crudTestData.validUserInput,
      };

      const response = await create(context, baseConfig);

      expect(response.status).toBe(500);
      expect(response.body.error?.code).toBe('QUERY_ERROR');
      expect(response.body.error?.message).toContain('No data returned');
    });

    it('should handle beforeCreate hook throwing error', async () => {
      const beforeCreateHook = vi.fn().mockRejectedValue(new Error('Hook failed'));

      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: crudTestData.validUserInput,
      };

      const config: HandlerConfig = {
        ...baseConfig,
        hooks: { beforeCreate: beforeCreateHook },
      };

      const response = await create(context, config);

      expect(response.status).toBe(500);
      expect(response.body.error?.code).toBe('INTERNAL_ERROR');
    });

    it('should handle afterCreate hook throwing error', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [{ id: 10, ...crudTestData.validUserInput }], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const afterCreateHook = vi.fn().mockRejectedValue(new Error('Hook failed'));

      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: crudTestData.validUserInput,
      };

      const config: HandlerConfig = {
        ...baseConfig,
        hooks: { afterCreate: afterCreateHook },
      };

      const response = await create(context, config);

      expect(response.status).toBe(500);
      expect(response.body.error?.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('update - Error Cases', () => {
    it('should return 400 when ID parameter is missing', async () => {
      const context: RequestContext = {
        ...baseContext,
        method: 'PUT',
        params: {},
        body: { name: 'Updated' },
      };

      const response = await update(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('MISSING_ID');
    });

    it('should return 400 when body is missing', async () => {
      const context: RequestContext = {
        ...baseContext,
        method: 'PUT',
        params: { id: '1' },
        body: undefined,
      };

      const response = await update(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('INVALID_BODY');
    });

    it('should return 400 when body is not an object', async () => {
      const context: RequestContext = {
        ...baseContext,
        method: 'PUT',
        params: { id: '1' },
        body: 'invalid',
      };

      const response = await update(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('INVALID_BODY');
    });

    it('should return 400 when body is an array', async () => {
      const context: RequestContext = {
        ...baseContext,
        method: 'PUT',
        params: { id: '1' },
        body: [],
      };

      const response = await update(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('INVALID_BODY');
    });

    it('should return 400 for validation failure on update', async () => {
      const context: RequestContext = {
        ...baseContext,
        method: 'PUT',
        params: { id: '1' },
        body: { age: 10 },
      };

      const response = await update(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 when record to update not found', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const context: RequestContext = {
        ...baseContext,
        method: 'PUT',
        params: { id: '999' },
        body: { name: 'Updated' },
      };

      const response = await update(context, baseConfig);

      expect(response.status).toBe(404);
      expect(response.body.error?.code).toBe('NOT_FOUND');
    });

    it('should return 500 when database update fails', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: false,
        error: new Error('Update failed'),
      });

      const context: RequestContext = {
        ...baseContext,
        method: 'PUT',
        params: { id: '1' },
        body: { name: 'Updated' },
      };

      const response = await update(context, baseConfig);

      expect(response.status).toBe(500);
      expect(response.body.error?.code).toBe('QUERY_ERROR');
    });

    it('should handle beforeUpdate hook throwing error', async () => {
      const beforeUpdateHook = vi.fn().mockRejectedValue(new Error('Hook failed'));

      const context: RequestContext = {
        ...baseContext,
        method: 'PUT',
        params: { id: '1' },
        body: { name: 'Updated' },
      };

      const config: HandlerConfig = {
        ...baseConfig,
        hooks: { beforeUpdate: beforeUpdateHook },
      };

      const response = await update(context, config);

      expect(response.status).toBe(500);
      expect(response.body.error?.code).toBe('INTERNAL_ERROR');
    });

    it('should handle afterUpdate hook throwing error', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [{ ...crudTestData.validUserRecord, name: 'Updated' }], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const afterUpdateHook = vi.fn().mockRejectedValue(new Error('Hook failed'));

      const context: RequestContext = {
        ...baseContext,
        method: 'PUT',
        params: { id: '1' },
        body: { name: 'Updated' },
      };

      const config: HandlerConfig = {
        ...baseConfig,
        hooks: { afterUpdate: afterUpdateHook },
      };

      const response = await update(context, config);

      expect(response.status).toBe(500);
      expect(response.body.error?.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('delete - Error Cases', () => {
    it('should return 400 when ID parameter is missing', async () => {
      const context: RequestContext = {
        ...baseContext,
        method: 'DELETE',
        params: {},
      };

      const response = await deleteRecord(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('MISSING_ID');
    });

    it('should return 404 when record to delete not found', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const context: RequestContext = {
        ...baseContext,
        method: 'DELETE',
        params: { id: '999' },
      };

      const response = await deleteRecord(context, baseConfig);

      expect(response.status).toBe(404);
      expect(response.body.error?.code).toBe('NOT_FOUND');
    });

    it('should return 500 when database delete fails', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: false,
        error: new Error('Delete failed'),
      });

      const context: RequestContext = {
        ...baseContext,
        method: 'DELETE',
        params: { id: '1' },
      };

      const response = await deleteRecord(context, baseConfig);

      expect(response.status).toBe(500);
      expect(response.body.error?.code).toBe('QUERY_ERROR');
    });

    it('should handle beforeDelete hook throwing error', async () => {
      const beforeDeleteHook = vi.fn().mockRejectedValue(new Error('Hook failed'));

      const context: RequestContext = {
        ...baseContext,
        method: 'DELETE',
        params: { id: '1' },
      };

      const config: HandlerConfig = {
        ...baseConfig,
        hooks: { beforeDelete: beforeDeleteHook },
      };

      const response = await deleteRecord(context, config);

      expect(response.status).toBe(500);
      expect(response.body.error?.code).toBe('INTERNAL_ERROR');
    });

    it('should handle afterDelete hook throwing error', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [crudTestData.validUserRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const afterDeleteHook = vi.fn().mockRejectedValue(new Error('Hook failed'));

      const context: RequestContext = {
        ...baseContext,
        method: 'DELETE',
        params: { id: '1' },
      };

      const config: HandlerConfig = {
        ...baseConfig,
        hooks: { afterDelete: afterDeleteHook },
      };

      const response = await deleteRecord(context, config);

      expect(response.status).toBe(500);
      expect(response.body.error?.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('count - Error Cases', () => {
    it('should return 400 for invalid query parameters', async () => {
      const context: RequestContext = {
        ...baseContext,
        query: { 'where[age][$invalid]': '25' },
      };

      const response = await count(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('INVALID_QUERY');
    });

    it('should return 500 when database query fails', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: false,
        error: new Error('Count query failed'),
      });

      const context: RequestContext = { ...baseContext };
      const response = await count(context, baseConfig);

      expect(response.status).toBe(500);
      expect(response.body.error?.code).toBe('QUERY_ERROR');
    });

    it('should return 0 when count result is empty', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const context: RequestContext = { ...baseContext };
      const response = await count(context, baseConfig);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ count: 0 });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string ID in findOne', async () => {
      const context: RequestContext = {
        ...baseContext,
        params: { id: '' },
      };

      const response = await findOne(context, baseConfig);

      expect(response.status).toBe(400);
    });

    it('should handle null body in create', async () => {
      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: null,
      };

      const response = await create(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('INVALID_BODY');
    });

    it('should handle empty object body in create', async () => {
      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: {},
      };

      const response = await create(context, baseConfig);

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('VALIDATION_ERROR');
    });
  });
});
