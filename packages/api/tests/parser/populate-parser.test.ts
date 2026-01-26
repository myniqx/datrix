// @ts-nocheck
/**
 * API Parser - Populate Parser Tests (Happy Path)
 *
 * Tests successful parsing of populate query parameters
 */

import { describe, it, expect } from "vitest";
import { parsePopulate } from "../../src/parser/populate-parser";
import { RawQueryParams } from "../../../types/src/api/parser";
import { parserTestData } from "../../../types/src/test/fixtures";

const expectSuccessData = (result: any) => result;

describe("PopulateParser - Happy Path", () => {
  describe("No populate parameter", () => {
    it("should return undefined when no populate parameter is provided", () => {
      const emptyParams: RawQueryParams = {};

      const parsedPopulate = expectSuccessData(parsePopulate(emptyParams));

      expect(parsedPopulate).toBeUndefined();
    });
  });

  describe("Simple string format", () => {
    it("should parse single relation", () => {
      const singleRelationParams: RawQueryParams = {
        populate: parserTestData.simplePopulate.singleRelation,
      };

      const parsedPopulate = expectSuccessData(
        parsePopulate(singleRelationParams),
      );

      expect(parsedPopulate).toEqual({ author: "*" });
    });

    it("should parse comma-separated relations", () => {
      const commaSeparatedParams: RawQueryParams = {
        populate: parserTestData.simplePopulate.commaSeparated,
      };

      const parsedPopulate = expectSuccessData(
        parsePopulate(commaSeparatedParams),
      );

      expect(parsedPopulate).toEqual({
        author: "*",
        comments: "*",
        category: "*",
      });
    });

    it("should parse relations with underscores", () => {
      const underscoreRelations: RawQueryParams = {
        populate: parserTestData.simplePopulate.withUnderscore,
      };

      const parsedPopulate = expectSuccessData(parsePopulate(underscoreRelations));

      expect(parsedPopulate).toEqual({
        api_key: "*",
        _internal: "*",
      });
    });

    it("should handle wildcard", () => {
      const wildcardParams: RawQueryParams = {
        populate: parserTestData.simplePopulate.wildcard,
      };

      const parsedPopulate = expectSuccessData(parsePopulate(wildcardParams));

      expect(parsedPopulate).toEqual({ "*": "*" });
    });

    it("should handle array format", () => {
      const arrayFormatParams: RawQueryParams = {
        populate: parserTestData.validRelationNames.slice(0, 2),
      };

      const parsedPopulate = expectSuccessData(parsePopulate(arrayFormatParams));

      expect(parsedPopulate).toEqual({
        author: "*",
        profile: "*",
      });
    });
  });

  describe("Object-style populate", () => {
    it("should parse populate[relation]=*", () => {
      const wildcardRelationParams: RawQueryParams =
        parserTestData.objectStylePopulate.wildcardRelation;

      const parsedPopulate = expectSuccessData(
        parsePopulate(wildcardRelationParams),
      );

      expect(parsedPopulate).toEqual({ author: "*" });
    });

    it("should parse populate with specific fields (comma-separated)", () => {
      const withFieldsParams: RawQueryParams =
        parserTestData.objectStylePopulate.withFields;

      const parsedPopulate = expectSuccessData(parsePopulate(withFieldsParams));

      expect(parsedPopulate).toEqual({
        author: {
          select: ["name", "email"],
        },
      });
    });

    it("should parse populate with specific fields (indexed array)", () => {
      const withFieldsIndexedParams: RawQueryParams =
        parserTestData.objectStylePopulate.withFieldsIndexed;

      const parsedPopulate = expectSuccessData(
        parsePopulate(withFieldsIndexedParams),
      );

      expect(parsedPopulate).toEqual({
        author: {
          select: ["name", "email"],
        },
      });
    });

    it("should parse multiple relations with different field selections", () => {
      const multipleRelationsParams: RawQueryParams = {
        "populate[author][fields]": "name,email",
        "populate[category][fields]": "title",
      };

      const parsedPopulate = expectSuccessData(
        parsePopulate(multipleRelationsParams),
      );

      expect(parsedPopulate).toEqual({
        author: { select: ["name", "email"] },
        category: { select: ["title"] },
      });
    });
  });

  describe("Nested populate", () => {
    it("should parse simple nested populate", () => {
      const simpleNestedParams: RawQueryParams =
        parserTestData.nestedPopulate.simple;

      const parsedPopulate = expectSuccessData(parsePopulate(simpleNestedParams));

      expect(parsedPopulate).toEqual({
        author: {
          populate: {
            profile: "*",
          },
        },
      });
    });

    it("should parse nested populate with fields", () => {
      const nestedWithFieldsParams: RawQueryParams =
        parserTestData.nestedPopulate.withFields;

      const parsedPopulate = expectSuccessData(
        parsePopulate(nestedWithFieldsParams),
      );

      expect(parsedPopulate).toEqual({
        author: {
          populate: {
            profile: {
              select: ["bio", "avatar"],
            },
          },
        },
      });
    });

    it("should parse deep nested populate with fields and populate", () => {
      const deepNestedParams: RawQueryParams = parserTestData.nestedPopulate.deep;

      const parsedPopulate = expectSuccessData(parsePopulate(deepNestedParams));

      expect(parsedPopulate).toEqual({
        author: {
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

    it("should parse multiple nested relations", () => {
      const multipleNestedParams: RawQueryParams = {
        "populate[author][populate]": "profile",
        "populate[comments][populate]": "user",
      };

      const parsedPopulate = expectSuccessData(
        parsePopulate(multipleNestedParams),
      );

      expect(parsedPopulate).toEqual({
        author: {
          populate: { profile: "*" },
        },
        comments: {
          populate: { user: "*" },
        },
      });
    });
  });

  describe("Max depth enforcement", () => {
    it("should allow populate within max depth (default 5)", () => {
      const depth5Params: RawQueryParams = parserTestData.maxDepthPopulate.depth5;

      const parsedPopulate = expectSuccessData(parsePopulate(depth5Params));

      expect(parsedPopulate).toBeDefined();
      expect(parsedPopulate?.a).toBeDefined();
    });

    it("should allow populate up to custom max depth", () => {
      const depth2Params: RawQueryParams = parserTestData.maxDepthPopulate.depth2;

      const parsedPopulate = expectSuccessData(parsePopulate(depth2Params, 2));

      expect(parsedPopulate).toBeDefined();
    });

    it("should allow depth 1 populate", () => {
      const depth1Params: RawQueryParams = parserTestData.maxDepthPopulate.depth1;

      const parsedPopulate = expectSuccessData(parsePopulate(depth1Params, 1));

      expect(parsedPopulate).toEqual({ a: "*" });
    });
  });

  describe("Determinism", () => {
    it("should return same result for identical input", () => {
      const identicalParams: RawQueryParams = { populate: "author,comments" };

      const firstParse = expectSuccessData(parsePopulate(identicalParams));
      const secondParse = expectSuccessData(parsePopulate(identicalParams));

      expect(firstParse).toEqual(secondParse);
    });

    it("should return same result regardless of input object mutation", () => {
      const mutableParams: RawQueryParams = { populate: "author" };
      const firstParse = expectSuccessData(parsePopulate(mutableParams));

      mutableParams.populate = "comments";
      const secondParse = expectSuccessData(parsePopulate({ populate: "author" }));

      expect(firstParse).toEqual(secondParse);
    });
  });

  describe("Input Immutability", () => {
    it("should not mutate input object", () => {
      const originalParams: RawQueryParams = { populate: "author,comments" };
      const paramsCopy = JSON.parse(JSON.stringify(originalParams));

      expectSuccessData(parsePopulate(originalParams));

      expect(originalParams).toEqual(paramsCopy);
    });

    it("should not mutate input array", () => {
      const originalArray = ["author", "comments"];
      const arrayCopy = [...originalArray];
      const arrayParams: RawQueryParams = { populate: originalArray };

      expectSuccessData(parsePopulate(arrayParams));

      expect(originalArray).toEqual(arrayCopy);
    });

    it("should not mutate nested object params", () => {
      const originalParams: RawQueryParams = {
        "populate[author][fields]": "name,email",
        "populate[comments][populate]": "user",
      };
      const paramsCopy = JSON.parse(JSON.stringify(originalParams));

      expectSuccessData(parsePopulate(originalParams));

      expect(originalParams).toEqual(paramsCopy);
    });
  });

  describe("Complex scenarios", () => {
    it("should handle mixed simple and object-style populate", () => {
      const mixedParams: RawQueryParams = {
        populate: "category",
        "populate[author][fields]": "name,email",
      };

      const parsedPopulate = expectSuccessData(parsePopulate(mixedParams));

      expect(parsedPopulate).toEqual({
        category: "*",
        author: { select: ["name", "email"] },
      });
    });

    it("should handle complex nested structure", () => {
      const complexParams: RawQueryParams = {
        "populate[author][fields]": "name",
        "populate[author][populate][profile][fields]": "bio",
        "populate[author][populate][profile][populate]": "avatar",
        "populate[comments][fields]": "content",
        "populate[comments][populate][user]": "*",
      };

      const parsedPopulate = expectSuccessData(parsePopulate(complexParams));

      expect(parsedPopulate).toEqual({
        author: {
          select: ["name"],
          populate: {
            profile: {
              select: ["bio"],
              populate: {
                avatar: "*",
              },
            },
          },
        },
        comments: {
          select: ["content"],
          populate: {
            user: "*",
          },
        },
      });
    });
  });
});
