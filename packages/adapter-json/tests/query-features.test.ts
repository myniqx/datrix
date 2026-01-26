import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { JsonAdapter } from "../src/adapter";
import { QueryObject } from "forja-types/core/query-builder";
import { expectSuccessData } from "forja-types/test/helpers";

describe("JsonAdapter - Advanced Features", () => {
  const root = path.join(__dirname, "tmp_features_test");
  let adapter: JsonAdapter;

  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    adapter = new JsonAdapter({ root });
    await adapter.connect();

    // Setup Tables
    await adapter.createTable({
      name: "users",
      tableName: "users",
      fields: {
        name: { type: "string", required: true },
        age: { type: "number", required: false },
        role: { type: "string", required: true },
      },
    });
    await adapter.createTable({
      name: "posts",
      tableName: "posts",
      fields: {
        title: { type: "string", required: true },
        authorId: { type: "number", required: true },
        views: { type: "number", required: false },
      },
    });
    await adapter.createTable({
      name: "comments",
      tableName: "comments",
      fields: {
        content: { type: "string", required: true },
        postId: { type: "number", required: true },
        userId: { type: "number", required: true },
      },
    });
  });

  afterEach(async () => {
    await adapter.disconnect();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("should support SELECT projection", async () => {
    await adapter.executeQuery({
      type: "insert",
      table: "users",
      data: { name: "Alice", age: 30, role: "admin" },
    });
    await adapter.executeQuery({
      type: "insert",
      table: "users",
      data: { name: "Bob", age: 25, role: "user" },
    });

    const result = expectSuccessData(
      await adapter.executeQuery({
        type: "select",
        table: "users",
        select: ["name", "role"],
      }),
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ name: "Alice", role: "admin" });
    expect(Object.keys(result.rows[0]!)).toHaveLength(2); // Strict check: Only 2 keys
    expect(result.rows[1]).toEqual({ name: "Bob", role: "user" });
  });

  it("should support DISTINCT", async () => {
    await adapter.executeQuery({
      type: "insert",
      table: "users",
      data: { name: "Alice", role: "admin" },
    });
    await adapter.executeQuery({
      type: "insert",
      table: "users",
      data: { name: "Charlie", role: "admin" },
    }); // Duplicate role
    await adapter.executeQuery({
      type: "insert",
      table: "users",
      data: { name: "Bob", role: "user" },
    });

    const result = expectSuccessData(
      await adapter.executeQuery({
        type: "select",
        table: "users",
        select: ["role"],
        distinct: true,
      }),
    );

    expect(result.rows).toHaveLength(2); // admin, user
    const roles = result.rows.map((r: any) => r.role).sort();
    expect(roles).toEqual(["admin", "user"]);
  });

  it("should support COMPLEX WHERE (AND/OR)", async () => {
    await adapter.executeQuery({
      type: "insert",
      table: "users",
      data: { name: "Alice", age: 30, role: "admin" },
    });
    await adapter.executeQuery({
      type: "insert",
      table: "users",
      data: { name: "Bob", age: 25, role: "user" },
    });
    await adapter.executeQuery({
      type: "insert",
      table: "users",
      data: { name: "Eve", age: 35, role: "admin" },
    });

    const result = expectSuccessData(
      await adapter.executeQuery({
        type: "select",
        table: "users",
        where: {
          $or: [
            { age: { $gt: 30 } },
            {
              $and: [{ role: "user" }, { age: 25 }],
            },
          ],
        },
      }),
    );

    // Matches: Eve (>30) OR Bob (User & 25)
    // Alice (30, not >30 and not User) excluded
    expect(result.rows).toHaveLength(2);
    const names = result.rows.map((r: any) => r.name).sort();
    expect(names).toEqual(["Bob", "Eve"]);
  });

  it("should support ORDER BY (Complex)", async () => {
    await adapter.executeQuery({
      type: "insert",
      table: "posts",
      data: { title: "C", views: 10 },
    });
    await adapter.executeQuery({
      type: "insert",
      table: "posts",
      data: { title: "A", views: 20 },
    });
    await adapter.executeQuery({
      type: "insert",
      table: "posts",
      data: { title: "B", views: 20 },
    });

    const result = expectSuccessData(
      await adapter.executeQuery({
        type: "select",
        table: "posts",
        orderBy: [
          { field: "views", direction: "desc" },
          { field: "title", direction: "asc" },
        ],
      }),
    );

    // Order: Views DESC, then Title ASC
    // 20, A
    // 20, B
    // 10, C
    expect(result.rows[0].title).toBe("A");
    expect(result.rows[1].title).toBe("B");
    expect(result.rows[2].title).toBe("C");
  });

  it("should support RETURNING clause in INSERT", async () => {
    const result = expectSuccessData(
      await adapter.executeQuery({
        type: "insert",
        table: "users",
        data: { name: "Alice", role: "admin" },
        returning: ["id", "name"],
      }),
    );

    expect(result.metadata.affectedRows).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({ id: 1, name: "Alice" });
    expect((result.rows[0] as any).role).toBeUndefined();
  });

  it("should support RETURNING clause in UPDATE", async () => {
    await adapter.executeQuery({
      type: "insert",
      table: "users",
      data: { name: "Alice", role: "admin" },
    });

    const result = expectSuccessData(
      await adapter.executeQuery({
        type: "update",
        table: "users",
        data: { role: "superadmin" },
        where: { name: "Alice" },
        returning: ["id", "role"],
      }),
    );

    expect(result.metadata.affectedRows).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({ id: 1, role: "superadmin" });
  });

  it("should support NESTED POPULATE", async () => {
    // Create Data
    // User (1) -> Post (1) -> Comment (1)

    await adapter.executeQuery({
      type: "insert",
      table: "users",
      data: { name: "Hacker", role: "user" },
    }); // id 1
    await adapter.executeQuery({
      type: "insert",
      table: "posts",
      data: { title: "Hack", authorId: 1 },
    }); // id 1
    await adapter.executeQuery({
      type: "insert",
      table: "comments",
      data: { content: "Nice", postId: 1, userId: 1 },
    }); // id 1

    const query: QueryObject = {
      type: "select",
      table: "comments",
      where: { id: 1 },
      populate: {
        post: {
          populate: {
            author: {},
          },
        },
      },
    };

    const result = expectSuccessData(await adapter.executeQuery(query));
    const comment = result.rows[0] as any;

    expect(comment.post).toBeDefined();
    expect(comment.post.title).toBe("Hack");
    expect(comment.post.author).toBeDefined();
    expect(comment.post.author.name).toBe("Hacker");
  });

  it("should support HAS_MANY populate", async () => {
    await adapter.executeQuery({
      type: "insert",
      table: "users",
      data: { name: "Author" },
    }); // id 1
    await adapter.executeQuery({
      type: "insert",
      table: "posts",
      data: { title: "Post 1", authorId: 1 },
    });
    await adapter.executeQuery({
      type: "insert",
      table: "posts",
      data: { title: "Post 2", authorId: 1 },
    });

    const query: QueryObject = {
      type: "select",
      table: "users",
      where: { id: 1 },
      populate: {
        posts: {},
      },
    };

    const result = expectSuccessData(await adapter.executeQuery(query));
    const user = result.rows[0] as any;

    expect(user.posts).toHaveLength(2);
    expect(user.posts[0].title).toBe("Post 1");
    expect(user.posts[1].title).toBe("Post 2");
  });
});
