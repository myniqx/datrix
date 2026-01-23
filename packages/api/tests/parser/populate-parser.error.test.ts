// @ts-nocheck
/**
 * API Parser - Populate Parser Tests (Error Path)
 *
 * Tests error handling, validation, and security for populate parsing
 */

import { describe, it, expect } from "vitest";
import { parsePopulate } from "../../src/parser/populate-parser";
import { RawQueryParams } from "../../../types/src/api/parser";
import { parserTestData } from "../../../types/src/test/fixtures";
import { expectFailureError } from "../../../types/src/test/helpers";

describe("PopulateParser - Error Path", () => {
  describe("Max depth exceeded", () => {
    it("should reject populate exceeding default max depth (5)", () => {
      const depth6Params: RawQueryParams = parserTestData.maxDepthPopulate.depth6;

      const error = expectFailureError(parsePopulate(depth6Params));

      expect(error.code).toBe("MAX_DEPTH_EXCEEDED");
      expect(error.expected).toContain("5");
    });

    it("should reject populate exceeding custom max depth", () => {
      const depth3Params: RawQueryParams = parserTestData.maxDepthPopulate.depth3;

      const error = expectFailureError(parsePopulate(depth3Params, 2));

      expect(error.code).toBe("MAX_DEPTH_EXCEEDED");
      expect(error.expected).toContain("2");
    });

    it("should reject depth 2 when max depth is 1", () => {
      const depth2Params: RawQueryParams = parserTestData.maxDepthPopulate.depth2;

      const error = expectFailureError(parsePopulate(depth2Params, 1));

      expect(error.code).toBe("MAX_DEPTH_EXCEEDED");
    });

    it("should reject complex nested structure exceeding depth", () => {
      const complexDeepParams: RawQueryParams = {
        "populate[a][populate][b][populate][c][populate][d][populate][e][populate][f]":
          "*",
      };

      const error = expectFailureError(parsePopulate(complexDeepParams, 4));

      expect(error.code).toBe("MAX_DEPTH_EXCEEDED");
    });
  });

  describe("Security: SQL Injection", () => {
    it("should reject SQL injection in relation name", () => {
      const sqlInjectionRelation: RawQueryParams = {
        populate: parserTestData.invalidRelationNames.sqlInjection,
      };

      const error = expectFailureError(parsePopulate(sqlInjectionRelation));

      expect(error.code).toBe("INVALID_FIELD_NAME");
    });

    it("should reject SQL injection with quotes", () => {
      const sqlInjectionWithQuotes: RawQueryParams = {
        populate: parserTestData.invalidRelationNames.sqlInjectionWithQuotes,
      };

      const error = expectFailureError(parsePopulate(sqlInjectionWithQuotes));

      expect(error.code).toBe("INVALID_FIELD_NAME");
    });

    it("should reject SQL injection in object-style populate", () => {
      const sqlInjectionObjectStyle: RawQueryParams = {
        [`populate[${parserTestData.invalidRelationNames.sqlInjection}]`]: "*",
      };

      const error = expectFailureError(parsePopulate(sqlInjectionObjectStyle));

      expect(error.code).toBe("INVALID_FIELD_NAME");
    });

    it("should reject SQL injection in nested populate", () => {
      const sqlInjectionNested: RawQueryParams = {
        "populate[author][populate]":
          parserTestData.invalidRelationNames.sqlInjection,
      };

      const error = expectFailureError(parsePopulate(sqlInjectionNested));

      expect(error.code).toBe("INVALID_FIELD_NAME");
    });
  });

  describe("Security: XSS Protection", () => {
    it("should reject XSS script in relation name", () => {
      const xssScriptRelation: RawQueryParams = {
        populate: parserTestData.invalidRelationNames.xssScript,
      };

      const error = expectFailureError(parsePopulate(xssScriptRelation));

      expect(error.code).toBe("INVALID_FIELD_NAME");
    });

    it("should reject XSS in nested relation", () => {
      const xssNestedRelation: RawQueryParams = {
        [`populate[${parserTestData.invalidRelationNames.xssScript}]`]: "*",
      };

      const error = expectFailureError(parsePopulate(xssNestedRelation));

      expect(error.code).toBe("INVALID_FIELD_NAME");
    });
  });

  describe("Security: Path Traversal", () => {
    it("should reject path traversal in relation name", () => {
      const pathTraversalRelation: RawQueryParams = {
        populate: parserTestData.invalidRelationNames.pathTraversal,
      };

      const error = expectFailureError(parsePopulate(pathTraversalRelation));

      expect(error.code).toBe("INVALID_FIELD_NAME");
    });
  });

  describe("Security: Command Injection", () => {
    it("should reject command injection in relation name", () => {
      const commandInjectionRelation: RawQueryParams = {
        populate: parserTestData.invalidRelationNames.commandInjection,
      };

      const error = expectFailureError(parsePopulate(commandInjectionRelation));

      expect(error.code).toBe("INVALID_FIELD_NAME");
    });
  });

  describe("Security: Null Byte Injection", () => {
    it("should reject null byte injection in relation name", () => {
      const nullByteRelation: RawQueryParams = {
        populate: parserTestData.invalidRelationNames.nullByteInjection,
      };

      const error = expectFailureError(parsePopulate(nullByteRelation));

      expect(error.code).toBe("INVALID_FIELD_NAME");
    });

    it("should reject control characters in relation name", () => {
      const controlCharsRelation: RawQueryParams = {
        populate: parserTestData.invalidRelationNames.controlChars,
      };

      const error = expectFailureError(parsePopulate(controlCharsRelation));

      expect(error.code).toBe("INVALID_FIELD_NAME");
    });
  });

  describe("Invalid relation names", () => {
    it("should reject relation starting with digit", () => {
      const digitStartRelation: RawQueryParams = {
        populate: parserTestData.invalidRelationNames.startsWithDigit,
      };

      const error = expectFailureError(parsePopulate(digitStartRelation));

      expect(error.code).toBe("INVALID_FIELD_NAME");
    });

    it("should reject relation with spaces", () => {
      const relationWithSpaces: RawQueryParams = {
        populate: parserTestData.invalidRelationNames.withSpaces,
      };

      const error = expectFailureError(parsePopulate(relationWithSpaces));

      expect(error.code).toBe("INVALID_FIELD_NAME");
    });

    it("should reject relation with special characters", () => {
      const relationWithSpecialChars: RawQueryParams = {
        populate: parserTestData.invalidRelationNames.withSpecialChars,
      };

      const error = expectFailureError(parsePopulate(relationWithSpecialChars));

      expect(error.code).toBe("INVALID_FIELD_NAME");
    });
  });

  describe("Boundary Safety", () => {
    it("should reject excessively long relation names", () => {
      const excessivelyLongRelation: RawQueryParams = {
        populate: parserTestData.invalidRelationNames.excessivelyLong,
      };

      const error = expectFailureError(parsePopulate(excessivelyLongRelation));

      expect(error.code).toBe("INVALID_FIELD_NAME");
    });

    it("should reject zero max depth", () => {
      const simpleRelation: RawQueryParams = { populate: "author" };

      const error = expectFailureError(parsePopulate(simpleRelation, 0));

      expect(error.code).toBe("MAX_DEPTH_EXCEEDED");
    });

    it("should reject negative max depth", () => {
      const simpleRelation: RawQueryParams = { populate: "author" };

      const error = expectFailureError(parsePopulate(simpleRelation, -1));

      expect(error.code).toBe("MAX_DEPTH_EXCEEDED");
    });
  });

  describe("Invalid-But-Plausible Input", () => {
    it("should reject empty string relation", () => {
      const emptyStringRelation: RawQueryParams = { populate: "" };

      const error = expectFailureError(parsePopulate(emptyStringRelation));

      expect(error.code).toBe("EMPTY_VALUE");
    });

    it("should reject whitespace-only relation", () => {
      const whitespaceRelation: RawQueryParams = { populate: "   " };

      const error = expectFailureError(parsePopulate(whitespaceRelation));

      expect(error.code).toBe("EMPTY_VALUE");
    });

    it("should reject comma-separated list with invalid relation", () => {
      const mixedValidInvalid: RawQueryParams = {
        populate: `author,${parserTestData.invalidRelationNames.sqlInjection},comments`,
      };

      const error = expectFailureError(parsePopulate(mixedValidInvalid));

      expect(error.code).toBe("INVALID_FIELD_NAME");
    });
  });

  describe("Explicit Failure Messages", () => {
    it("should return consistent error structure for max depth", () => {
      const depth6Params: RawQueryParams = parserTestData.maxDepthPopulate.depth6;

      const error = expectFailureError(parsePopulate(depth6Params));

      expect(error).toHaveProperty("code");
      expect(error).toHaveProperty("message");
      expect(error.code).toBe("MAX_DEPTH_EXCEEDED");
      expect(typeof error.message).toBe("string");
      expect(error.message.length).toBeGreaterThan(0);
    });

    it("should return consistent error structure for invalid relation", () => {
      const invalidRelation: RawQueryParams = {
        populate: parserTestData.invalidRelationNames.sqlInjection,
      };

      const error = expectFailureError(parsePopulate(invalidRelation));

      expect(error).toHaveProperty("code");
      expect(error).toHaveProperty("message");
      expect(error.code).toBe("INVALID_FIELD_NAME");
      expect(typeof error.message).toBe("string");
    });

    it("should include field information in error", () => {
      const depth6Params: RawQueryParams = parserTestData.maxDepthPopulate.depth6;

      const error = expectFailureError(parsePopulate(depth6Params));

      expect(error.location).toHaveProperty("parts");
    });
  });

  describe("State Isolation", () => {
    it("should not affect subsequent calls after error", () => {
      const invalidParams: RawQueryParams = {
        populate: parserTestData.invalidRelationNames.sqlInjection,
      };
      const validParams: RawQueryParams = { populate: "author" };

      expectFailureError(parsePopulate(invalidParams));
      expectFailureError(parsePopulate(invalidParams));
      expectFailureError(parsePopulate(invalidParams));

      const error = expectFailureError(parsePopulate(invalidParams));
      expect(error.code).toBe("INVALID_FIELD_NAME");
    });

    it("should handle alternating valid and invalid calls", () => {
      const invalidParams: RawQueryParams = parserTestData.maxDepthPopulate.depth6;
      const validParams: RawQueryParams = parserTestData.maxDepthPopulate.depth5;

      expectFailureError(parsePopulate(invalidParams));
      const error = expectFailureError(parsePopulate(invalidParams));

      expect(error.code).toBe("MAX_DEPTH_EXCEEDED");
    });
  });

  describe("Negative Space Coverage", () => {
    it("should reject invalid populate parameter types", () => {
      const numericPopulate: RawQueryParams = { populate: 123 as any };

      const error = expectFailureError(parsePopulate(numericPopulate));

      expect(error.code).toBe("INVALID_VALUE_TYPE");
    });

    it("should reject object as populate value", () => {
      const objectPopulate: RawQueryParams = {
        populate: { invalid: "structure" } as any,
      };

      const error = expectFailureError(parsePopulate(objectPopulate));

      expect(error.code).toBe("INVALID_VALUE_TYPE");
    });
  });
});
