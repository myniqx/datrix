/**
 * Hooks Plugin Tests - Happy Path
 *
 * Tests successful hook operations:
 * - Plugin initialization and cleanup
 * - Automatic beforeFind hook execution
 * - Manual hook execution
 * - Query modification
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createHooksPlugin } from '../src';
import type { PluginContext } from '../../../types/src/plugin';
import type { QueryObject } from '../../../types/src/core/query-builder';
import { expectSuccessData } from '../../../types/src/test/helpers';

describe('Hooks Plugin - Happy Path', () => {
  const mockContext: PluginContext = {
    adapter: {} as any,
    schemas: {} as any,
    config: {} as any,
  };

  let hooksPlugin: ReturnType<typeof createHooksPlugin>;

  beforeEach(async () => {
    hooksPlugin = createHooksPlugin({ enableLogging: false });
    const initResult = await hooksPlugin.init(mockContext);
    expectSuccessData(initResult);
  });

  describe('Automatic Hook Execution', () => {
    it('should trigger beforeFind hook for select queries', async () => {
      hooksPlugin.registerHooks('users', {
        beforeFind: (query: any) => {
          return {
            ...query,
            where: { ...query.where, active: true }
          };
        }
      });

      const selectQuery: QueryObject = {
        type: 'select',
        table: 'users',
        select: ['id', 'name'],
        where: { id: 1 }
      };

      const modifiedQuery = await hooksPlugin.onBeforeQuery(selectQuery);
      expect(modifiedQuery.where).toEqual({ id: 1, active: true });
    });

    it('should not modify query if no hook is registered', async () => {
      const queryWithoutHook: QueryObject = {
        type: 'select',
        table: 'other',
        select: ['*']
      };

      const unmodifiedQuery = await hooksPlugin.onBeforeQuery(queryWithoutHook);
      expect(unmodifiedQuery).toBe(queryWithoutHook);
    });

    it('should only trigger beforeFind for select type queries', async () => {
      let hookWasTriggered = false;
      hooksPlugin.registerHooks('users', {
        beforeFind: (q: any) => {
          hookWasTriggered = true;
          return q;
        }
      });

      const insertQuery: QueryObject = {
        type: 'insert',
        table: 'users',
        data: { name: 'Test' }
      } as any;

      await hooksPlugin.onBeforeQuery(insertQuery);
      expect(hookWasTriggered).toBe(false);
    });
  });

  describe('Manual Hook Execution', () => {
    it('should allow manual hook execution via executeHook', async () => {
      hooksPlugin.registerHooks('posts', {
        beforeCreate: (data: any) => ({ ...data, ok: true })
      });

      const hookResult = await hooksPlugin.executeHook(
        'posts',
        'beforeCreate',
        { val: 1 },
        { modelName: 'posts', operation: 'create' }
      );

      const executedData = expectSuccessData(hookResult);
      expect((executedData as any).ok).toBe(true);
      expect((executedData as any).val).toBe(1);
    });
  });

  describe('Lifecycle Management', () => {
    it('should clear hooks on destroy', async () => {
      hooksPlugin.registerHooks('test', { beforeFind: (q: any) => q });
      expect(hooksPlugin.getRegisteredModels()).toContain('test');

      await hooksPlugin.destroy();
      expect(hooksPlugin.getRegisteredModels()).toEqual([]);
    });
  });
});
