// @ts-nocheck
/**
 * Query Operators Integration Tests
 *
 * Comprehensive tests for ALL query operators:
 * - Comparison: $eq, $ne, $gt, $gte, $lt, $lte
 * - String: $contains, $notContains, $startsWith, $endsWith, $like, $ilike
 * - Array: $in, $nin
 * - Null: $null, $notNull
 * - Logical: $and, $or, $not
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import { handleRequest } from "../src/helper";
import { createTestConfig, getTmpDir, testSchemas } from "./data";
import { serializeQuery } from "../src/serializer/query";
import fs from "node:fs/promises";

describe("Query Operators Integration Tests", () => {
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

    // Seed test data
    await seedTestData();
  });

  afterAll(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (error) {
      console.warn("Failed to clean up temp directory:", error);
    }
  });

  /**
   * Seed test data for operator tests
   */
  async function seedTestData(): Promise<void> {
    // Create categories
    await handleRequest(
      forja,
      new Request("http://localhost:3000/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Electronics",
          description: "Electronic devices",
          isActive: true,
        }),
      }),
    );

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
      new Request("http://localhost:3000/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Clothing",
          description: null,
          isActive: false,
        }),
      }),
    );

    // Create suppliers
    await handleRequest(
      forja,
      new Request("http://localhost:3000/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "TechCorp Inc.",
          email: "contact@techcorp.com",
          country: "USA",
          rating: 4.5,
          isVerified: true,
        }),
      }),
    );

    await handleRequest(
      forja,
      new Request("http://localhost:3000/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "BookWorld Ltd.",
          email: "info@bookworld.com",
          country: "UK",
          rating: 4.8,
          isVerified: true,
        }),
      }),
    );

    await handleRequest(
      forja,
      new Request("http://localhost:3000/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Fashion House",
          email: "sales@fashionhouse.com",
          country: "France",
          rating: 3.2,
          isVerified: false,
        }),
      }),
    );

    // Create products with diverse data
    const products = [
      {
        name: "Wireless Mouse",
        description: "Ergonomic wireless mouse",
        price: 29.99,
        stock: 150,
        category: 1,
        supplier: 1,
        sku: "WM-2024-001",
        isAvailable: true,
        tags: ["wireless", "computer", "accessories"],
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
        name: "TypeScript Handbook",
        description: "Complete guide to TypeScript",
        price: 45.0,
        stock: 20,
        category: 2,
        supplier: 2,
        sku: "BOOK-TS-001",
        isAvailable: true,
        tags: ["programming", "typescript", "book"],
      },
      {
        name: "JavaScript Gue",
        description: "Modern JavaScript programming",
        price: 38.0,
        stock: 15,
        category: 2,
        supplier: 2,
        sku: "BOOK-JS-001",
        isAvailable: false,
        tags: ["programming", "javascript", "book"],
      },
      {
        name: "Cotton T-Shirt",
        description: null,
        price: 19.99,
        stock: 0,
        category: 3,
        supplier: 3,
        sku: "CLOTH-TS-001",
        isAvailable: false,
        tags: [],
      },
      {
        name: "Premium Headphones",
        description: "Noise-cancelling headphones",
        price: 299.99,
        stock: 8,
        category: 1,
        supplier: 1,
        sku: "HP-PRO-001",
        isAvailable: true,
        tags: ["audio", "premium", "wireless"],
      },
      {
        name: "000123",
        description: "Product with numeric-looking name",
        price: 9.99,
        stock: 10,
        category: 1,
        supplier: 1,
        sku: "NUM-NAME-001",
        isAvailable: true,
        tags: ["test"],
      },
    ];

    for (const product of products) {
      const result = await handleRequest(
        forja,
        new Request("http://localhost:3000/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(product),
        }),
      );
      console.log(await result.json());
    }
  }

  /**
   * Helper function to execute query and return data
   */
  async function queryProducts(
    where: Record<string, unknown>,
    populate?: PopulateOptions,
  ): Promise<unknown[]> {
    const query = { where, populate };
    const serialized = serializeQuery(query);
    const queryParams = new URLSearchParams(serialized as Record<string, string>);

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
    console.log({ query: where, response: JSON.stringify(data.data, null, 2) });
    return data.data;
  }

  // ============================================================================
  // COMPARISON OPERATORS
  // ============================================================================

  describe("Comparison Operators", () => {
    describe("$eq - Equal", () => {
      it("should find products with exact price match", async () => {
        const results = await queryProducts({ price: { $eq: 29.99 } });
        expect(results).toHaveLength(1);
        expect(results[0]).toHaveProperty("name", "Wireless Mouse");
      });

      it("should find products with exact string match", async () => {
        const results = await queryProducts({ name: { $eq: "USB Cable" } });
        expect(results).toHaveLength(1);
        expect(results[0]).toHaveProperty("sku", "CABLE-USBC-001");
      });

      it("should find products with exact boolean match", async () => {
        const results = await queryProducts({ isAvailable: { $eq: false } });
        expect(results.length).toBeGreaterThanOrEqual(2);
        expect(results.every((p) => p.isAvailable === false)).toBe(true);
      });

      it("should return empty array when no match found", async () => {
        const results = await queryProducts({ price: { $eq: 999.99 } });
        expect(results).toHaveLength(0);
      });
    });

    describe("$ne - Not Equal", () => {
      it("should find products where price is not equal", async () => {
        const results = await queryProducts({ price: { $ne: 29.99 } });
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.price !== 29.99)).toBe(true);
      });

      it("should find products where boolean is not equal", async () => {
        const results = await queryProducts({ isAvailable: { $ne: true } });
        expect(results.every((p) => p.isAvailable === false)).toBe(true);
      });

      it("should exclude specific category", async () => {
        const results = await queryProducts({ category: { $ne: 1 } });
        expect(results.every((p) => p.category !== 1)).toBe(true);
      });
    });

    describe("$gt - Greater Than", () => {
      it("should find products with price greater than 100", async () => {
        const results = await queryProducts({ price: { $gt: 100 } });
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.price > 100)).toBe(true);
      });

      it("should find products with stock greater than 50", async () => {
        const results = await queryProducts({ stock: { $gt: 50 } });
        expect(results.every((p) => p.stock > 50)).toBe(true);
      });

      it("should return empty array when no match", async () => {
        const results = await queryProducts({ price: { $gt: 1000 } });
        expect(results).toHaveLength(0);
      });
    });

    describe("$gte - Greater Than or Equal", () => {
      it("should find products with price >= 100", async () => {
        const results = await queryProducts({ price: { $gte: 120 } });
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.price >= 120)).toBe(true);
      });

      it("should include exact match", async () => {
        const results = await queryProducts({ price: { $gte: 29.99 } });
        expect(results.some((p) => p.price === 29.99)).toBe(true);
      });

      it("should find products with stock >= 0 (including zero)", async () => {
        const results = await queryProducts({ stock: { $gte: 0 } });
        expect(results.length).toBe(8); // All products
      });
    });

    describe("$lt - Less Than", () => {
      it("should find products with price less than 50", async () => {
        const results = await queryProducts({ price: { $lt: 50 } });
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.price < 50)).toBe(true);
      });

      it("should find products with low stock", async () => {
        const results = await queryProducts({ stock: { $lt: 10 } });
        expect(results.every((p) => p.stock < 10)).toBe(true);
      });
    });

    describe("$lte - Less Than or Equal", () => {
      it("should find products with price <= 30", async () => {
        const results = await queryProducts({ price: { $lte: 30 } });
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.price <= 30)).toBe(true);
      });

      it("should include exact match", async () => {
        const results = await queryProducts({ price: { $lte: 29.99 } });
        expect(results.some((p) => p.price === 29.99)).toBe(true);
      });
    });
  });

  // ============================================================================
  // STRING OPERATORS
  // ============================================================================

  describe("String Operators", () => {
    describe("$contains - String Contains", () => {
      it('should find products with name containing "Script"', async () => {
        const results = await queryProducts({ name: { $contains: "Script" } });
        expect(results.length).toBeGreaterThan(0);
        expect(
          results.every(
            (p) => typeof p.name === "string" && p.name.includes("Script"),
          ),
        ).toBe(true);
      });

      it('should find products with description containing "USB"', async () => {
        const results = await queryProducts({ description: { $contains: "USB" } });
        expect(results.length).toBeGreaterThan(0);
        expect(
          results.every(
            (p) => typeof p.description === "string" && p.description.includes("USB"),
          ),
        ).toBe(true);
      });

      it("should return empty when substring not found", async () => {
        const results = await queryProducts({ name: { $contains: "NonExistent" } });
        expect(results).toHaveLength(0);
      });
    });

    describe("$notContains - String Does Not Contain", () => {
      it('should find products NOT containing "Keyboard"', async () => {
        const results = await queryProducts({ name: { $notContains: "Keyboard" } });
        expect(results.length).toBeGreaterThan(0);
        expect(
          results.every(
            (p) => typeof p.name === "string" && !p.name.includes("Keyboard"),
          ),
        ).toBe(true);
      });

      it("should exclude products with specific substring", async () => {
        const results = await queryProducts({
          description: { $notContains: "wireless" },
        });
        expect(
          results.every(
            (p) =>
              p.description === null ||
              !p.description.toLowerCase().includes("wireless"),
          ),
        ).toBe(true);
      });
    });

    describe("$startsWith - String Starts With", () => {
      it('should find products with name starting with "Type"', async () => {
        const results = await queryProducts({ name: { $startsWith: "Type" } });
        expect(results.length).toBeGreaterThan(0);
        expect(
          results.every(
            (p) => typeof p.name === "string" && p.name.startsWith("Type"),
          ),
        ).toBe(true);
      });

      it('should find products with SKU starting with "BOOK-"', async () => {
        const results = await queryProducts({ sku: { $startsWith: "BOOK-" } });
        expect(results.length).toBe(2);
        expect(results.every((p) => p.sku.startsWith("BOOK-"))).toBe(true);
      });

      it("should return empty when no match", async () => {
        const results = await queryProducts({ name: { $startsWith: "XYZ" } });
        expect(results).toHaveLength(0);
      });
    });

    describe("$endsWith - String Ends With", () => {
      it('should find products with name ending with "Mouse"', async () => {
        const results = await queryProducts({ name: { $endsWith: "Mouse" } });
        expect(results.length).toBe(1);
        expect(results[0]).toHaveProperty("name", "Wireless Mouse");
      });

      it('should find products with SKU ending with "-001"', async () => {
        const results = await queryProducts({ sku: { $endsWith: "-001" } });
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.sku.endsWith("-001"))).toBe(true);
      });
    });

    describe("$like - SQL LIKE Pattern", () => {
      it('should find products matching pattern "%book%"', async () => {
        const results = await queryProducts({ name: { $like: "%book%" } });
        expect(results.length).toBeGreaterThan(0);
      });

      it('should find products matching pattern "USB%"', async () => {
        const results = await queryProducts({ name: { $like: "USB%" } });
        expect(results.length).toBe(1);
        expect(results[0]).toHaveProperty("name", "USB Cable");
      });

      it('should support single character wildcard "_"', async () => {
        const results = await queryProducts({ sku: { $like: "BOOK-_S-001" } });
        expect(results.length).toBe(2);
      });
    });

    describe("$ilike - Case-Insensitive LIKE", () => {
      it("should find products matching pattern case-insensitively", async () => {
        const results = await queryProducts({ name: { $ilike: "%book%" } });
        expect(results.length).toBeGreaterThan(0);
        expect(
          results.every(
            (p) =>
              typeof p.name === "string" && p.name.toLowerCase().includes("book"),
          ),
        ).toBe(true);
      });

      it("should match regardless of case", async () => {
        const results1 = await queryProducts({ name: { $ilike: "%KEYBOARD%" } });
        const results2 = await queryProducts({ name: { $ilike: "%keyboard%" } });
        const results3 = await queryProducts({ name: { $ilike: "%Keyboard%" } });

        expect(results1.length).toBe(results2.length);
        expect(results2.length).toBe(results3.length);
      });
    });
  });

  // ============================================================================
  // ARRAY OPERATORS
  // ============================================================================

  describe("Array Operators", () => {
    describe("$in - Value In Array", () => {
      it("should find products with price in array", async () => {
        const results = await queryProducts({
          price: { $in: [29.99, 45.0, 120.0] },
        });
        expect(results.length).toBe(3);
        expect(results.every((p) => [29.99, 45.0, 120.0].includes(p.price))).toBe(
          true,
        );
      });

      it.fails("should find products with categoryId in array", async () => {
        const results = await queryProducts({ category: { $in: [1, 2] } });
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => [1, 2].includes(p.category))).toBe(true);
      });

      it("should find products with name in array", async () => {
        const results = await queryProducts({
          name: { $in: ["USB Cable", "Wireless Mouse"] },
        });
        expect(results.length).toBe(2);
      });

      it("should return empty when no values match", async () => {
        const results = await queryProducts({ price: { $in: [999, 1000, 1001] } });
        expect(results).toHaveLength(0);
      });

      it.fails("should handle single value in array", async () => {
        const results = await queryProducts({ category: { $in: [1] } });
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.category === 1)).toBe(true);
      });

      it("should handle numeric-looking strings in $in array", async () => {
        // '000123' looks like a number but should stay as string
        const results = await queryProducts({
          name: { $in: ["000123", "USB Cable"] },
        });
        expect(results.length).toBe(2);
        expect(results.some((p) => p.name === "000123")).toBe(true);
        expect(results.some((p) => p.name === "USB Cable")).toBe(true);
      });
    });

    describe("$nin - Value Not In Array", () => {
      it("should find products with price not in array", async () => {
        const results = await queryProducts({ price: { $nin: [29.99, 45.0] } });
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => ![29.99, 45.0].includes(p.price))).toBe(true);
      });

      it.fails("should exclude multiple categories", async () => {
        const results = await queryProducts({ category: { $nin: [1, 3] } });
        expect(results.every((p) => p.category === 2)).toBe(true);
      });

      it("should exclude specific products by name", async () => {
        const results = await queryProducts({
          name: { $nin: ["USB Cable", "Cotton T-Shirt"] },
        });
        expect(
          results.every(
            (p) => p.name !== "USB Cable" && p.name !== "Cotton T-Shirt",
          ),
        ).toBe(true);
      });
    });
  });

  // ============================================================================
  // NULL OPERATORS
  // ============================================================================

  describe("Null Operators", () => {
    describe("$null - Is Null", () => {
      it("should find products with null description", async () => {
        const results = await queryProducts({ description: { $null: true } });
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.description === null)).toBe(true);
      });

      it("should find products with non-null description using $null: false", async () => {
        const results = await queryProducts({ description: { $null: false } });
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.description !== null)).toBe(true);
      });
    });

    describe("$notNull - Is Not Null", () => {
      it("should find products with non-null description", async () => {
        const results = await queryProducts({ description: { $notNull: true } });
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.description !== null)).toBe(true);
      });

      it("should find products with null description using $notNull: false", async () => {
        const results = await queryProducts({ description: { $notNull: false } });
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.description === null)).toBe(true);
      });
    });
  });

  // ============================================================================
  // LOGICAL OPERATORS
  // ============================================================================

  describe("Logical Operators", () => {
    describe("$and - Logical AND", () => {
      it("should find products matching all conditions", async () => {
        const results = await queryProducts({
          $and: [
            { price: { $gte: 20 } },
            { price: { $lte: 50 } },
            { isAvailable: true },
          ],
        });
        expect(results.length).toBeGreaterThan(0);
        expect(
          results.every(
            (p) => p.price >= 20 && p.price <= 50 && p.isAvailable === true,
          ),
        ).toBe(true);
      });

      it("should combine multiple field conditions", async () => {
        const results = await queryProducts({
          $and: [{ category: 1 }, { stock: { $gt: 100 } }],
        });
        expect(results.every((p) => p.category === 1 && p.stock > 100)).toBe(true);
      });

      it("should return empty when conditions conflict", async () => {
        const results = await queryProducts({
          $and: [{ price: { $gt: 100 } }, { price: { $lt: 50 } }],
        });
        expect(results).toHaveLength(0);
      });
    });

    describe("$or - Logical OR", () => {
      it("should find products matching any condition", async () => {
        const results = await queryProducts({
          $or: [{ price: { $lt: 20 } }, { price: { $gt: 200 } }],
        });
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.price < 20 || p.price > 200)).toBe(true);
      });

      it("should combine different fields", async () => {
        const results = await queryProducts({
          $or: [{ category: 2 }, { stock: { $eq: 0 } }],
        });
        expect(results.every((p) => p.category === 2 || p.stock === 0)).toBe(true);
      });

      it("should handle multiple OR conditions", async () => {
        const results = await queryProducts({
          $or: [
            { name: { $contains: "Book" } },
            { name: { $contains: "Cable" } },
            { name: { $contains: "Mouse" } },
          ],
        });
        expect(results.length).toBeGreaterThan(0);
      });
    });

    describe("$not - Logical NOT", () => {
      it("should exclude products matching condition", async () => {
        const results = await queryProducts({
          $not: { category: 1 },  // $not takes single object, not array
        });
        expect(results.every((p) => p.category !== 1)).toBe(true);
      });

      it("should negate complex conditions", async () => {
        const results = await queryProducts({
          $not: {  // $not takes single object, not array
            $and: [{ price: { $gte: 100 } }, { stock: { $lte: 10 } }],
          },
        });
        expect(results.every((p) => !(p.price >= 100 && p.stock <= 10))).toBe(true);
      });
    });

    describe("Complex Logical Combinations", () => {
      it("should handle nested $and inside $or", async () => {
        const results = await queryProducts({
          $or: [
            {
              $and: [{ price: { $gte: 100 } }, { stock: { $lte: 10 } }],
            },
            {
              $and: [{ price: { $lte: 20 } }, { stock: { $gte: 100 } }],
            },
          ],
        });
        expect(results.length).toBeGreaterThan(0);
        expect(
          results.every(
            (p) =>
              (p.price >= 100 && p.stock <= 10) || (p.price <= 20 && p.stock >= 100),
          ),
        ).toBe(true);
      });

      it("should handle $or inside $and", async () => {
        const results = await queryProducts({
          $and: [
            { isAvailable: true },
            {
              $or: [{ category: 1 }, { category: 2 }],
            },
          ],
        });
        expect(
          results.every(
            (p) => p.isAvailable === true && (p.category === 1 || p.category === 2),
          ),
        ).toBe(true);
      });

      it("should handle triple nested logic", async () => {
        const results = await queryProducts({
          $or: [
            {
              $and: [
                { category: 1 },
                {
                  $or: [{ price: { $lt: 30 } }, { price: { $gt: 200 } }],
                },
              ],
            },
            { stock: 0 },
          ],
        });
        expect(results.length).toBeGreaterThan(0);
      });
    });
  });

  // ============================================================================
  // OPERATOR COMBINATIONS
  // ============================================================================

  describe("Operator Combinations", () => {
    it("should combine comparison with string operators", async () => {
      const results = await queryProducts({
        $and: [{ price: { $gte: 20 } }, { name: { $contains: "Book" } }],
      });
      expect(results.every((p) => p.price >= 20 && p.name.includes("Book"))).toBe(
        true,
      );
    });

    it("should combine array with comparison operators", async () => {
      const results = await queryProducts({
        $and: [{ category: { $in: [1, 2] } }, { price: { $lte: 50 } }],
      });
      expect(
        results.every((p) => [1, 2].includes(p.category) && p.price <= 50),
      ).toBe(true);
    });

    it("should combine null with other operators", async () => {
      const results = await queryProducts({
        $and: [{ description: { $notNull: true } }, { price: { $lt: 100 } }],
      });
      expect(results.every((p) => p.description !== null && p.price < 100)).toBe(
        true,
      );
    });

    it("should use multiple operators on same field", async () => {
      const results = await queryProducts({
        price: {
          $gte: 20,
          $lte: 100,
        },
      });
      expect(results.every((p) => p.price >= 20 && p.price <= 100)).toBe(true);
    });

    it("should combine all operator types", async () => {
      const results = await queryProducts({
        $and: [
          { price: { $gte: 15, $lte: 50 } },
          { name: { $notContains: "Premium" } },
          { category: { $in: [1, 2] } },
          { description: { $notNull: true } },
          {
            $or: [{ stock: { $gte: 10 } }, { isAvailable: false }],
          },
        ],
      });
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // ============================================================================
  // NESTED RELATION WHERE (NEW FEATURE)
  // ============================================================================

  describe("Nested Relation WHERE Queries", () => {
    describe("Basic Relation WHERE", () => {
      it("should filter products by category name", async () => {
        const results = await queryProducts(
          {
            category: { name: { $eq: "Electronics" } }, // Filter by related category name
          },
          {
            category: "*", // Populate to verify
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.category.name === "Electronics")).toBe(true);
      });

      it("should filter products by supplier country", async () => {
        const results = await queryProducts(
          {
            supplier: { country: { $eq: "USA" } },
          },
          {
            supplier: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.supplier.country === "USA")).toBe(true);
      });

      it("should filter products by supplier rating", async () => {
        const results = await queryProducts(
          {
            supplier: { rating: { $gte: 4.5 } },
          },
          {
            supplier: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.supplier.rating >= 4.5)).toBe(true);
      });

      it("should filter products by category isActive status", async () => {
        const results = await queryProducts(
          {
            category: { isActive: { $eq: false } },
          },
          {
            category: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.category.isActive === false)).toBe(true);
      });

      it("should filter products by supplier verification status", async () => {
        const results = await queryProducts(
          {
            supplier: { isVerified: { $eq: false } },
          },
          {
            supplier: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.supplier.isVerified === false)).toBe(true);
      });
    });

    describe("Relation WHERE with String Operators", () => {
      it("should use $like on relation field", async () => {
        const results = await queryProducts(
          {
            category: { name: { $like: "%Book%" } },
          },
          {
            category: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.category.name.includes("Book"))).toBe(true);
      });

      it("should use $contains on relation field", async () => {
        const results = await queryProducts(
          {
            supplier: { name: { $contains: "Tech" } },
          },
          {
            supplier: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.supplier.name.includes("Tech"))).toBe(true);
      });

      it("should use $startsWith on relation field", async () => {
        const results = await queryProducts(
          {
            supplier: { name: { $startsWith: "Book" } },
          },
          {
            supplier: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.supplier.name.startsWith("Book"))).toBe(true);
      });
    });

    describe("Relation WHERE with Comparison Operators", () => {
      it("should use $gt on relation numeric field", async () => {
        const results = await queryProducts(
          {
            supplier: { rating: { $gt: 4.0 } },
          },
          {
            supplier: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.supplier.rating > 4.0)).toBe(true);
      });

      it("should use $lt on relation numeric field", async () => {
        const results = await queryProducts(
          {
            supplier: { rating: { $lt: 4.0 } },
          },
          {
            supplier: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.supplier.rating < 4.0)).toBe(true);
      });

      it("should use $ne on relation field", async () => {
        const results = await queryProducts(
          {
            category: { name: { $ne: "Electronics" } },
          },
          {
            category: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.category.name !== "Electronics")).toBe(true);
      });
    });

    describe("Relation WHERE with Null Operators", () => {
      it("should use $notNull on relation field", async () => {
        const results = await queryProducts(
          {
            category: { description: { $notNull: true } },
          },
          {
            category: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.category.description !== null)).toBe(true);
      });

      it("should use $null on relation field", async () => {
        const results = await queryProducts(
          {
            category: { description: { $null: true } },
          },
          {
            category: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.category.description === null)).toBe(true);
      });
    });

    describe("Complex Relation WHERE Combinations", () => {
      it("should combine relation WHERE with scalar WHERE using $and", async () => {
        const results = await queryProducts(
          {
            $and: [
              { price: { $gte: 100 } },
              { supplier: { isVerified: { $eq: true } } },
            ],
          },
          {
            supplier: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(
          results.every((p) => p.price >= 100 && p.supplier.isVerified === true),
        ).toBe(true);
      });

      it("should combine multiple relation WHEREs", async () => {
        const results = await queryProducts(
          {
            $and: [
              { category: { isActive: { $eq: true } } },
              { supplier: { isVerified: { $eq: true } } },
            ],
          },
          {
            category: "*",
            supplier: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(
          results.every(
            (p) => p.category.isActive === true && p.supplier.isVerified === true,
          ),
        ).toBe(true);
      });

      it("should use $or with relation WHERE", async () => {
        const results = await queryProducts(
          {
            $or: [
              { supplier: { country: { $eq: "USA" } } },
              { supplier: { country: { $eq: "UK" } } },
            ],
          },
          {
            supplier: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(
          results.every((p) => ["USA", "UK"].includes(p.supplier.country)),
        ).toBe(true);
      });

      it("should use $not with relation WHERE", async () => {
        const results = await queryProducts(
          {
            $not: { category: { name: { $eq: "Electronics" } } },
          },
          {
            category: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.category.name !== "Electronics")).toBe(true);
      });

      it("should combine relation WHERE with complex logical operators", async () => {
        const results = await queryProducts(
          {
            $and: [
              {
                $or: [
                  { category: { name: { $eq: "Electronics" } } },
                  { category: { name: { $eq: "Books" } } },
                ],
              },
              {
                $and: [
                  { price: { $gte: 20 } },
                  { supplier: { isVerified: { $eq: true } } },
                ],
              },
            ],
          },
          {
            category: "*",
            supplier: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(
          results.every(
            (p) =>
              ["Electronics", "Books"].includes(p.category.name) &&
              p.price >= 20 &&
              p.supplier.isVerified === true,
          ),
        ).toBe(true);
      });

      it("should handle relation WHERE with multiple operators on same relation", async () => {
        const results = await queryProducts(
          {
            supplier: {
              $and: [
                { rating: { $gte: 4.0 } },
                { isVerified: { $eq: true } },
                { country: { $ne: "France" } },
              ],
            },
          },
          {
            supplier: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(
          results.every(
            (p) =>
              p.supplier.rating >= 4.0 &&
              p.supplier.isVerified === true &&
              p.supplier.country !== "France",
          ),
        ).toBe(true);
      });
    });

    describe("Edge Cases", () => {
      it("should return empty when relation condition doesn't match", async () => {
        const results = await queryProducts({
          category: { name: { $eq: "NonExistentCategory" } },
        });
        expect(results).toHaveLength(0);
      });

      it("should handle null relation gracefully", async () => {
        // Test that existing products with valid relations work
        const results = await queryProducts(
          {
            category: { isActive: { $eq: true } },
          },
          {
            category: "*",
          },
        );
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((p) => p.category.isActive === true)).toBe(true);
      });

      it("should combine scalar and relation WHERE with same field name patterns", async () => {
        const results = await queryProducts(
          {
            $and: [
              { isAvailable: { $eq: true } },
              { category: { isActive: { $eq: true } } },
            ],
          },
          {
            category: "*",
          },
        );
        expect(results.length).toBeGreaterThan(0);
        expect(
          results.every(
            (p) => p.isAvailable === true && p.category.isActive === true,
          ),
        ).toBe(true);
      });
    });
  });
});
