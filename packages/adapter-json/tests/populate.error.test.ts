import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { JsonAdapter } from "../src/adapter";
import { QueryObject } from "@forja/types/core/query-builder";
import { expectSuccessData } from "@forja/types/test/helpers";

describe("JsonAdapter Populate - Error Handling", () => {
	const root = path.join(__dirname, "tmp_populate_error_test");
	let adapter: JsonAdapter;

	beforeEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
		adapter = new JsonAdapter({ root, standalone: true });
		await adapter.connect();

		await adapter.createTable({
			name: "User",
			tableName: "users",
			fields: {
				name: { type: "string", required: true },
			},
		});

		await adapter.createTable({
			name: "Post",
			tableName: "posts",
			fields: {
				title: { type: "string", required: true },
				authorId: { type: "number", required: false },
				author: {
					type: "relation",
					kind: "belongsTo",
					model: "User",
					foreignKey: "authorId",
				},
			},
		});
	});

	afterEach(async () => {
		await adapter.disconnect();
		await fs.rm(root, { recursive: true, force: true });
	});

	describe("Schema Validation Errors", () => {
		it("should throw when table schema not found", async () => {
			const query: QueryObject = {
				type: "select",
				table: "nonexistent_table",
				populate: { author: {} },
			};

			const result = await adapter.executeQuery(query);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.message).toContain("not found");
			}
		});

		it("should throw when relation field not found in schema", async () => {
			await adapter.createTable({
				name: "SimplePost",
				tableName: "simple_posts",
				fields: {
					title: { type: "string", required: true },
					authorId: { type: "number", required: false },
				},
			});
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "simple_posts",
				data: [{ title: "Test", authorId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "simple_posts",
				populate: { author: {} },
			};

			const result = await adapter.executeQuery(query);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.message).toContain("not found");
			}
		});

		it("should throw when field is not a relation type", async () => {
			await adapter.createTable({
				name: "InvalidPost",
				tableName: "invalid_posts",
				fields: {
					title: { type: "string", required: true },
					author: { type: "string", required: false },
				},
			});

			await adapter.executeQuery({
				type: "insert",
				table: "invalid_posts",
				data: [{ title: "Test", author: "John" }],
			});

			const query: QueryObject = {
				type: "select",
				table: "invalid_posts",
				populate: { author: {} },
			};

			const result = await adapter.executeQuery(query);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.message).toContain("not a relation");
			}
		});

		it("should throw when target model schema not found", async () => {
			await adapter.createTable({
				name: "PostWithBadRelation",
				tableName: "bad_posts",
				fields: {
					title: { type: "string", required: true },
					author: {
						type: "relation",
						kind: "belongsTo",
						model: "NonExistentUser",
						foreignKey: "authorId",
					},
				},
			});

			await adapter.executeQuery({
				type: "insert",
				table: "bad_posts",
				data: [{ title: "Test" }],
			});

			const query: QueryObject = {
				type: "select",
				table: "bad_posts",
				populate: { author: {} },
			};

			const result = await adapter.executeQuery(query);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.message).toContain("not found");
			}
		});

		it("should throw when junction table not found (manyToMany)", async () => {
			await adapter.createTable({
				name: "PostWithBadJunction",
				tableName: "posts_bad_junction",
				fields: {
					title: { type: "string", required: true },
					tags: {
						type: "relation",
						kind: "manyToMany",
						model: "Tag",
						through: "nonexistent_junction",
					},
				},
			});

			await adapter.createTable({
				name: "Tag",
				tableName: "tags",
				fields: {
					name: { type: "string", required: true },
				},
			});

			await adapter.executeQuery({
				type: "insert",
				table: "posts_bad_junction",
				data: [{ title: "Test" }],
			});

			const query: QueryObject = {
				type: "select",
				table: "posts_bad_junction",
				populate: { tags: "*" },
			};

			// Should throw error when junction table doesn't exist
			const result = await adapter.executeQuery(query);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.code).toBe("QUERY_ERROR");
				expect(result.error.message.toLowerCase()).toMatch(
					/junction|through|not found/,
				);
			}
		});
	});

	describe("Missing Target Table", () => {
		it("should throw when target table file is deleted (data corruption)", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Test Post", authorId: 1 }],
			});

			// Delete the target table file (simulates data corruption)
			await fs.unlink(path.join(root, "users.json"));

			const query: QueryObject = {
				type: "select",
				table: "posts",
				populate: { author: "*" },
			};

			// Should throw error because target model exists in schema but file is missing
			const result = await adapter.executeQuery(query);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.code).toBe("ADAPTER_TARGET_MODEL_NOT_FOUND");
				expect(result.error.message.toLowerCase()).toContain("not found");
			}
		});

		it("should throw when target model doesn't exist (hasMany)", async () => {
			await adapter.createTable({
				name: "UserMissingPosts",
				tableName: "users_missing_posts",
				fields: {
					name: { type: "string", required: true },
					posts: {
						type: "relation",
						kind: "hasMany",
						model: "NonExistentPost",
						foreignKey: "authorId",
					},
				},
			});

			await adapter.executeQuery({
				type: "insert",
				table: "users_missing_posts",
				data: [{ name: "Alice" }],
			});

			const query: QueryObject = {
				type: "select",
				table: "users_missing_posts",
				populate: { posts: true },
			};

			// Should throw error for non-existent target model
			const result = await adapter.executeQuery(query);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.code).toBe("ADAPTER_TARGET_MODEL_NOT_FOUND");
				expect(result.error.message.toLowerCase()).toMatch(
					/not found|nonexistent/,
				);
			}
		});

		it("should throw when target model doesn't exist (hasOne)", async () => {
			await adapter.createTable({
				name: "UserMissingProfile",
				tableName: "users_missing_profile",
				fields: {
					name: { type: "string", required: true },
					profile: {
						type: "relation",
						kind: "hasOne",
						model: "NonExistentProfile",
						foreignKey: "userId",
					},
				},
			});

			await adapter.executeQuery({
				type: "insert",
				table: "users_missing_profile",
				data: [{ name: "Alice" }],
			});

			const query: QueryObject = {
				type: "select",
				table: "users_missing_profile",
				populate: { profile: true },
			};

			// Should throw error for non-existent target model
			const result = await adapter.executeQuery(query);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.code).toBe("ADAPTER_TARGET_MODEL_NOT_FOUND");
				expect(result.error.message.toLowerCase()).toMatch(
					/not found|nonexistent/,
				);
			}
		});
	});

	describe("Corrupted JSON Files", () => {
		it("should handle corrupted target table JSON", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Test Post", authorId: 1 }],
			});

			const usersPath = path.join(root, "users.json");
			await fs.writeFile(usersPath, "{ invalid json }");

			const query: QueryObject = {
				type: "select",
				table: "posts",
				populate: { author: true },
			};

			const result = await adapter.executeQuery(query);

			if (result.success) {
				const post = (result as any).data.rows[0];
				expect(post.title).toBe("Test Post");
			} else {
				expect(result.success).toBe(false);
			}
		});

		it("should handle JSON file with missing data array", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Test Post", authorId: 1 }],
			});

			const usersPath = path.join(root, "users.json");
			await fs.writeFile(
				usersPath,
				JSON.stringify({
					meta: {
						version: 1,
						name: "users",
						updatedAt: new Date().toISOString(),
					},
				}),
			);

			const query: QueryObject = {
				type: "select",
				table: "posts",
				populate: { author: {} },
			};

			const result = await adapter.executeQuery(query);

			if (result.success) {
				const post = (result as any).data.rows[0];
				expect(post.title).toBe("Test Post");
			}
		});

		it("should handle corrupted junction table (manyToMany)", async () => {
			await adapter.createTable({
				name: "PostManyToMany",
				tableName: "posts_m2m",
				fields: {
					title: { type: "string", required: true },
					tags: {
						type: "relation",
						kind: "manyToMany",
						model: "Tag",
						through: "post_tags",
					},
				},
			});

			await adapter.createTable({
				name: "Tag",
				tableName: "tags",
				fields: {
					name: { type: "string", required: true },
				},
			});

			await adapter.createTable({
				name: "PostTag",
				tableName: "post_tags",
				fields: {
					PostManyToManyId: { type: "number", required: true },
					TagId: { type: "number", required: true },
				},
			});

			await adapter.executeQuery({
				type: "insert",
				table: "posts_m2m",
				data: [{ title: "Test Post" }],
			});

			const junctionPath = path.join(root, "post_tags.json");
			await fs.writeFile(junctionPath, "{ corrupted json }");

			const query: QueryObject = {
				type: "select",
				table: "posts_m2m",
				populate: { tags: true },
			};

			const result = await adapter.executeQuery(query);

			if (result.success) {
				const post = result.data.rows[0] as any;
				expect(post.title).toBe("Test Post");
			}
		});
	});

	describe("Circular Reference Prevention", () => {
		it("should handle nested populate without infinite loops", async () => {
			await adapter.createTable({
				name: "UserWithPosts",
				tableName: "users_circular",
				fields: {
					name: { type: "string", required: true },
					posts: {
						type: "relation",
						kind: "hasMany",
						model: "PostCircular",
						foreignKey: "authorId",
					},
				},
			});

			await adapter.createTable({
				name: "PostCircular",
				tableName: "posts_circular",
				fields: {
					title: { type: "string", required: true },
					authorId: { type: "number", required: false },
					author: {
						type: "relation",
						kind: "belongsTo",
						model: "UserWithPosts",
						foreignKey: "authorId",
					},
				},
			});

			await adapter.executeQuery({
				type: "insert",
				table: "users_circular",
				data: [{ name: "Alice" }],
			});

			await adapter.executeQuery({
				type: "insert",
				table: "posts_circular",
				data: [{ title: "Post 1", authorId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "posts_circular",
				populate: {
					author: {
						populate: {
							posts: true,
						},
					},
				},
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const post = result.rows[0] as any;

			expect(post.author).toBeDefined();
			expect(post.author.posts).toBeDefined();
		});
	});

	describe("Edge Cases", () => {
		it("should handle populate on empty table", async () => {
			const query: QueryObject = {
				type: "select",
				table: "posts",
				populate: { author: {} },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			expect(result.rows).toHaveLength(0);
		});

		it("should handle undefined foreign key field", async () => {
			const postsPath = path.join(root, "posts.json");
			const content = {
				meta: {
					version: 1,
					updatedAt: new Date().toISOString(),
					name: "Post",
					lastInsertId: 1,
				},
				schema: {
					name: "Post",
					tableName: "posts",
					fields: {
						title: { type: "string", required: true },
						author: {
							type: "relation",
							kind: "belongsTo",
							model: "User",
							foreignKey: "authorId",
						},
					},
				},
				data: [{ id: 1, title: "Post without FK field" }],
			};
			await fs.writeFile(postsPath, JSON.stringify(content, null, 2));

			const query: QueryObject = {
				type: "select",
				table: "posts",
				populate: { author: {} },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const post = result.rows[0] as any;

			expect(post.title).toBe("Post without FK field");
			expect(post.author).toBeNull();
		});

		it("should handle string foreign key values", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: { name: "Alice" },
			});

			const postsPath = path.join(root, "posts.json");
			const content = {
				meta: {
					version: 1,
					updatedAt: new Date().toISOString(),
					name: "Post",
					lastInsertId: 1,
				},
				schema: {
					name: "Post",
					tableName: "posts",
					fields: {
						title: { type: "string", required: true },
						authorId: { type: "number", required: false },
						author: {
							type: "relation",
							kind: "belongsTo",
							model: "User",
							foreignKey: "authorId",
						},
					},
				},
				data: [{ id: 1, title: "Post", authorId: "1" }],
			};
			await fs.writeFile(postsPath, JSON.stringify(content, null, 2));

			const query: QueryObject = {
				type: "select",
				table: "posts",
				populate: { author: {} },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const post = result.rows[0] as any;

			expect(post.title).toBe("Post");
		});

		it("should handle orphaned junction table records (manyToMany)", async () => {
			await adapter.createTable({
				name: "PostM2M",
				tableName: "posts_orphan_test",
				fields: {
					title: { type: "string", required: true },
					tags: {
						type: "relation",
						kind: "manyToMany",
						model: "TagM2M",
						through: "post_tag_orphan",
					},
				},
			});

			await adapter.createTable({
				name: "TagM2M",
				tableName: "tags_orphan_test",
				fields: {
					name: { type: "string", required: true },
				},
			});

			await adapter.createTable({
				name: "PostTagOrphan",
				tableName: "post_tag_orphan",
				fields: {
					PostM2MId: { type: "number", required: true },
					TagM2MId: { type: "number", required: true },
				},
			});

			await adapter.executeQuery({
				type: "insert",
				table: "posts_orphan_test",
				data: [{ title: "Post 1" }],
			});

			await adapter.executeQuery({
				type: "insert",
				table: "post_tag_orphan",
				data: [{ PostM2MId: 1, TagM2MId: 999 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "posts_orphan_test",
				populate: { tags: true },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const post = result.rows[0] as any;

			expect(post.tags).toHaveLength(0);
		});

		it("should handle FK type mismatch (string vs number)", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: { name: "Alice" },
			});

			const postsPath = path.join(root, "posts.json");
			const content = {
				meta: {
					version: 1,
					updatedAt: new Date().toISOString(),
					name: "Post",
					lastInsertId: 1,
				},
				schema: {
					name: "Post",
					tableName: "posts",
					fields: {
						title: { type: "string", required: true },
						authorId: { type: "string", required: false },
						author: {
							type: "relation",
							kind: "belongsTo",
							model: "User",
							foreignKey: "authorId",
						},
					},
				},
				data: [{ id: 1, title: "Post", authorId: "not-a-number" }],
			};
			await fs.writeFile(postsPath, JSON.stringify(content, null, 2));

			const query: QueryObject = {
				type: "select",
				table: "posts",
				populate: { author: {} },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const post = result.rows[0] as any;

			expect(post.author).toBeNull();
		});
	});
});
