/**
 * Relation & Populate Integration Tests - Error Path
 *
 * Tests error handling and security:
 * - Broken relation validation
 * - Invalid field/relation names
 * - Unsupported operators
 * - SQL injection prevention
 * - Schema registry validation
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PostgresAdapter } from "../../packages/adapter-postgres/src";
import { defineSchema } from "../../packages/types/src/core/schema";
import { createUnifiedHandler as createHandler } from "../../packages/api/src/handler/factory";
import { Pool } from "pg";
import { SchemaRegistry } from "forja-core/schema/registry";

// Mock pg
vi.mock("pg", () => {
  const mPool = {
    connect: vi.fn(),
    query: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  };
  return { Pool: vi.fn(() => mPool) };
});

describe("Relation & Populate Integration - Error Path", () => {
  describe("Schema Registry Validation", () => {
    let registry: SchemaRegistry;

    beforeEach(() => {
      registry = new SchemaRegistry();
    });

    const brokenRelationSchema = defineSchema({
      name: "bad_model",
      fields: {
        // @ts-ignore
        broken: {
          type: "relation",
          model: "non_existent_model", // Target does not exist
          kind: "belongsTo",
        },
      },
    });

    it("should throw when registering a schema with broken relation", () => {
      expect(() => registry.register(brokenRelationSchema)).toThrow();
    });
  });

  describe("Invalid Relation Requests", () => {
    let adapter: PostgresAdapter;
    let mockPool: any;

    const postSchema = defineSchema({
      name: "post",
      fields: {
        title: { type: "string", required: true },
        content: { type: "string" },
        author: {
          type: "relation",
          model: "user",
          kind: "belongsTo",
          foreignKey: "authorId",
        },
      },
    });

    beforeEach(async () => {
      vi.clearAllMocks();

      adapter = new PostgresAdapter({
        host: "localhost",
        port: 5432,
        database: "test_db",
        user: "admin",
        password: "password",
      });
      mockPool = new Pool();
      (adapter as any).pool = mockPool;
      (adapter as any).state = "connected";

      const registry = new SchemaRegistry();
      registry.register(postSchema);
    });

    it("should handle request for non-existent model in schema", async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const handler = createHandler({ adapter, schema: postSchema });
      const result = await handler({
        method: "GET",
        body: {},
        query: { "populate[invalid_relation]": "true" },
        params: {},
        headers: {},
        user: undefined,
        metadata: {},
      });

      // Expecting strict error for invalid Populate (Validation happens before query)
      expect(result.status).toBe(400);
      expect((result.body as any).error.code).toBe("INVALID_RELATION");
    });

    it("should return 400 for non-existent fields", async () => {
      const handler = createHandler({ adapter, schema: postSchema });
      const result = await handler({
        method: "GET",
        body: {},
        query: { "fields[0]": "non_existing" },
        params: {},
        headers: {},
        user: undefined,
        metadata: {},
      });

      expect(result.status).toBe(400);
      expect((result.body as any).error.code).toBe("INVALID_FIELD");
    });
  });

  describe("Unsupported Operators", () => {
    let adapter: PostgresAdapter;
    let mockPool: any;

    const postSchema = defineSchema({
      name: "post",
      fields: {
        title: { type: "string", required: true },
      },
    });

    beforeEach(async () => {
      vi.clearAllMocks();

      adapter = new PostgresAdapter({
        host: "localhost",
        port: 5432,
        database: "test_db",
        user: "admin",
        password: "password",
      });
      mockPool = new Pool();
      (adapter as any).pool = mockPool;
      (adapter as any).state = "connected";
    });

    it("should fail gracefully for unsupported operators", async () => {
      const handler = createHandler({ adapter, schema: postSchema });

      const result = await handler({
        method: "GET",
        body: {},
        query: { "where[title][$unknownOp]": "val" },
        params: {},
        headers: {},
        user: undefined,
        metadata: {},
      });

      expect(result.status).toBe(400);
      expect((result.body as any).error.code).toBe("INVALID_VALUE");
    });
  });

  describe("Security - SQL Injection Prevention", () => {
    let adapter: PostgresAdapter;
    let mockPool: any;

    const postSchema = defineSchema({
      name: "post",
      fields: {
        title: { type: "string", required: true },
      },
    });

    beforeEach(async () => {
      vi.clearAllMocks();

      adapter = new PostgresAdapter({
        host: "localhost",
        port: 5432,
        database: "test_db",
        user: "admin",
        password: "password",
      });
      mockPool = new Pool();
      (adapter as any).pool = mockPool;
      (adapter as any).state = "connected";
    });

    it("should parameterize values to prevent SQL injection", async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      const handler = createHandler({ adapter, schema: postSchema });

      await handler({
        method: "GET",
        body: {},
        query: { "where[title][$contains]": `%' OR 1=1 --` },
        params: {},
        headers: {},
        user: undefined,
        metadata: {},
      });

      const callArgs = mockPool.query.mock.calls[0];
      const generatedSql = callArgs[0];
      const params = callArgs[1];

      expect(generatedSql).not.toContain("1=1");
      expect(generatedSql).not.toContain("--");
      expect(params[0]).toBe(`%${"%' OR 1=1 --"}%`);
      expect(generatedSql).toMatch(/\$\d+/);
    });
  });
});
