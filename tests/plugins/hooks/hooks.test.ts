/**
 * Hooks Plugin - Integration Tests
 *
 * Tests the HooksPlugin class:
 * - Initialization and cleanup
 * - Automatic beforeFind hook execution during onBeforeQuery
 * - Manual hook execution via plugin API
 * - Error handling and logging
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHooksPlugin } from '@plugins/hooks';
import type { PluginContext } from '@plugins/base/types';
import type { QueryObject } from '@adapters/base/types';

describe('Hooks Plugin - Integration', () => {
  const mockContext: PluginContext = {
    adapter: {} as any,
    schemas: {} as any,
    config: {} as any,
  };

  let plugin: ReturnType<typeof createHooksPlugin>;

  beforeEach(async () => {
    plugin = createHooksPlugin({ enableLogging: false });
    await plugin.init(mockContext);
  });

  describe('onBeforeQuery', () => {
    it('should trigger beforeFind hook for select queries', async () => {
      plugin.registerHooks('users', {
        beforeFind: (query: any) => {
          return {
            ...query,
            where: { ...query.where, active: true }
          };
        }
      });

      const query: QueryObject = {
        type: 'select',
        table: 'users',
        fields: ['id', 'name'],
        where: { id: 1 }
      };

      const result = await plugin.onBeforeQuery(query);
      expect(result.where).toEqual({ id: 1, active: true });
    });

    it('should not modify query if no hook is registered', async () => {
      const query: QueryObject = {
        type: 'select',
        table: 'other',
        fields: ['*']
      };

      const result = await plugin.onBeforeQuery(query);
      expect(result).toBe(query);
    });

    it('should only trigger beforeFind for "select" type queries', async () => {
      let hookTriggered = false;
      plugin.registerHooks('users', {
        beforeFind: (q: any) => {
          hookTriggered = true;
          return q;
        }
      });

      const query: QueryObject = {
        type: 'insert',
        table: 'users',
        data: { name: 'Test' }
      } as any;

      await plugin.onBeforeQuery(query);
      expect(hookTriggered).toBe(false);
    });
  });

  describe('Manual Execution', () => {
    it('should allow manual hook execution via executeHook', async () => {
      plugin.registerHooks('posts', {
        beforeCreate: (data: any) => ({ ...data, ok: true })
      });

      const result = await plugin.executeHook('posts', 'beforeCreate', { val: 1 }, { modelName: 'posts', operation: 'create' });
      expect(result.success).toBe(true);
      expect((result.data as any).ok).toBe(true);
    });
  });

  describe('Lifecycle', () => {
    it('should clear hooks on destroy', async () => {
      plugin.registerHooks('test', { beforeFind: (q: any) => q });
      expect(plugin.getRegisteredModels()).toContain('test');

      await plugin.destroy();
      expect(plugin.getRegisteredModels()).toEqual([]);
    });
  });
});
