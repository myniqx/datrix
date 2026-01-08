/**
 * Soft Delete Plugin Tests - Happy Path
 *
 * Tests successful soft delete operations:
 * - Plugin initialization
 * - Schema modification (adding deletedAt field)
 * - Query interception
 * - Manual operations (softDelete, findDeleted, hardDelete)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSoftDeletePlugin } from '../src';
import type { PluginContext } from '../../../types/src/plugin';
import type { SchemaRegistry } from '../../../types/src/core/schema';
import type { QueryObject } from '../../../types/src/core/query-builder';
import { expectSuccessData } from '../../../types/src/test/helpers';

describe('Soft Delete Plugin - Happy Path', () => {
  const mockContext: PluginContext = {
    adapter: {} as any,
    schemas: {} as any,
    config: {} as any,
  };

  let softDeletePlugin: ReturnType<typeof createSoftDeletePlugin>;

  beforeEach(async () => {
    softDeletePlugin = createSoftDeletePlugin({ field: 'deletedAt', type: 'timestamp' });
    const initResult = await softDeletePlugin.init(mockContext);
    expectSuccessData(initResult);
  });

  describe('Schema Modification', () => {
    it('should add deletedAt field to registered schemas', async () => {
      const mockSchemas: any = {
        schemas: {
          users: { name: 'users', fields: { id: { type: 'string' } } }
        },
        getAll: function () { return Object.values(this.schemas); },
        register: function (s: any) { this.schemas[s.name] = s; }
      };

      await softDeletePlugin.onSchemaLoad(mockSchemas as unknown as SchemaRegistry);

      const modifiedUserSchema = mockSchemas.schemas.users;
      expect(modifiedUserSchema.fields.deletedAt).toBeDefined();
      expect(modifiedUserSchema.fields.deletedAt.type).toBe('date');
      expect(modifiedUserSchema.fields.deletedAt.required).toBe(false);
    });

    it('should respect excluded models during schema modification', async () => {
      softDeletePlugin.addExcludedModel('logs');
      const mockSchemas: any = {
        schemas: {
          logs: { name: 'logs', fields: { id: { type: 'string' } } }
        },
        getAll: function () { return Object.values(this.schemas); },
        register: vi.fn()
      };

      await softDeletePlugin.onSchemaLoad(mockSchemas as unknown as SchemaRegistry);
      expect(mockSchemas.schemas.logs.fields.deletedAt).toBeUndefined();
    });
  });

  describe('Query Interception', () => {
    it('should intercept queries via onBeforeQuery', async () => {
      const selectQuery: QueryObject = {
        type: 'select',
        table: 'posts',
        select: ['*']
      };

      const interceptedQuery = await softDeletePlugin.onBeforeQuery(selectQuery);
      expect(interceptedQuery.where).toHaveProperty('deletedAt', null);
    });
  });

  describe('Manual Operations', () => {
    it('should support manual softDelete action', () => {
      const softDeleteQuery = softDeletePlugin.softDelete('posts', { id: 1 });

      expect(softDeleteQuery.type).toBe('update');
      expect((softDeleteQuery.data as any).deletedAt).toBeInstanceOf(Date);
      expect(softDeleteQuery.where).toEqual({ id: 1 });
    });

    it('should support manual findDeleted action', () => {
      const findDeletedQuery = softDeletePlugin.findDeleted('posts', { id: 1 });

      expect(findDeletedQuery.type).toBe('select');
      expect(findDeletedQuery.where).toEqual({
        $and: [{ id: 1 }, { deletedAt: { $ne: null } }]
      });
    });

    it('should support hardDelete (manual bypass)', () => {
      const hardDeleteQuery = softDeletePlugin.hardDelete('posts', { id: 1 });

      expect(hardDeleteQuery.type).toBe('delete');
      expect(hardDeleteQuery.where).toEqual({ id: 1 });
    });
  });
});
