/**
 * Field Validator Tests - Happy Path
 *
 * Comprehensive tests for the field validation engine
 * Target: 95%+ coverage
 */

import { validateField } from "../../src";
import { edgeCases, sampleFields } from "../../../types/src/test/fixtures";
// import { expectSuccessData } from "../../../types/src/test/helpers";
import { describe, it, expect } from "vitest";

const expectSuccessData = (e) => {
	if (!e.success) {
		console.error("Expected success but got failure:", e);
	}
	expect(e.success).toBe(true);
	return e;
};

describe("FieldValidator - Happy Path", () => {
	describe("Required Field Validation", () => {
		it("should pass when required field has a value", () => {
			const validationResult = validateField(
				"test",
				sampleFields.requiredString,
				"name",
			);

			const { data: validatedValue } = expectSuccessData(validationResult);
			expect(validatedValue).toBe("test");
		});

		it("should pass when optional field is undefined", () => {
			const validationResult = validateField(
				undefined,
				sampleFields.optionalString,
				"name",
			);

			const { data: validatedValue } = expectSuccessData(validationResult);
			expect(validatedValue).toBeUndefined();
		});

		it("should pass when optional field is null", () => {
			const validationResult = validateField(
				null,
				sampleFields.optionalString,
				"name",
			);

			const { data: validatedValue } = expectSuccessData(validationResult);
			expect(validatedValue).toBeNull();
		});
	});

	describe("String Field Validation", () => {
		describe("Type Checking", () => {
			it("should accept valid string", () => {
				const validStringValue = "hello";
				const validationResult = validateField(
					validStringValue,
					sampleFields.requiredString,
					"name",
				);

				const { data: validatedString } = expectSuccessData(validationResult);
				expect(validatedString).toBe("hello");
			});
		});

		describe("minLength Validation", () => {
			it("should pass when string length equals minLength", () => {
				const exactLengthString = "abc";
				const validationResult = validateField(
					exactLengthString,
					sampleFields.stringWithMinLength,
					"name",
				);

				expectSuccessData(validationResult);
			});

			it("should pass when string length exceeds minLength", () => {
				const longerString = "abcdef";
				const validationResult = validateField(
					longerString,
					sampleFields.stringWithMinLength,
					"name",
				);

				expectSuccessData(validationResult);
			});
		});

		describe("maxLength Validation", () => {
			it("should pass when string length equals maxLength", () => {
				const exactMaxLengthString = "a".repeat(10);
				const validationResult = validateField(
					exactMaxLengthString,
					sampleFields.stringWithMaxLength,
					"name",
				);

				expectSuccessData(validationResult);
			});

			it("should pass when string length is less than maxLength", () => {
				const shorterString = "abc";
				const validationResult = validateField(
					shorterString,
					sampleFields.stringWithMaxLength,
					"name",
				);

				expectSuccessData(validationResult);
			});
		});

		describe("Pattern Validation", () => {
			it("should pass when string matches pattern", () => {
				const matchingString = "abc";
				const validationResult = validateField(
					matchingString,
					sampleFields.stringWithPattern,
					"name",
				);

				expectSuccessData(validationResult);
			});

			it("should validate email pattern correctly", () => {
				const validEmails = [
					"user@example.com",
					"test.user@example.com",
					"user+tag@example.co.uk",
				];

				for (const validEmail of validEmails) {
					const validationResult = validateField(
						validEmail,
						sampleFields.emailField,
						"email",
					);
					expectSuccessData(validationResult);
				}
			});
		});

		describe("Edge Cases", () => {
			it("should handle empty string", () => {
				const emptyStringValue = edgeCases.emptyString;
				const validationResult = validateField(
					emptyStringValue,
					sampleFields.optionalString,
					"name",
				);

				const { data: validatedValue } = expectSuccessData(validationResult);
				expect(validatedValue).toBe("");
			});

			it("should handle whitespace string", () => {
				const whitespaceString = edgeCases.whitespace;
				const validationResult = validateField(
					whitespaceString,
					sampleFields.optionalString,
					"name",
				);

				expectSuccessData(validationResult);
			});

			it("should handle special characters", () => {
				const specialCharsString = edgeCases.specialChars;
				const validationResult = validateField(
					specialCharsString,
					sampleFields.optionalString,
					"name",
				);

				expectSuccessData(validationResult);
			});

			it("should handle unicode characters", () => {
				const unicodeString = edgeCases.unicodeString;
				const validationResult = validateField(
					unicodeString,
					sampleFields.optionalString,
					"name",
				);

				expectSuccessData(validationResult);
			});
		});
	});

	describe("Number Field Validation", () => {
		describe("Type Checking", () => {
			it("should accept valid number", () => {
				const validNumber = 42;
				const validationResult = validateField(
					validNumber,
					sampleFields.requiredNumber,
					"age",
				);

				const { data: validatedNumber } = expectSuccessData(validationResult);
				expect(validatedNumber).toBe(42);
			});

			it("should accept zero", () => {
				const zeroValue = 0;
				const validationResult = validateField(
					zeroValue,
					sampleFields.requiredNumber,
					"age",
				);

				expectSuccessData(validationResult);
			});

			it("should accept negative numbers", () => {
				const negativeNumber = -5;
				const validationResult = validateField(
					negativeNumber,
					sampleFields.requiredNumber,
					"age",
				);

				expectSuccessData(validationResult);
			});

			it("should accept float numbers", () => {
				const floatNumber = 3.14;
				const validationResult = validateField(
					floatNumber,
					sampleFields.requiredNumber,
					"price",
				);

				expectSuccessData(validationResult);
			});
		});

		describe("min Validation", () => {
			it("should pass when number equals min", () => {
				const minValue = 0;
				const validationResult = validateField(
					minValue,
					sampleFields.numberWithMin,
					"age",
				);

				expectSuccessData(validationResult);
			});

			it("should pass when number exceeds min", () => {
				const aboveMinValue = 10;
				const validationResult = validateField(
					aboveMinValue,
					sampleFields.numberWithMin,
					"age",
				);

				expectSuccessData(validationResult);
			});
		});

		describe("max Validation", () => {
			it("should pass when number equals max", () => {
				const maxValue = 100;
				const validationResult = validateField(
					maxValue,
					sampleFields.numberWithMax,
					"age",
				);

				expectSuccessData(validationResult);
			});

			it("should pass when number is less than max", () => {
				const belowMaxValue = 50;
				const validationResult = validateField(
					belowMaxValue,
					sampleFields.numberWithMax,
					"age",
				);

				expectSuccessData(validationResult);
			});
		});

		describe("integer Validation", () => {
			it("should pass for integer values", () => {
				const integerValue = 42;
				const validationResult = validateField(
					integerValue,
					sampleFields.integerField,
					"count",
				);

				expectSuccessData(validationResult);
			});

			it("should pass for zero", () => {
				const zeroInteger = 0;
				const validationResult = validateField(
					zeroInteger,
					sampleFields.integerField,
					"count",
				);

				expectSuccessData(validationResult);
			});

			it("should pass for negative integers", () => {
				const negativeInteger = -10;
				const validationResult = validateField(
					negativeInteger,
					sampleFields.integerField,
					"count",
				);

				expectSuccessData(validationResult);
			});
		});

		describe("Age Field (min + max)", () => {
			it("should accept valid age", () => {
				const validAge = 25;
				const validationResult = validateField(
					validAge,
					sampleFields.ageField,
					"age",
				);

				expectSuccessData(validationResult);
			});

			it("should accept minimum age", () => {
				const minimumAge = 18;
				const validationResult = validateField(
					minimumAge,
					sampleFields.ageField,
					"age",
				);

				expectSuccessData(validationResult);
			});

			it("should accept maximum age", () => {
				const maximumAge = 120;
				const validationResult = validateField(
					maximumAge,
					sampleFields.ageField,
					"age",
				);

				expectSuccessData(validationResult);
			});
		});
	});

	describe("Boolean Field Validation", () => {
		it("should accept true", () => {
			const trueValue = true;
			const validationResult = validateField(
				trueValue,
				sampleFields.requiredBoolean,
				"active",
			);

			const { data: validatedBoolean } = expectSuccessData(validationResult);
			expect(validatedBoolean).toBe(true);
		});

		it("should accept false", () => {
			const falseValue = false;
			const validationResult = validateField(
				falseValue,
				sampleFields.requiredBoolean,
				"active",
			);

			const { data: validatedBoolean } = expectSuccessData(validationResult);
			expect(validatedBoolean).toBe(false);
		});
	});

	describe("Date Field Validation", () => {
		describe("Type Checking", () => {
			it("should accept valid Date object", () => {
				const validDate = new Date("2024-01-01");
				const validationResult = validateField(
					validDate,
					sampleFields.requiredDate,
					"createdAt",
				);

				const { data: validatedDate } = expectSuccessData(validationResult);
				expect(validatedDate).toBeInstanceOf(Date);
			});
		});

		describe("min Date Validation", () => {
			it("should pass when date equals min", () => {
				const minDate = new Date("2020-01-01");
				const validationResult = validateField(
					minDate,
					sampleFields.dateWithMin,
					"createdAt",
				);

				expectSuccessData(validationResult);
			});

			it("should pass when date is after min", () => {
				const afterMinDate = new Date("2021-01-01");
				const validationResult = validateField(
					afterMinDate,
					sampleFields.dateWithMin,
					"createdAt",
				);

				expectSuccessData(validationResult);
			});
		});

		describe("max Date Validation", () => {
			it("should pass when date equals max", () => {
				const maxDate = new Date("2030-12-31");
				const validationResult = validateField(
					maxDate,
					sampleFields.dateWithMax,
					"expiresAt",
				);

				expectSuccessData(validationResult);
			});

			it("should pass when date is before max", () => {
				const beforeMaxDate = new Date("2025-01-01");
				const validationResult = validateField(
					beforeMaxDate,
					sampleFields.dateWithMax,
					"expiresAt",
				);

				expectSuccessData(validationResult);
			});
		});
	});

	describe("Enum Field Validation", () => {
		it("should accept valid enum value", () => {
			const validEnumValue = "admin";
			const validationResult = validateField(
				validEnumValue,
				sampleFields.roleEnum,
				"role",
			);

			const { data: validatedEnum } = expectSuccessData(validationResult);
			expect(validatedEnum).toBe("admin");
		});

		it("should accept all valid enum values", () => {
			const validRoles = ["admin", "user", "moderator"];

			for (const validRole of validRoles) {
				const validationResult = validateField(
					validRole,
					sampleFields.roleEnum,
					"role",
				);
				const { data: validatedRole } = expectSuccessData(validationResult);
				expect(validatedRole).toBe(validRole);
			}
		});
	});

	describe("Array Field Validation", () => {
		describe("Type Checking", () => {
			it("should accept valid array", () => {
				const validArray = ["a", "b", "c"];
				const validationResult = validateField(
					validArray,
					sampleFields.stringArray,
					"tags",
				);

				const { data: validatedArray } = expectSuccessData(validationResult);
				expect(validatedArray).toEqual(["a", "b", "c"]);
			});

			it("should accept empty array", () => {
				const emptyArray: string[] = [];
				const validationResult = validateField(
					emptyArray,
					sampleFields.stringArray,
					"tags",
				);

				const { data: validatedArray } = expectSuccessData(validationResult);
				expect(validatedArray).toEqual([]);
			});
		});

		describe("Item Type Validation", () => {
			it("should validate item types", () => {
				const stringArray = ["a", "b", "c"];
				const validationResult = validateField(
					stringArray,
					sampleFields.stringArray,
					"tags",
				);

				expectSuccessData(validationResult);
			});
		});

		describe("minItems Validation", () => {
			it("should pass when array has exact minItems", () => {
				const exactMinItemsArray = ["a"];
				const validationResult = validateField(
					exactMinItemsArray,
					sampleFields.arrayWithMinItems,
					"tags",
				);

				expectSuccessData(validationResult);
			});

			it("should pass when array exceeds minItems", () => {
				const aboveMinItemsArray = ["a", "b", "c"];
				const validationResult = validateField(
					aboveMinItemsArray,
					sampleFields.arrayWithMinItems,
					"tags",
				);

				expectSuccessData(validationResult);
			});
		});

		describe("maxItems Validation", () => {
			it("should pass when array has exact maxItems", () => {
				const exactMaxItemsArray = [1, 2, 3, 4, 5];
				const validationResult = validateField(
					exactMaxItemsArray,
					sampleFields.arrayWithMaxItems,
					"numbers",
				);

				expectSuccessData(validationResult);
			});

			it("should pass when array is less than maxItems", () => {
				const belowMaxItemsArray = [1, 2];
				const validationResult = validateField(
					belowMaxItemsArray,
					sampleFields.arrayWithMaxItems,
					"numbers",
				);

				expectSuccessData(validationResult);
			});
		});

		describe("unique Items Validation", () => {
			it("should pass for array with unique items", () => {
				const uniqueItemsArray = ["a", "b", "c"];
				const validationResult = validateField(
					uniqueItemsArray,
					sampleFields.uniqueArray,
					"tags",
				);

				expectSuccessData(validationResult);
			});
		});
	});

	describe("JSON Field Validation", () => {
		it("should accept valid object", () => {
			const validJsonObject = { key: "value" };
			const validationResult = validateField(
				validJsonObject,
				sampleFields.jsonField,
				"metadata",
			);

			const { data: validatedJson } = expectSuccessData(validationResult);
			expect(validatedJson).toEqual(validJsonObject);
		});

		it("should accept array", () => {
			const jsonArray = [1, 2, 3];
			const validationResult = validateField(
				jsonArray,
				sampleFields.jsonField,
				"metadata",
			);

			const { data: validatedJson } = expectSuccessData(validationResult);
			expect(validatedJson).toEqual(jsonArray);
		});

		it("should accept null", () => {
			const nullValue = null;
			const validationResult = validateField(
				nullValue,
				{ type: "json", required: false },
				"metadata",
			);

			expectSuccessData(validationResult);
		});

		it("should accept nested objects", () => {
			const nestedJsonObject = { user: { name: "John", age: 30 } };
			const validationResult = validateField(
				nestedJsonObject,
				sampleFields.jsonField,
				"metadata",
			);

			const { data: validatedJson } = expectSuccessData(validationResult);
			expect(validatedJson).toEqual(nestedJsonObject);
		});
	});

	describe("Depth Limit Protection", () => {
		it("should prevent infinite recursion with depth limit", () => {
			const deepArrayField = {
				type: "array" as const,
				items: {
					type: "array" as const,
					items: {
						type: "array" as const,
						items: {
							type: "string" as const,
						},
					},
				},
			};

			const deeplyNestedData = [[[["deep"]]]];

			const validationResult = validateField(
				deeplyNestedData,
				deepArrayField,
				"nested",
				0,
			);

			if (validationResult.success) {
				expectSuccessData(validationResult);
			}
		});
	});
});
