/**
 * Soft Delete Interceptor Tests - Error Path
 *
 * Tests error handling and edge cases:
 * - Input immutability
 * - Edge cases with complex WHERE clauses
 * - Bypass attempts
 */

import { describe, it, expect } from 'vitest';
import { createSoftDeleteInterceptor } from '../src/interceptor';
import type { QueryObject } from '../../../types/src/core/query-builder';

describe('Soft Delete Interceptor - Error Path', () => {
  const timestampInterceptor = createSoftDeleteInterceptor({
    field: 'deletedAt',
    type: 'timestamp'
  });

  describe('Input Immutability', () => {
    it('should not mutate original query object during SELECT interception', () => {
      const originalQuery: QueryObject = {
        type: 'select',
        table: 'users',
        select: ['id', 'name'],
        where: { id: 1 }
      };

      const originalWhere = { ...originalQuery.where };

      timestampInterceptor.interceptQuery(originalQuery);

      // Original query should not be mutated
      expect(originalQuery.where).toEqual(originalWhere);
      expect(originalQuery.where).not.toHaveProperty('$and');
    });

    it('should not mutate original query object during DELETE conversion', () => {
      const originalDeleteQuery: QueryObject = {
        type: 'delete',
        table: 'users',
        where: { id: 1 }
      };

      const originalType = originalDeleteQuery.type;
      const originalWhere = { ...originalDeleteQuery.where };

      timestampInterceptor.interceptQuery(originalDeleteQuery);

      // Original query should not be mutated
      expect(originalDeleteQuery.type).toBe(originalType);
      expect(originalDeleteQuery.where).toEqual(originalWhere);
      expect((originalDeleteQuery as any).data).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle query without where clause', () => {
      const queryWithoutWhere: QueryObject = {
        type: 'select',
        table: 'users',
        select: ['*']
      };

      const result = timestampInterceptor.interceptQuery(queryWithoutWhere);
      expect(result.where).toEqual({ deletedAt: null });
    });

    it('should handle empty where object', () => {
      const emptyWhereQuery: QueryObject = {
        type: 'select',
        table: 'users',
        select: ['*'],
        where: {}
      };

      const result = timestampInterceptor.interceptQuery(emptyWhereQuery);
      expect(result.where).toEqual({
        $and: [{}, { deletedAt: null }]
      });
    });
  });

  describe('Security - Bypass Attempts', () => {
    it('should not allow bypassing filter with nested deletedAt in $or', () => {
      const bypassAttempt: QueryObject = {
        type: 'select',
        table: 'users',
        select: ['*'],
        where: { $or: [{ deletedAt: { $ne: null } }, { id: 1 }] }
      };

      const result = timestampInterceptor.interceptQuery(bypassAttempt);

      // Should still add the filter (current behavior merges)
      expect(result.where).toHaveProperty('$and');
      expect((result.where as any).$and).toContainEqual({ deletedAt: null });
    });
  });
});
