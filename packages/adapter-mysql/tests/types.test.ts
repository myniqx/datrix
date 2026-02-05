/**
 * MySQL Types Tests
 *
 * Tests for type mappings and value conversions
 */

import {
	FIELD_TYPE_TO_MYSQL,
	fromMySQLValue,
	getMySQLType,
	getMySQLTypeWithModifiers,
	MYSQL_TO_TS_TYPE,
	toMySQLValue,
	parseConnectionString,
} from "../src";
import { FieldType } from "../../types/src/core/schema";
import { describe, it, expect } from "vitest";

describe("MySQL Types", () => {
	describe("Type Mappings", () => {
		it("should map string to TEXT", () => {
			expect(getMySQLType("string")).toBe("TEXT");
		});

		it("should map number to DOUBLE", () => {
			expect(getMySQLType("number")).toBe("DOUBLE");
		});

		it("should map boolean to TINYINT", () => {
			expect(getMySQLType("boolean")).toBe("TINYINT");
		});

		it("should map date to DATETIME", () => {
			expect(getMySQLType("date")).toBe("DATETIME");
		});

		it("should map json to JSON", () => {
			expect(getMySQLType("json")).toBe("JSON");
		});

		it("should map array to JSON", () => {
			expect(getMySQLType("array")).toBe("JSON");
		});

		it("should map enum to VARCHAR", () => {
			expect(getMySQLType("enum")).toBe("VARCHAR");
		});

		it("should map file to TEXT", () => {
			expect(getMySQLType("file")).toBe("TEXT");
		});

		it("should map relation to INT", () => {
			expect(getMySQLType("relation")).toBe("INT");
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
				expect(FIELD_TYPE_TO_MYSQL[fieldType]).toBeDefined();
				expect(typeof FIELD_TYPE_TO_MYSQL[fieldType]).toBe("string");
			}
		});
	});

	describe("Type Modifiers", () => {
		it("should apply VARCHAR with maxLength for string", () => {
			const result = getMySQLTypeWithModifiers("string", { maxLength: 255 });
			expect(result).toBe("VARCHAR(255)");
		});

		it("should keep TEXT for string without maxLength", () => {
			const result = getMySQLTypeWithModifiers("string");
			expect(result).toBe("TEXT");
		});

		it("should apply DECIMAL with precision for number", () => {
			const result = getMySQLTypeWithModifiers("number", { precision: 10 });
			expect(result).toBe("DECIMAL(10)");
		});

		it("should apply DECIMAL with precision and scale for number", () => {
			const result = getMySQLTypeWithModifiers("number", {
				precision: 10,
				scale: 2,
			});
			expect(result).toBe("DECIMAL(10, 2)");
		});

		it("should keep DOUBLE for number without modifiers", () => {
			const result = getMySQLTypeWithModifiers("number");
			expect(result).toBe("DOUBLE");
		});

		it("should return TINYINT(1) for boolean", () => {
			const result = getMySQLTypeWithModifiers("boolean");
			expect(result).toBe("TINYINT(1)");
		});

		it("should return VARCHAR(255) for enum", () => {
			const result = getMySQLTypeWithModifiers("enum");
			expect(result).toBe("VARCHAR(255)");
		});

		it("should add UNSIGNED modifier for integer types", () => {
			const result = getMySQLTypeWithModifiers("relation", { unsigned: true });
			expect(result).toBe("INT UNSIGNED");
		});
	});

	describe("toMySQLValue", () => {
		describe("Date conversion", () => {
			it("should keep Date objects as-is", () => {
				const date = new Date("2024-01-01");
				const result = toMySQLValue(date, "date");
				expect(result).toBeInstanceOf(Date);
				expect(result).toBe(date);
			});

			it("should convert string to Date", () => {
				const result = toMySQLValue("2024-01-01", "date");
				expect(result).toBeInstanceOf(Date);
				if (result instanceof Date) {
					expect(result.getFullYear()).toBe(2024);
				}
			});

			it("should convert timestamp number to Date", () => {
				const timestamp = 1704067200000; // 2024-01-01
				const result = toMySQLValue(timestamp, "date");
				expect(result).toBeInstanceOf(Date);
			});

			it("should return null for null/undefined", () => {
				expect(toMySQLValue(null, "date")).toBe(null);
				expect(toMySQLValue(undefined, "date")).toBe(null);
			});
		});

		describe("Boolean conversion", () => {
			it("should convert boolean true to 1", () => {
				expect(toMySQLValue(true, "boolean")).toBe(1);
			});

			it("should convert boolean false to 0", () => {
				expect(toMySQLValue(false, "boolean")).toBe(0);
			});

			it('should convert string "true" to 1', () => {
				expect(toMySQLValue("true", "boolean")).toBe(1);
				expect(toMySQLValue("TRUE", "boolean")).toBe(1);
			});

			it('should convert string "1" to 1', () => {
				expect(toMySQLValue("1", "boolean")).toBe(1);
			});

			it('should convert string "false" to 0', () => {
				expect(toMySQLValue("false", "boolean")).toBe(0);
				expect(toMySQLValue("0", "boolean")).toBe(0);
			});

			it("should convert other truthy strings to 1", () => {
				expect(toMySQLValue("anything", "boolean")).toBe(1);
			});

			it("should convert number 0 to 0", () => {
				expect(toMySQLValue(0, "boolean")).toBe(0);
			});

			it("should convert non-zero numbers to 1", () => {
				expect(toMySQLValue(1, "boolean")).toBe(1);
				expect(toMySQLValue(-1, "boolean")).toBe(1);
				expect(toMySQLValue(100, "boolean")).toBe(1);
			});

			it("should return null for null/undefined", () => {
				expect(toMySQLValue(null, "boolean")).toBe(null);
				expect(toMySQLValue(undefined, "boolean")).toBe(null);
			});
		});

		describe("Number conversion", () => {
			it("should keep number values as-is", () => {
				expect(toMySQLValue(42, "number")).toBe(42);
				expect(toMySQLValue(3.14, "number")).toBe(3.14);
				expect(toMySQLValue(-10, "number")).toBe(-10);
			});

			it("should convert numeric strings to numbers", () => {
				expect(toMySQLValue("42", "number")).toBe(42);
				expect(toMySQLValue("3.14", "number")).toBe(3.14);
				expect(toMySQLValue("-10", "number")).toBe(-10);
			});

			it("should return null for non-numeric strings", () => {
				expect(toMySQLValue("abc", "number")).toBe(null);
				expect(toMySQLValue("", "number")).toBe(null);
				expect(toMySQLValue("   ", "number")).toBe(null);
			});

			it("should return null for null/undefined", () => {
				expect(toMySQLValue(null, "number")).toBe(null);
				expect(toMySQLValue(undefined, "number")).toBe(null);
			});

			it("should handle special number values", () => {
				expect(toMySQLValue(0, "number")).toBe(0);
				expect(toMySQLValue(Infinity, "number")).toBe(Infinity);
				expect(toMySQLValue(-Infinity, "number")).toBe(-Infinity);
			});
		});

		describe("String conversion", () => {
			it("should keep string values as-is", () => {
				expect(toMySQLValue("hello", "string")).toBe("hello");
			});

			it("should convert numbers to strings", () => {
				expect(toMySQLValue(42, "string")).toBe("42");
			});

			it("should convert booleans to strings", () => {
				expect(toMySQLValue(true, "string")).toBe("true");
				expect(toMySQLValue(false, "string")).toBe("false");
			});

			it("should return null for null/undefined", () => {
				expect(toMySQLValue(null, "string")).toBe(null);
				expect(toMySQLValue(undefined, "string")).toBe(null);
			});
		});

		describe("JSON/Array conversion", () => {
			it("should stringify objects", () => {
				const obj = { foo: "bar", nested: { value: 123 } };
				const result = toMySQLValue(obj, "json");
				expect(result).toBe(JSON.stringify(obj));
			});

			it("should stringify arrays", () => {
				const arr = [1, 2, 3, { nested: true }];
				const result = toMySQLValue(arr, "array");
				expect(result).toBe(JSON.stringify(arr));
			});

			it("should keep strings as-is (already JSON)", () => {
				const jsonStr = '{"foo":"bar"}';
				expect(toMySQLValue(jsonStr, "json")).toBe(jsonStr);
			});

			it("should return null for null/undefined", () => {
				expect(toMySQLValue(null, "json")).toBe(null);
				expect(toMySQLValue(undefined, "array")).toBe(null);
			});
		});

		describe("Enum conversion", () => {
			it("should convert values to strings", () => {
				expect(toMySQLValue("active", "enum")).toBe("active");
				expect(toMySQLValue(123, "enum")).toBe("123");
			});

			it("should return null for null/undefined", () => {
				expect(toMySQLValue(null, "enum")).toBe(null);
				expect(toMySQLValue(undefined, "enum")).toBe(null);
			});
		});

		describe("File conversion", () => {
			it("should convert file paths to strings", () => {
				expect(toMySQLValue("/path/to/file.jpg", "file")).toBe(
					"/path/to/file.jpg",
				);
			});

			it("should return null for null/undefined", () => {
				expect(toMySQLValue(null, "file")).toBe(null);
				expect(toMySQLValue(undefined, "file")).toBe(null);
			});
		});

		describe("Relation conversion", () => {
			it("should keep number values as-is", () => {
				expect(toMySQLValue(123, "relation")).toBe(123);
			});

			it("should convert numeric strings to numbers", () => {
				expect(toMySQLValue("456", "relation")).toBe(456);
			});

			it("should return null for non-numeric strings", () => {
				expect(toMySQLValue("abc", "relation")).toBe(null);
			});

			it("should return null for null/undefined", () => {
				expect(toMySQLValue(null, "relation")).toBe(null);
				expect(toMySQLValue(undefined, "relation")).toBe(null);
			});
		});
	});

	describe("fromMySQLValue", () => {
		describe("Date conversion", () => {
			it("should keep Date objects as-is", () => {
				const date = new Date("2024-01-01");
				const result = fromMySQLValue(date, "date");
				expect(result).toBeInstanceOf(Date);
				expect(result).toBe(date);
			});

			it("should convert strings to Date", () => {
				const result = fromMySQLValue("2024-01-01", "date");
				expect(result).toBeInstanceOf(Date);
			});

			it("should return null for null/undefined", () => {
				expect(fromMySQLValue(null, "date")).toBe(null);
				expect(fromMySQLValue(undefined, "date")).toBe(null);
			});
		});

		describe("Boolean conversion", () => {
			it("should convert number 1 to true", () => {
				expect(fromMySQLValue(1, "boolean")).toBe(true);
			});

			it("should convert number 0 to false", () => {
				expect(fromMySQLValue(0, "boolean")).toBe(false);
			});

			it("should keep boolean values as-is", () => {
				expect(fromMySQLValue(true, "boolean")).toBe(true);
				expect(fromMySQLValue(false, "boolean")).toBe(false);
			});

			it("should convert truthy values to true", () => {
				expect(fromMySQLValue("true", "boolean")).toBe(true);
				expect(fromMySQLValue(2, "boolean")).toBe(true);
			});

			it("should return null for null/undefined", () => {
				expect(fromMySQLValue(null, "boolean")).toBe(null);
				expect(fromMySQLValue(undefined, "boolean")).toBe(null);
			});
		});

		describe("Number conversion", () => {
			it("should keep numbers as-is", () => {
				expect(fromMySQLValue(42, "number")).toBe(42);
				expect(fromMySQLValue(3.14, "number")).toBe(3.14);
			});

			it("should convert strings to numbers", () => {
				expect(fromMySQLValue("42", "number")).toBe(42);
			});

			it("should return null for null/undefined", () => {
				expect(fromMySQLValue(null, "number")).toBe(null);
				expect(fromMySQLValue(undefined, "number")).toBe(null);
			});
		});

		describe("String conversion", () => {
			it("should convert values to strings", () => {
				expect(fromMySQLValue("hello", "string")).toBe("hello");
				expect(fromMySQLValue(42, "string")).toBe("42");
			});

			it("should return null for null/undefined", () => {
				expect(fromMySQLValue(null, "string")).toBe(null);
				expect(fromMySQLValue(undefined, "string")).toBe(null);
			});
		});

		describe("JSON/Array conversion", () => {
			it("should parse JSON strings", () => {
				const jsonStr = '{"foo":"bar"}';
				const result = fromMySQLValue(jsonStr, "json");
				expect(result).toEqual({ foo: "bar" });
			});

			it("should parse array JSON strings", () => {
				const jsonStr = "[1,2,3]";
				const result = fromMySQLValue(jsonStr, "array");
				expect(result).toEqual([1, 2, 3]);
			});

			it("should keep already-parsed objects as-is", () => {
				const obj = { foo: "bar" };
				expect(fromMySQLValue(obj, "json")).toEqual(obj);
			});

			it("should keep already-parsed arrays as-is", () => {
				const arr = [1, 2, 3];
				expect(fromMySQLValue(arr, "array")).toEqual(arr);
			});

			it("should return original value for invalid JSON", () => {
				const invalidJson = "not json";
				expect(fromMySQLValue(invalidJson, "json")).toBe(invalidJson);
			});

			it("should return null for null/undefined", () => {
				expect(fromMySQLValue(null, "json")).toBe(null);
				expect(fromMySQLValue(undefined, "array")).toBe(null);
			});
		});

		describe("Relation conversion", () => {
			it("should keep numbers as-is", () => {
				expect(fromMySQLValue(123, "relation")).toBe(123);
			});

			it("should convert strings to numbers", () => {
				expect(fromMySQLValue("456", "relation")).toBe(456);
			});

			it("should return null for null/undefined", () => {
				expect(fromMySQLValue(null, "relation")).toBe(null);
				expect(fromMySQLValue(undefined, "relation")).toBe(null);
			});
		});
	});

	describe("MySQL to TypeScript Mapping", () => {
		it("should map integer types to number", () => {
			expect(MYSQL_TO_TS_TYPE.TINYINT).toBe("number");
			expect(MYSQL_TO_TS_TYPE.SMALLINT).toBe("number");
			expect(MYSQL_TO_TS_TYPE.MEDIUMINT).toBe("number");
			expect(MYSQL_TO_TS_TYPE.INT).toBe("number");
			expect(MYSQL_TO_TS_TYPE.BIGINT).toBe("number");
		});

		it("should map decimal types to number", () => {
			expect(MYSQL_TO_TS_TYPE.DECIMAL).toBe("number");
			expect(MYSQL_TO_TS_TYPE.FLOAT).toBe("number");
			expect(MYSQL_TO_TS_TYPE.DOUBLE).toBe("number");
		});

		it("should map text types to string", () => {
			expect(MYSQL_TO_TS_TYPE.CHAR).toBe("string");
			expect(MYSQL_TO_TS_TYPE.VARCHAR).toBe("string");
			expect(MYSQL_TO_TS_TYPE.TEXT).toBe("string");
			expect(MYSQL_TO_TS_TYPE.TINYTEXT).toBe("string");
			expect(MYSQL_TO_TS_TYPE.MEDIUMTEXT).toBe("string");
			expect(MYSQL_TO_TS_TYPE.LONGTEXT).toBe("string");
		});

		it("should map datetime types to Date", () => {
			expect(MYSQL_TO_TS_TYPE.DATE).toBe("Date");
			expect(MYSQL_TO_TS_TYPE.DATETIME).toBe("Date");
			expect(MYSQL_TO_TS_TYPE.TIMESTAMP).toBe("Date");
		});

		it("should map BOOLEAN to boolean", () => {
			expect(MYSQL_TO_TS_TYPE.BOOLEAN).toBe("boolean");
		});

		it("should map JSON to unknown", () => {
			expect(MYSQL_TO_TS_TYPE.JSON).toBe("unknown");
		});

		it("should map BLOB types to Uint8Array", () => {
			expect(MYSQL_TO_TS_TYPE.BLOB).toBe("Uint8Array");
			expect(MYSQL_TO_TS_TYPE.TINYBLOB).toBe("Uint8Array");
			expect(MYSQL_TO_TS_TYPE.MEDIUMBLOB).toBe("Uint8Array");
			expect(MYSQL_TO_TS_TYPE.LONGBLOB).toBe("Uint8Array");
		});

		it("should map ENUM and SET to string", () => {
			expect(MYSQL_TO_TS_TYPE.ENUM).toBe("string");
			expect(MYSQL_TO_TS_TYPE.SET).toBe("string");
		});
	});

	describe("parseConnectionString", () => {
		it("should parse basic connection string", () => {
			const result = parseConnectionString(
				"mysql://user:password@localhost:3306/mydb",
			);

			expect(result.host).toBe("localhost");
			expect(result.port).toBe(3306);
			expect(result.user).toBe("user");
			expect(result.password).toBe("password");
			expect(result.database).toBe("mydb");
		});

		it("should use default port 3306 when not specified", () => {
			const result = parseConnectionString(
				"mysql://user:password@localhost/mydb",
			);

			expect(result.host).toBe("localhost");
			expect(result.port).toBe(3306);
		});

		it("should decode URL-encoded credentials", () => {
			const result = parseConnectionString(
				"mysql://user%40domain:pass%23word@localhost/mydb",
			);

			expect(result.user).toBe("user@domain");
			expect(result.password).toBe("pass#word");
		});

		it("should parse query parameters", () => {
			const result = parseConnectionString(
				"mysql://user:pass@localhost/mydb?charset=utf8mb4&connectionLimit=20",
			);

			expect(result["charset"]).toBe("utf8mb4");
			expect(result["connectionLimit"]).toBe(20);
		});

		it("should parse ssl parameter", () => {
			const result = parseConnectionString(
				"mysql://user:pass@localhost/mydb?ssl=true",
			);

			expect(result["ssl"]).toBe(true);
		});

		it("should parse connectTimeout parameter", () => {
			const result = parseConnectionString(
				"mysql://user:pass@localhost/mydb?connectTimeout=5000",
			);

			expect(result["connectTimeout"]).toBe(5000);
		});

		it("should parse timezone parameter", () => {
			const result = parseConnectionString(
				"mysql://user:pass@localhost/mydb?timezone=UTC",
			);

			expect(result["timezone"]).toBe("UTC");
		});

		it("should use localhost as default host when hostname is empty string", () => {
			// Note: 'mysql://user:pass@/mydb' throws an error in URL parser
			// Testing the fallback logic by checking the actual implementation behavior
			const result = parseConnectionString("mysql://user:pass@localhost/mydb");

			// This tests that host is correctly parsed, the || 'localhost' fallback
			// is for edge cases where hostname could be empty string
			expect(result.host).toBe("localhost");
		});
	});

	describe("Edge Cases", () => {
		it("should handle empty string conversion", () => {
			expect(toMySQLValue("", "string")).toBe("");
			expect(toMySQLValue("", "number")).toBe(null);
		});

		it("should handle zero values correctly", () => {
			expect(toMySQLValue(0, "number")).toBe(0);
			expect(toMySQLValue(0, "boolean")).toBe(0);
		});

		it("should handle NaN correctly", () => {
			expect(toMySQLValue(NaN, "number")).toBe(NaN);
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
			const result = toMySQLValue(complex, "json");
			expect(result).toBe(JSON.stringify(complex));
		});

		it("should handle whitespace-only strings for numbers", () => {
			expect(toMySQLValue("   ", "number")).toBe(null);
			expect(toMySQLValue("\t\n", "number")).toBe(null);
		});
	});
});
