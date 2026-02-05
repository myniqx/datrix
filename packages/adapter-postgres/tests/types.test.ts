/**
 * PostgreSQL Types Tests
 *
 * Tests for type mappings and value conversions
 */

import {
	FIELD_TYPE_TO_POSTGRES,
	fromPostgresValue,
	getPostgresType,
	getPostgresTypeWithModifiers,
	POSTGRES_TO_TS_TYPE,
	toPostgresValue,
} from "../src";
import { FieldType } from "../../types/src/core/schema";
import { describe, it, expect } from "vitest";

describe("PostgreSQL Types", () => {
	describe("Type Mappings", () => {
		it("should map string to TEXT", () => {
			expect(getPostgresType("string")).toBe("TEXT");
		});

		it("should map number to DOUBLE PRECISION", () => {
			expect(getPostgresType("number")).toBe("DOUBLE PRECISION");
		});

		it("should map boolean to BOOLEAN", () => {
			expect(getPostgresType("boolean")).toBe("BOOLEAN");
		});

		it("should map date to TIMESTAMP WITH TIME ZONE", () => {
			expect(getPostgresType("date")).toBe("TIMESTAMP WITH TIME ZONE");
		});

		it("should map json to JSONB", () => {
			expect(getPostgresType("json")).toBe("JSONB");
		});

		it("should map array to JSONB", () => {
			expect(getPostgresType("array")).toBe("JSONB");
		});

		it("should map enum to VARCHAR", () => {
			expect(getPostgresType("enum")).toBe("VARCHAR");
		});

		it("should map file to TEXT", () => {
			expect(getPostgresType("file")).toBe("TEXT");
		});

		it("should map relation to INTEGER", () => {
			expect(getPostgresType("relation")).toBe("INTEGER");
		});

		it("should have mapping for all FieldTypes", () => {
			const fieldTypes: FieldType[] = [
				"string",
				"number",
				"boolean",
				"date",
				"json",
				"array",
				"enum",
				"file",
				"relation",
			];

			for (const fieldType of fieldTypes) {
				expect(FIELD_TYPE_TO_POSTGRES[fieldType]).toBeDefined();
				expect(typeof FIELD_TYPE_TO_POSTGRES[fieldType]).toBe("string");
			}
		});
	});

	describe("Type Modifiers", () => {
		it("should apply VARCHAR with maxLength for string", () => {
			const result = getPostgresTypeWithModifiers("string", { maxLength: 255 });
			expect(result).toBe("VARCHAR(255)");
		});

		it("should keep TEXT for string without maxLength", () => {
			const result = getPostgresTypeWithModifiers("string");
			expect(result).toBe("TEXT");
		});

		it("should apply NUMERIC with precision for number", () => {
			const result = getPostgresTypeWithModifiers("number", { precision: 10 });
			expect(result).toBe("NUMERIC(10)");
		});

		it("should apply NUMERIC with precision and scale for number", () => {
			const result = getPostgresTypeWithModifiers("number", {
				precision: 10,
				scale: 2,
			});
			expect(result).toBe("NUMERIC(10, 2)");
		});

		it("should keep DOUBLE PRECISION for number without modifiers", () => {
			const result = getPostgresTypeWithModifiers("number");
			expect(result).toBe("DOUBLE PRECISION");
		});

		it("should add array brackets for array modifier", () => {
			const result = getPostgresTypeWithModifiers("string", { array: true });
			expect(result).toBe("TEXT[]");
		});

		it("should handle VARCHAR with maxLength and array together", () => {
			const result = getPostgresTypeWithModifiers("string", {
				maxLength: 50,
				array: true,
			});
			expect(result).toBe("VARCHAR(50)");
		});
	});

	describe("toPostgresValue", () => {
		describe("Date conversion", () => {
			it("should keep Date objects as-is", () => {
				const date = new Date("2024-01-01");
				const result = toPostgresValue(date, "date");
				expect(result).toBeInstanceOf(Date);
				expect(result).toBe(date);
			});

			it("should convert string to Date", () => {
				const result = toPostgresValue("2024-01-01", "date");
				expect(result).toBeInstanceOf(Date);
				if (result instanceof Date) {
					expect(result.getFullYear()).toBe(2024);
				}
			});

			it("should convert timestamp number to Date", () => {
				const timestamp = 1704067200000; // 2024-01-01
				const result = toPostgresValue(timestamp, "date");
				expect(result).toBeInstanceOf(Date);
			});

			it("should return null for invalid date strings", () => {
				const result = toPostgresValue("invalid", "date");
				expect(result).toBeInstanceOf(Date);
				// Invalid dates are still Date objects but with NaN time
			});

			it("should return null for null/undefined", () => {
				expect(toPostgresValue(null, "date")).toBe(null);
				expect(toPostgresValue(undefined, "date")).toBe(null);
			});
		});

		describe("Boolean conversion", () => {
			it("should keep boolean values as-is", () => {
				expect(toPostgresValue(true, "boolean")).toBe(true);
				expect(toPostgresValue(false, "boolean")).toBe(false);
			});

			it('should convert string "true" to true', () => {
				expect(toPostgresValue("true", "boolean")).toBe(true);
				expect(toPostgresValue("TRUE", "boolean")).toBe(true);
			});

			it('should convert string "1" to true', () => {
				expect(toPostgresValue("1", "boolean")).toBe(true);
			});

			it("should convert other strings to false", () => {
				expect(toPostgresValue("false", "boolean")).toBe(false);
				expect(toPostgresValue("0", "boolean")).toBe(false);
				expect(toPostgresValue("anything", "boolean")).toBe(true);
			});

			it("should convert number 0 to false", () => {
				expect(toPostgresValue(0, "boolean")).toBe(false);
			});

			it("should convert non-zero numbers to true", () => {
				expect(toPostgresValue(1, "boolean")).toBe(true);
				expect(toPostgresValue(-1, "boolean")).toBe(true);
				expect(toPostgresValue(100, "boolean")).toBe(true);
			});

			it("should return null for null/undefined", () => {
				expect(toPostgresValue(null, "boolean")).toBe(null);
				expect(toPostgresValue(undefined, "boolean")).toBe(null);
			});
		});

		describe("Number conversion", () => {
			it("should keep number values as-is", () => {
				expect(toPostgresValue(42, "number")).toBe(42);
				expect(toPostgresValue(3.14, "number")).toBe(3.14);
				expect(toPostgresValue(-10, "number")).toBe(-10);
			});

			it("should convert numeric strings to numbers", () => {
				expect(toPostgresValue("42", "number")).toBe(42);
				expect(toPostgresValue("3.14", "number")).toBe(3.14);
				expect(toPostgresValue("-10", "number")).toBe(-10);
			});

			it("should return null for non-numeric strings", () => {
				expect(toPostgresValue("abc", "number")).toBe(null);
				expect(toPostgresValue("", "number")).toBe(null);
			});

			it("should return null for null/undefined", () => {
				expect(toPostgresValue(null, "number")).toBe(null);
				expect(toPostgresValue(undefined, "number")).toBe(null);
			});

			it("should handle special number values", () => {
				expect(toPostgresValue(0, "number")).toBe(0);
				expect(toPostgresValue(Infinity, "number")).toBe(Infinity);
				expect(toPostgresValue(-Infinity, "number")).toBe(-Infinity);
			});
		});

		describe("String conversion", () => {
			it("should keep string values as-is", () => {
				expect(toPostgresValue("hello", "string")).toBe("hello");
			});

			it("should convert numbers to strings", () => {
				expect(toPostgresValue(42, "string")).toBe("42");
			});

			it("should convert booleans to strings", () => {
				expect(toPostgresValue(true, "string")).toBe("true");
				expect(toPostgresValue(false, "string")).toBe("false");
			});

			it("should return null for null/undefined", () => {
				expect(toPostgresValue(null, "string")).toBe(null);
				expect(toPostgresValue(undefined, "string")).toBe(null);
			});
		});

		describe("JSON/Array conversion", () => {
			it("should keep objects as-is", () => {
				const obj = { foo: "bar", nested: { value: 123 } };
				expect(toPostgresValue(obj, "json")).toEqual(obj);
			});

			it("should keep arrays as-is", () => {
				const arr = [1, 2, 3, { nested: true }];
				expect(toPostgresValue(arr, "array")).toEqual(arr);
			});

			it("should return null for null/undefined", () => {
				expect(toPostgresValue(null, "json")).toBe(null);
				expect(toPostgresValue(undefined, "array")).toBe(null);
			});
		});

		describe("Enum conversion", () => {
			it("should convert values to strings", () => {
				expect(toPostgresValue("active", "enum")).toBe("active");
				expect(toPostgresValue(123, "enum")).toBe("123");
			});

			it("should return null for null/undefined", () => {
				expect(toPostgresValue(null, "enum")).toBe(null);
				expect(toPostgresValue(undefined, "enum")).toBe(null);
			});
		});

		describe("File conversion", () => {
			it("should convert file paths to strings", () => {
				expect(toPostgresValue("/path/to/file.jpg", "file")).toBe(
					"/path/to/file.jpg",
				);
			});

			it("should return null for null/undefined", () => {
				expect(toPostgresValue(null, "file")).toBe(null);
				expect(toPostgresValue(undefined, "file")).toBe(null);
			});
		});

		describe("Relation conversion", () => {
			it("should keep number values as-is", () => {
				expect(toPostgresValue(123, "relation")).toBe(123);
			});

			it("should convert numeric strings to numbers", () => {
				expect(toPostgresValue("456", "relation")).toBe(456);
			});

			it("should return null for non-numeric strings", () => {
				expect(toPostgresValue("abc", "relation")).toBe(null);
			});

			it("should return null for null/undefined", () => {
				expect(toPostgresValue(null, "relation")).toBe(null);
				expect(toPostgresValue(undefined, "relation")).toBe(null);
			});
		});
	});

	describe("fromPostgresValue", () => {
		describe("Date conversion", () => {
			it("should keep Date objects as-is", () => {
				const date = new Date("2024-01-01");
				const result = fromPostgresValue(date, "date");
				expect(result).toBeInstanceOf(Date);
				expect(result).toBe(date);
			});

			it("should convert strings to Date", () => {
				const result = fromPostgresValue("2024-01-01", "date");
				expect(result).toBeInstanceOf(Date);
			});

			it("should return null for null/undefined", () => {
				expect(fromPostgresValue(null, "date")).toBe(null);
				expect(fromPostgresValue(undefined, "date")).toBe(null);
			});
		});

		describe("Boolean conversion", () => {
			it("should convert truthy values to true", () => {
				expect(fromPostgresValue(true, "boolean")).toBe(true);
				expect(fromPostgresValue(1, "boolean")).toBe(true);
				expect(fromPostgresValue("true", "boolean")).toBe(true);
			});

			it("should convert falsy values to false", () => {
				expect(fromPostgresValue(false, "boolean")).toBe(false);
				expect(fromPostgresValue(0, "boolean")).toBe(false);
				expect(fromPostgresValue("", "boolean")).toBe(false);
			});

			it("should return null for null/undefined", () => {
				expect(fromPostgresValue(null, "boolean")).toBe(null);
				expect(fromPostgresValue(undefined, "boolean")).toBe(null);
			});
		});

		describe("Number conversion", () => {
			it("should keep numbers as-is", () => {
				expect(fromPostgresValue(42, "number")).toBe(42);
				expect(fromPostgresValue(3.14, "number")).toBe(3.14);
			});

			it("should convert strings to numbers", () => {
				expect(fromPostgresValue("42", "number")).toBe(42);
			});

			it("should return null for null/undefined", () => {
				expect(fromPostgresValue(null, "number")).toBe(null);
				expect(fromPostgresValue(undefined, "number")).toBe(null);
			});
		});

		describe("String conversion", () => {
			it("should convert values to strings", () => {
				expect(fromPostgresValue("hello", "string")).toBe("hello");
				expect(fromPostgresValue(42, "string")).toBe("42");
			});

			it("should return null for null/undefined", () => {
				expect(fromPostgresValue(null, "string")).toBe(null);
				expect(fromPostgresValue(undefined, "string")).toBe(null);
			});
		});

		describe("JSON/Array conversion", () => {
			it("should keep parsed JSON as-is", () => {
				const obj = { foo: "bar" };
				expect(fromPostgresValue(obj, "json")).toEqual(obj);
			});

			it("should keep arrays as-is", () => {
				const arr = [1, 2, 3];
				expect(fromPostgresValue(arr, "array")).toEqual(arr);
			});

			it("should return null for null/undefined", () => {
				expect(fromPostgresValue(null, "json")).toBe(null);
				expect(fromPostgresValue(undefined, "array")).toBe(null);
			});
		});

		describe("Relation conversion", () => {
			it("should keep numbers as-is", () => {
				expect(fromPostgresValue(123, "relation")).toBe(123);
			});

			it("should convert strings to numbers", () => {
				expect(fromPostgresValue("456", "relation")).toBe(456);
			});

			it("should return null for null/undefined", () => {
				expect(fromPostgresValue(null, "relation")).toBe(null);
				expect(fromPostgresValue(undefined, "relation")).toBe(null);
			});
		});
	});

	describe("PostgreSQL to TypeScript Mapping", () => {
		it("should map integer types to number", () => {
			expect(POSTGRES_TO_TS_TYPE.SMALLINT).toBe("number");
			expect(POSTGRES_TO_TS_TYPE.INTEGER).toBe("number");
			expect(POSTGRES_TO_TS_TYPE.BIGINT).toBe("number");
			expect(POSTGRES_TO_TS_TYPE.SERIAL).toBe("number");
		});

		it("should map decimal types to number", () => {
			expect(POSTGRES_TO_TS_TYPE.DECIMAL).toBe("number");
			expect(POSTGRES_TO_TS_TYPE.NUMERIC).toBe("number");
			expect(POSTGRES_TO_TS_TYPE.REAL).toBe("number");
			expect(POSTGRES_TO_TS_TYPE["DOUBLE PRECISION"]).toBe("number");
		});

		it("should map text types to string", () => {
			expect(POSTGRES_TO_TS_TYPE.CHAR).toBe("string");
			expect(POSTGRES_TO_TS_TYPE.VARCHAR).toBe("string");
			expect(POSTGRES_TO_TS_TYPE.TEXT).toBe("string");
		});

		it("should map timestamp types to Date", () => {
			expect(POSTGRES_TO_TS_TYPE.TIMESTAMP).toBe("Date");
			expect(POSTGRES_TO_TS_TYPE["TIMESTAMP WITH TIME ZONE"]).toBe("Date");
			expect(POSTGRES_TO_TS_TYPE.DATE).toBe("Date");
		});

		it("should map BOOLEAN to boolean", () => {
			expect(POSTGRES_TO_TS_TYPE.BOOLEAN).toBe("boolean");
		});

		it("should map JSON types to unknown", () => {
			expect(POSTGRES_TO_TS_TYPE.JSON).toBe("unknown");
			expect(POSTGRES_TO_TS_TYPE.JSONB).toBe("unknown");
		});

		it("should map ARRAY to unknown[]", () => {
			expect(POSTGRES_TO_TS_TYPE.ARRAY).toBe("unknown[]");
		});

		it("should map UUID and network types to string", () => {
			expect(POSTGRES_TO_TS_TYPE.UUID).toBe("string");
			expect(POSTGRES_TO_TS_TYPE.INET).toBe("string");
			expect(POSTGRES_TO_TS_TYPE.MACADDR).toBe("string");
		});

		it("should map BYTEA to Uint8Array", () => {
			expect(POSTGRES_TO_TS_TYPE.BYTEA).toBe("Uint8Array");
		});
	});

	describe("Edge Cases", () => {
		it("should handle empty string conversion", () => {
			expect(toPostgresValue("", "string")).toBe("");
			expect(toPostgresValue("", "number")).toBe(null);
		});

		it("should handle zero values correctly", () => {
			expect(toPostgresValue(0, "number")).toBe(0);
			expect(toPostgresValue(0, "boolean")).toBe(false);
		});

		it("should handle NaN correctly", () => {
			expect(toPostgresValue(NaN, "number")).toBe(NaN);
		});

		it("should handle nested JSON objects", () => {
			const complex = {
				level1: {
					level2: {
						level3: {
							value: "deep",
						},
					},
				},
				array: [1, 2, { nested: true }],
			};
			expect(toPostgresValue(complex, "json")).toEqual(complex);
		});
	});
});
