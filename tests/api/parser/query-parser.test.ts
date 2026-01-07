/**
 * API Parser - Query Parser Tests
 *
 * Tests the main orchestration of query parameter parsing:
 * - Integration of fields, where, populate, pagination, and sort
 * - Pagination logic (limit/offset vs page/pageSize)
 * - Sorting logic
 * - Error handling and options
 */

import { describe, it, expect } from 'vitest';
import { parseQuery } from '@api/parser/query-parser';
import type { RawQueryParams, ParserOptions } from '@api/parser/types';

describe('API Parser - Query Parser', () => {
  it('should parse empty parameters with default pagination', () => {
    const params: RawQueryParams = {};
    const result = parseQuery(params);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      limit: 25,
      offset: 0
    });
  });

  describe('Pagination', () => {
    it('should parse limit and offset directly', () => {
      const params: RawQueryParams = { limit: '10', offset: '20' };
      const result = parseQuery(params);

      expect(result.success).toBe(true);
      expect(result.data?.limit).toBe(10);
      expect(result.data?.offset).toBe(20);
    });

    it('should parse page and pageSize', () => {
      const params: RawQueryParams = { page: '2', pageSize: '15' };
      const result = parseQuery(params);

      expect(result.success).toBe(true);
      expect(result.data?.limit).toBe(15);
      expect(result.data?.offset).toBe(15);
      expect(result.data?.page).toBe(2);
      expect(result.data?.pageSize).toBe(15);
    });

    it('should use default pageSize when page is provided without pageSize', () => {
      const params: RawQueryParams = { page: '3' };
      const result = parseQuery(params);

      expect(result.success).toBe(true);
      expect(result.data?.limit).toBe(25);
      expect(result.data?.offset).toBe(50);
    });

    it('should respect maxPageSize option', () => {
      const params: RawQueryParams = { limit: '200' };
      const options: ParserOptions = { maxPageSize: 50 };
      const result = parseQuery(params, options);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PAGINATION');
      expect(result.error?.message).toContain('exceeds maximum');
    });

    it('should fail on invalid pagination values', () => {
      const params: RawQueryParams = { page: '0' }; // Page must be >= 1
      const result = parseQuery(params);

      expect(result.success).toBe(false);
      expect(result.error?.field).toBe('page');
    });
  });

  describe('Sorting', () => {
    it('should parse single field ascending sort', () => {
      const params: RawQueryParams = { sort: 'name' };
      const result = parseQuery(params);

      expect(result.success).toBe(true);
      expect(result.data?.orderBy).toEqual([{ field: 'name', direction: 'asc' }]);
    });

    it('should parse single field descending sort', () => {
      const params: RawQueryParams = { sort: '-createdAt' };
      const result = parseQuery(params);

      expect(result.success).toBe(true);
      expect(result.data?.orderBy).toEqual([{ field: 'createdAt', direction: 'desc' }]);
    });

    it('should parse multiple fields sort', () => {
      const params: RawQueryParams = { sort: 'name,-age,status' };
      const result = parseQuery(params);

      expect(result.success).toBe(true);
      expect(result.data?.orderBy).toEqual([
        { field: 'name', direction: 'asc' },
        { field: 'age', direction: 'desc' },
        { field: 'status', direction: 'asc' }
      ]);
    });

    it('should handle sort as an array of strings', () => {
      const params: RawQueryParams = { sort: ['name', '-age'] };
      const result = parseQuery(params);

      expect(result.success).toBe(true);
      expect(result.data?.orderBy).toEqual([
        { field: 'name', direction: 'asc' },
        { field: 'age', direction: 'desc' }
      ]);
    });

    it('should fail on invalid sort field names', () => {
      const params: RawQueryParams = { sort: 'invalid-field!' };
      const result = parseQuery(params);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_SYNTAX');
    });
  });

  describe('Integration (Fields, Where, Populate)', () => {
    it('should combine multiple query sections', () => {
      const params: RawQueryParams = {
        fields: 'id,name',
        'where[status]': 'active',
        populate: 'author',
        sort: '-id',
        limit: '5'
      };

      const result = parseQuery(params);

      expect(result.success).toBe(true);
      const data = result.data!;

      // select (parsed by fields-parser)
      expect(data.select).toEqual(['id', 'name']);

      // where (parsed by where-parser)
      expect(data.where).toEqual({ status: 'active' });

      // populate (parsed by populate-parser)
      expect(data.populate).toEqual({ author: '*' });

      // orderBy
      expect(data.orderBy).toEqual([{ field: 'id', direction: 'desc' }]);

      // pagination
      expect(data.limit).toBe(5);
    });
  });
});
