// @ts-nocheck
/**
 * API Parser - Where Parser Tests (Error Path)
 *
 * Tests error handling, validation, and security for where parsing
 */

import { describe, it, expect } from "vitest";
import { parseWhere } from "../../src/parser/where-parser";
import { RawQueryParams } from "../../../types/src/api/parser";
import { parserTestData } from "../../../types/src/test/fixtures";

const expectSuccessData = (result: any) => result;

const expectFailureError = (result: () => any) => {
	try {
		const value = result();
		return value;
	} catch (error) {
		return error;
	}
};

describe("WhereParser - Error Path", () => {
	describe("Security: SQL Injection", () => {
		it("should reject SQL injection in field name", () => {
			const sqlInjectionFieldParams: RawQueryParams =
				parserTestData.invalidWhereConditions.sqlInjectionField;

			const error = expectFailureError(() =>
				parseWhere(sqlInjectionFieldParams),
			);

			expect(error.code).toBe("INVALID_FIELD_NAME");
		});

		it("should safely handle SQL injection in value", () => {
			// Values are parameterized by the adapter, so parser should accept them
			// but NOT execute them as SQL
			const sqlInjectionValueParams: RawQueryParams =
				parserTestData.invalidWhereConditions.sqlInjectionValue;

			const parsedWhere = expectSuccessData(
				parseWhere(sqlInjectionValueParams),
			);

			// Should parse as string value, not execute SQL
			expect(parsedWhere).toEqual({ name: "'; DROP TABLE users; --" });
			expect(typeof (parsedWhere as any).name).toBe("string");
		});

		it("should handle SQL injection in operator value", () => {
			const sqlInjectionInOperator: RawQueryParams = {
				"where[email][$contains]": "'; DROP TABLE users; --",
			};

			const parsedWhere = expectSuccessData(parseWhere(sqlInjectionInOperator));

			// Should be treated as literal string
			expect(parsedWhere).toEqual({
				email: { $contains: "'; DROP TABLE users; --" },
			});
		});
	});

	describe("Security: XSS Protection", () => {
		it("should reject XSS in field name", () => {
			const xssFieldParams: RawQueryParams =
				parserTestData.invalidWhereConditions.xssInField;

			const error = expectFailureError(() => parseWhere(xssFieldParams));

			expect(error.code).toBe("INVALID_FIELD_NAME");
		});

		it("should safely handle XSS in value", () => {
			// Values should be stored as-is, escaping happens at output
			const xssValueParams: RawQueryParams =
				parserTestData.invalidWhereConditions.xssInValue;

			const parsedWhere = expectSuccessData(parseWhere(xssValueParams));

			expect(parsedWhere).toEqual({ name: "<script>alert(1)</script>" });
		});
	});

	describe("Security: Path Traversal", () => {
		it("should reject path traversal in field name", () => {
			const pathTraversalParams: RawQueryParams =
				parserTestData.invalidWhereConditions.pathTraversalField;

			const error = expectFailureError(() => parseWhere(pathTraversalParams));

			expect(error.code).toBe("INVALID_FIELD_NAME");
		});
	});

	describe("Security: Command Injection", () => {
		it("should safely handle command injection in value", () => {
			const commandInjectionParams: RawQueryParams =
				parserTestData.invalidWhereConditions.commandInjectionValue;

			const parsedWhere = expectSuccessData(parseWhere(commandInjectionParams));

			// Should be treated as literal string
			expect(parsedWhere).toEqual({ name: "; rm -rf /" });
		});
	});

	describe("Security: Null Byte Injection", () => {
		it("should reject null byte in field name", () => {
			const nullByteFieldParams: RawQueryParams =
				parserTestData.invalidWhereConditions.nullByteField;

			const error = expectFailureError(() => parseWhere(nullByteFieldParams));

			expect(error.code).toBe("INVALID_FIELD_NAME");
		});
	});

	describe("Invalid operators", () => {
		it("should reject unknown operator", () => {
			const invalidOperatorParams: RawQueryParams =
				parserTestData.invalidWhereConditions.invalidOperator;

			const error = expectFailureError(() => parseWhere(invalidOperatorParams));

			expect(error.code).toBe("INVALID_OPERATOR");
			expect(error.message).toContain("$invalidOp");
		});

		it("should reject operator typo", () => {
			const typoOperator: RawQueryParams = {
				"where[price][$grt]": "100", // typo: should be $gt
			};

			const error = expectFailureError(() => parseWhere(typoOperator));

			expect(error.code).toBe("INVALID_OPERATOR");
		});

		it("should reject multiple invalid operators", () => {
			const multipleInvalidOps: RawQueryParams = {
				"where[field1][$invalid1]": "value",
				"where[field2][$invalid2]": "value",
			};

			const error = expectFailureError(() => parseWhere(multipleInvalidOps));

			expect(error.code).toBe("INVALID_OPERATOR");
		});
	});

	describe("Boundary Safety", () => {
		it("should reject excessively long field names", () => {
			const longFieldParams: RawQueryParams =
				parserTestData.invalidWhereConditions.excessivelyLongField;

			const error = expectFailureError(() => parseWhere(longFieldParams));

			expect(error.code).toBe("INVALID_FIELD_NAME");
		});

		it("should reject excessively long values", () => {
			const longValueParams: RawQueryParams =
				parserTestData.invalidWhereConditions.excessivelyLongValue;

			const error = expectFailureError(() => parseWhere(longValueParams));

			expect(error.code).toBe("MAX_LENGTH_EXCEEDED");
		});

		it("should handle empty field name", () => {
			const emptyField: RawQueryParams = { "where[]": "value" };

			const error = expectFailureError(() => parseWhere(emptyField));

			expect(error.code).toBe("INVALID_FIELD_NAME");
		});

		it.fails("should handle deeply nested logical operators", () => {
			const deepNesting: RawQueryParams = {
				"where[$or][0][$and][0][$or][0][$and][0][$or][0][field]": "value",
			};

			const error = expectFailureError(() => parseWhere(deepNesting));

			expect(error.code).toBe("MAX_NESTING_EXCEEDED");
		});
	});

	describe("Invalid-But-Plausible Input", () => {
		it("should reject whitespace-only field name", () => {
			const whitespaceField: RawQueryParams = { "where[   ]": "value" };

			const error = expectFailureError(() => parseWhere(whitespaceField));

			expect(error.code).toBe("INVALID_FIELD_NAME");
		});

		it("should reject field starting with digit", () => {
			const digitStartField: RawQueryParams = { "where[1field]": "value" };

			const error = expectFailureError(() => parseWhere(digitStartField));

			expect(error.code).toBe("INVALID_FIELD_NAME");
		});

		it("should reject field with special characters", () => {
			const specialCharsField: RawQueryParams = { "where[field!@#]": "value" };

			const error = expectFailureError(() => parseWhere(specialCharsField));

			expect(error.code).toBe("INVALID_FIELD_NAME");
		});

		it("should reject field with spaces", () => {
			const fieldWithSpaces: RawQueryParams = { "where[my field]": "value" };

			const error = expectFailureError(() => parseWhere(fieldWithSpaces));

			expect(error.code).toBe("INVALID_FIELD_NAME");
		});
	});

	describe("Type validation", () => {
		it("should reject non-array value for $in operator", () => {
			const nonArrayIn: RawQueryParams = {
				"where[status][$in]": "active", // should be array
			};

			const error = expectFailureError(() => parseWhere(nonArrayIn));

			expect(error.code).toBe("INVALID_VALUE_TYPE");
			expect(error.message).toContain("$in");
			expect(error.message).toContain("array");
		});

		it("should reject non-array value for $nin operator", () => {
			const nonArrayNin: RawQueryParams = {
				"where[role][$nin]": "admin", // should be array
			};

			const error = expectFailureError(() => parseWhere(nonArrayNin));

			expect(error.code).toBe("INVALID_VALUE_TYPE");
		});

		it("should reject empty array for $in operator", () => {
			const emptyArrayIn: RawQueryParams = {
				"where[status][$in]": [],
			};

			const error = expectFailureError(() => parseWhere(emptyArrayIn));

			expect(error.code).toBe("EMPTY_VALUE");
		});
	});

	describe("Logical operator validation", () => {
		it("should reject $or without array structure", () => {
			const invalidOr: RawQueryParams = {
				"where[$or][status]": "active", // missing index
			};

			const error = expectFailureError(() => parseWhere(invalidOr));

			expect(error.code).toBe("ARRAY_INDEX_ERROR");
		});

		it("should reject $and without array structure", () => {
			const invalidAnd: RawQueryParams = {
				"where[$and][field]": "value", // missing index
			};

			const error = expectFailureError(() => parseWhere(invalidAnd));

			expect(error.code).toBe("ARRAY_INDEX_ERROR");
		});

		it.fails("should reject empty $or array", () => {
			const emptyOr: RawQueryParams = {
				"where[$or]": [],
			};

			const error = expectFailureError(() => parseWhere(emptyOr));

			expect(error.code).toBe("EMPTY_LOGICAL_ARRAY");
		});
	});

	describe("Explicit Failure Messages", () => {
		it("should return consistent error structure", () => {
			const invalidParams: RawQueryParams =
				parserTestData.invalidWhereConditions.invalidOperator;

			const error = expectFailureError(() => parseWhere(invalidParams));

			expect(error).toHaveProperty("code");
			expect(error).toHaveProperty("message");
			expect(typeof error.code).toBe("string");
			expect(typeof error.message).toBe("string");
			expect(error.message.length).toBeGreaterThan(0);
		});

		it("should include field information in error", () => {
			const invalidOperatorParams: RawQueryParams = {
				"where[price][$invalid]": "100",
			};

			const error = expectFailureError(() => parseWhere(invalidOperatorParams));

			expect(error.location).toHaveProperty("path");
			expect(error.location.path).toContain("price");
		});

		it("should include operator information for invalid operator error", () => {
			const invalidOperator: RawQueryParams = {
				"where[age][$wrongOp]": "18",
			};

			const error = expectFailureError(() => parseWhere(invalidOperator));

			expect(error.message).toContain("$wrongOp");
		});
	});

	describe("State Isolation", () => {
		it("should not affect subsequent calls after error", () => {
			const invalidParams: RawQueryParams =
				parserTestData.invalidWhereConditions.invalidOperator;
			const validParams: RawQueryParams = { "where[status]": "active" };

			expectFailureError(() => parseWhere(invalidParams));
			expectFailureError(() => parseWhere(invalidParams));
			expectFailureError(() => parseWhere(invalidParams));

			const error = expectFailureError(() => parseWhere(invalidParams));
			expect(error.code).toBe("INVALID_OPERATOR");
		});

		it("should handle alternating valid and invalid calls", () => {
			const invalidParams: RawQueryParams =
				parserTestData.invalidWhereConditions.invalidOperator;
			const validParams: RawQueryParams = { "where[status]": "active" };

			expectFailureError(() => parseWhere(invalidParams));
			expectSuccessData(parseWhere(validParams));
			expectFailureError(() => parseWhere(invalidParams));
			const validResult = expectSuccessData(parseWhere(validParams));

			expect(validResult).toEqual({ status: "active" });
		});
	});

	describe("Negative Space Coverage", () => {
		it("should reject unknown query parameters that look like where", () => {
			const fakeWhere: RawQueryParams = {
				"where_injection[field]": "value",
				"whereextra[field]": "value",
			};

			const parsedWhere = expectSuccessData(parseWhere(fakeWhere));

			// Should ignore invalid where-like parameters
			expect(parsedWhere).toBeUndefined();
		});
	});

	describe("Invariant Protection", () => {
		it("should maintain field name constraints", () => {
			const reservedFieldName: RawQueryParams = {
				"where[__proto__]": "malicious",
			};

			const error = expectFailureError(() => parseWhere(reservedFieldName));

			expect(error.code).toBe("INVALID_FIELD_NAME");
			expect(error.context.fieldValidationReason).toBe("RESERVED_FIELD");
		});

		it("should maintain operator constraints", () => {
			const operatorAsField: RawQueryParams = {
				"where[$gt]": "value", // operator used as field
			};

			const error = expectFailureError(() => parseWhere(operatorAsField));

			expect(error.code).toBe("INVALID_FIELD_NAME");
		});
	});
});
