/**
 * Soft Delete Plugin Tests - Error Path
 *
 * Tests error handling and edge cases:
 * - Invalid configuration
 * - Input immutability
 * - Edge cases
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createSoftDeletePlugin } from '../src';
import type { PluginContext } from '../../../types/src/plugin';
import type { QueryObject } from '../../../types/src/core/query-builder';

describe('Soft Delete Plugin - Error Path', () => {
  const mockContext: PluginContext = {
    adapter: {} as any,
    schemas: {} as any,
    config: {} as any,
  };

  describe('Input Immutability', () => {
    it('should not mutate original query object', async () => {
      const softDeletePlugin = createSoftDeletePlugin({ field: 'deletedAt', type: 'timestamp' });
      await softDeletePlugin.init(mockContext);

      const originalQuery: QueryObject = {
        type: 'select',
        table: 'posts',
        select: ['id', 'title']
      };

      const originalQueryCopy = { ...originalQuery };

      await softDeletePlugin.onBeforeQuery(originalQuery);

      // Original query should not be mutated
      expect(originalQuery).toEqual(originalQueryCopy);
      expect(originalQuery.where).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle query without where clause', async () => {
      const softDeletePlugin = createSoftDeletePlugin({ field: 'deletedAt', type: 'timestamp' });
      await softDeletePlugin.init(mockContext);

      const queryWithoutWhere: QueryObject = {
        type: 'select',
        table: 'users',
        select: ['*']
      };

      const result = await softDeletePlugin.onBeforeQuery(queryWithoutWhere);
      expect(result.where).toEqual({ deletedAt: null });
    });
  });
});
