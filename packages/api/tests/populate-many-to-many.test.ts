// @ts-nocheck
/**
 * ManyToMany Populate Integration Tests
 *
 * Tests comprehensive manyToMany relation scenarios:
 * - Junction table auto-generation
 * - Connect/disconnect/set operations
 * - Populate with junction table lookup
 * - Cascade delete for junction records
 * - Nested populate with manyToMany
 * - create/delete operations (not yet implemented)
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Forja } from "forja-core";
import { handleRequest } from "../src/helper";
import { createTestConfig, getTmpDir } from "./data";
import { expectApiSuccess } from "forja-types/test/helpers";
import fs from "node:fs/promises";

describe("ManyToMany Populate Integration Tests", () => {
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
   * Fixture: Reset database state before each test
   * Creates fresh data for isolated test scenarios
   */
  async function setupFixture() {
    // Create Tags
    const jsTag = await forja.create("tag", { name: "JavaScript" });
    const tsTag = await forja.create("tag", { name: "TypeScript" });
    const reactTag = await forja.create("tag", { name: "React" });
    const nodeTag = await forja.create("tag", { name: "Node.js" });

    // Create Authors
    const johnAuthor = await forja.create("author", {
      name: "John Doe",
      email: "john@example.com",
    });
    const janeAuthor = await forja.create("author", {
      name: "Jane Smith",
      email: "jane@example.com",
    });

    return {
      tags: { js: jsTag, ts: tsTag, react: reactTag, node: nodeTag },
      authors: { john: johnAuthor, jane: janeAuthor },
    };
  }

  describe("Connect Operation", () => {
    beforeEach(async () => {
      // Clear all data before each test
      await forja.deleteMany("post", {});
      await forja.deleteMany("tag", {});
      await forja.deleteMany("author", {});
    });

    it("should create post with connected tags (shortcut syntax)", async () => {
      const { tags, authors } = await setupFixture();

      const request = new Request(
        "http://localhost:3000/api/posts?populate[tags]=true",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Getting Started with TypeScript",
            content: "TypeScript is awesome!",
            author: authors.john.id,
            tags: [tags.js.id, tags.ts.id], // Shortcut: array of IDs
          }),
        },
      );

      const response = await handleRequest(forja, request);
      const post = await expectApiSuccess(response, 201);

      expect(post).toHaveProperty("tags");
      expect(post.tags).toHaveLength(2);
      expect(post.tags.map((t) => t.name)).toEqual(
        expect.arrayContaining(["JavaScript", "TypeScript"]),
      );
    });

    it("should create post with connect API", async () => {
      const { tags, authors } = await setupFixture();

      const request = new Request(
        "http://localhost:3000/api/posts?populate[tags]=true",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "React Best Practices",
            content: "Learn React patterns",
            author: authors.jane.id,
            tags: { connect: [tags.js.id, tags.react.id] }, // Explicit connect
          }),
        },
      );

      const response = await handleRequest(forja, request);
      const post = await expectApiSuccess(response, 201);

      expect(post.tags).toHaveLength(2);
      expect(post.tags.map((t) => t.name)).toEqual(
        expect.arrayContaining(["JavaScript", "React"]),
      );
    });

    it("should update post to add new tags (connect)", async () => {
      const { tags, authors } = await setupFixture();

      // Create post with JS tag
      const createReq = new Request("http://localhost:3000/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Node.js Tutorial",
          content: "Learn backend development",
          author: authors.john.id,
          tags: [tags.node.id],
        }),
      });
      const createRes = await handleRequest(forja, createReq);
      const createdPost = await expectApiSuccess(createRes, 201);

      // Update: add TS and JS tags
      const updateReq = new Request(
        `http://localhost:3000/api/posts/${createdPost.id}?populate[tags]=true`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tags: { connect: [tags.js.id, tags.ts.id] },
          }),
        },
      );

      const updateRes = await handleRequest(forja, updateReq);
      const updatedPost = await expectApiSuccess(updateRes);

      expect(updatedPost.tags).toHaveLength(3); // node + js + ts
      expect(updatedPost.tags.map((t) => t.name)).toEqual(
        expect.arrayContaining(["Node.js", "JavaScript", "TypeScript"]),
      );
    });
  });

  describe("Disconnect Operation", () => {
    beforeEach(async () => {
      await forja.deleteMany("post", {});
      await forja.deleteMany("tag", {});
      await forja.deleteMany("author", {});
    });

    it("should remove specific tags from post", async () => {
      const { tags, authors } = await setupFixture();

      // Create post with 3 tags
      const createReq = new Request("http://localhost:3000/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Full Stack Development",
          content: "Frontend and Backend",
          author: authors.john.id,
          tags: [tags.js.id, tags.ts.id, tags.react.id],
        }),
      });
      const createRes = await handleRequest(forja, createReq);
      const createdPost = await expectApiSuccess(createRes, 201);

      // Disconnect JS and React tags
      const updateReq = new Request(
        `http://localhost:3000/api/posts/${createdPost.id}?populate[tags]=true`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tags: { disconnect: [tags.js.id, tags.react.id] },
          }),
        },
      );

      const updateRes = await handleRequest(forja, updateReq);
      const updatedPost = await expectApiSuccess(updateRes);

      expect(updatedPost.tags).toHaveLength(1);
      expect(updatedPost.tags[0].name).toBe("TypeScript");
    });

    it("should handle disconnect all tags", async () => {
      const { tags, authors } = await setupFixture();

      // Create post with tags
      const createReq = new Request("http://localhost:3000/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Test Post",
          content: "Content",
          author: authors.jane.id,
          tags: [tags.js.id, tags.ts.id],
        }),
      });
      const createRes = await handleRequest(forja, createReq);
      const createdPost = await expectApiSuccess(createRes, 201);

      // Disconnect all tags
      const updateReq = new Request(
        `http://localhost:3000/api/posts/${createdPost.id}?populate[tags]=true`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tags: { disconnect: [tags.js.id, tags.ts.id] },
          }),
        },
      );

      const updateRes = await handleRequest(forja, updateReq);
      const updatedPost = await expectApiSuccess(updateRes);

      expect(updatedPost.tags).toHaveLength(0);
    });
  });

  describe("Set Operation", () => {
    beforeEach(async () => {
      await forja.deleteMany("post", {});
      await forja.deleteMany("tag", {});
      await forja.deleteMany("author", {});
    });

    it("should replace all tags with new set", async () => {
      const { tags, authors } = await setupFixture();

      // Create post with JS and TS tags
      const createReq = new Request("http://localhost:3000/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "JavaScript Basics",
          content: "Learn JS",
          author: authors.john.id,
          tags: [tags.js.id, tags.ts.id],
        }),
      });
      const createRes = await handleRequest(forja, createReq);
      const createdPost = await expectApiSuccess(createRes, 201);

      // Set to React and Node tags (replace all)
      const updateReq = new Request(
        `http://localhost:3000/api/posts/${createdPost.id}?populate[tags]=true`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tags: { set: [tags.react.id, tags.node.id] },
          }),
        },
      );

      const updateRes = await handleRequest(forja, updateReq);
      const updatedPost = await expectApiSuccess(updateRes);

      expect(updatedPost.tags).toHaveLength(2);
      expect(updatedPost.tags.map((t) => t.name)).toEqual(
        expect.arrayContaining(["React", "Node.js"]),
      );
      expect(updatedPost.tags.map((t) => t.name)).not.toContain("JavaScript");
      expect(updatedPost.tags.map((t) => t.name)).not.toContain("TypeScript");
    });

    it("should set empty array to remove all tags", async () => {
      const { tags, authors } = await setupFixture();

      // Create post with tags
      const createReq = new Request("http://localhost:3000/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Test Post",
          content: "Content",
          author: authors.jane.id,
          tags: [tags.js.id, tags.react.id],
        }),
      });
      const createRes = await handleRequest(forja, createReq);
      const createdPost = await expectApiSuccess(createRes, 201);

      // Set to empty array
      const updateReq = new Request(
        `http://localhost:3000/api/posts/${createdPost.id}?populate[tags]=true`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tags: { set: [] },
          }),
        },
      );

      const updateRes = await handleRequest(forja, updateReq);
      const updatedPost = await expectApiSuccess(updateRes);

      expect(updatedPost.tags).toHaveLength(0);
    });
  });

  describe("Populate Operation", () => {
    beforeEach(async () => {
      await forja.deleteMany("post", {});
      await forja.deleteMany("tag", {});
      await forja.deleteMany("author", {});
    });

    it("should populate tags on post", async () => {
      const { tags, authors } = await setupFixture();

      // Create post with tags
      await forja.create("post", {
        title: "React Tutorial",
        content: "Learn React",
        author: authors.john.id,
        tags: [tags.js.id, tags.react.id],
      });

      const request = new Request(
        "http://localhost:3000/api/posts?populate[tags]=true",
        { method: "GET" },
      );

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].tags).toHaveLength(2);
      expect(data.data[0].tags.map((t) => t.name)).toEqual(
        expect.arrayContaining(["JavaScript", "React"]),
      );
    });

    it("should populate tags with select fields", async () => {
      const { tags, authors } = await setupFixture();

      await forja.create("post", {
        title: "Node.js Guide",
        content: "Backend development",
        author: authors.jane.id,
        tags: [tags.node.id, tags.ts.id],
      });

      const request = new Request(
        "http://localhost:3000/api/posts?populate[tags][fields][0]=id&populate[tags][fields][1]=name",
        { method: "GET" },
      );

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(200);
      const post = data.data[0];
      expect(post.tags).toHaveLength(2);

      // Should have selected fields + reserved fields
      post.tags.forEach((tag) => {
        expect(tag).toHaveProperty("id");
        expect(tag).toHaveProperty("name");
        expect(tag).toHaveProperty("createdAt"); // Reserved
        expect(tag).toHaveProperty("updatedAt"); // Reserved
      });
    });

    it("should populate posts without tags as empty array", async () => {
      const { authors } = await setupFixture();

      await forja.create("post", {
        title: "Untagged Post",
        content: "No tags",
        author: authors.john.id,
      });

      const request = new Request(
        "http://localhost:3000/api/posts?populate[tags]=true",
        { method: "GET" },
      );

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data[0].tags).toEqual([]);
    });
  });

  describe("Cascade Delete", () => {
    beforeEach(async () => {
      await forja.deleteMany("post", {});
      await forja.deleteMany("tag", {});
      await forja.deleteMany("author", {});
    });

    it("should delete junction records when post is deleted", async () => {
      const { tags, authors } = await setupFixture();

      // Create post with tags
      const createReq = new Request("http://localhost:3000/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Test Post",
          content: "Content",
          author: authors.john.id,
          tags: [tags.js.id, tags.ts.id],
        }),
      });
      const createRes = await handleRequest(forja, createReq);
      const createdPost = await expectApiSuccess(createRes, 201);

      // Verify junction table has records
      const junctionBefore = await forja
        .getAdapter()
        .getCachedTable("post_tag");
      expect(junctionBefore?.data).toHaveLength(2);

      // Delete post
      const deleteReq = new Request(
        `http://localhost:3000/api/posts/${createdPost.id}`,
        { method: "DELETE" },
      );
      await handleRequest(forja, deleteReq);

      // Verify junction records are deleted
      const junctionAfter = await forja.getAdapter().getCachedTable("post_tag");
      expect(junctionAfter?.data).toHaveLength(0);

      // Tags should still exist
      const tagsAfter = await forja.findMany("tag", {});
      expect(tagsAfter).toHaveLength(4);
    });

    it("should delete multiple junction records with deleteMany", async () => {
      const { tags, authors } = await setupFixture();

      // Create 2 posts with tags
      await forja.create("post", {
        title: "Post 1",
        content: "Content 1",
        author: authors.john.id,
        tags: [tags.js.id, tags.react.id],
      });
      await forja.create("post", {
        title: "Post 2",
        content: "Content 2",
        author: authors.john.id,
        tags: [tags.ts.id, tags.node.id],
      });

      // Verify junction table
      const junctionBefore = await forja
        .getAdapter()
        .getCachedTable("post_tag");
      expect(junctionBefore?.data).toHaveLength(4); // 2 posts × 2 tags

      // Delete all posts by author
      await forja.deleteMany("post", { author: authors.john.id });

      // Verify junction records are deleted
      const junctionAfter = await forja.getAdapter().getCachedTable("post_tag");
      expect(junctionAfter?.data).toHaveLength(0);
    });
  });

  describe("Create/Delete Operations (Not Implemented)", () => {
    beforeEach(async () => {
      await forja.deleteMany("post", {});
      await forja.deleteMany("tag", {});
      await forja.deleteMany("author", {});
    });

    it.fails("should create new tags and connect them to post", async () => {
      const { authors } = await setupFixture();

      const request = new Request(
        "http://localhost:3000/api/posts?populate[tags]=true",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "New Post",
            content: "Content",
            author: authors.john.id,
            tags: {
              create: [{ name: "Vue.js" }, { name: "Angular" }],
            },
          }),
        },
      );

      const response = await handleRequest(forja, request);
      const post = await expectApiSuccess(response, 201);

      expect(post.tags).toHaveLength(2);
      expect(post.tags.map((t) => t.name)).toEqual(
        expect.arrayContaining(["Vue.js", "Angular"]),
      );
    });

    it.fails("should delete tags when disconnecting with delete option", async () => {
      const { tags, authors } = await setupFixture();

      // Create post with tags
      const createReq = new Request("http://localhost:3000/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Test Post",
          content: "Content",
          author: authors.john.id,
          tags: [tags.js.id, tags.ts.id],
        }),
      });
      const createRes = await handleRequest(forja, createReq);
      const createdPost = await expectApiSuccess(createRes, 201);

      // Delete tags (removes from junction AND deletes the tag record)
      const updateReq = new Request(
        `http://localhost:3000/api/posts/${createdPost.id}?populate[tags]=true`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tags: { delete: [tags.js.id] },
          }),
        },
      );

      const updateRes = await handleRequest(forja, updateReq);
      const updatedPost = await expectApiSuccess(updateRes);

      expect(updatedPost.tags).toHaveLength(1);
      expect(updatedPost.tags[0].name).toBe("TypeScript");

      // Verify tag is deleted from database
      const allTags = await forja.findMany("tag", {});
      expect(allTags).toHaveLength(3); // 4 - 1 deleted
      expect(allTags.map((t) => t.name)).not.toContain("JavaScript");
    });
  });

  describe("Edge Cases", () => {
    beforeEach(async () => {
      await forja.deleteMany("post", {});
      await forja.deleteMany("tag", {});
      await forja.deleteMany("author", {});
    });

    it("should handle multiple operations in single update", async () => {
      const { tags, authors } = await setupFixture();

      // Create post with JS and TS tags
      const createReq = new Request("http://localhost:3000/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Test Post",
          content: "Content",
          author: authors.john.id,
          tags: [tags.js.id, tags.ts.id],
        }),
      });
      const createRes = await handleRequest(forja, createReq);
      const createdPost = await expectApiSuccess(createRes, 201);

      // Connect React, disconnect JS (should have: TS, React)
      const updateReq = new Request(
        `http://localhost:3000/api/posts/${createdPost.id}?populate[tags]=true`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tags: {
              connect: [tags.react.id],
              disconnect: [tags.js.id],
            },
          }),
        },
      );

      const updateRes = await handleRequest(forja, updateReq);
      const updatedPost = await expectApiSuccess(updateRes);

      expect(updatedPost.tags).toHaveLength(2);
      expect(updatedPost.tags.map((t) => t.name)).toEqual(
        expect.arrayContaining(["TypeScript", "React"]),
      );
      expect(updatedPost.tags.map((t) => t.name)).not.toContain("JavaScript");
    });

    it("should not include junction foreign keys in response", async () => {
      const { tags, authors } = await setupFixture();

      const request = new Request(
        "http://localhost:3000/api/posts?populate[tags]=true",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Test Post",
            content: "Content",
            author: authors.john.id,
            tags: [tags.js.id],
          }),
        },
      );

      const response = await handleRequest(forja, request);
      const post = await expectApiSuccess(response, 201);

      // Post should not have tagId field (junction FK)
      expect(post).not.toHaveProperty("tagId");
      expect(post).not.toHaveProperty("postId");

      // Tags should not have postId field
      post.tags.forEach((tag) => {
        expect(tag).not.toHaveProperty("postId");
      });
    });
  });
});
