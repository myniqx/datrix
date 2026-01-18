/**
 * Full Stack Integration Tests - Error Path
 *
 * Tests error handling:
 * - Validation errors before database
 * - Database connection errors
 * - Unique constraint violations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PostgresAdapter } from "../../packages/adapter-postgres/src";
import { defineSchema } from "../../packages/types/src/core/schema";
import { createUnifiedHandler as createHandler } from "../../packages/api/src/handler/factory";
import { Pool } from "pg";
import { SchemaRegistry } from "forja-core/schema/registry";

// Mock types
interface MockPool {
  connect: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

const TEST_USER = {
  id: 1,
  username: "johndoe",
  email: "john@example.com",
  age: 30,
} as const;

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

describe("Full Stack Integration - Error Path", () => {
  let adapter: PostgresAdapter;
  let registry: SchemaRegistry;
  let mockPool: MockPool;

  const userSchema = defineSchema({
    name: "user",
    fields: {
      username: { type: "string", required: true, unique: true },
      email: { type: "string", required: true },
      age: { type: "number" },
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
    mockPool = new Pool() as unknown as MockPool;
    (adapter as any).pool = mockPool;
    (adapter as any).state = "connected";

    registry = new SchemaRegistry();
    registry.register(userSchema);
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  describe("Validation Error Handling", () => {
    it("should reject invalid data before reaching database", async () => {
      const handler = createHandler({
        adapter,
        schema: userSchema,
      });

      const result = await handler({
        method: "POST",
        body: { age: 25 }, // Missing required: username, email
        query: {},
        params: {},
        headers: {},
        user: undefined,
        metadata: {},
      });

      // Debug: Log the actual response
      if (result.status !== 400) {
        console.log("❌ Validation test failed");
        console.log("Status:", result.status);
        console.log("Body:", JSON.stringify(result.body, null, 2));
      }

      // Should fail validation
      expect(result.status).toBe(400);
      expect(result.body).toHaveProperty("error");

      if ("error" in result.body) {
        expect(result.body.error).toBeDefined();
        expect(result.body.error.message).toBeDefined();
      }

      // Database should NOT be called
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it("should validate email field when provided", async () => {
      const handler = createHandler({
        adapter,
        schema: userSchema,
      });

      const result = await handler({
        method: "POST",
        body: {
          username: "test",
          email: "", // Invalid: empty email
          age: 25,
        },
        query: {},
        params: {},
        headers: {},
        user: undefined,
        metadata: {},
      });

      expect(result.status).toBe(400);
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe("Database Error Handling", () => {
    it("should handle database connection errors gracefully", async () => {
      mockPool.query.mockRejectedValueOnce(new Error("Connection timeout"));

      const handler = createHandler({
        adapter,
        schema: userSchema,
      });

      const result = await handler({
        method: "GET",
        body: {},
        query: {},
        params: {},
        headers: {},
        user: undefined,
        metadata: {},
      });

      expect(result.status).toBe(500);
      expect(result.body).toHaveProperty("error");
    });

    it("should handle unique constraint violations", async () => {
      const constraintError = new Error("duplicate key value");
      (constraintError as any).code = "23505"; // PostgreSQL unique violation

      mockPool.query.mockRejectedValueOnce(constraintError);

      const handler = createHandler({
        adapter,
        schema: userSchema,
      });

      const result = await handler({
        method: "POST",
        body: TEST_USER,
        query: {},
        params: {},
        headers: {},
        user: undefined,
        metadata: {},
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.body).toHaveProperty("error");
    });
  });
});
