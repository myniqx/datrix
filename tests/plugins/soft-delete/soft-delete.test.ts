/**
 * Soft Delete Plugin - Integration Tests
 *
 * Tests the SoftDeletePlugin:
 * - Initialization and destruction
 * - Automatic schema modification (adding deletedAt)
 * - Automatic query interception via onBeforeQuery
 * - Public API methods (softDelete, hardDelete, findDeleted, etc.)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createSoftDeletePlugin } from '@plugins/soft-delete';
import type { PluginContext } from '@plugins/base/types';
import type { SchemaRegistry } from '@core/schema/types';
import type { QueryObject } from '@adapters/base/types';

describe('Soft Delete Plugin - Integration', () => {
  const mockContext: PluginContext = {
    adapter: {} as any,
    schemas: {} as any,
    config: {} as any,
  };

  let plugin: ReturnType<typeof createSoftDeletePlugin>;

  beforeEach(async () => {
    plugin = createSoftDeletePlugin({ field: 'deletedAt', type: 'timestamp' });
    await plugin.init(mockContext);
  });

  describe('onSchemaLoad', () => {
    it('should add deletedAt field to registered schemas', async () => {
      const mockSchemas: any = {
        schemas: {
          users: { name: 'users', fields: { id: { type: 'string' } } }
        },
        getAll: function () { return Object.values(this.schemas); },
        register: function (s: any) { this.schemas[s.name] = s; }
      };

      await plugin.onSchemaLoad(mockSchemas as unknown as SchemaRegistry);

      const updatedUser = mockSchemas.schemas.users;
      expect(updatedUser.fields.deletedAt).toBeDefined();
      expect(updatedUser.fields.deletedAt.type).toBe('date');
      expect(updatedUser.fields.deletedAt.required).toBe(false);
    });

    it('should respect excluded models during schema modification', async () => {
      plugin.addExcludedModel('logs');
      const mockSchemas: any = {
        schemas: {
          logs: { name: 'logs', fields: { id: { type: 'string' } } }
        },
        getAll: function () { return Object.values(this.schemas); },
        register: vi.fn()
      };

      await plugin.onSchemaLoad(mockSchemas as unknown as SchemaRegistry);
      expect(mockSchemas.schemas.logs.fields.deletedAt).toBeUndefined();
    });
  });

  describe('Query Interception', () => {
    it('should intercept queries via onBeforeQuery', async () => {
      const query: QueryObject = {
        type: 'select',
        table: 'posts',
        fields: ['*']
      };

      const result = await plugin.onBeforeQuery(query);
      expect(result.where).toHaveProperty('deletedAt', null);
    });

    it('should support manual softDelete action', () => {
      const result = plugin.softDelete('posts', { id: 1 });
      expect(result.type).toBe('update');
      expect((result.data as any).deletedAt).toBeInstanceOf(Date);
      expect(result.where).toEqual({ id: 1 });
    });

    it('should support manual findDeleted action', () => {
      const result = plugin.findDeleted('posts', { id: 1 });
      expect(result.type).toBe('select');
      expect(result.where).toEqual({
        $and: [{ id: 1 }, { deletedAt: { $ne: null } }]
      });
    });
  });

  describe('Bypass', () => {
    it('should support hardDelete (manual bypass)', () => {
      const result = plugin.hardDelete('posts', { id: 1 });
      expect(result.type).toBe('delete');
      expect(result.where).toEqual({ id: 1 });
    });
  });
});
