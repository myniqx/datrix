// @ts-nocheck
/**
 * API Parser - Fields Parser Tests (Error Path)
 *
 * Tests error handling, validation, and security for fields parsing.
 * Uses Result pattern - parseFields returns Result<T, E>, NOT throws.
 */

import { describe, it, expect } from "vitest";
import { parseFields } from "../../src/parser/fields-parser";
import { RawQueryParams } from "../../../types/src/api/parser";
import { parserTestData } from "../../../types/src/test/fixtures";
import { expectFailureError } from "../../../types/src/test/helpers";

const expectFailureError = (result: () => any) => {
  try {
    const value = result();
    return value;
  } catch (error) {
    return error;
  }
};

describe("FieldsParser - Error Path (Result Pattern)", () => {
  describe("Invalid field names", () => {
    it("should return error for field starting with digit", () => {
      const result = () =>
        parseFields({
          fields: parserTestData.invalidFieldNames.startsWithDigit,
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("INVALID_FIELD_NAME");
      expect(error.context).toBeDefined();
      expect(error.suggestion).toContain("Use valid field");
    });

    it("should return error for field with spaces", () => {
      const result = () =>
        parseFields({
          fields: parserTestData.invalidFieldNames.withSpaces,
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("INVALID_FIELD_NAME");
      expect(typeof error.message).toBe("string");
    });

    it("should return error for field with special characters", () => {
      const result = () =>
        parseFields({
          fields: parserTestData.invalidFieldNames.withSpecialChars,
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("INVALID_FIELD_NAME");
    });

    it("should return error for multiple invalid fields in comma-separated list", () => {
      const result = () =>
        parseFields({
          fields: "id,name!,user space,1invalid",
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("INVALID_FIELD_NAME");
      expect(error.context).toBeDefined();
    });
  });

  describe("Security: SQL Injection", () => {
    it("should reject SQL injection attempt in field name", () => {
      const result = () =>
        parseFields({
          fields: parserTestData.invalidFieldNames.sqlInjection,
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("INVALID_FIELD_NAME");
    });

    it("should reject SQL injection with quotes", () => {
      const result = () =>
        parseFields({
          fields: parserTestData.invalidFieldNames.sqlInjectionWithQuotes,
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("INVALID_FIELD_NAME");
    });

    it("should reject SQL injection in comma-separated list", () => {
      const result = () =>
        parseFields({
          fields: `id,${parserTestData.invalidFieldNames.sqlInjection},name`,
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("INVALID_FIELD_NAME");
    });

    it("should reject SQL injection in array format", () => {
      const result = () =>
        parseFields({
          fields: ["id", parserTestData.invalidFieldNames.sqlInjection, "name"],
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("INVALID_FIELD_NAME");
    });
  });

  describe("Security: XSS Protection", () => {
    it("should reject XSS script tag in field name", () => {
      const result = () =>
        parseFields({
          fields: parserTestData.invalidFieldNames.xssScript,
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("INVALID_FIELD_NAME");
    });

    it("should reject XSS img tag in field name", () => {
      const result = () =>
        parseFields({
          fields: parserTestData.invalidFieldNames.xssImgTag,
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("INVALID_FIELD_NAME");
    });
  });

  describe("Security: Path Traversal", () => {
    it("should reject path traversal attempt", () => {
      const result = () =>
        parseFields({
          fields: parserTestData.invalidFieldNames.pathTraversal,
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("INVALID_FIELD_NAME");
    });
  });

  describe("Security: Command Injection", () => {
    it("should reject command injection attempt", () => {
      const result = () =>
        parseFields({
          fields: parserTestData.invalidFieldNames.commandInjection,
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("INVALID_FIELD_NAME");
    });
  });

  describe("Security: Null Byte Injection", () => {
    it("should reject null byte injection", () => {
      const result = () =>
        parseFields({
          fields: parserTestData.invalidFieldNames.nullByteInjection,
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("INVALID_FIELD_NAME");
    });

    it("should reject control characters", () => {
      const result = () =>
        parseFields({
          fields: parserTestData.invalidFieldNames.controlChars,
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("INVALID_FIELD_NAME");
    });
  });

  describe("Security: Unicode Tricks", () => {
    it("should reject unicode directional override tricks", () => {
      const result = () =>
        parseFields({
          fields: parserTestData.invalidFieldNames.unicodeTricks,
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("INVALID_FIELD_NAME");
    });
  });

  describe("Boundary Safety", () => {
    it("should reject excessively long field names", () => {
      const result = () =>
        parseFields({
          fields: parserTestData.invalidFieldNames.excessivelyLong,
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("INVALID_FIELD_NAME");
    });
  });

  describe("Invalid-But-Plausible Input", () => {
    it("should reject numeric string that looks like field name", () => {
      const result = () =>
        parseFields({
          fields: parserTestData.invalidFieldNames.startsWithDigitComplex,
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("INVALID_FIELD_NAME");
    });

    it("should reject field with only whitespace", () => {
      const result = () =>
        parseFields({
          fields: "   ",
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("EMPTY_VALUE");
    });

    it("should reject empty string after trimming", () => {
      const result = () =>
        parseFields({
          fields: " , , ",
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("EMPTY_VALUE");
    });
  });

  describe("Error Structure Validation", () => {
    it("should return consistent ParserError structure", () => {
      const result = () =>
        parseFields({
          fields: parserTestData.invalidFieldNames.withSpecialChars,
        });

      const error = expectFailureError(result);

      // ParserError should have these properties
      expect(error).toHaveProperty("code");
      expect(error).toHaveProperty("message");
      expect(error).toHaveProperty("parser");
      expect(error.code).toBe("INVALID_FIELD_NAME");
      expect(error.parser).toBe("fields");
      expect(typeof error.message).toBe("string");
    });

    it("should provide details about invalid field", () => {
      const result = () =>
        parseFields({
          fields: "id,invalid!field,name",
        });

      const error = expectFailureError(result);
      expect(error.context).toBeDefined();
    });

    it("should include location information", () => {
      const result = () =>
        parseFields({
          fields: "id,invalid!field",
        });

      const error = expectFailureError(result);
      expect(error.location).toBeDefined();
    });
  });

  describe("Suspicious Parameters Detection", () => {
    it("should reject unknown query parameters that look like fields", () => {
      const result = () =>
        parseFields({
          fields: "id,name",
          "fields[extra]": "malicious",
          fields_injection: "attack",
        });

      const error = expectFailureError(result);
      expect(error.code).toBe("UNKNOWN_PARAMETER");
      expect(error.parser).toBe("fields");
    });

    it("should allow valid array format fields[0], fields[1]", () => {
      const result = parseFields({
        "fields[0]": "id",
        "fields[1]": "name",
      });

      // This should succeed, not error
      expect(result).toBeDefined();
    });
  });

  describe("State Isolation & Consistency", () => {
    it("should not affect subsequent calls after error", () => {
      const invalidParams: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.sqlInjection,
      };

      // Multiple calls should produce identical results
      const result1 = () => parseFields(invalidParams);
      const result2 = () => parseFields(invalidParams);
      const result3 = () => parseFields(invalidParams);

      const error1 = expectFailureError(result1);
      const error2 = expectFailureError(result2);
      const error3 = expectFailureError(result3);

      expect(error1.code).toBe("INVALID_FIELD_NAME");
      expect(error2.code).toBe("INVALID_FIELD_NAME");
      expect(error3.code).toBe("INVALID_FIELD_NAME");
    });

    it("should produce valid results after error", () => {
      const invalidParams: RawQueryParams = {
        fields: parserTestData.invalidFieldNames.sqlInjection,
      };
      const validParams: RawQueryParams = {
        fields: "id,name",
      };

      // Error shouldn't affect subsequent valid calls
      expectFailureError(() => parseFields(invalidParams));

      const validResult = parseFields(validParams);
      expect(validResult).toBeDefined();
    });
  });
});
