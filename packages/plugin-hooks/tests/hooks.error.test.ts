/**
 * Hooks Plugin Tests - Error Path
 *
 * Tests error handling and edge cases:
 * - Hook execution errors
 * - Input immutability
 * - Non-existent hook handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createHooksPlugin } from '../src';
import type { PluginContext } from '../../../types/src/plugin';
import type { QueryObject } from '../../../types/src/core/query-builder';
import { expectFailureError } from '../../../types/src/test/helpers';

describe('Hooks Plugin - Error Path', () => {
  const mockContext: PluginContext = {
    adapter: {} as any,
    schemas: {} as any,
    config: {} as any,
  };

  let hooksPlugin: ReturnType<typeof createHooksPlugin>;

  beforeEach(async () => {
    hooksPlugin = createHooksPlugin({ enableLogging: false });
    await hooksPlugin.init(mockContext);
  });

  describe('Hook Execution Errors', () => {
    it('should handle errors thrown in hooks', async () => {
      hooksPlugin.registerHooks('posts', {
        beforeCreate: () => {
          throw new Error('Hook execution failed');
        }
      });

      const executionResult = await hooksPlugin.executeHook(
        'posts',
        'beforeCreate',
        { title: 'Test' },
        { modelName: 'posts', operation: 'create' }
      );

      const error = expectFailureError(executionResult);
      expect(error.message).toContain('Hook execution failed');
    });
  });

  describe('Input Immutability', () => {
    it('should not mutate original query object', async () => {
      hooksPlugin.registerHooks('users', {
        beforeFind: (query: any) => {
          return {
            ...query,
            where: { ...query.where, active: true }
          };
        }
      });

      const originalQuery: QueryObject = {
        type: 'select',
        table: 'users',
        select: ['id'],
        where: { id: 1 }
      };

      const originalWhere = { ...originalQuery.where };

      await hooksPlugin.onBeforeQuery(originalQuery);

      // Original query should not be mutated
      expect(originalQuery.where).toEqual(originalWhere);
      expect(originalQuery.where).not.toHaveProperty('active');
    });
  });

  describe('Non-Existent Hook Handling', () => {
    it('should return original data when hook does not exist', async () => {
      const originalData = { title: 'Test' };

      const executionResult = await hooksPlugin.executeHook(
        'nonexistent',
        'beforeCreate',
        originalData,
        { modelName: 'nonexistent', operation: 'create' }
      );

      expect(executionResult.data).toBe(originalData);
    });
  });
});
