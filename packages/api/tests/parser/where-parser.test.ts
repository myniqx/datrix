/**
 * API Parser - Where Parser Tests (Happy Path)
 *
 * Tests successful parsing of where query parameters
 */

import { describe, it, expect } from "vitest";
import { parseWhere } from "../../src/parser/where-parser";
import { RawQueryParams } from "../../../types/src/api/parser";
import { parserTestData } from "../../../types/src/test/fixtures";
import { expectSuccessData } from "../../../types/src/test/helpers";

describe("WhereParser - Happy Path", () => {
  describe("No where parameter", () => {
    it("should return undefined when no where parameters are present", () => {
      const emptyParams: RawQueryParams = { other: "value" };

      const parsedWhere = expectSuccessData(parseWhere(emptyParams));

      expect(parsedWhere).toBeUndefined();
    });

    it("should return undefined for completely empty params", () => {
      const emptyParams: RawQueryParams = {};

      const parsedWhere = expectSuccessData(parseWhere(emptyParams));

      expect(parsedWhere).toBeUndefined();
    });
  });

  describe("Simple equality", () => {
    it("should parse single field equality", () => {
      const singleFieldParams: RawQueryParams =
        parserTestData.simpleWhereConditions.singleField;

      const parsedWhere = expectSuccessData(parseWhere(singleFieldParams));

      expect(parsedWhere).toEqual({ status: "active" });
    });

    it("should parse multiple field equality", () => {
      const multipleFieldsParams: RawQueryParams =
        parserTestData.simpleWhereConditions.multipleFields;

      const parsedWhere = expectSuccessData(parseWhere(multipleFieldsParams));

      expect(parsedWhere).toEqual({
        status: "active",
        type: "post",
      });
    });

    it("should parse various field names", () => {
      const variousFields: RawQueryParams = {
        "where[id]": "1",
        "where[name]": "John",
        "where[email]": "john@example.com",
        "where[createdAt]": "2024-01-01",
      };

      const parsedWhere = expectSuccessData(parseWhere(variousFields));

      expect(parsedWhere).toEqual({
        id: "1",
        name: "John",
        email: "john@example.com",
        createdAt: "2024-01-01",
      });
    });
  });

  describe("Type coercion", () => {
    it("should coerce string numbers to actual numbers", () => {
      const numberFieldParams: RawQueryParams =
        parserTestData.simpleWhereConditions.numberField;

      const parsedWhere = expectSuccessData(parseWhere(numberFieldParams));

      expect(parsedWhere).toEqual({ id: 123 });
      expect(typeof (parsedWhere as any).id).toBe("number");
    });

    it('should coerce string "true" to boolean true', () => {
      const booleanFieldParams: RawQueryParams =
        parserTestData.simpleWhereConditions.booleanField;

      const parsedWhere = expectSuccessData(parseWhere(booleanFieldParams));

      expect(parsedWhere).toEqual({ active: true });
      expect(typeof (parsedWhere as any).active).toBe("boolean");
    });

    it('should coerce string "false" to boolean false', () => {
      const falseFieldParams: RawQueryParams = { "where[disabled]": "false" };

      const parsedWhere = expectSuccessData(parseWhere(falseFieldParams));

      expect(parsedWhere).toEqual({ disabled: false });
      expect(typeof (parsedWhere as any).disabled).toBe("boolean");
    });

    it('should coerce string "null" to null', () => {
      const nullFieldParams: RawQueryParams =
        parserTestData.simpleWhereConditions.nullField;

      const parsedWhere = expectSuccessData(parseWhere(nullFieldParams));

      expect(parsedWhere).toEqual({ deletedAt: null });
      expect((parsedWhere as any).deletedAt).toBeNull();
    });

    it("should coerce all types together", () => {
      const mixedTypes: RawQueryParams = {
        "where[id]": "42",
        "where[active]": "true",
        "where[verified]": "false",
        "where[deletedAt]": "null",
        "where[name]": "John Doe",
      };

      const parsedWhere = expectSuccessData(parseWhere(mixedTypes));

      expect(parsedWhere).toEqual({
        id: "42",
        active: true,
        verified: false,
        deletedAt: null,
        name: "John Doe",
      });
    });
  });

  describe("Comparison operators", () => {
    it("should parse $gt operator", () => {
      const gtParams: RawQueryParams =
        parserTestData.comparisonOperators.greaterThan;

      const parsedWhere = expectSuccessData(parseWhere(gtParams));

      expect(parsedWhere).toEqual({ price: { $gt: 100 } });
    });

    it("should parse $lt operator", () => {
      const ltParams: RawQueryParams = parserTestData.comparisonOperators.lessThan;

      const parsedWhere = expectSuccessData(parseWhere(ltParams));

      expect(parsedWhere).toEqual({ age: { $lt: 18 } });
    });

    it("should parse $gte operator", () => {
      const gteParams: RawQueryParams =
        parserTestData.comparisonOperators.greaterThanOrEqual;

      const parsedWhere = expectSuccessData(parseWhere(gteParams));

      expect(parsedWhere).toEqual({ score: { $gte: 90 } });
    });

    it("should parse $lte operator", () => {
      const lteParams: RawQueryParams =
        parserTestData.comparisonOperators.lessThanOrEqual;

      const parsedWhere = expectSuccessData(parseWhere(lteParams));

      expect(parsedWhere).toEqual({ views: { $lte: 1000 } });
    });

    it("should parse $ne operator", () => {
      const neParams: RawQueryParams = parserTestData.comparisonOperators.notEqual;

      const parsedWhere = expectSuccessData(parseWhere(neParams));

      expect(parsedWhere).toEqual({ status: { $ne: "archived" } });
    });

    it("should combine multiple operators on same field", () => {
      const combinedParams: RawQueryParams =
        parserTestData.comparisonOperators.combined;

      const parsedWhere = expectSuccessData(parseWhere(combinedParams));

      expect(parsedWhere).toEqual({
        price: {
          $gte: 100,
          $lte: 500,
        },
      });
    });
  });

  describe("String operators", () => {
    it("should parse $contains operator", () => {
      const containsParams: RawQueryParams =
        parserTestData.stringOperators.contains;

      const parsedWhere = expectSuccessData(parseWhere(containsParams));

      expect(parsedWhere).toEqual({ name: { $contains: "john" } });
    });

    it("should parse $startsWith operator", () => {
      const startsWithParams: RawQueryParams =
        parserTestData.stringOperators.startsWith;

      const parsedWhere = expectSuccessData(parseWhere(startsWithParams));

      expect(parsedWhere).toEqual({ email: { $startsWith: "admin" } });
    });

    it("should parse $endsWith operator", () => {
      const endsWithParams: RawQueryParams =
        parserTestData.stringOperators.endsWith;

      const parsedWhere = expectSuccessData(parseWhere(endsWithParams));

      expect(parsedWhere).toEqual({ domain: { $endsWith: ".com" } });
    });

    it("should parse $like operator", () => {
      const likeParams: RawQueryParams = parserTestData.stringOperators.like;

      const parsedWhere = expectSuccessData(parseWhere(likeParams));

      expect(parsedWhere).toEqual({ pattern: { $like: "%test%" } });
    });

    it("should parse $ilike operator", () => {
      const ilikeParams: RawQueryParams = parserTestData.stringOperators.ilike;

      const parsedWhere = expectSuccessData(parseWhere(ilikeParams));

      expect(parsedWhere).toEqual({ pattern: { $ilike: "%TEST%" } });
    });
  });

  describe("Array operators", () => {
    it("should parse $in operator with string array", () => {
      const inParams: RawQueryParams = parserTestData.arrayOperators.in;

      const parsedWhere = expectSuccessData(parseWhere(inParams));

      expect(parsedWhere).toEqual({ status: { $in: ["active", "pending"] } });
    });

    it("should parse $nin operator with string array", () => {
      const ninParams: RawQueryParams = parserTestData.arrayOperators.nin;

      const parsedWhere = expectSuccessData(parseWhere(ninParams));

      expect(parsedWhere).toEqual({ role: { $nin: ["guest", "banned"] } });
    });

    it("should parse $in operator with numeric strings", () => {
      const inNumberParams: RawQueryParams =
        parserTestData.arrayOperators.inWithNumbers;

      const parsedWhere = expectSuccessData(parseWhere(inNumberParams));

      expect(parsedWhere).toEqual({ id: { $in: [1, 2, 3] } });
    });

    it("should coerce array values", () => {
      const arrayCoercion: RawQueryParams = {
        "where[values][$in]": ["1", "2", "true", "false", "null", "text"],
      };

      const parsedWhere = expectSuccessData(parseWhere(arrayCoercion));

      expect(parsedWhere).toEqual({
        values: { $in: [1, 2, true, false, null, "text"] },
      });
    });
  });

  describe("Logical operators", () => {
    it("should parse simple $or operator", () => {
      const simpleOrParams: RawQueryParams =
        parserTestData.logicalOperators.simpleOr;

      const parsedWhere = expectSuccessData(parseWhere(simpleOrParams));

      expect(parsedWhere).toEqual({
        $or: [{ status: "active" }, { status: "pending" }],
      });
    });

    it("should parse simple $and operator", () => {
      const simpleAndParams: RawQueryParams =
        parserTestData.logicalOperators.simpleAnd;

      const parsedWhere = expectSuccessData(parseWhere(simpleAndParams));

      expect(parsedWhere).toEqual({
        $and: [{ status: "active" }, { verified: true }],
      });
    });

    it("should parse nested logical operators", () => {
      const nestedOrParams: RawQueryParams =
        parserTestData.logicalOperators.nestedOr;

      const parsedWhere = expectSuccessData(parseWhere(nestedOrParams));

      expect(parsedWhere).toEqual({
        $or: [
          { status: "active" },
          {
            $and: [{ status: "pending" }, { verified: true }],
          },
        ],
      });
    });

    it("should parse multiple $or conditions with different fields", () => {
      const multipleOrFields: RawQueryParams = {
        "where[$or][0][email][$contains]": "@admin",
        "where[$or][1][role]": "admin",
      };

      const parsedWhere = expectSuccessData(parseWhere(multipleOrFields));

      expect(parsedWhere).toEqual({
        $or: [{ email: { $contains: "@admin" } }, { role: "admin" }],
      });
    });
  });

  describe("Complex combinations", () => {
    it("should combine equality and operators", () => {
      const complexParams: RawQueryParams = {
        "where[status]": "active",
        "where[price][$gte]": "100",
        "where[name][$contains]": "product",
      };

      const parsedWhere = expectSuccessData(parseWhere(complexParams));

      expect(parsedWhere).toEqual({
        status: "active",
        price: { $gte: 100 },
        name: { $contains: "product" },
      });
    });

    it("should handle multiple operators on different fields", () => {
      const multipleOperators: RawQueryParams = {
        "where[price][$gte]": "50",
        "where[price][$lte]": "200",
        "where[stock][$gt]": "0",
        "where[status][$ne]": "discontinued",
      };

      const parsedWhere = expectSuccessData(parseWhere(multipleOperators));

      expect(parsedWhere).toEqual({
        price: { $gte: 50, $lte: 200 },
        stock: { $gt: 0 },
        status: { $ne: "discontinued" },
      });
    });
  });

  describe("Determinism", () => {
    it("should return same result for identical input", () => {
      const identicalParams: RawQueryParams = { "where[status]": "active" };

      const firstParse = expectSuccessData(parseWhere(identicalParams));
      const secondParse = expectSuccessData(parseWhere(identicalParams));

      expect(firstParse).toEqual(secondParse);
    });

    it("should return same result regardless of input object mutation", () => {
      const mutableParams: RawQueryParams = { "where[status]": "active" };
      const firstParse = expectSuccessData(parseWhere(mutableParams));

      mutableParams["where[status]"] = "inactive";
      const secondParse = expectSuccessData(
        parseWhere({ "where[status]": "active" }),
      );

      expect(firstParse).toEqual(secondParse);
    });
  });

  describe("Input Immutability", () => {
    it("should not mutate input object", () => {
      const originalParams: RawQueryParams = { "where[status]": "active" };
      const paramsCopy = JSON.parse(JSON.stringify(originalParams));

      expectSuccessData(parseWhere(originalParams));

      expect(originalParams).toEqual(paramsCopy);
    });

    it("should not mutate input arrays", () => {
      const originalArray = ["active", "pending"];
      const arrayCopy = [...originalArray];
      const arrayParams: RawQueryParams = { "where[status][$in]": originalArray };

      expectSuccessData(parseWhere(arrayParams));

      expect(originalArray).toEqual(arrayCopy);
    });

    it("should not mutate nested structures", () => {
      const originalParams: RawQueryParams = {
        "where[$or][0][status]": "active",
        "where[$or][1][verified]": "true",
      };
      const paramsCopy = JSON.parse(JSON.stringify(originalParams));

      expectSuccessData(parseWhere(originalParams));

      expect(originalParams).toEqual(paramsCopy);
    });
  });
});
