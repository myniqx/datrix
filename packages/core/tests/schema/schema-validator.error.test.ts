/**
 * Schema Validator Tests - Error Path
 *
 * Tests for error handling and validation failures
 * Target: 95%+ coverage
 */

import { validatePartial, validateSchema } from "../../src";
import {
	assertSchema,
	isValid,
	validateMany,
	validateOrThrow,
} from "../../src/validator/schema-validator";
import {
	invalidData,
	sampleSchemas,
	validData,
} from "../../../types/src/test/fixtures";
import { expectFailureError } from "../../../types/src/test/helpers";
import { describe, it, expect } from "vitest";

describe("SchemaValidator - Error Path", () => {
	describe("validateSchema - Type Checking", () => {
		it("should reject non-object data", () => {
			const nonObjectInput = "not an object";
			const validationResult = validateSchema(
				nonObjectInput,
				sampleSchemas.userSchema,
			);

			const validationError = expectFailureError(validationResult);
			expect(validationError.some((e) => e.code === "TYPE_MISMATCH")).toBe(
				true,
			);
		});

		it("should reject null", () => {
			const nullInput = null;
			const validationResult = validateSchema(
				nullInput,
				sampleSchemas.userSchema,
			);

			const validationError = expectFailureError(validationResult);
			expect(validationError.some((e) => e.code === "TYPE_MISMATCH")).toBe(
				true,
			);
		});

		it("should reject undefined", () => {
			const undefinedInput = undefined;
			const validationResult = validateSchema(
				undefinedInput,
				sampleSchemas.userSchema,
			);

			const validationError = expectFailureError(validationResult);
			expect(validationError.some((e) => e.code === "TYPE_MISMATCH")).toBe(
				true,
			);
		});

		it("should reject array", () => {
			const arrayInput: unknown[] = [];
			const validationResult = validateSchema(
				arrayInput,
				sampleSchemas.userSchema,
			);

			const validationError = expectFailureError(validationResult);
			expect(validationError.some((e) => e.code === "TYPE_MISMATCH")).toBe(
				true,
			);
		});

		it("should reject number", () => {
			const numberInput = 123;
			const validationResult = validateSchema(
				numberInput,
				sampleSchemas.userSchema,
			);

			const validationError = expectFailureError(validationResult);
			expect(validationError.some((e) => e.code === "TYPE_MISMATCH")).toBe(
				true,
			);
		});
	});

	describe("validateSchema - Required Fields", () => {
		it("should fail when required fields are missing", () => {
			const userMissingRequiredFields = invalidData.user.missingRequired;
			const validationResult = validateSchema(
				userMissingRequiredFields,
				sampleSchemas.userSchema,
			);

			const validationError = expectFailureError(validationResult);
			expect(
				validationError.some(
					(e) => e.field === "email" && e.code === "REQUIRED",
				),
			).toBe(true);
			expect(
				validationError.some(
					(e) => e.field === "name" && e.code === "REQUIRED",
				),
			).toBe(true);
		});
	});

	describe("validateSchema - Field Validation", () => {
		it("should fail for invalid email format", () => {
			const userWithInvalidEmail = invalidData.user.invalidEmail;
			const validationResult = validateSchema(
				userWithInvalidEmail,
				sampleSchemas.userSchema,
			);

			const validationError = expectFailureError(validationResult);
			expect(
				validationError.some(
					(e) => e.field === "email" && e.code === "PATTERN",
				),
			).toBe(true);
		});

		it("should fail for age below minimum", () => {
			const userWithInvalidAge = invalidData.user.invalidAge;
			const validationResult = validateSchema(
				userWithInvalidAge,
				sampleSchemas.userSchema,
			);

			const validationError = expectFailureError(validationResult);
			expect(
				validationError.some(
					(e) => e.field === "age" && e.code === "MIN_VALUE",
				),
			).toBe(true);
		});

		it("should fail for invalid enum value", () => {
			const userWithInvalidRole = invalidData.user.invalidRole;
			const validationResult = validateSchema(
				userWithInvalidRole,
				sampleSchemas.userSchema,
			);

			const validationError = expectFailureError(validationResult);
			expect(
				validationError.some(
					(e) => e.field === "role" && e.code === "INVALID_ENUM",
				),
			).toBe(true);
		});

		it("should fail for title too short", () => {
			const postWithShortTitle = invalidData.post.titleTooShort;
			const validationResult = validateSchema(
				postWithShortTitle,
				sampleSchemas.postSchema,
			);

			const validationError = expectFailureError(validationResult);
			expect(
				validationError.some(
					(e) => e.field === "title" && e.code === "MIN_LENGTH",
				),
			).toBe(true);
		});

		it("should fail for title too long", () => {
			const postWithLongTitle = invalidData.post.titleTooLong;
			const validationResult = validateSchema(
				postWithLongTitle,
				sampleSchemas.postSchema,
			);

			const validationError = expectFailureError(validationResult);
			expect(
				validationError.some(
					(e) => e.field === "title" && e.code === "MAX_LENGTH",
				),
			).toBe(true);
		});
	});

	describe("validateSchema - Multiple Errors", () => {
		it("should collect all validation errors by default", () => {
			const multipleErrorsData = {
				id: 1,
				age: 15,
				role: "superadmin",
			};

			const validationResult = validateSchema(
				multipleErrorsData,
				sampleSchemas.userSchema,
			);

			const validationError = expectFailureError(validationResult);
			expect(validationError.length).toBeGreaterThanOrEqual(4);
		});

		it("should abort early if option is set", () => {
			const multipleErrorsData = {
				id: 1,
				age: 15,
				role: "superadmin",
			};

			const validationResult = validateSchema(
				multipleErrorsData,
				sampleSchemas.userSchema,
				{
					abortEarly: true,
				},
			);

			const validationError = expectFailureError(validationResult);
			expect(validationError.length).toBe(1);
		});
	});

	describe("validateSchema - Unknown Fields (Strict Mode)", () => {
		it("should fail for unknown fields in strict mode (default)", () => {
			const userWithUnknownField = {
				...validData.user,
				extraField: "should not be here",
			};

			const validationResult = validateSchema(
				userWithUnknownField,
				sampleSchemas.userSchema,
			);

			const validationError = expectFailureError(validationResult);
			expect(
				validationError.some(
					(e) => e.field === "extraField" && e.code === "UNKNOWN",
				),
			).toBe(true);
		});
	});

	describe("validatePartial - Update Validation", () => {
		it("should validate provided fields", () => {
			const partialUpdateWithInvalidEmail = {
				email: "not-an-email",
			};

			const validationResult = validatePartial(
				partialUpdateWithInvalidEmail,
				sampleSchemas.userSchema,
			);

			const validationError = expectFailureError(validationResult);
			expect(
				validationError.some(
					(e) => e.field === "email" && e.code === "PATTERN",
				),
			).toBe(true);
		});

		it("should reject non-object data", () => {
			const nonObjectInput = "not an object";
			const validationResult = validatePartial(
				nonObjectInput,
				sampleSchemas.userSchema,
			);

			const validationError = expectFailureError(validationResult);
			expect(validationError.some((e) => e.code === "TYPE_MISMATCH")).toBe(
				true,
			);
		});

		it("should handle unknown fields in strict mode", () => {
			const partialUpdateWithUnknown = {
				name: "Updated Name",
				unknownField: "value",
			};

			const validationResult = validatePartial(
				partialUpdateWithUnknown,
				sampleSchemas.userSchema,
				{
					strict: true,
				},
			);

			const validationError = expectFailureError(validationResult);
			expect(
				validationError.some(
					(e) => e.field === "unknownField" && e.code === "UNKNOWN",
				),
			).toBe(true);
		});
	});

	describe("validateMany - Array Validation", () => {
		it("should reject non-array data", () => {
			const nonArrayInput = "not an array";
			const validationResult = validateMany(
				nonArrayInput,
				sampleSchemas.userSchema,
			);

			const validationError = expectFailureError(validationResult);
			expect(validationError.some((e) => e.code === "TYPE_MISMATCH")).toBe(
				true,
			);
		});

		it("should reject object instead of array", () => {
			const objectInput = validData.user;
			const validationResult = validateMany(
				objectInput,
				sampleSchemas.userSchema,
			);

			const validationError = expectFailureError(validationResult);
			expect(validationError.some((e) => e.code === "TYPE_MISMATCH")).toBe(
				true,
			);
		});

		it("should collect errors from multiple items", () => {
			const mixedValidityUsers = [
				validData.user,
				{ id: 2, email: "invalid", name: "User 2" },
				{ id: 3 },
			];

			const validationResult = validateMany(
				mixedValidityUsers,
				sampleSchemas.userSchema,
			);

			const validationError = expectFailureError(validationResult);
			expect(validationError.length).toBeGreaterThan(0);

			const errorFields = validationError.map((e) => e.field);
			expect(errorFields.some((f) => f.startsWith("[1]"))).toBe(true);
			expect(errorFields.some((f) => f.startsWith("[2]"))).toBe(true);
		});

		it("should abort early on first item error if option is set", () => {
			const usersWithFirstInvalid = [{ id: 1 }, validData.user];

			const validationResult = validateMany(
				usersWithFirstInvalid,
				sampleSchemas.userSchema,
				{
					abortEarly: true,
				},
			);

			const validationError = expectFailureError(validationResult);
			expect(validationError.length).toBe(1);
		});
	});

	describe("isValid - Boolean Check", () => {
		it("should return false for invalid data", () => {
			const userWithInvalidEmail = invalidData.user.invalidEmail;
			const isUserValid = isValid(
				userWithInvalidEmail,
				sampleSchemas.userSchema,
			);

			expect(isUserValid).toBe(false);
		});

		it("should return false for missing required fields", () => {
			const userMissingRequired = invalidData.user.missingRequired;
			const isUserValid = isValid(
				userMissingRequired,
				sampleSchemas.userSchema,
			);

			expect(isUserValid).toBe(false);
		});

		it("should respect options", () => {
			const userWithExtraField = {
				...validData.user,
				extraField: "value",
			};

			const validStrict = isValid(
				userWithExtraField,
				sampleSchemas.userSchema,
				{
					strict: true,
				},
			);
			expect(validStrict).toBe(false);
		});
	});

	describe("validateOrThrow - Throws on Error", () => {
		it("should throw Error for invalid data", () => {
			const userWithInvalidEmail = invalidData.user.invalidEmail;

			expect(() => {
				validateOrThrow(userWithInvalidEmail, sampleSchemas.userSchema);
			}).toThrow(Error);
		});

		it("should include error messages in thrown error", () => {
			const userWithInvalidEmail = invalidData.user.invalidEmail;

			expect(() => {
				validateOrThrow(userWithInvalidEmail, sampleSchemas.userSchema);
			}).toThrow(/Validation failed/);
		});

		it("should throw for missing required fields", () => {
			const userMissingRequired = invalidData.user.missingRequired;

			expect(() => {
				validateOrThrow(userMissingRequired, sampleSchemas.userSchema);
			}).toThrow();
		});
	});

	describe("assertSchema - Type Assertion", () => {
		it("should throw for invalid data", () => {
			const invalidUserData: unknown = invalidData.user.invalidEmail;

			expect(() => {
				assertSchema(invalidUserData, sampleSchemas.userSchema);
			}).toThrow();
		});

		it("should throw Error with message", () => {
			const invalidUserData: unknown = invalidData.user.invalidEmail;

			expect(() => {
				assertSchema(invalidUserData, sampleSchemas.userSchema);
			}).toThrow(/Validation assertion failed/);
		});
	});

	describe("ValidatorOptions - Configuration", () => {
		describe("strict option", () => {
			it("should enforce strict validation by default", () => {
				const userWithExtraField = { ...validData.user, extra: "field" };
				const validationResult = validateSchema(
					userWithExtraField,
					sampleSchemas.userSchema,
				);

				const validationError = expectFailureError(validationResult);
				expect(validationError.some((e) => e.code === "UNKNOWN")).toBe(true);
			});
		});

		describe("abortEarly option", () => {
			it("should collect all errors by default", () => {
				const multipleErrorsData = {
					id: 1,
					email: "invalid",
					name: "a",
				};
				const validationResult = validateSchema(
					multipleErrorsData,
					sampleSchemas.userSchema,
				);

				const validationError = expectFailureError(validationResult);
				expect(validationError.length).toBeGreaterThanOrEqual(2);
			});

			it("should stop at first error when abortEarly=true", () => {
				const multipleErrorsData = {
					id: 1,
					email: "invalid",
					name: "a",
				};
				const validationResult = validateSchema(
					multipleErrorsData,
					sampleSchemas.userSchema,
					{
						abortEarly: true,
					},
				);

				const validationError = expectFailureError(validationResult);
				expect(validationError.length).toBe(1);
			});
		});
	});
});
