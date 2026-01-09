/**
 * Soft Delete Interceptor Tests - Happy Path
 *
 * Tests successful query interception:
 * - SELECT query filtering (adding deletedAt filter)
 * - DELETE to UPDATE conversion
 * - Mode handling (default, only-deleted, include-deleted)
 * - WHERE clause merging
 * - Excluded models
 * - Restore and hard-delete operations
 */

import { describe, it, expect } from 'vitest';
import { createSoftDeleteInterceptor } from '../src/interceptor';
import type { QueryObject } from '../../../types/src/core/query-builder';

describe('Soft Delete Interceptor - Happy Path', () => {
  const timestampInterceptor = createSoftDeleteInterceptor({
    field: 'deletedAt',
    type: 'timestamp'
  });

  describe('SELECT Query Interception', () => {
    it('should add deletedAt: null filter to basic SELECT query', () => {
      const basicSelectQuery: QueryObject = {
        type: 'select',
        table: 'users',
        select: ['*']
      };

      const filteredQuery = timestampInterceptor.interceptQuery(basicSelectQuery);
      expect(filteredQuery.where).toEqual({ deletedAt: null });
    });

    it('should merge filter with existing WHERE clause using $and', () => {
      const queryWithWhere: QueryObject = {
        type: 'select',
        table: 'users',
        select: ['*'],
        where: { id: 1 }
      };

      const mergedQuery = timestampInterceptor.interceptQuery(queryWithWhere);
      expect(mergedQuery.where).toEqual({
        $and: [{ id: 1 }, { deletedAt: null }]
      });
    });

    it('should not override explicit deletedAt filter from user', () => {
      const explicitDeletedAtQuery: QueryObject = {
        type: 'select',
        table: 'users',
        select: ['*'],
        where: { deletedAt: { $ne: null } }
      };

      const preservedQuery = timestampInterceptor.interceptQuery(explicitDeletedAtQuery);
      expect(preservedQuery.where).toEqual({ deletedAt: { $ne: null } });
    });

    it('should preserve select fields exactly as provided', () => {
      const specificFieldsQuery: QueryObject = {
        type: 'select',
        table: 'users',
        select: ['id', 'name']
      };

      const resultQuery = timestampInterceptor.interceptQuery(specificFieldsQuery);
      expect(resultQuery.select).toEqual(['id', 'name']);
      expect(resultQuery.where).toEqual({ deletedAt: null });
    });
  });

  describe('Mode Handling', () => {
    it('should support only-deleted mode', () => {
      const selectQuery: QueryObject = {
        type: 'select',
        table: 'users',
        select: ['*']
      };

      const onlyDeletedQuery = timestampInterceptor.interceptQuery(selectQuery, { mode: 'only-deleted' });
      expect(onlyDeletedQuery.where).toEqual({ deletedAt: { $ne: null } });
    });

    it('should support include-deleted mode (no filter)', () => {
      const selectQuery: QueryObject = {
        type: 'select',
        table: 'users',
        select: ['*']
      };

      const includeDeletedQuery = timestampInterceptor.interceptQuery(selectQuery, { mode: 'include-deleted' });
      expect(includeDeletedQuery.where).toBeUndefined();
    });
  });

  describe('Excluded Models', () => {
    it('should respect excluded models', () => {
      timestampInterceptor.addExcludedModel('logs');
      const excludedModelQuery: QueryObject = {
        type: 'select',
        table: 'logs',
        select: ['*']
      };

      const unmodifiedQuery = timestampInterceptor.interceptQuery(excludedModelQuery);
      expect(unmodifiedQuery.where).toBeUndefined();

      timestampInterceptor.removeExcludedModel('logs');
    });
  });

  describe('DELETE Query Conversion', () => {
    it('should convert DELETE to UPDATE with current timestamp', () => {
      const deleteQuery: QueryObject = {
        type: 'delete',
        table: 'users',
        where: { id: 1 }
      };

      const softDeleteQuery = timestampInterceptor.interceptQuery(deleteQuery);
      expect(softDeleteQuery.type).toBe('update');
      expect((softDeleteQuery as any).data.deletedAt).toBeInstanceOf(Date);
      expect(softDeleteQuery.where).toEqual({ id: 1 });
    });
  });

  describe('Boolean Mode', () => {
    const booleanInterceptor = createSoftDeleteInterceptor({
      field: 'isDeleted',
      type: 'boolean'
    });

    it('should use true/false instead of null for default mode', () => {
      const selectQuery: QueryObject = { type: 'select', table: 'users', select: ['*'] };

      const defaultModeQuery = booleanInterceptor.interceptQuery(selectQuery);
      expect(defaultModeQuery.where).toEqual({ isDeleted: false });
    });

    it('should use true for only-deleted mode', () => {
      const selectQuery: QueryObject = { type: 'select', table: 'users', select: ['*'] };

      const onlyDeletedQuery = booleanInterceptor.interceptQuery(selectQuery, { mode: 'only-deleted' });
      expect(onlyDeletedQuery.where).toEqual({ isDeleted: true });
    });
  });

  describe('Operations', () => {
    it('should generate restore query', () => {
      const restoreQuery = timestampInterceptor.restore('users', '1');

      expect(restoreQuery.type).toBe('update');
      expect(restoreQuery.data.deletedAt).toBeNull();
      expect(restoreQuery.where).toEqual({ id: '1' });
    });

    it('should return query as-is for hardDelete', () => {
      const deleteQuery: QueryObject = { type: 'delete', table: 'users', where: { id: 1 } };
      const hardDeleteQuery = timestampInterceptor.hardDelete(deleteQuery);

      expect(hardDeleteQuery).toBe(deleteQuery);
      expect(hardDeleteQuery.type).toBe('delete');
    });
  });

  describe('Complex WHERE Clauses', () => {
    it('should NOT merge filter if deletedAt is present at top level', () => {
      const topLevelDeletedAtQuery: QueryObject = {
        type: 'select',
        table: 'users',
        select: ['*'],
        where: { deletedAt: '2023-01-01' }
      };

      const resultQuery = timestampInterceptor.interceptQuery(topLevelDeletedAtQuery);
      expect(resultQuery.where).toEqual({ deletedAt: '2023-01-01' });
    });

    it('should merge filter if deletedAt is ONLY present in nested logic', () => {
      const nestedDeletedAtQuery: QueryObject = {
        type: 'select',
        table: 'users',
        select: ['*'],
        where: { $or: [{ deletedAt: { $ne: null } }, { id: 1 }] }
      };

      const mergedQuery = timestampInterceptor.interceptQuery(nestedDeletedAtQuery);
      expect(mergedQuery.where).toEqual({
        $and: [
          { $or: [{ deletedAt: { $ne: null } }, { id: 1 }] },
          { deletedAt: null }
        ]
      });
    });
  });
});
