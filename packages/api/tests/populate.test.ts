// @ts-nocheck
/**
 * Populate Integration Tests
 *
 * Tests advanced populate scenarios including:
 * - Foreign key exclusion
 * - Select + populate combinations
 * - Nested populate with select
 * - Reserved fields in populated relations
 * - Deep nested populate (3+ levels)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import { handleRequest } from "../src/helper";
import { createTestConfig, getTmpDir } from "./data";
import { serializeQuery } from "../src/serializer/query";
import fs from "node:fs/promises";

describe("Populate Integration Tests", () => {
  let forja: Forja;
  let getForja: () => Promise<Forja>;
  const tmpDir = getTmpDir();
  let testProductId: number;

  beforeAll(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (error) {
      console.warn("Failed to clean up temp directory:", error);
    }
    // Create temporary directory
    await fs.mkdir(tmpDir, { recursive: true });

    // Get Forja factory function
    getForja = createTestConfig(tmpDir);

    // Get Forja instance (this will initialize everything)
    forja = await getForja();

    // Create tables manually for JsonAdapter
    const adapter = forja.getAdapter();
    for (const schema of forja.getSchemas().getAll()) {
      try {
        await adapter.dropTable(schema.tableName!)
      } catch { }
      const result = await adapter.createTable(schema);
      if (!result.success) {
        throw new Error(
          `Failed to create table ${schema.name}: ${result.error.message}`,
        );
      }
    }

    // Create fixture data for tests
    await forja.create("category", {
      name: "Electronics",
      description: "Electronic devices and gadgets",
      isActive: true,
    });

    await forja.create("supplier", {
      name: "TechCorp Inc.",
      email: "contact@techcorp.com",
      country: "USA",
      rating: 4.5,
      isVerified: true,
    });

    // Create test product
    const product = await forja.create("product", {
      name: "Gaming Headset",
      description: "7.1 Surround Sound Gaming Headset",
      price: 89.99,
      stock: 50,
      category: 1,
      supplier: 1,
      sku: "GH-PRO-001",
      isAvailable: true,
    });

    testProductId = product.id;
  });

  afterAll(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (error) {
      console.warn("Failed to clean up temp directory:", error);
    }
  });

  describe("Basic Populate", () => {
    it("should populate relations with all fields", async () => {
      const request = new Request(
        `http://localhost:3000/api/products/${testProductId}?populate[category]=true&populate[supplier]=true`,
        {
          method: "GET",
        },
      );

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveProperty("category");
      expect(data.data.category).toHaveProperty("id");
      expect(data.data.category).toHaveProperty("name");
      expect(data.data.category).toHaveProperty("description");

      expect(data.data).toHaveProperty("supplier");
      expect(data.data.supplier).toHaveProperty("id");
      expect(data.data.supplier).toHaveProperty("name");
    });

    it("should create product with populate option", async () => {
      const request = new Request(
        "http://localhost:3000/api/products?populate[category]=true&populate[supplier]=true",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "Monitor",
            description: "27-inch 4K monitor",
            price: 399.99,
            stock: 25,
            category: 1,
            supplier: 1,
            sku: "MON-2024-001",
            isAvailable: true,
          }),
        },
      );

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data).toHaveProperty("category");
      expect(data.data.category).toHaveProperty("id");
      expect(data.data.category).toHaveProperty("name");
      expect(data.data.category.id).toBe(1);

      expect(data.data).toHaveProperty("supplier");
      expect(data.data.supplier).toHaveProperty("id");
      expect(data.data.supplier).toHaveProperty("name");
      expect(data.data.supplier.id).toBe(1);
    });
  });

  describe("Foreign Key Exclusion", () => {
    it("should NOT include foreign keys in response when populate is used", async () => {
      const request = new Request(
        `http://localhost:3000/api/products/${testProductId}?populate[category]=true&populate[supplier]=true`,
        {
          method: "GET",
        },
      );

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(200);

      // Foreign keys should NOT be in response
      expect(data.data).not.toHaveProperty("categoryId");
      expect(data.data).not.toHaveProperty("supplierId");

      // But populated relations should be there
      expect(data.data).toHaveProperty("category");
      expect(data.data).toHaveProperty("supplier");
    });

    it("should NOT include foreign keys even with select=*", async () => {
      const request = new Request(
        `http://localhost:3000/api/products/${testProductId}?fields=*&populate[category]=true`,
        {
          method: "GET",
        },
      );

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(200);

      // Foreign key should NOT be visible
      expect(data.data).not.toHaveProperty("categoryId");

      // Populated relation should be there
      expect(data.data).toHaveProperty("category");
    });
  });

  describe("Select + Populate Combination", () => {
    it("should apply select to main entity while preserving populated fields", async () => {
      const request = new Request(
        `http://localhost:3000/api/products/${testProductId}?fields[0]=id&fields[1]=name&populate[category]=true`,
        {
          method: "GET",
        },
      );

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(200);

      // Only selected fields + reserved fields
      expect(data.data).toHaveProperty("id");
      expect(data.data).toHaveProperty("name");
      expect(data.data).toHaveProperty("createdAt"); // Reserved field
      expect(data.data).toHaveProperty("updatedAt"); // Reserved field

      // Non-selected fields should NOT be there
      expect(data.data).not.toHaveProperty("description");
      expect(data.data).not.toHaveProperty("price");
      expect(data.data).not.toHaveProperty("stock");

      // Populated field should be preserved
      expect(data.data).toHaveProperty("category");
      expect(data.data.category).toHaveProperty("id");
      expect(data.data.category).toHaveProperty("name");
    });

    it("should create product with both select and populate options", async () => {
      const request = new Request(
        "http://localhost:3000/api/products?fields[0]=id&fields[1]=name&fields[2]=price&populate[category][fields][0]=id&populate[category][fields][1]=name",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "Webcam",
            description: "1080p HD webcam",
            price: 59.99,
            stock: 100,
            category: 1,
            supplier: 1,
            sku: "WC-2024-001",
            isAvailable: true,
          }),
        },
      );

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(201);

      // Should only have selected fields + reserved fields
      expect(data.data).toHaveProperty("id");
      expect(data.data).toHaveProperty("name");
      expect(data.data).toHaveProperty("price");
      expect(data.data).toHaveProperty("createdAt");
      expect(data.data).toHaveProperty("updatedAt");

      // Should not have non-selected fields
      expect(data.data).not.toHaveProperty("description");
      expect(data.data).not.toHaveProperty("stock");

      // Check populated category with selected fields only
      expect(data.data).toHaveProperty("category");
      expect(data.data.category).toHaveProperty("id");
      expect(data.data.category).toHaveProperty("name");
      expect(data.data.category).not.toHaveProperty("description");
      expect(data.data.category).not.toHaveProperty("isActive");
    });
  });

  describe("Reserved Fields in Populated Relations", () => {
    it("should always include reserved fields (id, createdAt, updatedAt) in populated relations even with select", async () => {
      const query = {
        populate: {
          category: {
            select: ["name"],
          },
        },
      };

      const serialized = serializeQuery(query);
      const queryParams = new URLSearchParams(
        serialized as Record<string, string>,
      );

      const request = new Request(
        `http://localhost:3000/api/products/${testProductId}?${queryParams}`,
        {
          method: "GET",
        },
      );

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveProperty("category");

      // Reserved fields should ALWAYS be present
      expect(data.data.category).toHaveProperty("id");
      expect(data.data.category).toHaveProperty("createdAt");
      expect(data.data.category).toHaveProperty("updatedAt");

      // User-selected field
      expect(data.data.category).toHaveProperty("name");

      // Non-selected fields should NOT be there
      expect(data.data.category).not.toHaveProperty("description");
      expect(data.data.category).not.toHaveProperty("isActive");
    });

    it("should include reserved fields in nested populate with select", async () => {
      const query = {
        populate: {
          category: {
            select: ["id", "name", "description"],
          },
          supplier: {
            select: ["name", "country"],
          },
        },
      };

      const serialized = serializeQuery(query);
      const queryParams = new URLSearchParams(
        serialized as Record<string, string>,
      );

      const request = new Request(
        `http://localhost:3000/api/products/${testProductId}?${queryParams}`,
        {
          method: "GET",
        },
      );

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(200);

      // Category - reserved fields + selected fields
      expect(data.data.category).toHaveProperty("id");
      expect(data.data.category).toHaveProperty("createdAt");
      expect(data.data.category).toHaveProperty("updatedAt");
      expect(data.data.category).toHaveProperty("name");
      expect(data.data.category).toHaveProperty("description");
      expect(data.data.category).not.toHaveProperty("isActive");

      // Supplier - reserved fields + selected fields
      expect(data.data.supplier).toHaveProperty("id");
      expect(data.data.supplier).toHaveProperty("createdAt");
      expect(data.data.supplier).toHaveProperty("updatedAt");
      expect(data.data.supplier).toHaveProperty("name");
      expect(data.data.supplier).toHaveProperty("country");
      expect(data.data.supplier).not.toHaveProperty("email");
      expect(data.data.supplier).not.toHaveProperty("rating");
    });
  });

  describe("Populate with Select Options", () => {
    it("should populate with selected fields (Level 1 - 3 fields)", async () => {
      const query = {
        populate: {
          category: {
            select: ["id", "name", "description"],
          },
        },
      };

      const serialized = serializeQuery(query);
      const queryParams = new URLSearchParams(
        serialized as Record<string, string>,
      );

      const request = new Request(
        `http://localhost:3000/api/products/${testProductId}?${queryParams}`,
        {
          method: "GET",
        },
      );

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("category");
      expect(data.data.category).toHaveProperty("id");
      expect(data.data.category).toHaveProperty("name");
      expect(data.data.category).toHaveProperty("description");
      expect(data.data.category).toHaveProperty("createdAt"); // Reserved field
      expect(data.data.category).toHaveProperty("updatedAt"); // Reserved field
      expect(data.data.category).not.toHaveProperty("isActive");
    });

    it("should populate nested relations (Level 2 - full first level, 3 fields second level)", async () => {
      const query = {
        populate: {
          category: {
            select: "*",
          },
          supplier: {
            select: ["id", "name", "country"],
          },
        },
      };

      const serialized = serializeQuery(query);
      const queryParams = new URLSearchParams(
        serialized as Record<string, string>,
      );

      const request = new Request(
        `http://localhost:3000/api/products/${testProductId}?${queryParams}`,
        {
          method: "GET",
        },
      );

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("data");

      expect(data.data).toHaveProperty("category");
      expect(data.data.category).toHaveProperty("id");
      expect(data.data.category).toHaveProperty("name");
      expect(data.data.category).toHaveProperty("description");
      expect(data.data.category).toHaveProperty("isActive");

      expect(data.data).toHaveProperty("supplier");
      expect(data.data.supplier).toHaveProperty("id");
      expect(data.data.supplier).toHaveProperty("name");
      expect(data.data.supplier).toHaveProperty("country");
      expect(data.data.supplier).toHaveProperty("createdAt"); // Reserved field
      expect(data.data.supplier).toHaveProperty("updatedAt"); // Reserved field
      expect(data.data.supplier).not.toHaveProperty("email");
      expect(data.data.supplier).not.toHaveProperty("rating");
      expect(data.data.supplier).not.toHaveProperty("isVerified");
    });
  });

  describe("Edge Cases", () => {
    it("should handle select on main entity with multiple populated relations", async () => {
      const request = new Request(
        `http://localhost:3000/api/products/${testProductId}?fields[0]=id&fields[1]=name&populate[category]=true&populate[supplier]=true`,
        {
          method: "GET",
        },
      );

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(200);

      // Main entity - only selected fields + reserved
      expect(data.data).toHaveProperty("id");
      expect(data.data).toHaveProperty("name");
      expect(data.data).toHaveProperty("createdAt");
      expect(data.data).toHaveProperty("updatedAt");
      expect(data.data).not.toHaveProperty("description");
      expect(data.data).not.toHaveProperty("price");

      // Both populated relations should be present
      expect(data.data).toHaveProperty("category");
      expect(data.data).toHaveProperty("supplier");

      // Foreign keys should NOT be present
      expect(data.data).not.toHaveProperty("categoryId");
      expect(data.data).not.toHaveProperty("supplierId");
    });
  });

  describe("Relation API (connect/disconnect/set)", () => {
    it("should create product with connect API", async () => {
      const request = new Request(
        "http://localhost:3000/api/products?populate[category]=true",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "Keyboard",
            description: "Mechanical keyboard",
            price: 129.99,
            stock: 30,
            category: { connect: { id: 1 } }, // Full API instead of shortcut
            supplier: { connect: { id: 1 } },
            sku: "KB-2024-001",
            isAvailable: true,
          }),
        },
      );

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data).toHaveProperty("category");
      expect(data.data.category.id).toBe(1);
      expect(data.data.category).toHaveProperty("name");
    });

    it("should update product relation using connect", async () => {
      // First create a product without category
      const createReq = new Request("http://localhost:3000/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Mouse",
          price: 49.99,
          stock: 50,
          sku: "MS-2024-001",
          isAvailable: true,
          category: { connect: { id: 1 } }, // Full API instead of shortcut
          supplier: { connect: { id: 1 } },
        }),
      });

      const createRes = await handleRequest(forja, createReq);
      const createData = await createRes.json();
      const productId = createData.data.id;

      // Now update with category using connect
      const updateReq = new Request(
        `http://localhost:3000/api/products/${productId}?populate[category]=true`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: { connect: { id: 1 } },
          }),
        },
      );

      const updateRes = await handleRequest(forja, updateReq);
      const updateData = await updateRes.json();

      expect(updateRes.status).toBe(200);
      expect(updateData.data).toHaveProperty("category");
      expect(updateData.data.category.id).toBe(1);
    });

    it("should update product relation using disconnect", async () => {
      // First create a product with category
      const createReq = new Request("http://localhost:3000/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Headset",
          price: 79.99,
          stock: 20,
          category: 1,
          supplier: { connect: { id: 1 } },
          sku: "HS-2024-001",
          isAvailable: true,
        }),
      });

      const createRes = await handleRequest(forja, createReq);
      const createData = await createRes.json();
      const productId = createData.data.id;

      // Now disconnect category
      const updateReq = new Request(
        `http://localhost:3000/api/products/${productId}?populate[category]=true`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: { disconnect: true },
          }),
        },
      );

      const updateRes = await handleRequest(forja, updateReq);
      const updateData = await updateRes.json();

      expect(updateRes.status).toBe(200);
      expect(updateData.data.category).toBeNull();
    });

    it("should update product relation using set", async () => {
      // Create a product with category 1
      const createReq = new Request("http://localhost:3000/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Speaker",
          price: 199.99,
          stock: 15,
          category: 1,
          supplier: { connect: { id: 1 } },
          sku: "SP-2024-001",
          isAvailable: true,
        }),
      });

      const createRes = await handleRequest(forja, createReq);
      const createData = await createRes.json();
      const productId = createData.data.id;

      // First create another category
      const catReq = new Request("http://localhost:3000/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Audio",
          description: "Audio equipment",
          isActive: true,
        }),
      });
      const catRes = await handleRequest(forja, catReq);
      const catData = await catRes.json();
      const newCategoryId = catData.data.id;

      // Now set to new category
      const updateReq = new Request(
        `http://localhost:3000/api/products/${productId}?populate[category]=true`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: { set: { id: newCategoryId } },
          }),
        },
      );

      const updateRes = await handleRequest(forja, updateReq);
      const updateData = await updateRes.json();

      expect(updateRes.status).toBe(200);
      expect(updateData.data).toHaveProperty("category");
      expect(updateData.data.category.id).toBe(newCategoryId);
      expect(updateData.data.category.name).toBe("Audio");
    });
  });
});
