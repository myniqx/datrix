/**
 * Soft Delete Plugin - Interceptor Tests
 *
 * Tests the SoftDeleteInterceptor:
 * - SELECT query interception (adding deletedAt filter)
 * - DELETE query interception (conversion to UPDATE)
 * - Mode handling (default, only-deleted, include-deleted)
 * - Existing WHERE clause merging ($and)
 * - Excluded models and global bypass
 * - Restore and hard-delete operations
 */

import { describe, it, expect } from 'vitest';
import { createSoftDeleteInterceptor } from '@plugins/soft-delete/interceptor';
import type { QueryObject } from '@adapters/base/types';

describe('Soft Delete Plugin - Interceptor', () => {
  const interceptor = createSoftDeleteInterceptor({
    field: 'deletedAt',
    type: 'timestamp'
  });

  describe('interceptQuery (SELECT)', () => {
    it('should add deletedAt: null filter to basic SELECT query', () => {
      const query: QueryObject = {
        type: 'select',
        table: 'users',
        fields: ['*']
      };

      const result = interceptor.interceptQuery(query);
      expect(result.where).toEqual({ deletedAt: null });
    });

    it('should merge filter with existing WHERE clause using $and', () => {
      const query: QueryObject = {
        type: 'select',
        table: 'users',
        fields: ['*'],
        where: { id: 1 }
      };

      const result = interceptor.interceptQuery(query);
      expect(result.where).toEqual({
        $and: [{ id: 1 }, { deletedAt: null }]
      });
    });

    it('should not override explicit deletedAt filter from user', () => {
      const query: QueryObject = {
        type: 'select',
        table: 'users',
        fields: ['*'],
        where: { deletedAt: { $ne: null } }
      };

      const result = interceptor.interceptQuery(query);
      expect(result.where).toEqual({ deletedAt: { $ne: null } });
    });

    it('should support only-deleted mode', () => {
      const query: QueryObject = {
        type: 'select',
        table: 'users',
        fields: ['*']
      };

      const result = interceptor.interceptQuery(query, { mode: 'only-deleted' });
      expect(result.where).toEqual({ deletedAt: { $ne: null } });
    });

    it('should support include-deleted mode (no filter)', () => {
      const query: QueryObject = {
        type: 'select',
        table: 'users',
        fields: ['*']
      };

      const result = interceptor.interceptQuery(query, { mode: 'include-deleted' });
      expect(result.where).toBeUndefined();
    });

    it('should respect excluded models', () => {
      interceptor.addExcludedModel('logs');
      const query: QueryObject = {
        type: 'select',
        table: 'logs',
        fields: ['*']
      };

      const result = interceptor.interceptQuery(query);
      expect(result.where).toBeUndefined();
      interceptor.removeExcludedModel('logs');
    });
  });

  describe('interceptQuery (DELETE)', () => {
    it('should convert DELETE to UPDATE with current timestamp', () => {
      const query: QueryObject = {
        type: 'delete',
        table: 'users',
        where: { id: 1 }
      };

      const result = interceptor.interceptQuery(query);
      expect(result.type).toBe('update');
      expect((result as any).data.deletedAt).toBeInstanceOf(Date);
      expect(result.where).toEqual({ id: 1 });
    });
  });

  describe('Boolean mode', () => {
    const boolInterceptor = createSoftDeleteInterceptor({
      field: 'isDeleted',
      type: 'boolean'
    });

    it('should use true/false instead of null', () => {
      const query: QueryObject = { type: 'select', table: 'users', fields: ['*'] };

      const r_default = boolInterceptor.interceptQuery(query);
      expect(r_default.where).toEqual({ isDeleted: false });

      const r_only = boolInterceptor.interceptQuery(query, { mode: 'only-deleted' });
      expect(r_only.where).toEqual({ isDeleted: true });
    });
  });

  describe('Operations', () => {
    it('should generate restore query', () => {
      const result = interceptor.restore('users', '1');
      expect(result.type).toBe('update');
      expect(result.data.deletedAt).toBeNull();
      expect(result.where).toEqual({ id: '1' });
    });

    it('should return query as-is for hardDelete', () => {
      const query: QueryObject = { type: 'delete', table: 'users', where: { id: 1 } };
      const result = interceptor.hardDelete(query);
      expect(result).toBe(query);
      expect(result.type).toBe('delete');
    });
  });
});
