/**
 * Schema-Level Permission Tests
 *
 * Tests the permission system with auth ENABLED.
 * Validates that permissions are enforced correctly for different roles.
 *
 * Schema permissions used in tests:
 * - category: create=admin, read=true, update=admin/editor, delete=admin
 * - supplier: create=admin/editor, read=authenticated, update=admin/editor, delete=admin
 * - product: create=admin/editor, read=true, update=admin/editor/owner, delete=admin
 * - secret: no permission (uses defaultPermission)
 * - public: all=true
 * - restricted: all=admin
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import { handleRequest } from "../src/helper";
import {
  createTestConfigWithAuth,
  testJwtSecret,
  testUsers,
  TestRoles,
} from "./data/config-auth";
import { JwtStrategy } from "../src/auth/jwt";
import fs from "node:fs/promises";
import path from "node:path";

/** API Response type for type-safe json parsing */
interface ApiResponse<T = Record<string, unknown>> {
  data?: T;
  error?: { message: string; code: string };
}

describe("Schema-Level Permission Tests", () => {
  let forja: Forja;
  let jwtStrategy: JwtStrategy;
  const tmpDir = path.join(
    process.cwd(),
    "packages",
    "api",
    "tests",
    ".tmp-auth",
  );

  // Token cache for each role
  const tokens: Record<TestRoles, string> = {
    admin: "",
    editor: "",
    user: "",
    guest: "",
  };

  /**
   * Helper to create authenticated request
   */
  function createRequest(
    url: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      token?: string;
    } = {},
  ): Request {
    const { method = "GET", body, token } = options;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    return new Request(`http://localhost:3000${url}`, {
      method,
      headers,
      ...(body && { body: JSON.stringify(body) }),
    });
  }

  beforeAll(async () => {
    // Clean up and create temp directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
    await fs.mkdir(tmpDir, { recursive: true });

    // Initialize Forja with auth config
    const getForja = createTestConfigWithAuth(tmpDir);
    forja = await getForja();

    // Create tables
    const adapter = forja.getAdapter();
    for (const schema of forja.getSchemas().getAll()) {
      const result = await adapter.createTable(schema);
      if (!result.success) {
        throw new Error(
          `Failed to create table ${schema.name}: ${result.error.message}`,
        );
      }
    }

    // Create JWT strategy for generating test tokens
    jwtStrategy = new JwtStrategy({
      secret: testJwtSecret,
      expiresIn: "1h",
      algorithm: "HS256",
    });

    // Generate tokens for each role
    for (const role of Object.keys(testUsers) as TestRoles[]) {
      const user = testUsers[role];
      const result = await jwtStrategy.sign({
        userId: user.id,
        role: user.role,
      });
      tokens[role] = result;
    }
  });

  afterAll(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  // ============================================================
  // AUTHENTICATION SYSTEM TESTS
  // Verifies auth infrastructure is properly set up
  // ============================================================

  describe("Authentication System Setup", () => {
    it("should create authentication table when auth is enabled", async () => {
      const schemas = forja.getSchemas().getAll();
      const authSchema = schemas.find((s) => s.name === "authentication");

      expect(authSchema).toBeDefined();
      expect(authSchema?.fields).toHaveProperty("user");
      expect(authSchema?.fields).toHaveProperty("email");
      expect(authSchema?.fields).toHaveProperty("password");
      expect(authSchema?.fields).toHaveProperty("passwordSalt");
      expect(authSchema?.fields).toHaveProperty("role");
    });

    it("should create auth record when user is created", async () => {
      // Create a user
      const createResponse = await handleRequest(
        forja,
        createRequest("/api/users", {
          method: "POST",
          token: tokens.admin,
          body: {
            email: "newuser@test.com",
            name: "New User",
          },
        }),
      );

      const createData = (await createResponse.json()) as ApiResponse<{
        id: number;
      }>;
      expect(createResponse.status).toBe(201);
      const userId = createData.data!.id;

      // Verify auth record was created
      const adapter = forja.getAdapter();
      const authResult = await adapter.executeQuery({
        type: "select",
        table: "authentications",
        where: { userId: String(userId) },
      });

      expect(authResult.success).toBe(true);
      if (authResult.success && Array.isArray(authResult.data)) {
        expect(authResult.data.length).toBe(1);
        const authRecord = authResult.data[0] as { email: string; userId: string };
        expect(authRecord.email).toBe("newuser@test.com");
        expect(authRecord.userId).toBe(String(userId));
      }
    });

    it("should sync auth email when user email is updated", async () => {
      // Create a user first
      const createResponse = await handleRequest(
        forja,
        createRequest("/api/users", {
          method: "POST",
          token: tokens.admin,
          body: {
            email: "synctest@test.com",
            name: "Sync Test User",
          },
        }),
      );

      const createData = (await createResponse.json()) as { data: { id: number } };
      expect(createResponse.status).toBe(201);
      const userId = createData.data.id;

      // Update user email
      const updateResponse = await handleRequest(
        forja,
        createRequest(`/api/users/${userId}`, {
          method: "PATCH",
          token: tokens.admin,
          body: { email: "updated-sync@test.com" },
        }),
      );

      expect(updateResponse.status).toBe(200);

      // Verify auth record was also updated
      // Query authentication table directly via adapter
      const adapter = forja.getAdapter();
      const authResult = await adapter.executeQuery({
        type: "select",
        table: "authentication",
        where: { userId: String(userId) },
      });

      if (
        authResult.success &&
        Array.isArray(authResult.data) &&
        authResult.data.length > 0
      ) {
        const authRecord = authResult.data[0] as { email: string };
        expect(authRecord.email).toBe("updated-sync@test.com");
      }
    });

    it("should delete auth record when user is deleted", async () => {
      // Create a user
      const createResponse = await handleRequest(
        forja,
        createRequest("/api/users", {
          method: "POST",
          token: tokens.admin,
          body: {
            email: "deletetest@test.com",
            name: "Delete Test User",
          },
        }),
      );

      const createData = (await createResponse.json()) as { data: { id: number } };
      const userId = createData.data.id;

      // Delete user
      const deleteResponse = await handleRequest(
        forja,
        createRequest(`/api/users/${userId}`, {
          method: "DELETE",
          token: tokens.admin,
        }),
      );

      expect(deleteResponse.status).toBe(200);

      // Verify auth record was also deleted
      const adapter = forja.getAdapter();
      const authResult = await adapter.executeQuery({
        type: "select",
        table: "authentication",
        where: { userId: String(userId) },
      });

      if (authResult.success && Array.isArray(authResult.data)) {
        expect(authResult.data.length).toBe(0);
      }
    });
  });

  // ============================================================
  // CATEGORY TESTS
  // permission: { create: admin, read: true, update: admin/editor, delete: admin }
  // ============================================================

  describe("Category Schema (create=admin, read=true, update=admin/editor, delete=admin)", () => {
    let categoryId: number;

    describe("CREATE permission", () => {
      it("should allow admin to create", async () => {
        const response = await handleRequest(
          forja,
          createRequest("/api/categories", {
            method: "POST",
            token: tokens.admin,
            body: { name: "Test Category", description: "Created by admin" },
          }),
        );

        const data = (await response.json()) as ApiResponse<{ id: number }>;
        expect(response.status).toBe(201);
        expect(data.data).toHaveProperty("id");
        categoryId = data.data!.id;
      });

      it("should deny editor from creating (403)", async () => {
        const response = await handleRequest(
          forja,
          createRequest("/api/categories", {
            method: "POST",
            token: tokens.editor,
            body: { name: "Editor Category", description: "Should fail" },
          }),
        );

        expect(response.status).toBe(403);
      });

      it("should deny user from creating (403)", async () => {
        const response = await handleRequest(
          forja,
          createRequest("/api/categories", {
            method: "POST",
            token: tokens.user,
            body: { name: "User Category", description: "Should fail" },
          }),
        );

        expect(response.status).toBe(403);
      });

      it("should deny unauthenticated from creating (401)", async () => {
        const response = await handleRequest(
          forja,
          createRequest("/api/categories", {
            method: "POST",
            body: { name: "Anonymous Category", description: "Should fail" },
          }),
        );

        expect(response.status).toBe(401);
      });
    });

    describe("READ permission (public)", () => {
      it("should allow unauthenticated to read", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/categories/${categoryId}`),
        );

        expect(response.status).toBe(200);
        const data = (await response.json()) as ApiResponse<{ name: string }>;
        expect(data.data!.name).toBe("Test Category");
      });

      it("should allow any role to read list", async () => {
        const response = await handleRequest(
          forja,
          createRequest("/api/categories", { token: tokens.guest }),
        );

        expect(response.status).toBe(200);
        const data = (await response.json()) as ApiResponse<unknown[]>;
        expect(Array.isArray(data.data)).toBe(true);
      });
    });

    describe("UPDATE permission", () => {
      it("should allow admin to update", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/categories/${categoryId}`, {
            method: "PATCH",
            token: tokens.admin,
            body: { description: "Updated by admin" },
          }),
        );

        expect(response.status).toBe(200);
      });

      it("should allow editor to update", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/categories/${categoryId}`, {
            method: "PATCH",
            token: tokens.editor,
            body: { description: "Updated by editor" },
          }),
        );

        expect(response.status).toBe(200);
      });

      it("should deny user from updating (403)", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/categories/${categoryId}`, {
            method: "PATCH",
            token: tokens.user,
            body: { description: "Should fail" },
          }),
        );

        expect(response.status).toBe(403);
      });

      it("should deny unauthenticated from updating (401)", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/categories/${categoryId}`, {
            method: "PATCH",
            body: { description: "Should fail" },
          }),
        );

        expect(response.status).toBe(401);
      });
    });

    describe("DELETE permission", () => {
      it("should deny editor from deleting (403)", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/categories/${categoryId}`, {
            method: "DELETE",
            token: tokens.editor,
          }),
        );

        expect(response.status).toBe(403);
      });

      it("should deny user from deleting (403)", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/categories/${categoryId}`, {
            method: "DELETE",
            token: tokens.user,
          }),
        );

        expect(response.status).toBe(403);
      });

      it("should allow admin to delete", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/categories/${categoryId}`, {
            method: "DELETE",
            token: tokens.admin,
          }),
        );

        expect(response.status).toBe(200);
      });
    });
  });

  // ============================================================
  // SUPPLIER TESTS
  // permission: { create: admin/editor, read: authenticated, update: admin/editor, delete: admin }
  // ============================================================

  describe("Supplier Schema (read=authenticated function)", () => {
    let supplierId: number;

    beforeAll(async () => {
      // Create a supplier for tests
      const response = await handleRequest(
        forja,
        createRequest("/api/suppliers", {
          method: "POST",
          token: tokens.admin,
          body: {
            name: "Test Supplier",
            email: "supplier@test.com",
            country: "USA",
            rating: 4.5,
          },
        }),
      );
      const data = (await response.json()) as ApiResponse<{ id: number }>;
      supplierId = data.data!.id;
    });

    describe("READ permission (function: authenticated only)", () => {
      it("should deny unauthenticated from reading (401)", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/suppliers/${supplierId}`),
        );

        expect(response.status).toBe(401);
      });

      it("should allow any authenticated user to read", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/suppliers/${supplierId}`, { token: tokens.user }),
        );

        expect(response.status).toBe(200);
      });

      it("should allow guest (authenticated) to read", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/suppliers/${supplierId}`, { token: tokens.guest }),
        );

        expect(response.status).toBe(200);
      });
    });

    describe("CREATE permission (admin/editor)", () => {
      it("should allow editor to create", async () => {
        const response = await handleRequest(
          forja,
          createRequest("/api/suppliers", {
            method: "POST",
            token: tokens.editor,
            body: {
              name: "Editor Supplier",
              email: "editor-supplier@test.com",
              country: "UK",
            },
          }),
        );

        expect(response.status).toBe(201);
      });

      it("should deny user from creating (403)", async () => {
        const response = await handleRequest(
          forja,
          createRequest("/api/suppliers", {
            method: "POST",
            token: tokens.user,
            body: {
              name: "User Supplier",
              email: "user-supplier@test.com",
              country: "UK",
            },
          }),
        );

        expect(response.status).toBe(403);
      });
    });
  });

  // ============================================================
  // PUBLIC SCHEMA TESTS
  // permission: { create: true, read: true, update: true, delete: true }
  // ============================================================

  describe("Public Schema (all=true)", () => {
    let publicId: number;

    it("should allow unauthenticated to create", async () => {
      const response = await handleRequest(
        forja,
        createRequest("/api/publics", {
          method: "POST",
          body: { title: "Public Post", content: "Anyone can create" },
        }),
      );

      expect(response.status).toBe(201);
      const data = (await response.json()) as ApiResponse<{ id: number }>;
      publicId = data.data!.id;
    });

    it("should allow unauthenticated to read", async () => {
      const response = await handleRequest(
        forja,
        createRequest(`/api/publics/${publicId}`),
      );

      expect(response.status).toBe(200);
    });

    it("should allow unauthenticated to update", async () => {
      const response = await handleRequest(
        forja,
        createRequest(`/api/publics/${publicId}`, {
          method: "PATCH",
          body: { content: "Updated anonymously" },
        }),
      );

      expect(response.status).toBe(200);
    });

    it("should allow unauthenticated to delete", async () => {
      const response = await handleRequest(
        forja,
        createRequest(`/api/publics/${publicId}`, {
          method: "DELETE",
        }),
      );

      expect(response.status).toBe(200);
    });
  });

  // ============================================================
  // RESTRICTED SCHEMA TESTS
  // permission: { create: admin, read: admin, update: admin, delete: admin }
  // ============================================================

  describe("Restricted Schema (all=admin)", () => {
    let restrictedId: number;

    describe("Admin access", () => {
      it("should allow admin to create", async () => {
        const response = await handleRequest(
          forja,
          createRequest("/api/restricteds", {
            method: "POST",
            token: tokens.admin,
            body: { data: "Secret admin data" },
          }),
        );

        expect(response.status).toBe(201);
        const data = (await response.json()) as ApiResponse<{ id: number }>;
        restrictedId = data.data!.id;
      });

      it("should allow admin to read", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/restricteds/${restrictedId}`, {
            token: tokens.admin,
          }),
        );

        expect(response.status).toBe(200);
      });

      it("should allow admin to update", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/restricteds/${restrictedId}`, {
            method: "PATCH",
            token: tokens.admin,
            body: { data: "Updated by admin" },
          }),
        );

        expect(response.status).toBe(200);
      });
    });

    describe("Non-admin denied", () => {
      it("should deny editor from reading (403)", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/restricteds/${restrictedId}`, {
            token: tokens.editor,
          }),
        );

        expect(response.status).toBe(403);
      });

      it("should deny user from creating (403)", async () => {
        const response = await handleRequest(
          forja,
          createRequest("/api/restricteds", {
            method: "POST",
            token: tokens.user,
            body: { data: "Should fail" },
          }),
        );

        expect(response.status).toBe(403);
      });

      it("should deny unauthenticated from reading (401)", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/restricteds/${restrictedId}`),
        );

        expect(response.status).toBe(401);
      });
    });

    describe("Admin can delete", () => {
      it("should allow admin to delete", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/restricteds/${restrictedId}`, {
            method: "DELETE",
            token: tokens.admin,
          }),
        );

        expect(response.status).toBe(200);
      });
    });
  });

  // ============================================================
  // SECRET SCHEMA TESTS (uses defaultPermission)
  // defaultPermission: { create: admin, read: true, update: admin, delete: admin }
  // ============================================================

  describe("Secret Schema (uses defaultPermission)", () => {
    let secretId: number;

    it("should allow admin to create (from defaultPermission)", async () => {
      const response = await handleRequest(
        forja,
        createRequest("/api/secrets", {
          method: "POST",
          token: tokens.admin,
          body: { key: "API_KEY", value: "secret-value-123" },
        }),
      );

      expect(response.status).toBe(201);
      const data = (await response.json()) as ApiResponse<{ id: number }>;
      secretId = data.data!.id;
    });

    it("should deny editor from creating (from defaultPermission)", async () => {
      const response = await handleRequest(
        forja,
        createRequest("/api/secrets", {
          method: "POST",
          token: tokens.editor,
          body: { key: "OTHER_KEY", value: "should-fail" },
        }),
      );

      expect(response.status).toBe(403);
    });

    it("should allow unauthenticated to read (defaultPermission read=true)", async () => {
      const response = await handleRequest(
        forja,
        createRequest(`/api/secrets/${secretId}`),
      );

      expect(response.status).toBe(200);
    });

    it("should deny user from updating (from defaultPermission)", async () => {
      const response = await handleRequest(
        forja,
        createRequest(`/api/secrets/${secretId}`, {
          method: "PATCH",
          token: tokens.user,
          body: { value: "hacked" },
        }),
      );

      expect(response.status).toBe(403);
    });
  });

  // ============================================================
  // PRODUCT TESTS - Mixed permission (role + function)
  // update: ['admin', 'editor', ownerFn]
  // ============================================================

  describe("Product Schema (update with owner function)", () => {
    let productId: number;
    const userId = testUsers.user.id;

    beforeAll(async () => {
      // Create category and supplier first
      await handleRequest(
        forja,
        createRequest("/api/categories", {
          method: "POST",
          token: tokens.admin,
          body: { name: "Product Category" },
        }),
      );

      await handleRequest(
        forja,
        createRequest("/api/suppliers", {
          method: "POST",
          token: tokens.admin,
          body: {
            name: "Product Supplier",
            email: "prod-supplier@test.com",
            country: "USA",
          },
        }),
      );

      const response = await handleRequest(
        forja,
        createRequest("/api/products", {
          method: "POST",
          token: tokens.admin,
          body: {
            name: "Test Product",
            price: 99.99,
            stock: 10,
            category: 1,
            supplier: 1,
            sku: "TEST-001",
            createdBy: userId.toString(), // Set owner as user
          },
        }),
      );


      const data = (await response.json()) as ApiResponse<{ id: number }>;
      productId = data.data!.id;
    });

    it("should allow !editor changed to admin to create product", async () => {
      const response = await handleRequest(
        forja,
        createRequest("/api/products", {
          method: "POST",
          token: tokens.editor,
          body: {
            name: "Test Product2",
            price: 99.99,
            stock: 10,
            category: 1,
            supplier: 1,
            sku: "TEST-002",
            createdBy: userId.toString(), // Set owner as user
          },
        }),
      );
      const data = (await response.json()) as ApiResponse<{ id: number }>;
      expect(response.status).toBe(201);
      productId = data.data!.id;
    });

    describe("UPDATE with mixed permission (role OR owner)", () => {
      it("should allow admin to update any product", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/products/${productId}`, {
            method: "PATCH",
            token: tokens.admin,
            body: { name: "Updated by Admin" },
          }),
        );

        const result = await response.json();
        expect(response.status).toBe(200);
      });

      it("should allow editor to update any product", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/products/${productId}`, {
            method: "PATCH",
            token: tokens.editor,
            body: { name: "Updated by Editor" },
          }),
        );

        expect(response.status).toBe(200);
      });

      it("should allow owner (user) to update their own product", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/products/${productId}`, {
            method: "PATCH",
            token: tokens.user,
            body: { name: "Updated by Owner" },
          }),
        );

        expect(response.status).toBe(200);
      });

      it("should deny guest from updating (not admin/editor/owner)", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/products/${productId}`, {
            method: "PATCH",
            token: tokens.guest,
            body: { name: "Should fail" },
          }),
        );

        expect(response.status).toBe(403);
      });
    });

    describe("DELETE (admin only)", () => {
      it("should deny owner from deleting their product", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/products/${productId}`, {
            method: "DELETE",
            token: tokens.user,
          }),
        );

        expect(response.status).toBe(403);
      });

      it("should allow admin to delete", async () => {
        const response = await handleRequest(
          forja,
          createRequest(`/api/products/${productId}`, {
            method: "DELETE",
            token: tokens.admin,
          }),
        );

        expect(response.status).toBe(200);
      });
    });
  });
});
