/**
 * Field Validator Tests - Error Path
 *
 * Tests for error handling and validation failures
 * Target: 95%+ coverage
 */

import { validateField } from '../../src';
import { sampleFields } from '../../../types/src/test/fixtures';
import { expectFailureError } from '../../../types/src/test/helpers';
import { describe, it, expect } from 'vitest';


describe('FieldValidator - Error Path', () => {
  describe('Required Field Validation', () => {
    it('should fail when required field is undefined', () => {
      const undefinedValue = undefined;
      const validationResult = validateField(undefinedValue, sampleFields.requiredString, 'name');

      const validationError = expectFailureError(validationResult);
      expect(validationError.some(e => e.code === 'REQUIRED')).toBe(true);
    });

    it('should fail when required field is null', () => {
      const nullValue = null;
      const validationResult = validateField(nullValue, sampleFields.requiredString, 'name');

      const validationError = expectFailureError(validationResult);
      expect(validationError.some(e => e.code === 'REQUIRED')).toBe(true);
    });
  });

  describe('String Field Validation', () => {
    describe('Type Checking', () => {
      it('should reject number', () => {
        const numberValue = 123;
        const validationResult = validateField(numberValue, sampleFields.requiredString, 'name');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'TYPE_MISMATCH')).toBe(true);
      });

      it('should reject boolean', () => {
        const booleanValue = true;
        const validationResult = validateField(booleanValue, sampleFields.requiredString, 'name');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'TYPE_MISMATCH')).toBe(true);
      });

      it('should reject object', () => {
        const objectValue = {};
        const validationResult = validateField(objectValue, sampleFields.requiredString, 'name');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'TYPE_MISMATCH')).toBe(true);
      });

      it('should reject array', () => {
        const arrayValue: unknown[] = [];
        const validationResult = validateField(arrayValue, sampleFields.requiredString, 'name');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'TYPE_MISMATCH')).toBe(true);
      });
    });

    describe('minLength Validation', () => {
      it('should fail when string length is less than minLength', () => {
        const tooShortString = 'ab';
        const validationResult = validateField(tooShortString, sampleFields.stringWithMinLength, 'name');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'MIN_LENGTH')).toBe(true);
      });

      it('should fail for empty string when minLength > 0', () => {
        const emptyString = '';
        const validationResult = validateField(emptyString, sampleFields.stringWithMinLength, 'name');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'MIN_LENGTH')).toBe(true);
      });
    });

    describe('maxLength Validation', () => {
      it('should fail when string length exceeds maxLength', () => {
        const tooLongString = 'a'.repeat(11);
        const validationResult = validateField(tooLongString, sampleFields.stringWithMaxLength, 'name');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'MAX_LENGTH')).toBe(true);
      });
    });

    describe('Pattern Validation', () => {
      it('should fail when string does not match pattern', () => {
        const nonMatchingString = 'ABC123';
        const validationResult = validateField(nonMatchingString, sampleFields.stringWithPattern, 'name');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'PATTERN')).toBe(true);
      });

      it('should reject invalid email patterns', () => {
        const invalidEmails = [
          'not-an-email',
          '@example.com',
          'user@',
          'user@.com',
          'user @example.com',
        ];

        for (const invalidEmail of invalidEmails) {
          const validationResult = validateField(invalidEmail, sampleFields.emailField, 'email');
          const validationError = expectFailureError(validationResult);
          expect(validationError.some(e => e.code === 'PATTERN')).toBe(true);
        }
      });
    });
  });

  describe('Number Field Validation', () => {
    describe('Type Checking', () => {
      it('should reject string', () => {
        const stringValue = '123';
        const validationResult = validateField(stringValue, sampleFields.requiredNumber, 'age');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'TYPE_MISMATCH')).toBe(true);
      });

      it('should reject NaN', () => {
        const nanValue = NaN;
        const validationResult = validateField(nanValue, sampleFields.requiredNumber, 'age');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'TYPE_MISMATCH')).toBe(true);
      });

      it('should reject boolean', () => {
        const booleanValue = true;
        const validationResult = validateField(booleanValue, sampleFields.requiredNumber, 'age');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'TYPE_MISMATCH')).toBe(true);
      });
    });

    describe('min Validation', () => {
      it('should fail when number is less than min', () => {
        const belowMinValue = -1;
        const validationResult = validateField(belowMinValue, sampleFields.numberWithMin, 'age');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'MIN_VALUE')).toBe(true);
      });
    });

    describe('max Validation', () => {
      it('should fail when number exceeds max', () => {
        const aboveMaxValue = 101;
        const validationResult = validateField(aboveMaxValue, sampleFields.numberWithMax, 'age');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'MAX_VALUE')).toBe(true);
      });
    });

    describe('integer Validation', () => {
      it('should fail for float values', () => {
        const floatValue = 3.14;
        const validationResult = validateField(floatValue, sampleFields.integerField, 'count');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'INVALID_FORMAT')).toBe(true);
      });
    });

    describe('Age Field (min + max)', () => {
      it('should reject age below minimum', () => {
        const belowMinimumAge = 17;
        const validationResult = validateField(belowMinimumAge, sampleFields.ageField, 'age');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'MIN_VALUE')).toBe(true);
      });

      it('should reject age above maximum', () => {
        const aboveMaximumAge = 121;
        const validationResult = validateField(aboveMaximumAge, sampleFields.ageField, 'age');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'MAX_VALUE')).toBe(true);
      });
    });
  });

  describe('Boolean Field Validation', () => {
    it('should reject string "true"', () => {
      const stringTrueValue = 'true';
      const validationResult = validateField(stringTrueValue, sampleFields.requiredBoolean, 'active');

      const validationError = expectFailureError(validationResult);
      expect(validationError.some(e => e.code === 'TYPE_MISMATCH')).toBe(true);
    });

    it('should reject number 1', () => {
      const numberOneValue = 1;
      const validationResult = validateField(numberOneValue, sampleFields.requiredBoolean, 'active');

      const validationError = expectFailureError(validationResult);
      expect(validationError.some(e => e.code === 'TYPE_MISMATCH')).toBe(true);
    });

    it('should reject number 0', () => {
      const numberZeroValue = 0;
      const validationResult = validateField(numberZeroValue, sampleFields.requiredBoolean, 'active');

      const validationError = expectFailureError(validationResult);
      expect(validationError.some(e => e.code === 'TYPE_MISMATCH')).toBe(true);
    });
  });

  describe('Date Field Validation', () => {
    describe('Type Checking', () => {
      it('should reject date string', () => {
        const dateString = '2024-01-01';
        const validationResult = validateField(dateString, sampleFields.requiredDate, 'createdAt');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'TYPE_MISMATCH')).toBe(true);
      });

      it('should reject invalid Date object', () => {
        const invalidDate = new Date('invalid');
        const validationResult = validateField(invalidDate, sampleFields.requiredDate, 'createdAt');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'INVALID_DATE')).toBe(true);
      });

      it('should reject timestamp number', () => {
        const timestampNumber = Date.now();
        const validationResult = validateField(timestampNumber, sampleFields.requiredDate, 'createdAt');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'TYPE_MISMATCH')).toBe(true);
      });
    });

    describe('min Date Validation', () => {
      it('should fail when date is before min', () => {
        const beforeMinDate = new Date('2019-12-31');
        const validationResult = validateField(beforeMinDate, sampleFields.dateWithMin, 'createdAt');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'MIN_VALUE')).toBe(true);
      });
    });

    describe('max Date Validation', () => {
      it('should fail when date is after max', () => {
        const afterMaxDate = new Date('2031-01-01');
        const validationResult = validateField(afterMaxDate, sampleFields.dateWithMax, 'expiresAt');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'MAX_VALUE')).toBe(true);
      });
    });
  });

  describe('Enum Field Validation', () => {
    it('should reject invalid enum value', () => {
      const invalidEnumValue = 'superadmin';
      const validationResult = validateField(invalidEnumValue, sampleFields.roleEnum, 'role');

      const validationError = expectFailureError(validationResult);
      expect(validationError.some(e => e.code === 'INVALID_ENUM')).toBe(true);
    });

    it('should reject case-different value', () => {
      const caseDifferentValue = 'Admin';
      const validationResult = validateField(caseDifferentValue, sampleFields.roleEnum, 'role');

      const validationError = expectFailureError(validationResult);
      expect(validationError.some(e => e.code === 'INVALID_ENUM')).toBe(true);
    });

    it('should reject empty string', () => {
      const emptyString = '';
      const validationResult = validateField(emptyString, sampleFields.roleEnum, 'role');

      const validationError = expectFailureError(validationResult);
      expect(validationError.some(e => e.code === 'INVALID_ENUM')).toBe(true);
    });

    it('should reject number', () => {
      const numberValue = 1;
      const validationResult = validateField(numberValue, sampleFields.roleEnum, 'role');

      const validationError = expectFailureError(validationResult);
      expect(validationError.some(e => e.code === 'TYPE_MISMATCH')).toBe(true);
    });
  });

  describe('Array Field Validation', () => {
    describe('Type Checking', () => {
      it('should reject non-array', () => {
        const nonArrayValue = 'not an array';
        const validationResult = validateField(nonArrayValue, sampleFields.stringArray, 'tags');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'TYPE_MISMATCH')).toBe(true);
      });

      it('should reject object', () => {
        const objectValue = {};
        const validationResult = validateField(objectValue, sampleFields.stringArray, 'tags');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'TYPE_MISMATCH')).toBe(true);
      });
    });

    describe('Item Type Validation', () => {
      it('should reject array with invalid item types', () => {
        const mixedTypeArray = ['a', 123, 'c'];
        const validationResult = validateField(mixedTypeArray, sampleFields.stringArray, 'tags');

        expectFailureError(validationResult);
      });
    });

    describe('minItems Validation', () => {
      it('should fail when array has less than minItems', () => {
        const belowMinItemsArray: string[] = [];
        const validationResult = validateField(belowMinItemsArray, sampleFields.arrayWithMinItems, 'tags');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'MIN_ITEMS')).toBe(true);
      });
    });

    describe('maxItems Validation', () => {
      it('should fail when array exceeds maxItems', () => {
        const aboveMaxItemsArray = [1, 2, 3, 4, 5, 6];
        const validationResult = validateField(aboveMaxItemsArray, sampleFields.arrayWithMaxItems, 'numbers');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'MAX_ITEMS')).toBe(true);
      });
    });

    describe('unique Items Validation', () => {
      it('should fail for array with duplicate items', () => {
        const duplicateItemsArray = ['a', 'b', 'a'];
        const validationResult = validateField(duplicateItemsArray, sampleFields.uniqueArray, 'tags');

        const validationError = expectFailureError(validationResult);
        expect(validationError.some(e => e.code === 'UNIQUE')).toBe(true);
      });
    });
  });

  describe('Multiple Validation Errors', () => {
    it('should accumulate multiple errors for string field', () => {
      const multiConstraintField = {
        type: 'string' as const,
        minLength: 5,
        maxLength: 10,
        pattern: /^[0-9]+$/,
      };

      const invalidMultiConstraintValue = 'abc';
      const validationResult = validateField(invalidMultiConstraintValue, multiConstraintField, 'code');

      const validationError = expectFailureError(validationResult);
      expect(validationError.length).toBeGreaterThanOrEqual(1);
    });
  });
});
