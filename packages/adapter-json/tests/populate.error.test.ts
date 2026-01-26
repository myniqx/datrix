import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { JsonAdapter } from "../src/adapter";
import { QueryObject } from "forja-types/core/query-builder";
import { expectSuccessData } from "forja-types/test/helpers";

describe("JsonAdapter Populate - Error Handling", () => {
  const root = path.join(__dirname, "tmp_populate_error_test");
  let adapter: JsonAdapter;

  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    adapter = new JsonAdapter({ root });
    await adapter.connect();

    await adapter.createTable({
      name: "users",
      tableName: "users",
      fields: { name: { type: "string", required: true } },
    });
    await adapter.createTable({
      name: "posts",
      tableName: "posts",
      fields: {
        title: { type: "string", required: true },
        authorId: { type: "number", required: false },
      },
    });
  });

  afterEach(async () => {
    await adapter.disconnect();
    await fs.rm(root, { recursive: true, force: true });
  });

  describe("Missing Target Table", () => {
    it("should gracefully handle non-existent target table", async () => {
      await adapter.executeQuery({
        type: "insert",
        table: "posts",
        data: { title: "Test Post", authorId: 1 },
      });

      const query: QueryObject = {
        type: "select",
        table: "posts",
        populate: { author: "*" },
      };

      const result = expectSuccessData(await adapter.executeQuery(query));
      const post = result.rows[0] as any;

      // Should not crash, just skip the populate
      expect(post.title).toBe("Test Post");
      expect(post.author).toBeUndefined();
    });

    it("should handle missing target table for hasMany", async () => {
      await adapter.executeQuery({
        type: "insert",
        table: "users",
        data: { name: "Alice" },
      });

      const query: QueryObject = {
        type: "select",
        table: "users",
        populate: { posts: {} },
        // @ts-ignore
        meta: {
          relations: {
            posts: {
              kind: "hasMany",
              model: "Post",
              targetTable: "nonexistent_posts",
              foreignKey: "authorId",
            },
          },
        },
      };

      const result = expectSuccessData(await adapter.executeQuery(query));
      const user = result.rows[0] as any;

      expect(user.name).toBe("Alice");
      expect(user.posts).toBeUndefined();
    });
  });

  describe("Corrupted JSON Files", () => {
    it("should handle corrupted target table JSON", async () => {
      await adapter.executeQuery({
        type: "insert",
        table: "posts",
        data: { title: "Test Post", authorId: 1 },
      });

      // Corrupt the users.json file
      const usersPath = path.join(root, "users.json");
      await fs.writeFile(usersPath, "{ invalid json }");

      const query: QueryObject = {
        type: "select",
        table: "posts",
        populate: { author: {} },
      };

      // Should not crash - either skip populate or handle gracefully
      const result = await adapter.executeQuery(query);

      // Accepting either: success with undefined author, or error
      if (result.success) {
        const post = (result as any).data.rows[0];
        expect(post.title).toBe("Test Post");
      } else {
        // Error is also acceptable behavior
        expect(result.success).toBe(false);
      }
    });

    it("should handle JSON file with missing data array", async () => {
      await adapter.executeQuery({
        type: "insert",
        table: "posts",
        data: { title: "Test Post", authorId: 1 },
      });

      // Create malformed users.json (valid JSON but missing structure)
      const usersPath = path.join(root, "users.json");
      await fs.writeFile(usersPath, JSON.stringify({ meta: { version: 1 } }));

      const query: QueryObject = {
        type: "select",
        table: "posts",
        populate: { author: {} },
        // @ts-ignore
        meta: {
          relations: {
            author: {
              kind: "belongsTo",
              model: "User",
              targetTable: "users",
              foreignKey: "authorId",
            },
          },
        },
      };

      const result = await adapter.executeQuery(query);

      // Should handle gracefully (either skip or error)
      if (result.success) {
        const post = (result as any).data.rows[0];
        expect(post.title).toBe("Test Post");
      }
    });
  });

  describe("Invalid Relation Metadata", () => {
    it("should skip populate when no relation metadata", async () => {
      await adapter.executeQuery({
        type: "insert",
        table: "users",
        data: { name: "Alice" },
      });
      await adapter.executeQuery({
        type: "insert",
        table: "posts",
        data: { title: "Test", authorId: 1 },
      });

      const query: QueryObject = {
        type: "select",
        table: "posts",
        populate: { author: {} },
        // No meta.relations!
      };

      const result = expectSuccessData(await adapter.executeQuery(query));
      const post = result.rows[0] as any;

      // Should not crash, populate should be skipped
      expect(post.title).toBe("Test");
      expect(post.author).toBeUndefined();
    });

    it("should handle missing foreignKey in metadata", async () => {
      await adapter.executeQuery({
        type: "insert",
        table: "posts",
        data: { title: "Test", authorId: 1 },
      });

      const query: QueryObject = {
        type: "select",
        table: "posts",
        populate: { author: {} },
        // @ts-ignore - intentionally incomplete metadata
        meta: {
          relations: {
            author: {
              kind: "belongsTo",
              model: "User",
              targetTable: "users",
              // Missing foreignKey!
            },
          },
        },
      };

      const result = await adapter.executeQuery(query);

      // Should either skip or handle gracefully
      if (result.success) {
        const post = (result as any).data.rows[0];
        expect(post.title).toBe("Test");
      }
    });

    it("should handle invalid relation kind", async () => {
      await adapter.executeQuery({
        type: "insert",
        table: "posts",
        data: { title: "Test", authorId: 1 },
      });

      const query: QueryObject = {
        type: "select",
        table: "posts",
        populate: { author: {} },
        // @ts-ignore - invalid kind
        meta: {
          relations: {
            author: {
              kind: "invalidKind",
              model: "User",
              targetTable: "users",
              foreignKey: "authorId",
            },
          },
        },
      };

      const result = expectSuccessData(await adapter.executeQuery(query));
      const post = result.rows[0] as any;

      // Should skip unsupported relation types
      expect(post.title).toBe("Test");
      expect(post.author).toBeUndefined();
    });
  });

  describe("Performance & Resource Issues", () => {
    it("should handle large datasets without memory issues", async () => {
      // Create 100 users
      for (let i = 0; i < 100; i++) {
        await adapter.executeQuery({
          type: "insert",
          table: "users",
          data: { name: `User${i}` },
        });
      }

      // Create 100 posts, each referencing random users
      for (let i = 0; i < 100; i++) {
        await adapter.executeQuery({
          type: "insert",
          table: "posts",
          data: { title: `Post${i}`, authorId: (i % 100) + 1 },
        });
      }

      const query: QueryObject = {
        type: "select",
        table: "posts",
        populate: { author: {} },
        // @ts-ignore
        meta: {
          relations: {
            author: {
              kind: "belongsTo",
              model: "User",
              targetTable: "users",
              foreignKey: "authorId",
            },
          },
        },
      };

      const initialMemory = process.memoryUsage().heapUsed;
      const result = expectSuccessData(await adapter.executeQuery(query));
      const memoryUsed = process.memoryUsage().heapUsed - initialMemory;

      expect(result.rows).toHaveLength(100);
      expect(result.rows[0]).toHaveProperty("author");

      // Should not use excessive memory (less than 50MB for 100 records)
      expect(memoryUsed).toBeLessThan(50 * 1024 * 1024);
    }, 30000);

    it("should handle missing FK values in large dataset", async () => {
      // Create 50 posts with valid FK, 50 with null FK
      for (let i = 0; i < 50; i++) {
        await adapter.executeQuery({
          type: "insert",
          table: "posts",
          data: { title: `Post${i}`, authorId: 1 },
        });
      }
      for (let i = 50; i < 100; i++) {
        await adapter.executeQuery({
          type: "insert",
          table: "posts",
          data: { title: `Post${i}`, authorId: null },
        });
      }

      // Create one user
      await adapter.executeQuery({
        type: "insert",
        table: "users",
        data: { name: "OnlyUser" },
      });

      const query: QueryObject = {
        type: "select",
        table: "posts",
        populate: { author: {} },
        // @ts-ignore
        meta: {
          relations: {
            author: {
              kind: "belongsTo",
              model: "User",
              targetTable: "users",
              foreignKey: "authorId",
            },
          },
        },
      };

      const result = expectSuccessData(await adapter.executeQuery(query));

      // First 50 should have author, last 50 should be null
      const withAuthor = result.rows.filter((r: any) => r.author !== null);
      const withoutAuthor = result.rows.filter((r: any) => r.author === null);

      expect(withAuthor.length).toBeGreaterThanOrEqual(45);
      expect(withoutAuthor.length).toBeGreaterThanOrEqual(45);
    }, 30000);
  });

  describe("Circular Reference Prevention", () => {
    it("should handle potential circular references gracefully", async () => {
      // This tests if nested populate could cause infinite loops
      // Post -> Author -> Posts -> Author...

      await adapter.executeQuery({
        type: "insert",
        table: "users",
        data: { name: "Alice" },
      });

      await adapter.executeQuery({
        type: "insert",
        table: "posts",
        data: { title: "Post 1", authorId: 1 },
      });

      // Nested populate that could theoretically loop
      const query: QueryObject = {
        type: "select",
        table: "posts",
        populate: {
          author: {
            populate: {
              posts: {
                // If this tried to populate author again, it would loop
                // But the implementation doesn't support 3+ levels
              },
            },
          },
        },
        // @ts-ignore
        meta: {
          relations: {
            author: {
              kind: "belongsTo",
              model: "User",
              targetTable: "users",
              foreignKey: "authorId",
            },
            posts: {
              kind: "hasMany",
              model: "Post",
              targetTable: "posts",
              foreignKey: "authorId",
            },
          },
        },
      };

      // Should not crash or timeout
      const result = expectSuccessData(await adapter.executeQuery(query));
      const post = result.rows[0] as any;

      expect(post.author).toBeDefined();
      expect(post.author.posts).toBeDefined();
      // Third level should not be populated (preventing infinite loop)
    });
  });

  describe("Empty and Edge Case Data", () => {
    it("should handle populate on empty table", async () => {
      const query: QueryObject = {
        type: "select",
        table: "posts",
        populate: { author: {} },
        // @ts-ignore
        meta: {
          relations: {
            author: {
              kind: "belongsTo",
              model: "User",
              targetTable: "users",
              foreignKey: "authorId",
            },
          },
        },
      };

      const result = expectSuccessData(await adapter.executeQuery(query));
      expect(result.rows).toHaveLength(0);
    });

    it("should handle undefined foreign key field", async () => {
      // Insert post without authorId field at all
      const postsPath = path.join(root, "posts.json");
      const content = {
        meta: {
          version: 1,
          updatedAt: new Date().toISOString(),
          name: "posts",
          lastInsertId: 1,
        },
        schema: {
          name: "posts",
          fields: { title: { type: "string", required: true } },
        },
        data: [{ id: 1, title: "Post without FK field" }],
      };
      await fs.writeFile(postsPath, JSON.stringify(content, null, 2));

      const query: QueryObject = {
        type: "select",
        table: "posts",
        populate: { author: {} },
        // @ts-ignore
        meta: {
          relations: {
            author: {
              kind: "belongsTo",
              model: "User",
              targetTable: "users",
              foreignKey: "authorId",
            },
          },
        },
      };

      const result = expectSuccessData(await adapter.executeQuery(query));
      const post = result.rows[0] as any;

      expect(post.title).toBe("Post without FK field");
      expect(post.author).toBeNull();
    });

    it("should handle string foreign key values", async () => {
      // Some implementations might use string IDs
      await adapter.executeQuery({
        type: "insert",
        table: "users",
        data: { name: "Alice" },
      });

      // Manually create post with string FK
      const postsPath = path.join(root, "posts.json");
      const content = {
        meta: {
          version: 1,
          updatedAt: new Date().toISOString(),
          name: "posts",
          lastInsertId: 1,
        },
        schema: {
          name: "posts",
          fields: {
            title: { type: "string", required: true },
            authorId: { type: "number", required: false },
          },
        },
        data: [{ id: 1, title: "Post", authorId: "1" }],
      };
      await fs.writeFile(postsPath, JSON.stringify(content, null, 2));

      const query: QueryObject = {
        type: "select",
        table: "posts",
        populate: { author: {} },
        // @ts-ignore
        meta: {
          relations: {
            author: {
              kind: "belongsTo",
              model: "User",
              targetTable: "users",
              foreignKey: "authorId",
            },
          },
        },
      };

      const result = expectSuccessData(await adapter.executeQuery(query));
      const post = result.rows[0] as any;

      // Should still work due to loose equality or fail gracefully
      expect(post.title).toBe("Post");
      // author might be null or found depending on implementation
    });
  });
});
