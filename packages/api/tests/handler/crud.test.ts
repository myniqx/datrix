/**
 * API Handler - CRUD Tests (Happy Path)
 *
 * Tests CRUD operations with proper success flows:
 * - findMany with pagination
 * - findOne by ID
 * - create with validation
 * - update partial data
 * - delete by ID
 * - count with filters
 * - Hook execution (beforeFind, afterFind, etc.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create, deleteRecord, findMany, findOne, update, count } from '../../src/handler/crud';
import { crudTestData } from '../../../types/src/test/fixtures';
import type { DatabaseAdapter } from '../../../types/src/adapter';
import type { HandlerConfig, RequestContext } from '../../../types/src/api/handler';
import type { SchemaDefinition } from '../../../types/src/core/schema';

describe('API Handler - CRUD (Happy Path)', () => {
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

  describe('findMany', () => {
    it('should return multiple records successfully', async () => {
      const mockRecords = [
        crudTestData.validUserRecord,
        { ...crudTestData.validUserRecord, id: 2, email: 'user2@example.com' },
      ];

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: mockRecords, metadata: { rowCount: 2, affectedRows: 0 } },
      });

      const context: RequestContext = { ...baseContext, query: {} };
      const response = await findMany(context, baseConfig);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(mockRecords);
      // Parser sets default limit (25), so count query is also executed
      expect(mockAdapter.executeQuery).toHaveBeenCalledTimes(2);
    });

    it('should return empty array when no records found', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [], metadata: { rowCount: 0, affectedRows: 0 } },
      });

      const context: RequestContext = { ...baseContext };
      const response = await findMany(context, baseConfig);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });

    it('should handle pagination with page and pageSize', async () => {
      const paginatedRecords = crudTestData.bulkRecords.slice(0, 10);

      vi.mocked(mockAdapter.executeQuery)
        .mockResolvedValueOnce({
          success: true,
          data: { rows: paginatedRecords, metadata: { rowCount: 10, affectedRows: 0 } },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { rows: [{ count: 100 }], metadata: { rowCount: 1, affectedRows: 0 } },
        });

      const context: RequestContext = {
        ...baseContext,
        query: { page: '1', pageSize: '10' },
      };

      const response = await findMany(context, baseConfig);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(10);
      expect(response.body.meta?.pagination).toEqual({
        page: 1,
        pageSize: 10,
        total: 100,
        pageCount: 10,
      });
      expect(mockAdapter.executeQuery).toHaveBeenCalledTimes(2);
    });

    it('should handle limit and offset pagination', async () => {
      const limitedRecords = crudTestData.bulkRecords.slice(20, 40);

      vi.mocked(mockAdapter.executeQuery)
        .mockResolvedValueOnce({
          success: true,
          data: { rows: limitedRecords, metadata: { rowCount: 20, affectedRows: 0 } },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { rows: [{ count: 100 }], metadata: { rowCount: 1, affectedRows: 0 } },
        });

      const context: RequestContext = {
        ...baseContext,
        query: { limit: '20', offset: '20' },
      };

      const response = await findMany(context, baseConfig);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(20);
    });

    it('should execute beforeFind hook', async () => {
      const mockRecords = [crudTestData.validUserRecord];

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: mockRecords, metadata: { rowCount: 1, affectedRows: 0 } },
      });

      const beforeFindHook = vi.fn().mockImplementation((ctx, query) => ({
        ...query,
        limit: 50,
      }));

      const context: RequestContext = { ...baseContext };
      const config: HandlerConfig = {
        ...baseConfig,
        hooks: { beforeFind: beforeFindHook },
      };

      const response = await findMany(context, config);

      expect(response.status).toBe(200);
      expect(beforeFindHook).toHaveBeenCalledOnce();
      expect(beforeFindHook).toHaveBeenCalledWith(context, expect.any(Object));
    });

    it('should execute afterFind hook', async () => {
      const mockRecords = [crudTestData.validUserRecord];

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: mockRecords, metadata: { rowCount: 1, affectedRows: 0 } },
      });

      const afterFindHook = vi.fn().mockImplementation((ctx, results) =>
        results.map((r: any) => ({ ...r, transformed: true }))
      );

      const context: RequestContext = { ...baseContext };
      const config: HandlerConfig = {
        ...baseConfig,
        hooks: { afterFind: afterFindHook },
      };

      const response = await findMany(context, config);

      expect(response.status).toBe(200);
      expect(afterFindHook).toHaveBeenCalledOnce();
      expect((response.body.data as any)[0].transformed).toBe(true);
    });

    it('should handle fields selection', async () => {
      const selectedFieldsRecord = { id: 1, email: 'user@example.com' };

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [selectedFieldsRecord], metadata: { rowCount: 1, affectedRows: 0 } },
      });

      const context: RequestContext = {
        ...baseContext,
        query: { 'fields[0]': 'id', 'fields[1]': 'email' },
      };

      const response = await findMany(context, baseConfig);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([selectedFieldsRecord]);
    });

    it('should handle sorting', async () => {
      const sortedRecords = [...crudTestData.bulkRecords].slice(0, 5);

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: sortedRecords, metadata: { rowCount: 5, affectedRows: 0 } },
      });

      const context: RequestContext = {
        ...baseContext,
        query: { sort: 'name' },
      };

      const response = await findMany(context, baseConfig);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(5);
    });

    it('should handle where filters', async () => {
      const adminRecords = crudTestData.bulkRecords.filter((r) => r.role === 'admin');

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: adminRecords, metadata: { rowCount: adminRecords.length, affectedRows: 0 } },
      });

      const context: RequestContext = {
        ...baseContext,
        query: { 'where[role]': 'admin' },
      };

      const response = await findMany(context, baseConfig);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(adminRecords);
    });
  });

  describe('findOne', () => {
    it('should return single record by ID', async () => {
      const mockRecord = crudTestData.validUserRecord;

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [mockRecord], metadata: { rowCount: 1, affectedRows: 0 } },
      });

      const context: RequestContext = {
        ...baseContext,
        params: { id: '1' },
      };

      const response = await findOne(context, baseConfig);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(mockRecord);
    });

    it('should handle fields selection in findOne', async () => {
      const selectedRecord = { id: 1, name: 'John Doe' };

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [selectedRecord], metadata: { rowCount: 1, affectedRows: 0 } },
      });

      const context: RequestContext = {
        ...baseContext,
        params: { id: '1' },
        query: { 'fields[0]': 'id', 'fields[1]': 'name' },
      };

      const response = await findOne(context, baseConfig);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(selectedRecord);
    });

    it('should execute afterFind hook for single record', async () => {
      const mockRecord = crudTestData.validUserRecord;

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [mockRecord], metadata: { rowCount: 1, affectedRows: 0 } },
      });

      const afterFindHook = vi.fn().mockImplementation((ctx, result) => ({
        ...result,
        enhanced: true,
      }));

      const context: RequestContext = {
        ...baseContext,
        params: { id: '1' },
      };

      const config: HandlerConfig = {
        ...baseConfig,
        hooks: { afterFind: afterFindHook },
      };

      const response = await findOne(context, config);

      expect(response.status).toBe(200);
      expect(afterFindHook).toHaveBeenCalledOnce();
      expect((response.body.data as any).enhanced).toBe(true);
    });
  });

  describe('create', () => {
    it('should create new record successfully', async () => {
      const inputData = crudTestData.validUserInput;
      const createdRecord = { id: 10, ...inputData };

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [createdRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: inputData,
      };

      const response = await create(context, baseConfig);

      expect(response.status).toBe(201);
      expect(response.body.data).toEqual(createdRecord);
      expect(mockAdapter.executeQuery).toHaveBeenCalledOnce();
    });

    it('should execute beforeCreate hook', async () => {
      const inputData = crudTestData.validUserInput;
      const transformedData = { ...inputData, name: inputData.name.toUpperCase() };
      const createdRecord = { id: 10, ...transformedData };

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [createdRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const beforeCreateHook = vi.fn().mockImplementation((ctx, data) => ({
        ...data,
        name: data.name.toUpperCase(),
      }));

      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: inputData,
      };

      const config: HandlerConfig = {
        ...baseConfig,
        hooks: { beforeCreate: beforeCreateHook },
      };

      const response = await create(context, config);

      expect(response.status).toBe(201);
      expect(beforeCreateHook).toHaveBeenCalledOnce();
    });

    it('should execute afterCreate hook', async () => {
      const inputData = crudTestData.validUserInput;
      const createdRecord = { id: 10, ...inputData };

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [createdRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const afterCreateHook = vi.fn().mockImplementation((ctx, data) => ({
        ...data,
        hooked: true,
      }));

      const context: RequestContext = {
        ...baseContext,
        method: 'POST',
        body: inputData,
      };

      const config: HandlerConfig = {
        ...baseConfig,
        hooks: { afterCreate: afterCreateHook },
      };

      const response = await create(context, config);

      expect(response.status).toBe(201);
      expect(afterCreateHook).toHaveBeenCalledOnce();
      expect((response.body.data as any).hooked).toBe(true);
    });
  });

  describe('update', () => {
    it('should update record successfully', async () => {
      const updateData = { name: 'Updated Name' };
      const updatedRecord = { ...crudTestData.validUserRecord, name: 'Updated Name' };

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [updatedRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const context: RequestContext = {
        ...baseContext,
        method: 'PUT',
        params: { id: '1' },
        body: updateData,
      };

      const response = await update(context, baseConfig);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(updatedRecord);
    });

    it('should handle partial update', async () => {
      const partialUpdate = { age: 26 };
      const updatedRecord = { ...crudTestData.validUserRecord, age: 26 };

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [updatedRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const context: RequestContext = {
        ...baseContext,
        method: 'PATCH',
        params: { id: '1' },
        body: partialUpdate,
      };

      const response = await update(context, baseConfig);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(updatedRecord);
    });

    it('should execute beforeUpdate hook', async () => {
      const updateData = { name: 'Updated Name' };
      const updatedRecord = { ...crudTestData.validUserRecord, name: 'Updated Name' };

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [updatedRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const beforeUpdateHook = vi.fn().mockImplementation((ctx, id, data) => ({
        ...data,
        name: data.name.toUpperCase(),
      }));

      const context: RequestContext = {
        ...baseContext,
        method: 'PUT',
        params: { id: '1' },
        body: updateData,
      };

      const config: HandlerConfig = {
        ...baseConfig,
        hooks: { beforeUpdate: beforeUpdateHook },
      };

      const response = await update(context, config);

      expect(response.status).toBe(200);
      expect(beforeUpdateHook).toHaveBeenCalledOnce();
      expect(beforeUpdateHook).toHaveBeenCalledWith(context, '1', expect.any(Object));
    });

    it('should execute afterUpdate hook', async () => {
      const updateData = { name: 'Updated Name' };
      const updatedRecord = { ...crudTestData.validUserRecord, name: 'Updated Name' };

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [updatedRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const afterUpdateHook = vi.fn().mockImplementation((ctx, data) => ({
        ...data,
        processed: true,
      }));

      const context: RequestContext = {
        ...baseContext,
        method: 'PUT',
        params: { id: '1' },
        body: updateData,
      };

      const config: HandlerConfig = {
        ...baseConfig,
        hooks: { afterUpdate: afterUpdateHook },
      };

      const response = await update(context, config);

      expect(response.status).toBe(200);
      expect(afterUpdateHook).toHaveBeenCalledOnce();
      expect((response.body.data as any).processed).toBe(true);
    });
  });

  describe('delete', () => {
    it('should delete record successfully', async () => {
      const deletedRecord = crudTestData.validUserRecord;

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [deletedRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const context: RequestContext = {
        ...baseContext,
        method: 'DELETE',
        params: { id: '1' },
      };

      const response = await deleteRecord(context, baseConfig);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(deletedRecord);
    });

    it('should execute beforeDelete hook', async () => {
      const deletedRecord = crudTestData.validUserRecord;

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [deletedRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const beforeDeleteHook = vi.fn().mockResolvedValue(undefined);

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

      expect(response.status).toBe(200);
      expect(beforeDeleteHook).toHaveBeenCalledOnce();
      expect(beforeDeleteHook).toHaveBeenCalledWith(context, '1');
    });

    it('should execute afterDelete hook', async () => {
      const deletedRecord = crudTestData.validUserRecord;

      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [deletedRecord], metadata: { rowCount: 1, affectedRows: 1 } },
      });

      const afterDeleteHook = vi.fn().mockResolvedValue(undefined);

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

      expect(response.status).toBe(200);
      expect(afterDeleteHook).toHaveBeenCalledOnce();
      expect(afterDeleteHook).toHaveBeenCalledWith(context, '1');
    });
  });

  describe('count', () => {
    it('should return count of all records', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [{ count: 100 }], metadata: { rowCount: 1, affectedRows: 0 } },
      });

      const context: RequestContext = { ...baseContext };
      const response = await count(context, baseConfig);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ count: 100 });
    });

    it('should return count with where filter', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [{ count: 10 }], metadata: { rowCount: 1, affectedRows: 0 } },
      });

      const context: RequestContext = {
        ...baseContext,
        query: { 'where[role]': 'admin' },
      };

      const response = await count(context, baseConfig);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ count: 10 });
    });

    it('should return zero when no records match', async () => {
      vi.mocked(mockAdapter.executeQuery).mockResolvedValue({
        success: true,
        data: { rows: [{ count: 0 }], metadata: { rowCount: 1, affectedRows: 0 } },
      });

      const context: RequestContext = {
        ...baseContext,
        query: { 'where[role]': 'nonexistent' },
      };

      const response = await count(context, baseConfig);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ count: 0 });
    });
  });
});
