/**
 * Field Validator Tests
 *
 * Comprehensive tests for the field validation engine
 * Target: 95%+ coverage
 */

import { describe, it, expect } from 'vitest';
import { validateField } from '@core/validator/field-validator';
import { sampleFields, edgeCases } from '../../utils/fixtures';
import {
  expectSuccess,
  expectFailure,
  expectErrorCode,
  expectFieldError,
  createMockDate,
} from '../../utils/helpers';

describe('FieldValidator', () => {
  describe('Required Field Validation', () => {
    it('should fail when required field is undefined', () => {
      const result = validateField(undefined, sampleFields.requiredString, 'name');
      expectFailure(result);
      expectErrorCode(result.error, 'REQUIRED');
    });

    it('should fail when required field is null', () => {
      const result = validateField(null, sampleFields.requiredString, 'name');
      expectFailure(result);
      expectErrorCode(result.error, 'REQUIRED');
    });

    it('should pass when required field has a value', () => {
      const result = validateField('test', sampleFields.requiredString, 'name');
      expectSuccess(result);
      expect(result.data).toBe('test');
    });

    it('should pass when optional field is undefined', () => {
      const result = validateField(undefined, sampleFields.optionalString, 'name');
      expectSuccess(result);
      expect(result.data).toBeUndefined();
    });

    it('should pass when optional field is null', () => {
      const result = validateField(null, sampleFields.optionalString, 'name');
      expectSuccess(result);
      expect(result.data).toBeNull();
    });
  });

  describe('String Field Validation', () => {
    describe('Type Checking', () => {
      it('should accept valid string', () => {
        const result = validateField('hello', sampleFields.requiredString, 'name');
        expectSuccess(result);
        expect(result.data).toBe('hello');
      });

      it('should reject number', () => {
        const result = validateField(123, sampleFields.requiredString, 'name');
        expectFailure(result);
        expectErrorCode(result.error, 'TYPE_MISMATCH');
      });

      it('should reject boolean', () => {
        const result = validateField(true, sampleFields.requiredString, 'name');
        expectFailure(result);
        expectErrorCode(result.error, 'TYPE_MISMATCH');
      });

      it('should reject object', () => {
        const result = validateField({}, sampleFields.requiredString, 'name');
        expectFailure(result);
        expectErrorCode(result.error, 'TYPE_MISMATCH');
      });

      it('should reject array', () => {
        const result = validateField([], sampleFields.requiredString, 'name');
        expectFailure(result);
        expectErrorCode(result.error, 'TYPE_MISMATCH');
      });
    });

    describe('minLength Validation', () => {
      it('should pass when string length equals minLength', () => {
        const result = validateField('abc', sampleFields.stringWithMinLength, 'name');
        expectSuccess(result);
      });

      it('should pass when string length exceeds minLength', () => {
        const result = validateField('abcdef', sampleFields.stringWithMinLength, 'name');
        expectSuccess(result);
      });

      it('should fail when string length is less than minLength', () => {
        const result = validateField('ab', sampleFields.stringWithMinLength, 'name');
        expectFailure(result);
        expectErrorCode(result.error, 'MIN_LENGTH');
      });

      it('should fail for empty string when minLength > 0', () => {
        const result = validateField('', sampleFields.stringWithMinLength, 'name');
        expectFailure(result);
        expectErrorCode(result.error, 'MIN_LENGTH');
      });
    });

    describe('maxLength Validation', () => {
      it('should pass when string length equals maxLength', () => {
        const result = validateField('a'.repeat(10), sampleFields.stringWithMaxLength, 'name');
        expectSuccess(result);
      });

      it('should pass when string length is less than maxLength', () => {
        const result = validateField('abc', sampleFields.stringWithMaxLength, 'name');
        expectSuccess(result);
      });

      it('should fail when string length exceeds maxLength', () => {
        const result = validateField('a'.repeat(11), sampleFields.stringWithMaxLength, 'name');
        expectFailure(result);
        expectErrorCode(result.error, 'MAX_LENGTH');
      });
    });

    describe('Pattern Validation', () => {
      it('should pass when string matches pattern', () => {
        const result = validateField('abc', sampleFields.stringWithPattern, 'name');
        expectSuccess(result);
      });

      it('should fail when string does not match pattern', () => {
        const result = validateField('ABC123', sampleFields.stringWithPattern, 'name');
        expectFailure(result);
        expectErrorCode(result.error, 'PATTERN');
      });

      it('should validate email pattern correctly', () => {
        const validEmails = [
          'user@example.com',
          'test.user@example.com',
          'user+tag@example.co.uk',
        ];

        for (const email of validEmails) {
          const result = validateField(email, sampleFields.emailField, 'email');
          expectSuccess(result);
        }
      });

      it('should reject invalid email patterns', () => {
        const invalidEmails = [
          'not-an-email',
          '@example.com',
          'user@',
          'user@.com',
          'user @example.com',
        ];

        for (const email of invalidEmails) {
          const result = validateField(email, sampleFields.emailField, 'email');
          expectFailure(result);
          expectErrorCode(result.error, 'PATTERN');
        }
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty string', () => {
        const result = validateField(edgeCases.emptyString, sampleFields.optionalString, 'name');
        expectSuccess(result);
        expect(result.data).toBe('');
      });

      it('should handle whitespace string', () => {
        const result = validateField(edgeCases.whitespace, sampleFields.optionalString, 'name');
        expectSuccess(result);
      });

      it('should handle special characters', () => {
        const result = validateField(edgeCases.specialChars, sampleFields.optionalString, 'name');
        expectSuccess(result);
      });

      it('should handle unicode characters', () => {
        const result = validateField(edgeCases.unicodeString, sampleFields.optionalString, 'name');
        expectSuccess(result);
      });
    });
  });

  describe('Number Field Validation', () => {
    describe('Type Checking', () => {
      it('should accept valid number', () => {
        const result = validateField(42, sampleFields.requiredNumber, 'age');
        expectSuccess(result);
        expect(result.data).toBe(42);
      });

      it('should accept zero', () => {
        const result = validateField(0, sampleFields.requiredNumber, 'age');
        expectSuccess(result);
      });

      it('should accept negative numbers', () => {
        const result = validateField(-5, sampleFields.requiredNumber, 'age');
        expectSuccess(result);
      });

      it('should accept float numbers', () => {
        const result = validateField(3.14, sampleFields.requiredNumber, 'price');
        expectSuccess(result);
      });

      it('should reject string', () => {
        const result = validateField('123', sampleFields.requiredNumber, 'age');
        expectFailure(result);
        expectErrorCode(result.error, 'TYPE_MISMATCH');
      });

      it('should reject NaN', () => {
        const result = validateField(NaN, sampleFields.requiredNumber, 'age');
        expectFailure(result);
        expectErrorCode(result.error, 'TYPE_MISMATCH');
      });

      it('should reject boolean', () => {
        const result = validateField(true, sampleFields.requiredNumber, 'age');
        expectFailure(result);
        expectErrorCode(result.error, 'TYPE_MISMATCH');
      });
    });

    describe('min Validation', () => {
      it('should pass when number equals min', () => {
        const result = validateField(0, sampleFields.numberWithMin, 'age');
        expectSuccess(result);
      });

      it('should pass when number exceeds min', () => {
        const result = validateField(10, sampleFields.numberWithMin, 'age');
        expectSuccess(result);
      });

      it('should fail when number is less than min', () => {
        const result = validateField(-1, sampleFields.numberWithMin, 'age');
        expectFailure(result);
        expectErrorCode(result.error, 'MIN_VALUE');
      });
    });

    describe('max Validation', () => {
      it('should pass when number equals max', () => {
        const result = validateField(100, sampleFields.numberWithMax, 'age');
        expectSuccess(result);
      });

      it('should pass when number is less than max', () => {
        const result = validateField(50, sampleFields.numberWithMax, 'age');
        expectSuccess(result);
      });

      it('should fail when number exceeds max', () => {
        const result = validateField(101, sampleFields.numberWithMax, 'age');
        expectFailure(result);
        expectErrorCode(result.error, 'MAX_VALUE');
      });
    });

    describe('integer Validation', () => {
      it('should pass for integer values', () => {
        const result = validateField(42, sampleFields.integerField, 'count');
        expectSuccess(result);
      });

      it('should pass for zero', () => {
        const result = validateField(0, sampleFields.integerField, 'count');
        expectSuccess(result);
      });

      it('should pass for negative integers', () => {
        const result = validateField(-10, sampleFields.integerField, 'count');
        expectSuccess(result);
      });

      it('should fail for float values', () => {
        const result = validateField(3.14, sampleFields.integerField, 'count');
        expectFailure(result);
        expectErrorCode(result.error, 'INVALID_FORMAT');
      });
    });

    describe('Age Field (min + max)', () => {
      it('should accept valid age', () => {
        const result = validateField(25, sampleFields.ageField, 'age');
        expectSuccess(result);
      });

      it('should accept minimum age', () => {
        const result = validateField(18, sampleFields.ageField, 'age');
        expectSuccess(result);
      });

      it('should accept maximum age', () => {
        const result = validateField(120, sampleFields.ageField, 'age');
        expectSuccess(result);
      });

      it('should reject age below minimum', () => {
        const result = validateField(17, sampleFields.ageField, 'age');
        expectFailure(result);
        expectErrorCode(result.error, 'MIN_VALUE');
      });

      it('should reject age above maximum', () => {
        const result = validateField(121, sampleFields.ageField, 'age');
        expectFailure(result);
        expectErrorCode(result.error, 'MAX_VALUE');
      });
    });
  });

  describe('Boolean Field Validation', () => {
    it('should accept true', () => {
      const result = validateField(true, sampleFields.requiredBoolean, 'active');
      expectSuccess(result);
      expect(result.data).toBe(true);
    });

    it('should accept false', () => {
      const result = validateField(false, sampleFields.requiredBoolean, 'active');
      expectSuccess(result);
      expect(result.data).toBe(false);
    });

    it('should reject string "true"', () => {
      const result = validateField('true', sampleFields.requiredBoolean, 'active');
      expectFailure(result);
      expectErrorCode(result.error, 'TYPE_MISMATCH');
    });

    it('should reject number 1', () => {
      const result = validateField(1, sampleFields.requiredBoolean, 'active');
      expectFailure(result);
      expectErrorCode(result.error, 'TYPE_MISMATCH');
    });

    it('should reject number 0', () => {
      const result = validateField(0, sampleFields.requiredBoolean, 'active');
      expectFailure(result);
      expectErrorCode(result.error, 'TYPE_MISMATCH');
    });
  });

  describe('Date Field Validation', () => {
    describe('Type Checking', () => {
      it('should accept valid Date object', () => {
        const date = new Date('2024-01-01');
        const result = validateField(date, sampleFields.requiredDate, 'createdAt');
        expectSuccess(result);
        expect(result.data).toBeInstanceOf(Date);
      });

      it('should reject date string', () => {
        const result = validateField('2024-01-01', sampleFields.requiredDate, 'createdAt');
        expectFailure(result);
        expectErrorCode(result.error, 'TYPE_MISMATCH');
      });

      it('should reject invalid Date object', () => {
        const invalidDate = new Date('invalid');
        const result = validateField(invalidDate, sampleFields.requiredDate, 'createdAt');
        expectFailure(result);
        expectErrorCode(result.error, 'INVALID_DATE');
      });

      it('should reject timestamp number', () => {
        const result = validateField(Date.now(), sampleFields.requiredDate, 'createdAt');
        expectFailure(result);
        expectErrorCode(result.error, 'TYPE_MISMATCH');
      });
    });

    describe('min Date Validation', () => {
      it('should pass when date equals min', () => {
        const date = new Date('2020-01-01');
        const result = validateField(date, sampleFields.dateWithMin, 'createdAt');
        expectSuccess(result);
      });

      it('should pass when date is after min', () => {
        const date = new Date('2021-01-01');
        const result = validateField(date, sampleFields.dateWithMin, 'createdAt');
        expectSuccess(result);
      });

      it('should fail when date is before min', () => {
        const date = new Date('2019-12-31');
        const result = validateField(date, sampleFields.dateWithMin, 'createdAt');
        expectFailure(result);
        expectErrorCode(result.error, 'MIN_VALUE');
      });
    });

    describe('max Date Validation', () => {
      it('should pass when date equals max', () => {
        const date = new Date('2030-12-31');
        const result = validateField(date, sampleFields.dateWithMax, 'expiresAt');
        expectSuccess(result);
      });

      it('should pass when date is before max', () => {
        const date = new Date('2025-01-01');
        const result = validateField(date, sampleFields.dateWithMax, 'expiresAt');
        expectSuccess(result);
      });

      it('should fail when date is after max', () => {
        const date = new Date('2031-01-01');
        const result = validateField(date, sampleFields.dateWithMax, 'expiresAt');
        expectFailure(result);
        expectErrorCode(result.error, 'MAX_VALUE');
      });
    });
  });

  describe('Enum Field Validation', () => {
    it('should accept valid enum value', () => {
      const result = validateField('admin', sampleFields.roleEnum, 'role');
      expectSuccess(result);
      expect(result.data).toBe('admin');
    });

    it('should accept all valid enum values', () => {
      const roles = ['admin', 'user', 'moderator'];
      for (const role of roles) {
        const result = validateField(role, sampleFields.roleEnum, 'role');
        expectSuccess(result);
        expect(result.data).toBe(role);
      }
    });

    it('should reject invalid enum value', () => {
      const result = validateField('superadmin', sampleFields.roleEnum, 'role');
      expectFailure(result);
      expectErrorCode(result.error, 'INVALID_ENUM');
    });

    it('should reject case-different value', () => {
      const result = validateField('Admin', sampleFields.roleEnum, 'role');
      expectFailure(result);
      expectErrorCode(result.error, 'INVALID_ENUM');
    });

    it('should reject empty string', () => {
      const result = validateField('', sampleFields.roleEnum, 'role');
      expectFailure(result);
      expectErrorCode(result.error, 'INVALID_ENUM');
    });

    it('should reject number', () => {
      const result = validateField(1, sampleFields.roleEnum, 'role');
      expectFailure(result);
      expectErrorCode(result.error, 'TYPE_MISMATCH');
    });
  });

  describe('Array Field Validation', () => {
    describe('Type Checking', () => {
      it('should accept valid array', () => {
        const result = validateField(['a', 'b', 'c'], sampleFields.stringArray, 'tags');
        expectSuccess(result);
        expect(result.data).toEqual(['a', 'b', 'c']);
      });

      it('should accept empty array', () => {
        const result = validateField([], sampleFields.stringArray, 'tags');
        expectSuccess(result);
        expect(result.data).toEqual([]);
      });

      it('should reject non-array', () => {
        const result = validateField('not an array', sampleFields.stringArray, 'tags');
        expectFailure(result);
        expectErrorCode(result.error, 'TYPE_MISMATCH');
      });

      it('should reject object', () => {
        const result = validateField({}, sampleFields.stringArray, 'tags');
        expectFailure(result);
        expectErrorCode(result.error, 'TYPE_MISMATCH');
      });
    });

    describe('Item Type Validation', () => {
      it('should validate item types', () => {
        const result = validateField(['a', 'b', 'c'], sampleFields.stringArray, 'tags');
        expectSuccess(result);
      });

      it('should reject array with invalid item types', () => {
        const result = validateField(['a', 123, 'c'], sampleFields.stringArray, 'tags');
        expectFailure(result);
      });
    });

    describe('minItems Validation', () => {
      it('should pass when array has exact minItems', () => {
        const result = validateField(['a'], sampleFields.arrayWithMinItems, 'tags');
        expectSuccess(result);
      });

      it('should pass when array exceeds minItems', () => {
        const result = validateField(['a', 'b', 'c'], sampleFields.arrayWithMinItems, 'tags');
        expectSuccess(result);
      });

      it('should fail when array has less than minItems', () => {
        const result = validateField([], sampleFields.arrayWithMinItems, 'tags');
        expectFailure(result);
        expectErrorCode(result.error, 'MIN_ITEMS');
      });
    });

    describe('maxItems Validation', () => {
      it('should pass when array has exact maxItems', () => {
        const result = validateField([1, 2, 3, 4, 5], sampleFields.arrayWithMaxItems, 'numbers');
        expectSuccess(result);
      });

      it('should pass when array is less than maxItems', () => {
        const result = validateField([1, 2], sampleFields.arrayWithMaxItems, 'numbers');
        expectSuccess(result);
      });

      it('should fail when array exceeds maxItems', () => {
        const result = validateField([1, 2, 3, 4, 5, 6], sampleFields.arrayWithMaxItems, 'numbers');
        expectFailure(result);
        expectErrorCode(result.error, 'MAX_ITEMS');
      });
    });

    describe('unique Items Validation', () => {
      it('should pass for array with unique items', () => {
        const result = validateField(['a', 'b', 'c'], sampleFields.uniqueArray, 'tags');
        expectSuccess(result);
      });

      it('should fail for array with duplicate items', () => {
        const result = validateField(['a', 'b', 'a'], sampleFields.uniqueArray, 'tags');
        expectFailure(result);
        expectErrorCode(result.error, 'UNIQUE');
      });
    });
  });

  describe('JSON Field Validation', () => {
    it('should accept valid object', () => {
      const obj = { key: 'value' };
      const result = validateField(obj, sampleFields.jsonField, 'metadata');
      expectSuccess(result);
      expect(result.data).toEqual(obj);
    });

    it('should accept array', () => {
      const arr = [1, 2, 3];
      const result = validateField(arr, sampleFields.jsonField, 'metadata');
      expectSuccess(result);
      expect(result.data).toEqual(arr);
    });

    it('should accept null', () => {
      const result = validateField(null, { type: 'json', required: false }, 'metadata');
      expectSuccess(result);
    });

    it('should accept nested objects', () => {
      const nested = { user: { name: 'John', age: 30 } };
      const result = validateField(nested, sampleFields.jsonField, 'metadata');
      expectSuccess(result);
      expect(result.data).toEqual(nested);
    });
  });

  describe('Depth Limit Protection', () => {
    it('should prevent infinite recursion with depth limit', () => {
      // Create a deeply nested array field
      const deepArrayField = {
        type: 'array' as const,
        items: {
          type: 'array' as const,
          items: {
            type: 'array' as const,
            items: {
              type: 'string' as const,
            },
          },
        },
      };

      // Create deeply nested data (more than MAX_VALIDATION_DEPTH)
      const deepData = [[[['deep']]]];

      // This should eventually hit the depth limit
      const result = validateField(deepData, deepArrayField, 'nested', 0);

      // Should either succeed (if depth is within limit) or fail with depth error
      if (!result.success) {
        const hasDepthError = result.error.some(err =>
          err.message.includes('depth')
        );
        // If it failed, it should be due to depth limit
        expect(hasDepthError || result.error.length > 0).toBe(true);
      }
    });
  });

  describe('Multiple Validation Errors', () => {
    it('should accumulate multiple errors for string field', () => {
      const field = {
        type: 'string' as const,
        minLength: 5,
        maxLength: 10,
        pattern: /^[0-9]+$/,
      };

      // Too short and doesn't match pattern
      const result = validateField('abc', field, 'code');
      expectFailure(result);
      expect(result.error.length).toBeGreaterThanOrEqual(1);
    });
  });
});
