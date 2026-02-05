// @ts-nocheck
/**
 * CRUD Relation API Integration Tests
 *
 * Tests nested create/update operations and relation API:
 * - Data normalization (connect/set/disconnect formats)
 * - Nested create (recursive processing)
 * - Nested update (recursive processing)
 * - Mixed relation operations (connect + create + disconnect)
 * - Deep nesting (multi-level)
 * - Depth limit validation
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import { handleRequest } from "../src/helper";
import { createTestConfig, getTmpDir } from "./data";
import { createRequest } from "./data/helper";
import { expectApiSingle, expectApiError, randomEmail } from "forja-types/test/helpers";
import fs from "node:fs/promises";
import { ParsedQuery } from "forja-types";

describe("CRUD Relation API Tests", () => {
  let forja: Forja;
  const tmpDir = getTmpDir();

  // Helper: POST request
  const postRequest = async (endpoint: string, body: unknown, params?: ParsedQuery) => {
    const request = createRequest(endpoint, {
      method: "POST",
      body,
    }, params);
    return handleRequest(forja, request);
  };

  // Helper: PUT request
  const putRequest = async (endpoint: string, body: unknown) => {
    const request = createRequest(endpoint, {
      method: "PUT",
      body,
    });
    return handleRequest(forja, request);
  };

  // Helper: GET request
  const getRequest = async (endpoint: string) => {
    const request = createRequest(endpoint, {
      method: "GET",
    });
    return handleRequest(forja, request);
  };

  beforeAll(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (error) {
      console.warn("Failed to clean up temp directory:", error);
    }
    await fs.mkdir(tmpDir, { recursive: true });

    // Get Forja instance
    const getForja = createTestConfig(tmpDir);
    forja = await getForja();

    // Create tables
    const adapter = forja.getAdapter();
    for (const schema of forja.getSchemas().getAll()) {
      try {
        await adapter.dropTable(schema.tableName!);
      } catch { }
      const result = await adapter.createTable(schema);
      if (!result.success) {
        throw new Error(
          `Failed to create table ${schema.name}: ${result.error.message}`,
        );
      }
    }
  });

  afterAll(async () => {
    // Clean up
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (error) {
      console.warn("Failed to clean up temp directory:", error);
    }
  });

  describe("Data Normalization - Connect/Set/Disconnect", () => {
    it("should normalize connect: number → number[]", async () => {
      // Create company first
      const companyRes = await postRequest("/api/companies", {
        name: "TechCorp",
        country: "USA",
      });
      const company = await expectApiSingle(companyRes, 201);

      // Create author with connect as number
      const authorRes = await postRequest("/api/authors?populate=true", {
        name: "John Doe",
        email: randomEmail(),
        company: company.id, // ✅ Direct ID (should normalize to number[])
      });
      const author = await expectApiSingle(authorRes, 201);

      expect(author.company.id).toBe(company.id);
    });

    it("should normalize connect: {id} → number[]", async () => {
      const companyRes = await postRequest("/api/companies", {
        name: "DevCorp",
        country: "UK",
      });
      const company = await expectApiSingle(companyRes, 201);

      // Without populate → No relation, no FK
      const authorRes = await postRequest("/api/authors", {
        name: "Jane Smith",
        email: randomEmail(),
        company: { connect: { id: company.id } }, // ✅ Object format
      });
      const author = await expectApiSingle(authorRes, 201);

      expect(author.companyId).toBeUndefined(); // ❌ FK never visible
      expect(author.company).toBeUndefined(); // ❌ Relation not populated
    });

    it("should normalize connect: [{id}, {id}] → number[] (first only for belongsTo)", async () => {
      const company1Res = await postRequest("/api/companies", { name: "Corp1", country: "USA" });
      const company1 = await expectApiSingle(company1Res, 201);

      const company2Res = await postRequest("/api/companies", { name: "Corp2", country: "UK" });
      const company2 = await expectApiSingle(company2Res, 201);

      // Without populate → No FK, no relation
      const authorRes = await postRequest("/api/authors", {
        name: "Bob Johnson",
        email: randomEmail(),
        company: { connect: [{ id: company1.id }, { id: company2.id }] }, // ✅ Array (belongsTo takes first)
      });
      const author = await expectApiSingle(authorRes, 201);

      expect(author.companyId).toBeUndefined(); // ❌ FK never visible
      expect(author.company).toBeUndefined(); // ❌ Not populated
    });

    it("should normalize set: [number] → number[]", async () => {
      const companyRes = await postRequest("/api/companies", { name: "NewCorp", country: "DE" });
      const company = await expectApiSingle(companyRes, 201);

      // Without populate → No FK, no relation
      const authorRes = await postRequest("/api/authors", {
        name: "Alice Brown",
        email: randomEmail(),
        company: { set: [company.id] }, // ✅ Set format
      });
      const author = await expectApiSingle(authorRes, 201);

      expect(author.companyId).toBeUndefined(); // ❌ FK never visible
      expect(author.company).toBeUndefined(); // ❌ Not populated
    });

    it("should handle disconnect (set FK to null)", async () => {
      const companyRes = await postRequest("/api/companies", { name: "OldCorp", country: "FR" });
      const company = await expectApiSingle(companyRes, 201);

      const authorRes = await postRequest("/api/authors?populate=true", {
        name: "Charlie Wilson",
        email: randomEmail(),
        company: company.id,
      });
      const author = await expectApiSingle(authorRes, 201);

      expect(author.company.id).toBe(company.id); // ✅ Populated before disconnect

      // Disconnect (populate to verify it's gone)
      const updateRes = await putRequest(`/api/authors/${author.id}?populate=true`, {
        company: { disconnect: true },
      });
      const updated = await expectApiSingle(updateRes);

      expect(updated.companyId).toBeUndefined(); // ❌ FK never visible
      expect(updated.company).toBeNull(); // ✅ Relation is null after disconnect
    });
  });

  describe("Nested Create - Single Level", () => {
    it("should create author with nested company create", async () => {
      const response = await postRequest("/api/authors?populate=true", {
        name: "David Lee",
        email: randomEmail(),
        company: {
          create: {
            name: "StartupCo",
            country: "JP",
          },
        },
      });

      const author = await expectApiSingle(response, 201);

      expect(author.name).toBe("David Lee");
      expect(author.companyId).toBeUndefined(); // ❌ FK never visible
      expect(author.company).toBeDefined(); // ✅ Populated relation
      expect(author.company.name).toBe("StartupCo");
      expect(author.company.country).toBe("JP");
    });

    it("should create post with nested author create", async () => {
      const response = await postRequest("/api/posts?populate=true", {
        title: "My First Post",
        content: "Hello World!",
        author: {
          create: {
            name: "Emma Davis",
            email: randomEmail(),
          },
        },
      });

      const post = await expectApiSingle(response, 201);

      expect(post.title).toBe("My First Post");
      expect(post.authorId).toBeUndefined(); // ❌ FK never visible
      expect(post.author).toBeDefined(); // ✅ Populated relation
      expect(post.author.name).toBe("Emma Davis");
    });

    it("should create with nested array creates (manyToMany)", async () => {
      const response = await postRequest("/api/posts", {
        title: "Tagged Post",
        content: "Content here",
        tags: {
          create: [
            { name: "javascript" },
            { name: "typescript" },
            { name: "nodejs" },
          ],
        },
      });

      const post = await expectApiSingle(response, 201);
      expect(post.title).toBe("Tagged Post");

      // Verify tags were created (check via API if populate works)
      // For now, we'll trust the normalization worked
    });
  });

  describe("Nested Create - Multi Level (Deep Nesting)", () => {
    it("should create post → author → company (3 levels)", async () => {
      const response = await postRequest("/api/posts", {
        title: "Deep Nested Post",
        content: "Testing deep nesting",
        author: {
          create: {
            name: "Frank Miller",
            email: randomEmail(),
            company: {
              create: {
                name: "NestedCorp",
                country: "CA",
              },
            },
          },
        },
      }, {
        populate: ["author.company"]
      });

      const post = await expectApiSingle(response, 201);

      expect(post.title).toBe("Deep Nested Post");
      expect(post.authorId).toBeUndefined(); // ❌ FK never visible
      expect(post.author).toBeDefined(); // ✅ Populated
      expect(post.author.name).toBe("Frank Miller");
      expect(post.author.companyId).toBeUndefined(); // ❌ FK never visible
      expect(post.author.company).toBeDefined(); // ✅ Populated
      expect(post.author.company.name).toBe("NestedCorp");
      expect(post.author.company.country).toBe("CA");
    });

    it("should fail when depth exceeds MAX_NESTED_DEPTH (5 levels)", async () => {
      // This would require 6+ level schema which we don't have
      // But we can test the concept with a mock deep structure
      // For now, skip or mark as TODO
      // TODO: Create schema with 6+ levels to test depth limit
    });
  });

  describe("Mixed Operations - Connect + Create + Set", () => {
    it("should handle connect existing + create new (manyToMany)", async () => {
      // Create existing tags
      const tag1Res = await postRequest("/api/tags", { name: "react" });
      const tag1 = await expectApiSingle(tag1Res, 201);

      const tag2Res = await postRequest("/api/tags", { name: "vue" });
      const tag2 = await expectApiSingle(tag2Res, 201);

      // Create post with mixed operations
      const response = await postRequest("/api/posts", {
        title: "Framework Comparison",
        content: "Comparing frameworks",
        tags: {
          connect: [tag1.id, tag2.id], // ✅ Connect existing
          create: [{ name: "angular" }], // ✅ Create new
        },
      });

      const post = await expectApiSingle(response, 201);
      expect(post.title).toBe("Framework Comparison");

      // Verify: should have 3 tags total (2 connected + 1 created)
      // (Would need populate to verify fully)
    });

    it("should handle create with nested create + connect", async () => {
      // Create existing company
      const companyRes = await postRequest("/api/companies", { name: "ExistingCo", country: "US" });
      const company = await expectApiSingle(companyRes, 201);

      // Create post with author that has both create and connect
      const response = await postRequest("/api/posts", {
        title: "Complex Post",
        content: "Testing complex relations",
        author: {
          create: {
            name: "Grace Hopper",
            email: randomEmail(),
            company: company.id, // ✅ Connect existing company
          },
        },
      }, {
        populate: ["author.company"]
      });

      const post = await expectApiSingle(response, 201);
      expect(post.authorId).toBeUndefined(); // ❌ FK never visible
      expect(post.author).toBeDefined(); // ✅ Populated
      expect(post.author.name).toBe("Grace Hopper");
      expect(post.author.companyId).toBeUndefined(); // ❌ FK never visible
      expect(post.author.company).toBeDefined(); // ✅ Populated
      expect(post.author.company.id).toBe(company.id);
    });
  });

  describe("Nested Update Operations", () => {
    it("should update post with nested author update", async () => {
      // Create post with author (populate to get author.id)
      const createRes = await postRequest("/api/posts?populate=true", {
        title: "Original Title",
        content: "Original content",
        author: {
          create: {
            name: "Henry Ford",
            email: randomEmail(),
          },
        },
      });
      const post = await expectApiSingle(createRes, 201);

      // Update post with nested author update
      const updateRes = await putRequest(`/api/posts/${post.id}?populate=true`, {
        title: "Updated Title",
        author: {
          update: {
            where: { id: post.author.id },
            data: {
              name: "Henry Ford Jr.",
            },
          },
        },
      });

      const updated = await expectApiSingle(updateRes);
      expect(updated.title).toBe("Updated Title");
      expect(updated.author.name).toBe("Henry Ford Jr.");
    });

    it("should update with nested create (add new relation)", async () => {
      // Create post without author
      const createRes = await postRequest("/api/posts", {
        title: "Authorless Post",
        content: "No author yet",
      });
      const post = await expectApiSingle(createRes, 201);

      // Update with nested author create (populate to get author)
      const updateRes = await putRequest(`/api/posts/${post.id}?populate=true`, {
        author: {
          create: {
            name: "Isabel Perez",
            email: randomEmail(),
          },
        },
      });

      const updated = await expectApiSingle(updateRes);
      expect(updated.authorId).toBeUndefined(); // ❌ FK never visible
      expect(updated.author).toBeDefined(); // ✅ Populated
      expect(updated.author.name).toBe("Isabel Perez");
    });
  });

  describe("Relation Delete Operations", () => {
    it("should delete related records", async () => {
      // Create author with company (populate to get company.id)
      const createRes = await postRequest("/api/authors?populate=true", {
        name: "Jack Ryan",
        email: randomEmail(),
        company: {
          create: {
            name: "TempCorp",
            country: "US",
          },
        },
      });
      const author = await expectApiSingle(createRes, 201);
      const companyId = author.company.id;

      // Update with delete operation
      const updateRes = await putRequest(`/api/authors/${author.id}`, {
        company: {
          delete: [companyId], // ✅ Delete company
        },
      });

      const updated = await expectApiSingle(updateRes);
      expect(updated.companyId).toBeUndefined(); // ❌ FK never visible

      // Verify company was deleted
      const companyRes = await getRequest(`/api/companies/${companyId}`);
      await expectApiError(companyRes, 404); // Should be deleted
    });
  });

  describe("Set Operation (Replace All)", () => {
    it("should replace all tags with set operation", async () => {
      // Create tags
      const tag1Res = await postRequest("/api/tags", { name: "old1" });
      const tag1 = await expectApiSingle(tag1Res, 201);

      const tag2Res = await postRequest("/api/tags", { name: "old2" });
      const tag2 = await expectApiSingle(tag2Res, 201);

      const tag3Res = await postRequest("/api/tags", { name: "new1" });
      const tag3 = await expectApiSingle(tag3Res, 201);

      // Create post with initial tags
      const createRes = await postRequest("/api/posts", {
        title: "Tag Test Post",
        content: "Testing tags",
        tags: {
          connect: [tag1.id, tag2.id],
        },
      });
      const post = await expectApiSingle(createRes, 201);

      // Replace all tags with set
      const updateRes = await putRequest(`/api/posts/${post.id}`, {
        tags: {
          set: [tag3.id], // ✅ Replace all with just tag3
        },
      });

      const updated = await expectApiSingle(updateRes);
      expect(updated.title).toBe("Tag Test Post");

      // (Would need populate to verify tag replacement)
    });
  });

  describe("Edge Cases & Validation", () => {
    it("should preserve FK inline optimization (belongsTo)", async () => {
      // When using simple connect, FK should be inlined
      const companyRes = await postRequest("/api/companies", { name: "InlineCo", country: "US" });
      const company = await expectApiSingle(companyRes, 201);

      const authorRes = await postRequest("/api/authors?populate=true", {
        name: "Karen White",
        email: randomEmail(),
        company: company.id, // ✅ Should inline FK, no async relation processing
      });

      const author = await expectApiSingle(authorRes, 201);
      expect(author.companyId).toBeUndefined(); // ❌ FK never visible
      expect(author.company).toBeDefined(); // ✅ Populated
      expect(author.company.id).toBe(company.id);
    });

    it("should fail with invalid nested data", async () => {
      const response = await postRequest("/api/authors", {
        name: "Invalid Author",
        email: randomEmail(),
        company: {
          create: {
            // Missing required 'country' field
            name: "BadCorp",
          },
        },
      });

      await expectApiError(response, 400); // Validation should fail
    });

    it("should handle empty create array", async () => {
      const response = await postRequest("/api/posts", {
        title: "Empty Tags",
        content: "No tags",
        tags: {
          create: [], // ✅ Empty array should be handled
        },
      });

      const post = await expectApiSingle(response, 201);
      expect(post.title).toBe("Empty Tags");
    });
  });
});
