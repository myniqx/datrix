/**
 * API Parser - Fields Parser Tests (Error Path)
 *
 * Tests error handling, validation, and security for fields parsing
 */

import { describe, it, expect } from 'vitest';
import { parseFields } from '../../src/parser/fields-parser';
import { RawQueryParams } from '../../../types/src/api/parser';
import { parserTestData } from '../../../types/src/test/fixtures';
import { expectFailureError } from '../../../types/src/test/helpers';

describe('FieldsParser - Error Path', () => {
  describe('Invalid field names', () => {
    it('should reject field starting with digit', () => {
      const digitStartField: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.startsWithDigit
      };

      const error = expectFailureError(parseFields(digitStartField));

      expect(error.code).toBe('INVALID_SYNTAX');
      expect(error.details).toBeDefined();
    });

    it('should reject field with spaces', () => {
      const fieldWithSpaces: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.withSpaces
      };

      const error = expectFailureError(parseFields(fieldWithSpaces));

      expect(error.code).toBe('INVALID_SYNTAX');
    });

    it('should reject field with special characters', () => {
      const fieldWithSpecialChars: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.withSpecialChars
      };

      const error = expectFailureError(parseFields(fieldWithSpecialChars));

      expect(error.code).toBe('INVALID_SYNTAX');
    });

    it('should reject multiple invalid fields in comma-separated list', () => {
      const multipleInvalidFields: RawQueryParams = {
        fields: 'id,name!,user space,1invalid'
      };

      const error = expectFailureError(parseFields(multipleInvalidFields));

      expect(error.code).toBe('INVALID_SYNTAX');
      expect(error.details).toBeDefined();
    });
  });

  describe('Security: SQL Injection', () => {
    it('should reject SQL injection attempt in field name', () => {
      const sqlInjectionField: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.sqlInjection
      };

      const error = expectFailureError(parseFields(sqlInjectionField));

      expect(error.code).toBe('INVALID_SYNTAX');
    });

    it('should reject SQL injection with quotes', () => {
      const sqlInjectionWithQuotes: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.sqlInjectionWithQuotes
      };

      const error = expectFailureError(parseFields(sqlInjectionWithQuotes));

      expect(error.code).toBe('INVALID_SYNTAX');
    });

    it('should reject SQL injection in comma-separated list', () => {
      const mixedSqlInjection: RawQueryParams = {
        fields: `id,${parserTestData.invalidFieldNames.sqlInjection},name`
      };

      const error = expectFailureError(parseFields(mixedSqlInjection));

      expect(error.code).toBe('INVALID_SYNTAX');
    });

    it('should reject SQL injection in array format', () => {
      const sqlInjectionArray: RawQueryParams = {
        fields: ['id', parserTestData.invalidFieldNames.sqlInjection, 'name']
      };

      const error = expectFailureError(parseFields(sqlInjectionArray));

      expect(error.code).toBe('INVALID_SYNTAX');
    });
  });

  describe('Security: XSS Protection', () => {
    it('should reject XSS script tag in field name', () => {
      const xssScriptField: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.xssScript
      };

      const error = expectFailureError(parseFields(xssScriptField));

      expect(error.code).toBe('INVALID_SYNTAX');
    });

    it('should reject XSS img tag in field name', () => {
      const xssImgField: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.xssImgTag
      };

      const error = expectFailureError(parseFields(xssImgField));

      expect(error.code).toBe('INVALID_SYNTAX');
    });
  });

  describe('Security: Path Traversal', () => {
    it('should reject path traversal attempt', () => {
      const pathTraversalField: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.pathTraversal
      };

      const error = expectFailureError(parseFields(pathTraversalField));

      expect(error.code).toBe('INVALID_SYNTAX');
    });
  });

  describe('Security: Command Injection', () => {
    it('should reject command injection attempt', () => {
      const commandInjectionField: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.commandInjection
      };

      const error = expectFailureError(parseFields(commandInjectionField));

      expect(error.code).toBe('INVALID_SYNTAX');
    });
  });

  describe('Security: Null Byte Injection', () => {
    it('should reject null byte injection', () => {
      const nullByteField: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.nullByteInjection
      };

      const error = expectFailureError(parseFields(nullByteField));

      expect(error.code).toBe('INVALID_SYNTAX');
    });

    it('should reject control characters', () => {
      const controlCharsField: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.controlChars
      };

      const error = expectFailureError(parseFields(controlCharsField));

      expect(error.code).toBe('INVALID_SYNTAX');
    });
  });

  describe('Security: Unicode Tricks', () => {
    it('should reject unicode directional override tricks', () => {
      const unicodeTricksField: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.unicodeTricks
      };

      const error = expectFailureError(parseFields(unicodeTricksField));

      expect(error.code).toBe('INVALID_SYNTAX');
    });
  });

  describe('Boundary Safety', () => {
    it('should reject excessively long field names', () => {
      const excessivelyLongField: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.excessivelyLong
      };

      const error = expectFailureError(parseFields(excessivelyLongField));

      expect(error.code).toBe('INVALID_SYNTAX');
    });

    it('should handle large index gracefully', () => {
      const largeIndexParams: RawQueryParams = parserTestData.indexedArrayFields.largeIndex;

      const error = expectFailureError(parseFields(largeIndexParams));

      expect(error.code).toBe('INVALID_SYNTAX');
    });
  });

  describe('Invalid-But-Plausible Input', () => {
    it('should reject numeric string that looks like field name', () => {
      const numericLikeField: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.startsWithDigitComplex
      };

      const error = expectFailureError(parseFields(numericLikeField));

      expect(error.code).toBe('INVALID_SYNTAX');
    });

    it('should reject field with only whitespace', () => {
      const whitespaceOnlyField: RawQueryParams = {
        fields: '   '
      };

      const error = expectFailureError(parseFields(whitespaceOnlyField));

      expect(error.code).toBe('INVALID_SYNTAX');
    });

    it('should reject empty string after trimming', () => {
      const emptyAfterTrim: RawQueryParams = {
        fields: ' , , '
      };

      const error = expectFailureError(parseFields(emptyAfterTrim));

      expect(error.code).toBe('INVALID_SYNTAX');
    });
  });

  describe('Explicit Failure Messages', () => {
    it('should return consistent error structure', () => {
      const invalidField: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.withSpecialChars
      };

      const error = expectFailureError(parseFields(invalidField));

      expect(error).toHaveProperty('code');
      expect(error).toHaveProperty('message');
      expect(error.code).toBe('INVALID_SYNTAX');
      expect(typeof error.message).toBe('string');
    });

    it('should provide details about invalid field', () => {
      const invalidField: RawQueryParams = {
        fields: 'id,invalid!field,name'
      };

      const error = expectFailureError(parseFields(invalidField));

      expect(error.details).toBeDefined();
    });
  });

  describe('Negative Space Coverage', () => {
    it('should reject unknown query parameters that look like fields', () => {
      const unknownParams: RawQueryParams = {
        fields: 'id,name',
        'fields[extra]': 'malicious',
        'fields_injection': 'attack'
      };

      const error = expectFailureError(parseFields(unknownParams));

      expect(error.code).toBe('INVALID_SYNTAX');
    });
  });

  describe('State Isolation', () => {
    it('should not affect subsequent calls after error', () => {
      const invalidParams: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.sqlInjection
      };
      const validParams: RawQueryParams = {
        fields: 'id,name'
      };

      expectFailureError(parseFields(invalidParams));
      const error2 = expectFailureError(parseFields(invalidParams));
      expectFailureError(parseFields(invalidParams));

      expect(error2.code).toBe('INVALID_SYNTAX');
    });
  });
});
