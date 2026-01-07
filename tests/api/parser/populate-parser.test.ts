/**
 * API Parser - Populate Parser Tests
 *
 * Tests the parsing of populate query parameters:
 * - Simple string populate (populate=author)
 * - Wildcard (*)
 * - Comma-separated relations
 * - Object-style populate with fields selection
 * - Nested populate
 * - Max depth enforcement
 */

import { describe, it, expect } from 'vitest';
import { parsePopulate } from '@api/parser/populate-parser';
import type { RawQueryParams } from '@api/parser/types';

describe('API Parser - Populate Parser', () => {
  it('should return undefined when no populate parameter is provided', () => {
    const params: RawQueryParams = {};
    const result = parsePopulate(params);

    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();
  });

  describe('Simple String Format', () => {
    it('should parse single relation string', () => {
      const params: RawQueryParams = { populate: 'author' };
      const result = parsePopulate(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ author: '*' });
    });

    it('should parse comma-separated relations', () => {
      const params: RawQueryParams = { populate: 'author,comments,api_key' };
      const result = parsePopulate(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        author: '*',
        comments: '*',
        api_key: '*'
      });
    });

    it('should handle wildcard "*"', () => {
      const params: RawQueryParams = { populate: '*' };
      const result = parsePopulate(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ '*': '*' });
    });

    it('should handle array format (populate[])', () => {
      const params: RawQueryParams = { populate: ['author', 'comments'] };
      const result = parsePopulate(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        author: '*',
        comments: '*'
      });
    });
  });

  describe('Object-style Populate', () => {
    it('should parse populate[relation]=*', () => {
      const params: RawQueryParams = { 'populate[author]': '*' };
      const result = parsePopulate(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ author: '*' });
    });

    it('should parse populate with specific fields', () => {
      const params: RawQueryParams = {
        'populate[author][fields]': 'name,email'
      };
      const result = parsePopulate(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        author: {
          select: ['name', 'email']
        }
      });
    });

    it('should parse populate with specific fields as indexed array', () => {
      const params: RawQueryParams = {
        'populate[author][fields][0]': 'name',
        'populate[author][fields][1]': 'email'
      };
      const result = parsePopulate(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        author: {
          select: ['name', 'email']
        }
      });
    });
  });

  describe('Nested Populate', () => {
    it('should parse simple nested populate', () => {
      const params: RawQueryParams = {
        'populate[author][populate]': 'profile'
      };
      const result = parsePopulate(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        author: {
          populate: {
            profile: '*'
          }
        }
      });
    });

    it('should parse deep nested populate with fields', () => {
      const params: RawQueryParams = {
        'populate[author][populate][profile][fields]': 'bio',
        'populate[author][populate][profile][populate]': 'avatar'
      };
      const result = parsePopulate(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        author: {
          populate: {
            profile: {
              select: ['bio'],
              populate: {
                avatar: '*'
              }
            }
          }
        }
      });
    });
  });

  describe('Max Depth Enforcement', () => {
    it('should fail when max depth is exceeded', () => {
      // Depth 1: a
      // Depth 2: a.b
      // Depth 3: a.b.c
      const params: RawQueryParams = {
        'populate[a][populate][b][populate][c][populate]': '*'
      };
      const result = parsePopulate(params, 2); // Max depth 2

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MAX_DEPTH_EXCEEDED');
    });

    it('should respect default max depth (5)', () => {
      const params: RawQueryParams = {
        'populate[1][populate][2][populate][3][populate][4][populate][5][populate]': '*'
      };
      const result = parsePopulate(params);
      expect(result.success).toBe(true);

      const params2: RawQueryParams = {
        'populate[1][populate][2][populate][3][populate][4][populate][5][populate][6][populate]': '*'
      };
      const result2 = parsePopulate(params2);
      expect(result2.success).toBe(false);
      expect(result2.error?.code).toBe('MAX_DEPTH_EXCEEDED');
    });
  });
});
