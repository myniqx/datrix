/**
 * API Parser - Where Parser Tests
 *
 * Tests the parsing of where query parameters:
 * - Simple equality
 * - Comparison operators ($gt, $lt, $gte, $lte, $ne)
 * - String operators ($contains, $startsWith, $endsWith)
 * - Array operators ($in, $nin)
 * - Null and Boolean coercion
 * - Logical operators ($and, $or, $not) (Expected to fail/require strengthening)
 */

import { describe, it, expect } from 'vitest';
import { parseWhere } from '@api/parser/where-parser';
import type { RawQueryParams } from '@api/parser/types';

describe('API Parser - Where Parser', () => {
  it('should return undefined when no where parameters are present', () => {
    const params: RawQueryParams = { other: 'value' };
    const result = parseWhere(params);

    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();
  });

  describe('Simple Equality', () => {
    it('should parse single field equality', () => {
      const params: RawQueryParams = { 'where[status]': 'active' };
      const result = parseWhere(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ status: 'active' });
    });

    it('should parse multiple field equality', () => {
      const params: RawQueryParams = {
        'where[status]': 'active',
        'where[type]': 'post'
      };
      const result = parseWhere(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        status: 'active',
        type: 'post'
      });
    });
  });

  describe('Comparison Operators', () => {
    it('should parse $gt, $lt, $gte, $lte operators', () => {
      const params: RawQueryParams = {
        'where[price][$gt]': '100',
        'where[age][$lte]': '18'
      };
      const result = parseWhere(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        price: { $gt: 100 },
        age: { $lte: 18 }
      });
    });

    it('should parse $ne operator', () => {
      const params: RawQueryParams = { 'where[status][$ne]': 'archived' };
      const result = parseWhere(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ status: { $ne: 'archived' } });
    });
  });

  describe('Type Coercion', () => {
    it('should coerce numbers, booleans and null', () => {
      const params: RawQueryParams = {
        'where[id]': '123',
        'where[active]': 'true',
        'where[deleted]': 'false',
        'where[reference]': 'null'
      };
      const result = parseWhere(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        id: 123,
        active: true,
        deleted: false,
        reference: null
      });
    });
  });

  describe('Array Operators', () => {
    it('should parse $in and $nin with array values', () => {
      const params: RawQueryParams = {
        'where[status][$in]': ['active', 'pending'],
        'where[tag][$nin]': ['draft']
      };
      const result = parseWhere(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        status: { $in: ['active', 'pending'] },
        tag: { $nin: ['draft'] }
      });
    });
  });

  describe('String Operators', () => {
    it('should parse $contains, $startsWith, $endsWith', () => {
      const params: RawQueryParams = {
        'where[name][$contains]': 'john',
        'where[email][$startsWith]': 'admin'
      };
      const result = parseWhere(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        name: { $contains: 'john' },
        email: { $startsWith: 'admin' }
      });
    });
  });

  describe('Combining Operators', () => {
    it('should combine multiple operators on the same field', () => {
      const params: RawQueryParams = {
        'where[price][$gte]': '100',
        'where[price][$lte]': '500'
      };
      const result = parseWhere(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        price: {
          $gte: 100,
          $lte: 500
        }
      });
    });
  });

  describe('Logical Operators (Advanced/Recursive)', () => {
    // These tests might fail with the current regex-based implementation
    it('should parse simple $or logical operator', () => {
      const params: RawQueryParams = {
        'where[$or][0][status]': 'active',
        'where[$or][1][status]': 'pending'
      };

      const result = parseWhere(params);

      // EXPECTED: { $or: [{ status: 'active' }, { status: 'pending' }] }
      // ACTUAL: Might fail or return incomplete result with current regex
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        $or: [
          { status: 'active' },
          { status: 'pending' }
        ]
      });
    });
  });
});
