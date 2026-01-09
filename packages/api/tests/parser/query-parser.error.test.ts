/**
 * API Parser - Query Parser Tests (Error Path)
 *
 * Tests error handling for query parsing
 * Focuses on pagination and sort validation
 */

import { describe, it, expect } from 'vitest';
import { parseQuery } from '../../src/parser/query-parser';
import { RawQueryParams, ParserOptions } from '../../../types/src/api/parser';
import { parserTestData } from '../../../types/src/test/fixtures';
import { expectFailureError } from '../../../types/src/test/helpers';

describe('QueryParser - Error Path', () => {
  describe('Pagination errors', () => {
    it('should reject negative limit', () => {
      const negativeLimit: RawQueryParams = parserTestData.invalidPaginationParams.negativeLimit;

      const error = expectFailureError(parseQuery(negativeLimit));

      expect(error.code).toBe('INVALID_PAGINATION');
      expect(error.field).toBe('limit');
    });

    it('should reject negative offset', () => {
      const negativeOffset: RawQueryParams = parserTestData.invalidPaginationParams.negativeOffset;

      const error = expectFailureError(parseQuery(negativeOffset));

      expect(error.code).toBe('INVALID_PAGINATION');
      expect(error.field).toBe('offset');
    });

    it('should reject zero page', () => {
      const zeroPage: RawQueryParams = parserTestData.invalidPaginationParams.zeroPage;

      const error = expectFailureError(parseQuery(zeroPage));

      expect(error.code).toBe('INVALID_PAGINATION');
      expect(error.field).toBe('page');
      expect(error.message).toContain('>= 1');
    });

    it('should reject negative page', () => {
      const negativePage: RawQueryParams = parserTestData.invalidPaginationParams.negativePage;

      const error = expectFailureError(parseQuery(negativePage));

      expect(error.code).toBe('INVALID_PAGINATION');
      expect(error.field).toBe('page');
    });

    it('should reject zero pageSize', () => {
      const zeroPageSize: RawQueryParams = parserTestData.invalidPaginationParams.zeroPageSize;

      const error = expectFailureError(parseQuery(zeroPageSize));

      expect(error.code).toBe('INVALID_PAGINATION');
      expect(error.field).toBe('pageSize');
    });

    it('should reject negative pageSize', () => {
      const negativePageSize: RawQueryParams = parserTestData.invalidPaginationParams.negativePageSize;

      const error = expectFailureError(parseQuery(negativePageSize));

      expect(error.code).toBe('INVALID_PAGINATION');
      expect(error.field).toBe('pageSize');
    });

    it('should reject limit exceeding maxPageSize', () => {
      const exceedsMax: RawQueryParams = parserTestData.invalidPaginationParams.exceedsMaxPageSize;
      const options: ParserOptions = { maxPageSize: 100 };

      const error = expectFailureError(parseQuery(exceedsMax, options));

      expect(error.code).toBe('INVALID_PAGINATION');
      expect(error.field).toBe('limit');
      expect(error.message).toContain('exceeds maximum');
      expect(error.message).toContain('100');
    });

    it('should reject pageSize exceeding maxPageSize', () => {
      const exceedsPageSize: RawQueryParams = { pageSize: '200' };
      const options: ParserOptions = { maxPageSize: 100 };

      const error = expectFailureError(parseQuery(exceedsPageSize, options));

      expect(error.code).toBe('INVALID_PAGINATION');
      expect(error.field).toBe('pageSize');
      expect(error.message).toContain('exceeds maximum');
    });

    it('should reject non-numeric limit', () => {
      const nonNumericLimit: RawQueryParams = parserTestData.invalidPaginationParams.nonNumericLimit;

      const error = expectFailureError(parseQuery(nonNumericLimit));

      expect(error.code).toBe('INVALID_PAGINATION');
      expect(error.field).toBe('limit');
    });

    it('should reject non-numeric page', () => {
      const nonNumericPage: RawQueryParams = parserTestData.invalidPaginationParams.nonNumericPage;

      const error = expectFailureError(parseQuery(nonNumericPage));

      expect(error.code).toBe('INVALID_PAGINATION');
      expect(error.field).toBe('page');
    });
  });

  describe('Sort errors', () => {
    it('should reject SQL injection in sort field', () => {
      const sqlInjectionSort: RawQueryParams = parserTestData.invalidSortParams.sqlInjection;

      const error = expectFailureError(parseQuery(sqlInjectionSort));

      expect(error.code).toBe('INVALID_SYNTAX');
      expect(error.field).toBe('sort');
    });

    it('should reject sort field with special characters', () => {
      const specialCharsSort: RawQueryParams = parserTestData.invalidSortParams.specialChars;

      const error = expectFailureError(parseQuery(specialCharsSort));

      expect(error.code).toBe('INVALID_SYNTAX');
      expect(error.field).toBe('sort');
    });

    it('should reject sort field starting with digit', () => {
      const digitStartSort: RawQueryParams = parserTestData.invalidSortParams.startsWithDigit;

      const error = expectFailureError(parseQuery(digitStartSort));

      expect(error.code).toBe('INVALID_SYNTAX');
      expect(error.field).toBe('sort');
    });

    it('should reject sort field with spaces', () => {
      const spacesSort: RawQueryParams = parserTestData.invalidSortParams.withSpaces;

      const error = expectFailureError(parseQuery(spacesSort));

      expect(error.code).toBe('INVALID_SYNTAX');
      expect(error.field).toBe('sort');
    });

    it('should reject path traversal in sort', () => {
      const pathTraversalSort: RawQueryParams = parserTestData.invalidSortParams.pathTraversal;

      const error = expectFailureError(parseQuery(pathTraversalSort));

      expect(error.code).toBe('INVALID_SYNTAX');
      expect(error.field).toBe('sort');
    });

    it('should reject XSS in sort field', () => {
      const xssSort: RawQueryParams = parserTestData.invalidSortParams.xss;

      const error = expectFailureError(parseQuery(xssSort));

      expect(error.code).toBe('INVALID_SYNTAX');
      expect(error.field).toBe('sort');
    });

    it('should reject excessively long sort field', () => {
      const longSort: RawQueryParams = parserTestData.invalidSortParams.excessivelyLong;

      const error = expectFailureError(parseQuery(longSort));

      expect(error.code).toBe('INVALID_SYNTAX');
      expect(error.field).toBe('sort');
    });

    it('should reject empty sort field', () => {
      const emptySort: RawQueryParams = { sort: '' };

      const error = expectFailureError(parseQuery(emptySort));

      expect(error.code).toBe('INVALID_SYNTAX');
    });

    it('should reject sort with only minus sign', () => {
      const onlyMinus: RawQueryParams = { sort: '-' };

      const error = expectFailureError(parseQuery(onlyMinus));

      expect(error.code).toBe('INVALID_SYNTAX');
      expect(error.field).toBe('sort');
    });
  });

  describe('Integration errors', () => {
    it('should propagate fields parser errors', () => {
      const invalidFields: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.sqlInjection
      };

      const error = expectFailureError(parseQuery(invalidFields));

      expect(error.code).toBe('INVALID_SYNTAX');
    });

    it('should propagate where parser errors', () => {
      const invalidWhere: RawQueryParams = parserTestData.invalidWhereConditions.invalidOperator;

      const error = expectFailureError(parseQuery(invalidWhere));

      expect(error.code).toBe('INVALID_OPERATOR');
    });

    it('should propagate populate parser errors', () => {
      const exceedsDepth: RawQueryParams = parserTestData.maxDepthPopulate.depth6;

      const error = expectFailureError(parseQuery(exceedsDepth));

      expect(error.code).toBe('MAX_DEPTH_EXCEEDED');
    });

    it('should stop at first error (fields before where)', () => {
      const multipleErrors: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.sqlInjection,
        'where[price][$invalid]': '100'
      };

      const error = expectFailureError(parseQuery(multipleErrors));

      // Should fail on fields first
      expect(error.code).toBe('INVALID_SYNTAX');
    });

    it('should stop at first error (pagination before sort)', () => {
      const multipleErrors: RawQueryParams = {
        limit: '-10',
        sort: 'invalid!field'
      };

      const error = expectFailureError(parseQuery(multipleErrors));

      // Should fail on pagination first
      expect(error.code).toBe('INVALID_PAGINATION');
    });
  });

  describe('Explicit Failure Messages', () => {
    it('should return consistent error structure for pagination', () => {
      const invalidPage: RawQueryParams = { page: '0' };

      const error = expectFailureError(parseQuery(invalidPage));

      expect(error).toHaveProperty('code');
      expect(error).toHaveProperty('message');
      expect(error).toHaveProperty('field');
      expect(typeof error.code).toBe('string');
      expect(typeof error.message).toBe('string');
      expect(error.message.length).toBeGreaterThan(0);
    });

    it('should return consistent error structure for sort', () => {
      const invalidSort: RawQueryParams = { sort: 'invalid!field' };

      const error = expectFailureError(parseQuery(invalidSort));

      expect(error).toHaveProperty('code');
      expect(error).toHaveProperty('message');
      expect(error).toHaveProperty('field');
      expect(error.field).toBe('sort');
    });

    it('should include helpful message for maxPageSize exceeded', () => {
      const exceedsMax: RawQueryParams = { limit: '200' };
      const options: ParserOptions = { maxPageSize: 50 };

      const error = expectFailureError(parseQuery(exceedsMax, options));

      expect(error.message).toContain('50');
      expect(error.message).toContain('exceeds');
    });
  });

  describe('Boundary Safety', () => {
    it('should reject extremely large page number', () => {
      const largePage: RawQueryParams = { page: Number.MAX_SAFE_INTEGER.toString() };

      const error = expectFailureError(parseQuery(largePage));

      expect(error.code).toBe('INVALID_PAGINATION');
    });

    it('should reject extremely large limit', () => {
      const largeLimit: RawQueryParams = { limit: '999999999' };
      const options: ParserOptions = { maxPageSize: 1000 };

      const error = expectFailureError(parseQuery(largeLimit, options));

      expect(error.code).toBe('INVALID_PAGINATION');
    });
  });

  describe('State Isolation', () => {
    it('should not affect subsequent calls after error', () => {
      const invalidParams: RawQueryParams = { limit: '-10' };
      const validParams: RawQueryParams = { limit: '10' };

      expectFailureError(parseQuery(invalidParams));
      expectFailureError(parseQuery(invalidParams));
      expectFailureError(parseQuery(invalidParams));

      const error = expectFailureError(parseQuery(invalidParams));
      expect(error.code).toBe('INVALID_PAGINATION');
    });
  });
});
