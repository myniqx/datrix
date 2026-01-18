// @ts-nocheck
/**
 * API Parser - Query Parser Tests (Happy Path)
 *
 * Tests successful parsing of complete query parameters
 * Integrates fields, where, populate, pagination, and sort parsing
 */

import { describe, it, expect } from "vitest";
import { parseQuery } from "../../src/parser/query-parser";
import { RawQueryParams, ParserOptions } from "../../../types/src/api/parser";
import { parserTestData } from "../../../types/src/test/fixtures";
import { expectSuccessData } from "../../../types/src/test/helpers";

describe("QueryParser - Happy Path", () => {
  describe("Empty query", () => {
    it("should parse empty parameters with default pagination", () => {
      const emptyParams: RawQueryParams = {};

      const parsedQuery = expectSuccessData(parseQuery(emptyParams));

      expect(parsedQuery.limit).toBe(25);
      expect(parsedQuery.offset).toBe(0);
      expect(parsedQuery.select).toBeUndefined();
      expect(parsedQuery.where).toBeUndefined();
      expect(parsedQuery.populate).toBeUndefined();
      expect(parsedQuery.orderBy).toBeUndefined();
    });
  });

  describe("Pagination", () => {
    it("should parse limit and offset directly", () => {
      const limitOffsetParams: RawQueryParams =
        parserTestData.paginationParams.limitOffset;

      const parsedQuery = expectSuccessData(parseQuery(limitOffsetParams));

      expect(parsedQuery.limit).toBe(10);
      expect(parsedQuery.offset).toBe(20);
    });

    it("should parse page and pageSize", () => {
      const pagePageSizeParams: RawQueryParams =
        parserTestData.paginationParams.pagePageSize;

      const parsedQuery = expectSuccessData(parseQuery(pagePageSizeParams));

      expect(parsedQuery.limit).toBe(15);
      expect(parsedQuery.offset).toBe(15); // (page-1) * pageSize = (2-1) * 15 = 15
      expect(parsedQuery.page).toBe(2);
      expect(parsedQuery.pageSize).toBe(15);
    });

    it("should use default pageSize when page is provided without pageSize", () => {
      const pageOnlyParams: RawQueryParams =
        parserTestData.paginationParams.pageOnly;

      const parsedQuery = expectSuccessData(parseQuery(pageOnlyParams));

      expect(parsedQuery.limit).toBe(25); // default pageSize
      expect(parsedQuery.offset).toBe(50); // (3-1) * 25 = 50
      expect(parsedQuery.page).toBe(3);
      expect(parsedQuery.pageSize).toBe(25);
    });

    it("should handle pageSize without page", () => {
      const pageSizeOnlyParams: RawQueryParams =
        parserTestData.paginationParams.pageSizeOnly;

      const parsedQuery = expectSuccessData(parseQuery(pageSizeOnlyParams));

      expect(parsedQuery.limit).toBe(50);
      expect(parsedQuery.offset).toBe(0); // default page is 1
      expect(parsedQuery.page).toBe(1);
      expect(parsedQuery.pageSize).toBe(50);
    });

    it("should handle large page numbers", () => {
      const largePageParams: RawQueryParams =
        parserTestData.paginationParams.largePage;

      const parsedQuery = expectSuccessData(parseQuery(largePageParams));

      expect(parsedQuery.limit).toBe(25);
      expect(parsedQuery.offset).toBe(2475); // (100-1) * 25
      expect(parsedQuery.page).toBe(100);
    });

    it("should respect custom defaultPageSize option", () => {
      const emptyParams: RawQueryParams = {};
      const customOptions: ParserOptions = { defaultPageSize: 50 };

      const parsedQuery = expectSuccessData(
        parseQuery(emptyParams, customOptions),
      );

      expect(parsedQuery.limit).toBe(50);
      expect(parsedQuery.offset).toBe(0);
    });

    it("should respect custom maxPageSize option", () => {
      const params: RawQueryParams = { limit: "30" };
      const customOptions: ParserOptions = { maxPageSize: 50 };

      const parsedQuery = expectSuccessData(parseQuery(params, customOptions));

      expect(parsedQuery.limit).toBe(30);
    });
  });

  describe("Sorting", () => {
    it("should parse single field ascending sort", () => {
      const singleAscParams: RawQueryParams = parserTestData.sortParams.singleAsc;

      const parsedQuery = expectSuccessData(parseQuery(singleAscParams));

      expect(parsedQuery.orderBy).toEqual([{ field: "name", direction: "asc" }]);
    });

    it("should parse single field descending sort", () => {
      const singleDescParams: RawQueryParams =
        parserTestData.sortParams.singleDesc;

      const parsedQuery = expectSuccessData(parseQuery(singleDescParams));

      expect(parsedQuery.orderBy).toEqual([
        { field: "createdAt", direction: "desc" },
      ]);
    });

    it("should parse multiple fields sort", () => {
      const multipleParams: RawQueryParams = parserTestData.sortParams.multiple;

      const parsedQuery = expectSuccessData(parseQuery(multipleParams));

      expect(parsedQuery.orderBy).toEqual([
        { field: "name", direction: "asc" },
        { field: "age", direction: "desc" },
        { field: "status", direction: "asc" },
      ]);
    });

    it("should handle sort as an array of strings", () => {
      const arrayParams: RawQueryParams = parserTestData.sortParams.array;

      const parsedQuery = expectSuccessData(parseQuery(arrayParams));

      expect(parsedQuery.orderBy).toEqual([
        { field: "name", direction: "asc" },
        { field: "age", direction: "desc" },
      ]);
    });

    it("should parse sort with dots (nested fields)", () => {
      const dotsParams: RawQueryParams = parserTestData.sortParams.withDots;

      const parsedQuery = expectSuccessData(parseQuery(dotsParams));

      expect(parsedQuery.orderBy).toEqual([
        { field: "user.profile.name", direction: "asc" },
      ]);
    });

    it("should parse sort with underscores", () => {
      const underscoreParams: RawQueryParams =
        parserTestData.sortParams.withUnderscore;

      const parsedQuery = expectSuccessData(parseQuery(underscoreParams));

      expect(parsedQuery.orderBy).toEqual([
        { field: "_id", direction: "asc" },
        { field: "created_at", direction: "desc" },
      ]);
    });
  });

  describe("Integration - Simple queries", () => {
    it("should combine fields and where", () => {
      const params: RawQueryParams = {
        fields: "id,name",
        "where[status]": "active",
      };

      const parsedQuery = expectSuccessData(parseQuery(params));

      expect(parsedQuery.select).toEqual(["id", "name"]);
      expect(parsedQuery.where).toEqual({ status: "active" });
    });

    it("should combine where and populate", () => {
      const params: RawQueryParams = {
        "where[published]": "true",
        populate: "author,comments",
      };

      const parsedQuery = expectSuccessData(parseQuery(params));

      expect(parsedQuery.where).toEqual({ published: true });
      expect(parsedQuery.populate).toEqual({
        author: "*",
        comments: "*",
      });
    });

    it("should combine all query sections", () => {
      const params: RawQueryParams = parserTestData.integratedQueryParams.simple;

      const parsedQuery = expectSuccessData(parseQuery(params));

      expect(parsedQuery.select).toEqual(["id", "name"]);
      expect(parsedQuery.where).toEqual({ status: "active" });
      expect(parsedQuery.populate).toEqual({ author: "*" });
      expect(parsedQuery.orderBy).toEqual([{ field: "id", direction: "desc" }]);
      expect(parsedQuery.limit).toBe(5);
    });
  });

  describe("Integration - Complex queries", () => {
    it("should handle complex nested query", () => {
      const params: RawQueryParams = parserTestData.integratedQueryParams.complex;

      const parsedQuery = expectSuccessData(parseQuery(params));

      expect(parsedQuery.select).toEqual(["id", "title"]);
      expect(parsedQuery.where).toEqual({
        published: true,
        views: { $gte: "100" },
      });
      expect(parsedQuery.populate).toEqual({
        author: { select: ["name", "email"] },
        comments: { populate: { user: "*" } },
      });
      expect(parsedQuery.orderBy).toEqual([
        { field: "title", direction: "asc" },
        { field: "createdAt", direction: "desc" },
      ]);
      expect(parsedQuery.page).toBe(2);
      expect(parsedQuery.pageSize).toBe(20);
      expect(parsedQuery.limit).toBe(20);
      expect(parsedQuery.offset).toBe(20);
    });

    it("should handle fields with where operators", () => {
      const params: RawQueryParams = {
        fields: "id,title,author.name",
        "where[price][$gte]": "10",
        "where[price][$lte]": "100",
        "where[category][$in]": ["tech", "science"],
        sort: "-price,title",
        limit: "20",
      };

      const parsedQuery = expectSuccessData(parseQuery(params));

      expect(parsedQuery.select).toEqual(["id", "title", "author.name"]);
      expect(parsedQuery.where).toEqual({
        price: { $gte: "10", $lte: "100" },
        category: { $in: ["tech", "science"] },
      });
      expect(parsedQuery.orderBy).toEqual([
        { field: "price", direction: "desc" },
        { field: "title", direction: "asc" },
      ]);
      expect(parsedQuery.limit).toBe(20);
    });

    it("should handle deeply nested populate with fields", () => {
      const params: RawQueryParams = {
        "populate[author][fields]": "name,email",
        "populate[author][populate][profile][fields]": "bio",
        "populate[author][populate][profile][populate]": "avatar",
      };

      const parsedQuery = expectSuccessData(parseQuery(params));

      expect(parsedQuery.populate).toEqual({
        author: {
          select: ["name", "email"],
          populate: {
            profile: {
              select: ["bio"],
              populate: {
                avatar: "*",
              },
            },
          },
        },
      });
    });
  });

  describe("Determinism", () => {
    it("should return same result for identical input", () => {
      const identicalParams: RawQueryParams = {
        fields: "id,name",
        "where[status]": "active",
        limit: "10",
      };

      const firstParse = expectSuccessData(parseQuery(identicalParams));
      const secondParse = expectSuccessData(parseQuery(identicalParams));

      expect(firstParse).toEqual(secondParse);
    });

    it("should return same result regardless of input mutation", () => {
      const mutableParams: RawQueryParams = {
        fields: "id,name",
        limit: "10",
      };
      const firstParse = expectSuccessData(parseQuery(mutableParams));

      mutableParams.fields = "email";
      mutableParams.limit = "20";
      const secondParse = expectSuccessData(
        parseQuery({ fields: "id,name", limit: "10" }),
      );

      expect(firstParse).toEqual(secondParse);
    });
  });

  describe("Input Immutability", () => {
    it("should not mutate input object", () => {
      const originalParams: RawQueryParams = {
        fields: "id,name",
        "where[status]": "active",
        populate: "author",
        sort: "name",
        limit: "10",
      };
      const paramsCopy = JSON.parse(JSON.stringify(originalParams));

      expectSuccessData(parseQuery(originalParams));

      expect(originalParams).toEqual(paramsCopy);
    });

    it("should not mutate options object", () => {
      const params: RawQueryParams = { limit: "10" };
      const options: ParserOptions = { maxPageSize: 50, defaultPageSize: 25 };
      const optionsCopy = { ...options };

      expectSuccessData(parseQuery(params, options));

      expect(options).toEqual(optionsCopy);
    });
  });

  describe("Options handling", () => {
    it("should use custom maxPopulateDepth", () => {
      const params: RawQueryParams = {
        "populate[a][populate][b][populate][c]": "*",
      };
      const customOptions: ParserOptions = { maxPopulateDepth: 3 };

      const parsedQuery = expectSuccessData(parseQuery(params, customOptions));

      expect(parsedQuery.populate).toBeDefined();
    });

    it("should merge custom options with defaults", () => {
      const params: RawQueryParams = {};
      const partialOptions: Partial<ParserOptions> = { defaultPageSize: 10 };

      const parsedQuery = expectSuccessData(parseQuery(params, partialOptions));

      expect(parsedQuery.limit).toBe(10);
      expect(parsedQuery.offset).toBe(0);
    });
  });
});
