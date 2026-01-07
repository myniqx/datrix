/**
 * Schema Validator Tests
 *
 * Comprehensive tests for schema-level validation
 * Target: 95%+ coverage
 */

import { describe, it, expect } from 'vitest';
import {
  validateSchema,
  validatePartial,
  validateMany,
  isValid,
  validateOrThrow,
  assertSchema,
} from '@core/validator/schema-validator';
import {
  sampleSchemas,
  validData,
  invalidData,
  createTestData,
} from '../../utils/fixtures';
import {
  expectSuccess,
  expectFailure,
  expectErrorCode,
  expectFieldError,
  expectErrorCount,
} from '../../utils/helpers';

describe('SchemaValidator', () => {
  describe('validateSchema - Basic Validation', () => {
    it('should validate valid user data', () => {
      const result = validateSchema(validData.user, sampleSchemas.userSchema);
      expectSuccess(result);
      expect(result.data).toMatchObject({
        id: 1,
        email: 'user@example.com',
        name: 'John Doe',
      });
    });

    it('should validate valid post data', () => {
      const result = validateSchema(validData.post, sampleSchemas.postSchema);
      expectSuccess(result);
      expect(result.data).toMatchObject({
        id: 1,
        title: 'Test Post Title',
        content: expect.any(String),
      });
    });

    it('should validate valid profile data', () => {
      const result = validateSchema(validData.profile, sampleSchemas.profileSchema);
      expectSuccess(result);
      expect(result.data).toMatchObject({
        id: 1,
        userId: 1,
      });
    });
  });

  describe('validateSchema - Type Checking', () => {
    it('should reject non-object data', () => {
      const result = validateSchema('not an object', sampleSchemas.userSchema);
      expectFailure(result);
      expectErrorCode(result.error, 'TYPE_MISMATCH');
    });

    it('should reject null', () => {
      const result = validateSchema(null, sampleSchemas.userSchema);
      expectFailure(result);
      expectErrorCode(result.error, 'TYPE_MISMATCH');
    });

    it('should reject undefined', () => {
      const result = validateSchema(undefined, sampleSchemas.userSchema);
      expectFailure(result);
      expectErrorCode(result.error, 'TYPE_MISMATCH');
    });

    it('should reject array', () => {
      const result = validateSchema([], sampleSchemas.userSchema);
      expectFailure(result);
      expectErrorCode(result.error, 'TYPE_MISMATCH');
    });

    it('should reject number', () => {
      const result = validateSchema(123, sampleSchemas.userSchema);
      expectFailure(result);
      expectErrorCode(result.error, 'TYPE_MISMATCH');
    });
  });

  describe('validateSchema - Required Fields', () => {
    it('should fail when required fields are missing', () => {
      const result = validateSchema(
        invalidData.user.missingRequired,
        sampleSchemas.userSchema
      );
      expectFailure(result);
      expectFieldError(result.error, 'email', 'REQUIRED');
      expectFieldError(result.error, 'name', 'REQUIRED');
    });

    it('should pass when only required fields are provided', () => {
      const minimalUser = {
        id: 1,
        email: 'test@example.com',
        name: 'Test User',
      };
      const result = validateSchema(minimalUser, sampleSchemas.userSchema);
      expectSuccess(result);
    });

    it('should pass when optional fields are omitted', () => {
      const userWithoutAge = createTestData.user({ age: undefined });
      delete (userWithoutAge as Record<string, unknown>).age;

      const result = validateSchema(userWithoutAge, sampleSchemas.userSchema);
      expectSuccess(result);
    });
  });

  describe('validateSchema - Field Validation', () => {
    it('should fail for invalid email format', () => {
      const result = validateSchema(
        invalidData.user.invalidEmail,
        sampleSchemas.userSchema
      );
      expectFailure(result);
      expectFieldError(result.error, 'email', 'PATTERN');
    });

    it('should fail for age below minimum', () => {
      const result = validateSchema(
        invalidData.user.invalidAge,
        sampleSchemas.userSchema
      );
      expectFailure(result);
      expectFieldError(result.error, 'age', 'MIN_VALUE');
    });

    it('should fail for invalid enum value', () => {
      const result = validateSchema(
        invalidData.user.invalidRole,
        sampleSchemas.userSchema
      );
      expectFailure(result);
      expectFieldError(result.error, 'role', 'INVALID_ENUM');
    });

    it('should fail for title too short', () => {
      const result = validateSchema(
        invalidData.post.titleTooShort,
        sampleSchemas.postSchema
      );
      expectFailure(result);
      expectFieldError(result.error, 'title', 'MIN_LENGTH');
    });

    it('should fail for title too long', () => {
      const result = validateSchema(
        invalidData.post.titleTooLong,
        sampleSchemas.postSchema
      );
      expectFailure(result);
      expectFieldError(result.error, 'title', 'MAX_LENGTH');
    });
  });

  describe('validateSchema - Multiple Errors', () => {
    it('should collect all validation errors by default', () => {
      const badData = {
        id: 1,
        // missing email and name (2 errors)
        age: 15, // below min (1 error)
        role: 'superadmin', // invalid enum (1 error)
      };

      const result = validateSchema(badData, sampleSchemas.userSchema);
      expectFailure(result);
      expect(result.error.length).toBeGreaterThanOrEqual(4);
    });

    it('should abort early if option is set', () => {
      const badData = {
        id: 1,
        // missing email and name
        age: 15,
        role: 'superadmin',
      };

      const result = validateSchema(badData, sampleSchemas.userSchema, {
        abortEarly: true,
      });
      expectFailure(result);
      expect(result.error.length).toBe(1); // Only first error
    });
  });

  describe('validateSchema - Unknown Fields (Strict Mode)', () => {
    it('should fail for unknown fields in strict mode (default)', () => {
      const dataWithExtra = {
        ...validData.user,
        extraField: 'should not be here',
      };

      const result = validateSchema(dataWithExtra, sampleSchemas.userSchema);
      expectFailure(result);
      expectFieldError(result.error, 'extraField', 'UNKNOWN');
    });

    it('should pass with unknown fields when strict=false', () => {
      const dataWithExtra = {
        ...validData.user,
        extraField: 'allowed',
      };

      const result = validateSchema(dataWithExtra, sampleSchemas.userSchema, {
        strict: false,
      });
      expectSuccess(result);
      expect(result.data).toHaveProperty('extraField', 'allowed');
    });

    it('should strip unknown fields when stripUnknown=true', () => {
      const dataWithExtra = {
        ...validData.user,
        extraField: 'will be removed',
      };

      const result = validateSchema(dataWithExtra, sampleSchemas.userSchema, {
        strict: false,
        stripUnknown: true,
      });
      expectSuccess(result);
      expect(result.data).not.toHaveProperty('extraField');
    });
  });

  describe('validatePartial - Update Validation', () => {
    it('should validate partial data without requiring all fields', () => {
      const partialUpdate = {
        name: 'Updated Name',
      };

      const result = validatePartial(partialUpdate, sampleSchemas.userSchema);
      expectSuccess(result);
      expect(result.data).toEqual({ name: 'Updated Name' });
    });

    it('should allow updating single field', () => {
      const partialUpdate = {
        age: 30,
      };

      const result = validatePartial(partialUpdate, sampleSchemas.userSchema);
      expectSuccess(result);
      expect(result.data).toEqual({ age: 30 });
    });

    it('should validate provided fields', () => {
      const partialUpdate = {
        email: 'not-an-email', // Invalid
      };

      const result = validatePartial(partialUpdate, sampleSchemas.userSchema);
      expectFailure(result);
      expectFieldError(result.error, 'email', 'PATTERN');
    });

    it('should allow empty object (no updates)', () => {
      const result = validatePartial({}, sampleSchemas.userSchema);
      expectSuccess(result);
      expect(result.data).toEqual({});
    });

    it('should reject non-object data', () => {
      const result = validatePartial('not an object', sampleSchemas.userSchema);
      expectFailure(result);
      expectErrorCode(result.error, 'TYPE_MISMATCH');
    });

    it('should handle unknown fields in strict mode', () => {
      const partialUpdate = {
        name: 'Updated Name',
        unknownField: 'value',
      };

      const result = validatePartial(partialUpdate, sampleSchemas.userSchema, {
        strict: true,
      });
      expectFailure(result);
      expectFieldError(result.error, 'unknownField', 'UNKNOWN');
    });

    it('should allow unknown fields when strict=false', () => {
      const partialUpdate = {
        name: 'Updated Name',
        unknownField: 'value',
      };

      const result = validatePartial(partialUpdate, sampleSchemas.userSchema, {
        strict: false,
      });
      expectSuccess(result);
      expect(result.data).toHaveProperty('unknownField');
    });
  });

  describe('validateMany - Array Validation', () => {
    it('should validate array of valid data', () => {
      const users = [
        createTestData.user({ id: 1, email: 'user1@example.com' }),
        createTestData.user({ id: 2, email: 'user2@example.com' }),
        createTestData.user({ id: 3, email: 'user3@example.com' }),
      ];

      const result = validateMany(users, sampleSchemas.userSchema);
      expectSuccess(result);
      expect(result.data).toHaveLength(3);
      expect(result.data[0]).toHaveProperty('email', 'user1@example.com');
    });

    it('should validate empty array', () => {
      const result = validateMany([], sampleSchemas.userSchema);
      expectSuccess(result);
      expect(result.data).toEqual([]);
    });

    it('should reject non-array data', () => {
      const result = validateMany('not an array', sampleSchemas.userSchema);
      expectFailure(result);
      expectErrorCode(result.error, 'TYPE_MISMATCH');
    });

    it('should reject object instead of array', () => {
      const result = validateMany(validData.user, sampleSchemas.userSchema);
      expectFailure(result);
      expectErrorCode(result.error, 'TYPE_MISMATCH');
    });

    it('should collect errors from multiple items', () => {
      const users = [
        validData.user, // Valid
        { id: 2, email: 'invalid', name: 'User 2' }, // Invalid email
        { id: 3 }, // Missing required fields
      ];

      const result = validateMany(users, sampleSchemas.userSchema);
      expectFailure(result);
      expect(result.error.length).toBeGreaterThan(0);

      // Check that errors include array index
      const errorFields = result.error.map((e) => e.field);
      expect(errorFields.some((f) => f.startsWith('[1]'))).toBe(true);
      expect(errorFields.some((f) => f.startsWith('[2]'))).toBe(true);
    });

    it('should abort early on first item error if option is set', () => {
      const users = [
        { id: 1 }, // Missing required fields
        validData.user,
      ];

      const result = validateMany(users, sampleSchemas.userSchema, {
        abortEarly: true,
      });
      expectFailure(result);
      expect(result.error.length).toBe(1); // Only first error
    });

    it('should validate large arrays', () => {
      const users = Array.from({ length: 100 }, (_, i) =>
        createTestData.user({ id: i + 1, email: `user${i + 1}@example.com` })
      );

      const result = validateMany(users, sampleSchemas.userSchema);
      expectSuccess(result);
      expect(result.data).toHaveLength(100);
    });
  });

  describe('isValid - Boolean Check', () => {
    it('should return true for valid data', () => {
      const valid = isValid(validData.user, sampleSchemas.userSchema);
      expect(valid).toBe(true);
    });

    it('should return false for invalid data', () => {
      const valid = isValid(
        invalidData.user.invalidEmail,
        sampleSchemas.userSchema
      );
      expect(valid).toBe(false);
    });

    it('should return false for missing required fields', () => {
      const valid = isValid(
        invalidData.user.missingRequired,
        sampleSchemas.userSchema
      );
      expect(valid).toBe(false);
    });

    it('should respect options', () => {
      const dataWithExtra = {
        ...validData.user,
        extraField: 'value',
      };

      const validStrict = isValid(dataWithExtra, sampleSchemas.userSchema, {
        strict: true,
      });
      expect(validStrict).toBe(false);

      const validNonStrict = isValid(dataWithExtra, sampleSchemas.userSchema, {
        strict: false,
      });
      expect(validNonStrict).toBe(true);
    });
  });

  describe('validateOrThrow - Throws on Error', () => {
    it('should return data for valid input', () => {
      const data = validateOrThrow(validData.user, sampleSchemas.userSchema);
      expect(data).toMatchObject({
        id: 1,
        email: 'user@example.com',
      });
    });

    it('should throw Error for invalid data', () => {
      expect(() => {
        validateOrThrow(invalidData.user.invalidEmail, sampleSchemas.userSchema);
      }).toThrow(Error);
    });

    it('should include error messages in thrown error', () => {
      expect(() => {
        validateOrThrow(invalidData.user.invalidEmail, sampleSchemas.userSchema);
      }).toThrow(/Validation failed/);
    });

    it('should throw for missing required fields', () => {
      expect(() => {
        validateOrThrow(
          invalidData.user.missingRequired,
          sampleSchemas.userSchema
        );
      }).toThrow();
    });
  });

  describe('assertSchema - Type Assertion', () => {
    it('should not throw for valid data', () => {
      const data: unknown = validData.user;
      expect(() => {
        assertSchema(data, sampleSchemas.userSchema);
      }).not.toThrow();
    });

    it('should throw for invalid data', () => {
      const data: unknown = invalidData.user.invalidEmail;
      expect(() => {
        assertSchema(data, sampleSchemas.userSchema);
      }).toThrow();
    });

    it('should throw Error with message', () => {
      const data: unknown = invalidData.user.invalidEmail;
      expect(() => {
        assertSchema(data, sampleSchemas.userSchema);
      }).toThrow(/Validation assertion failed/);
    });

    it('should narrow type after successful assertion', () => {
      const data: unknown = validData.user;
      assertSchema<typeof validData.user>(data, sampleSchemas.userSchema);

      // After assertion, TypeScript knows data is the correct type
      expect(data.email).toBe('user@example.com');
      expect(data.name).toBe('John Doe');
    });
  });

  describe('ValidatorOptions - Configuration', () => {
    describe('strict option', () => {
      it('should enforce strict validation by default', () => {
        const dataWithExtra = { ...validData.user, extra: 'field' };
        const result = validateSchema(dataWithExtra, sampleSchemas.userSchema);
        expectFailure(result);
      });

      it('should allow unknown fields when strict=false', () => {
        const dataWithExtra = { ...validData.user, extra: 'field' };
        const result = validateSchema(dataWithExtra, sampleSchemas.userSchema, {
          strict: false,
        });
        expectSuccess(result);
      });
    });

    describe('stripUnknown option', () => {
      it('should keep unknown fields by default', () => {
        const dataWithExtra = { ...validData.user, extra: 'field' };
        const result = validateSchema(dataWithExtra, sampleSchemas.userSchema, {
          strict: false,
        });
        expectSuccess(result);
        expect(result.data).toHaveProperty('extra');
      });

      it('should remove unknown fields when stripUnknown=true', () => {
        const dataWithExtra = { ...validData.user, extra: 'field' };
        const result = validateSchema(dataWithExtra, sampleSchemas.userSchema, {
          strict: false,
          stripUnknown: true,
        });
        expectSuccess(result);
        expect(result.data).not.toHaveProperty('extra');
      });
    });

    describe('abortEarly option', () => {
      it('should collect all errors by default', () => {
        const badData = {
          id: 1,
          email: 'invalid', // Invalid pattern
          name: 'a', // Too short (minLength: 2)
        };
        const result = validateSchema(badData, sampleSchemas.userSchema);
        expectFailure(result);
        expect(result.error.length).toBeGreaterThanOrEqual(2);
      });

      it('should stop at first error when abortEarly=true', () => {
        const badData = {
          id: 1,
          email: 'invalid', // Invalid pattern
          name: 'a', // Too short (minLength: 2)
        };
        const result = validateSchema(badData, sampleSchemas.userSchema, {
          abortEarly: true,
        });
        expectFailure(result);
        expect(result.error.length).toBe(1);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty schema', () => {
      const emptySchema = {
        name: 'Empty',
        fields: {},
      };
      const result = validateSchema({}, emptySchema);
      expectSuccess(result);
      expect(result.data).toEqual({});
    });

    it('should handle schema with all optional fields', () => {
      const optionalSchema = {
        name: 'Optional',
        fields: {
          field1: { type: 'string' as const, required: false },
          field2: { type: 'number' as const, required: false },
        },
      };
      const result = validateSchema({}, optionalSchema);
      expectSuccess(result);
    });

    it('should validate nested object structures', () => {
      const userData = {
        ...validData.user,
        createdAt: new Date(),
      };
      const result = validateSchema(userData, sampleSchemas.userSchema);
      expectSuccess(result);
      expect(result.data.createdAt).toBeInstanceOf(Date);
    });

    it('should handle default values in schema', () => {
      const minimalUser = {
        id: 1,
        email: 'test@example.com',
        name: 'Test',
        // role and active have defaults
      };
      const result = validateSchema(minimalUser, sampleSchemas.userSchema);
      expectSuccess(result);
    });
  });
});
