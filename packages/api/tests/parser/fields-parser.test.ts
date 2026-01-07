/**
 * API Parser - Fields Parser Tests
 *
 * Tests the parsing of fields query parameters:
 * - Wildcard (*)
 * - Comma-separated strings
 * - Array format (fields[0], fields[1])
 * - Multiple fields as array
 * - Invalid field validation
 */

import { describe, it, expect } from 'vitest';
import { parseFields } from '@api/parser/fields-parser';
import type { RawQueryParams } from '@api/parser/types';

describe('API Parser - Fields Parser', () => {
  it('should return "*" when no fields parameter is provided', () => {
    const params: RawQueryParams = {};
    const result = parseFields(params);

    expect(result.success).toBe(true);
    expect(result.data).toBe('*');
  });

  it('should return "*" when fields is set to "*"', () => {
    const params: RawQueryParams = { fields: '*' };
    const result = parseFields(params);

    expect(result.success).toBe(true);
    expect(result.data).toBe('*');
  });

  describe('Comma-separated strings', () => {
    it('should parse simple comma-separated list', () => {
      const params: RawQueryParams = { fields: 'id,name,email' };
      const result = parseFields(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(['id', 'name', 'email']);
    });

    it('should trim whitespace from field names', () => {
      const params: RawQueryParams = { fields: 'id, name , email ' };
      const result = parseFields(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(['id', 'name', 'email']);
    });

    it('should ignore empty fields', () => {
      const params: RawQueryParams = { fields: 'id,,name,' };
      const result = parseFields(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(['id', 'name']);
    });
  });

  describe('Array-style parameters (indexed)', () => {
    it('should parse indexed array format', () => {
      const params: RawQueryParams = {
        'fields[0]': 'id',
        'fields[1]': 'name'
      };
      const result = parseFields(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(['id', 'name']);
    });

    it('should stop at first missing index', () => {
      const params: RawQueryParams = {
        'fields[0]': 'id',
        'fields[2]': 'email' // Skip [1]
      };
      const result = parseFields(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(['id']);
    });
  });

  describe('Framework-parsed arrays', () => {
    it('should handle fields parameter as an array', () => {
      // Frameworks like Express might parse fields[]=id&fields[]=name into an array
      const params: RawQueryParams = { fields: ['id', 'name'] };
      const result = parseFields(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(['id', 'name']);
    });
  });

  describe('Validation', () => {
    it('should fail on invalid field names', () => {
      const params: RawQueryParams = { fields: 'id,name!,user space' };
      const result = parseFields(params);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_SYNTAX');
      expect(result.error?.details).toBeDefined();
    });

    it('should allow underscore and dots in field names', () => {
      const params: RawQueryParams = { fields: 'id,_internal,user.profile_name' };
      const result = parseFields(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(['id', '_internal', 'user.profile_name']);
    });

    it('should fail if field starts with a digit', () => {
      const params: RawQueryParams = { fields: '1abc' };
      const result = parseFields(params);

      expect(result.success).toBe(false);
    });
  });
});
