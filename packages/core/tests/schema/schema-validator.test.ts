/**
 * Schema Validator Tests - Happy Path
 *
 * Comprehensive tests for schema-level validation
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
	createTestData,
	sampleSchemas,
	validData,
} from "../../../types/src/test/fixtures";
import { expectSuccessData } from "../../../types/src/test/helpers";
import { describe, it, expect } from "vitest";

describe("SchemaValidator - Happy Path", () => {
	describe("validateSchema - Basic Validation", () => {
		it("should validate valid user data", () => {
			const validationResult = validateSchema(
				validData.user,
				sampleSchemas.userSchema,
			);

			const validatedUser = expectSuccessData(validationResult);
			expect(validatedUser).toMatchObject({
				id: 1,
				email: "user@example.com",
				name: "John Doe",
			});
		});

		it("should validate valid post data", () => {
			const validationResult = validateSchema(
				validData.post,
				sampleSchemas.postSchema,
			);

			const validatedPost = expectSuccessData(validationResult);
			expect(validatedPost).toMatchObject({
				id: 1,
				title: "Test Post Title",
				content: expect.any(String),
			});
		});

		it("should validate valid profile data", () => {
			const validationResult = validateSchema(
				validData.profile,
				sampleSchemas.profileSchema,
			);

			const validatedProfile = expectSuccessData(validationResult);
			expect(validatedProfile).toMatchObject({
				id: 1,
				userId: 1,
			});
		});
	});

	describe("validateSchema - Required Fields", () => {
		it("should pass when only required fields are provided", () => {
			const minimalUserData = {
				id: 1,
				email: "test@example.com",
				name: "Test User",
			};
			const validationResult = validateSchema(
				minimalUserData,
				sampleSchemas.userSchema,
			);

			const validatedUser = expectSuccessData(validationResult);
			expect(validatedUser).toMatchObject(minimalUserData);
		});

		it("should pass when optional fields are omitted", () => {
			const userWithoutOptionalAge = createTestData.user({ age: undefined });
			delete (userWithoutOptionalAge as Record<string, unknown>).age;

			const validationResult = validateSchema(
				userWithoutOptionalAge,
				sampleSchemas.userSchema,
			);

			const validatedUser = expectSuccessData(validationResult);
			expect(validatedUser).toBeDefined();
		});
	});

	describe("validateSchema - Unknown Fields (Non-Strict Mode)", () => {
		it("should pass with unknown fields when strict=false", () => {
			const userWithExtraField = {
				...validData.user,
				extraField: "allowed",
			};

			const validationResult = validateSchema(
				userWithExtraField,
				sampleSchemas.userSchema,
				{
					strict: false,
				},
			);

			const validatedUser = expectSuccessData(validationResult);
			expect(validatedUser).toHaveProperty("extraField", "allowed");
		});

		it("should strip unknown fields when stripUnknown=true", () => {
			const userWithExtraField = {
				...validData.user,
				extraField: "will be removed",
			};

			const validationResult = validateSchema(
				userWithExtraField,
				sampleSchemas.userSchema,
				{
					strict: false,
					stripUnknown: true,
				},
			);

			const validatedUser = expectSuccessData(validationResult);
			expect(validatedUser).not.toHaveProperty("extraField");
		});
	});

	describe("validatePartial - Update Validation", () => {
		it("should validate partial data without requiring all fields", () => {
			const partialNameUpdate = {
				name: "Updated Name",
			};

			const validationResult = validatePartial(
				partialNameUpdate,
				sampleSchemas.userSchema,
			);

			const validatedUpdate = expectSuccessData(validationResult);
			expect(validatedUpdate).toEqual({ name: "Updated Name" });
		});

		it("should allow updating single field", () => {
			const partialAgeUpdate = {
				age: 30,
			};

			const validationResult = validatePartial(
				partialAgeUpdate,
				sampleSchemas.userSchema,
			);

			const validatedUpdate = expectSuccessData(validationResult);
			expect(validatedUpdate).toEqual({ age: 30 });
		});

		it("should allow empty object (no updates)", () => {
			const emptyUpdate = {};
			const validationResult = validatePartial(
				emptyUpdate,
				sampleSchemas.userSchema,
			);

			const validatedUpdate = expectSuccessData(validationResult);
			expect(validatedUpdate).toEqual({});
		});

		it("should allow unknown fields when strict=false", () => {
			const partialUpdateWithUnknown = {
				name: "Updated Name",
				unknownField: "value",
			};

			const validationResult = validatePartial(
				partialUpdateWithUnknown,
				sampleSchemas.userSchema,
				{
					strict: false,
				},
			);

			const validatedUpdate = expectSuccessData(validationResult);
			expect(validatedUpdate).toHaveProperty("unknownField");
		});
	});

	describe("validateMany - Array Validation", () => {
		it("should validate array of valid data", () => {
			const multipleUsers = [
				createTestData.user({ id: 1, email: "user1@example.com" }),
				createTestData.user({ id: 2, email: "user2@example.com" }),
				createTestData.user({ id: 3, email: "user3@example.com" }),
			];

			const validationResult = validateMany(
				multipleUsers,
				sampleSchemas.userSchema,
			);

			const validatedUsers = expectSuccessData(validationResult);
			expect(validatedUsers).toHaveLength(3);
			expect(validatedUsers[0]).toHaveProperty("email", "user1@example.com");
		});

		it("should validate empty array", () => {
			const emptyArray: unknown[] = [];
			const validationResult = validateMany(
				emptyArray,
				sampleSchemas.userSchema,
			);

			const validatedArray = expectSuccessData(validationResult);
			expect(validatedArray).toEqual([]);
		});

		it("should validate large arrays", () => {
			const largeUserArray = Array.from({ length: 100 }, (_, i) =>
				createTestData.user({ id: i + 1, email: `user${i + 1}@example.com` }),
			);

			const validationResult = validateMany(
				largeUserArray,
				sampleSchemas.userSchema,
			);

			const validatedUsers = expectSuccessData(validationResult);
			expect(validatedUsers).toHaveLength(100);
		});
	});

	describe("isValid - Boolean Check", () => {
		it("should return true for valid data", () => {
			const isUserValid = isValid(validData.user, sampleSchemas.userSchema);
			expect(isUserValid).toBe(true);
		});

		it("should respect options", () => {
			const userWithExtraField = {
				...validData.user,
				extraField: "value",
			};

			const validNonStrict = isValid(
				userWithExtraField,
				sampleSchemas.userSchema,
				{
					strict: false,
				},
			);
			expect(validNonStrict).toBe(true);
		});
	});

	describe("validateOrThrow - Throws on Error", () => {
		it("should return data for valid input", () => {
			const validatedUser = validateOrThrow(
				validData.user,
				sampleSchemas.userSchema,
			);

			expect(validatedUser).toMatchObject({
				id: 1,
				email: "user@example.com",
			});
		});
	});

	describe("assertSchema - Type Assertion", () => {
		it("should not throw for valid data", () => {
			const unknownUserData: unknown = validData.user;

			expect(() => {
				assertSchema(unknownUserData, sampleSchemas.userSchema);
			}).not.toThrow();
		});

		it("should narrow type after successful assertion", () => {
			const unknownUserData: unknown = validData.user;
			assertSchema<typeof validData.user>(
				unknownUserData,
				sampleSchemas.userSchema,
			);

			expect(unknownUserData.email).toBe("user@example.com");
			expect(unknownUserData.name).toBe("John Doe");
		});
	});

	describe("ValidatorOptions - Configuration", () => {
		describe("strict option", () => {
			it("should allow unknown fields when strict=false", () => {
				const userWithExtraField = { ...validData.user, extra: "field" };
				const validationResult = validateSchema(
					userWithExtraField,
					sampleSchemas.userSchema,
					{
						strict: false,
					},
				);

				const validatedUser = expectSuccessData(validationResult);
				expect(validatedUser).toHaveProperty("extra");
			});
		});

		describe("stripUnknown option", () => {
			it("should keep unknown fields by default", () => {
				const userWithExtraField = { ...validData.user, extra: "field" };
				const validationResult = validateSchema(
					userWithExtraField,
					sampleSchemas.userSchema,
					{
						strict: false,
					},
				);

				const validatedUser = expectSuccessData(validationResult);
				expect(validatedUser).toHaveProperty("extra");
			});

			it("should remove unknown fields when stripUnknown=true", () => {
				const userWithExtraField = { ...validData.user, extra: "field" };
				const validationResult = validateSchema(
					userWithExtraField,
					sampleSchemas.userSchema,
					{
						strict: false,
						stripUnknown: true,
					},
				);

				const validatedUser = expectSuccessData(validationResult);
				expect(validatedUser).not.toHaveProperty("extra");
			});
		});
	});

	describe("Edge Cases", () => {
		it("should handle empty schema", () => {
			const emptySchema = {
				name: "Empty",
				fields: {},
			};
			const validationResult = validateSchema({}, emptySchema);

			const validatedData = expectSuccessData(validationResult);
			expect(validatedData).toEqual({});
		});

		it("should handle schema with all optional fields", () => {
			const optionalFieldsSchema = {
				name: "Optional",
				fields: {
					field1: { type: "string" as const, required: false },
					field2: { type: "number" as const, required: false },
				},
			};
			const validationResult = validateSchema({}, optionalFieldsSchema);

			const validatedData = expectSuccessData(validationResult);
			expect(validatedData).toBeDefined();
		});

		it("should validate nested object structures", () => {
			const userWithTimestamp = {
				...validData.user,
				createdAt: new Date(),
			};
			const validationResult = validateSchema(
				userWithTimestamp,
				sampleSchemas.userSchema,
			);

			const validatedUser = expectSuccessData(validationResult);
			expect(validatedUser["createdAt"]).toBeInstanceOf(Date);
		});

		it("should handle default values in schema", () => {
			const minimalUserData = {
				id: 1,
				email: "test@example.com",
				name: "Test",
			};
			const validationResult = validateSchema(
				minimalUserData,
				sampleSchemas.userSchema,
			);

			const validatedUser = expectSuccessData(validationResult);
			expect(validatedUser).toBeDefined();
		});
	});
});
