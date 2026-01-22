// @ts-nocheck
/**
 * CRUD Integration Tests
 *
 * Tests the full stack: JsonAdapter + ApiPlugin + handleRequest
 * WITHOUT authentication
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import { handleRequest } from "../src/helper";
import { createTestConfig, getTmpDir } from "./data";
import { serializeQuery } from "../src/serializer/query";
import fs from "node:fs/promises";

describe("API CRUD Integration Tests", () => {
  let forja: Forja;
  let getForja: () => Promise<Forja>;
  const tmpDir = getTmpDir();

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
  });

  afterAll(async () => {
    // Disconnect
    if (forja) {
      //     await forja.disconnect();
    }

    // Clean up temporary directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (error) {
      console.warn("Failed to clean up temp directory:", error);
    }
  });

  describe("CREATE Operation", () => {
    it("should create a new category", async () => {
      const request = new Request("http://localhost:3000/api/categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Electronics 2",
          description: "Electronic devices and gadgets",
          isActive: true,
        }),
      });

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("id");
      expect(data.data.name).toBe("Electronics 2");
      expect(data.data.description).toBe("Electronic devices and gadgets");
      expect(data.data.isActive).toBe(true);
    });

    it("should create a new supplier", async () => {
      const request = new Request("http://localhost:3000/api/suppliers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "TechCorp Inc. 2",
          email: "contact2@techcorp.com",
          country: "USA",
          rating: 4.5,
          isVerified: true,
        }),
      });

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("id");
      expect(data.data.name).toBe("TechCorp Inc. 2");
      expect(data.data.email).toBe("contact2@techcorp.com");
      expect(data.data.country).toBe("USA");
      expect(data.data.rating).toBe(4.5);
      expect(data.data.isVerified).toBe(true);
    });

    it("should create a new product with relations", async () => {
      const request = new Request("http://localhost:3000/api/products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Wireless Mouse",
          description: "Ergonomic wireless mouse with 2.4GHz connectivity",
          price: 29.99,
          stock: 150,
          category: 1,
          supplier: 1,
          sku: "WM-2024-001",
          isAvailable: true,
          tags: ["wireless", "computer", "accessories"],
        }),
      });

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("id");
      expect(data.data.name).toBe("Wireless Mouse");
      expect(data.data.price).toBe(29.99);
      expect(data.data.stock).toBe(150);
      expect(data.data.sku).toBe("WM-2024-001");
      expect(data.data.tags).toEqual(["wireless", "computer", "accessories"]);
    });

    it("should fail to create product with invalid data (missing required field)", async () => {
      const request = new Request("http://localhost:3000/api/products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          description: "Product without name",
          price: 10.0,
          stock: 5,
        }),
      });

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toHaveProperty("error");
    });

    it("should fail to create category with duplicate name", async () => {
      // First create
      const request1 = new Request("http://localhost:3000/api/categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Unique Category",
          description: "First creation",
        }),
      });

      const response1 = await handleRequest(forja, request1);
      expect(response1.status).toBe(201);

      // Try duplicate
      const request2 = new Request("http://localhost:3000/api/categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Unique Category",
          description: "Duplicate attempt",
        }),
      });

      const response2 = await handleRequest(forja, request2);
      const data2 = await response2.json();

      expect(response2.status).toBe(400);
      expect(data2).toHaveProperty("error");
    });

    it("should create product with select fields option", async () => {
      const request = new Request(
        "http://localhost:3000/api/products?fields[0]=id&fields[1]=name&fields[2]=price",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "Keyboard",
            description: "Mechanical keyboard with RGB lighting",
            price: 79.99,
            stock: 50,
            category: 1,
            supplier: 1,
            sku: "KB-2024-001",
            isAvailable: true,
          }),
        },
      );

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data).toHaveProperty("data");

      // Should only have selected fields (plus reserved fields)
      expect(data.data).toHaveProperty("id");
      expect(data.data).toHaveProperty("name");
      expect(data.data).toHaveProperty("price");
      expect(data.data.name).toBe("Keyboard");
      expect(data.data.price).toBe(79.99);

      // Reserved fields always present
      expect(data.data).toHaveProperty("createdAt");
      expect(data.data).toHaveProperty("updatedAt");

      // Other fields should not be present
      expect(data.data).not.toHaveProperty("description");
      expect(data.data).not.toHaveProperty("stock");
      expect(data.data).not.toHaveProperty("sku");
    });
  });

  describe("COMPLEX QUERY Operations", () => {
    beforeAll(async () => {
      await handleRequest(
        forja,
        new Request("http://localhost:3000/api/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Books",
            description: "Books and literature",
            isActive: true,
          }),
        }),
      );

      await handleRequest(
        forja,
        new Request("http://localhost:3000/api/suppliers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "BookCorp Ltd.",
            email: "info@bookcorp.com",
            country: "UK",
            rating: 4.8,
            isVerified: true,
          }),
        }),
      );

      const products = [
        {
          name: "TypeScript Handbook",
          description: "Complete guide to TypeScript",
          price: 45.0,
          stock: 20,
          category: 3,
          supplier: 2,
          sku: "BOOK-TS-001",
          isAvailable: true,
          tags: ["programming", "typescript", "book"],
        },
        {
          name: "Mechanical Keyboard",
          description: "RGB mechanical keyboard",
          price: 120.0,
          stock: 5,
          category: 1,
          supplier: 1,
          sku: "KB-MECH-001",
          isAvailable: true,
          tags: ["gaming", "keyboard", "rgb"],
        },
        {
          name: "USB Cable",
          description: "USB-C to USB-C cable 2m",
          price: 15.0,
          stock: 200,
          category: 1,
          supplier: 1,
          sku: "CABLE-USBC-001",
          isAvailable: true,
          tags: ["cable", "usb", "accessories"],
        },
        {
          name: "JavaScript Guide",
          description: "Modern JavaScript programming",
          price: 38.0,
          stock: 15,
          category: 3,
          supplier: 2,
          sku: "BOOK-JS-001",
          isAvailable: false,
          tags: ["programming", "javascript", "book"],
        },
      ];

      for (const product of products) {
        await handleRequest(
          forja,
          new Request("http://localhost:3000/api/products", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(product),
          }),
        );
      }
    });

    it("should query products with AND/OR conditions", async () => {
      const query = {
        where: {
          $or: [
            {
              $and: [{ price: { $gte: 100 } }, { stock: { $lte: 10 } }],
            },
            {
              $and: [{ price: { $lte: 20 } }, { stock: { $gte: 100 } }],
            },
          ],
        },
      };

      const serialized = serializeQuery(query);
      const queryParams = new URLSearchParams(
        serialized as Record<string, string>,
      );

      const request = new Request(
        `http://localhost:3000/api/products?${queryParams}`,
        {
          method: "GET",
        },
      );

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("data");
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBe(2);

      for (const product of data.data) {
        const matchesFirstCondition = product.price >= 100 && product.stock <= 10;
        const matchesSecondCondition = product.price <= 20 && product.stock >= 100;
        expect(matchesFirstCondition || matchesSecondCondition).toBe(true);
      }
    });
  });
});
