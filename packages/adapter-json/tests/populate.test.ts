import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { JsonAdapter } from "../src/adapter";
import { QueryObject } from "@forja/types/core/query-builder";
import { expectSuccessData } from "@forja/types/test/helpers";

describe("JsonAdapter Populate - Happy Path", () => {
	const root = path.join(__dirname, "tmp_populate_test");
	let adapter: JsonAdapter;

	beforeEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
		adapter = new JsonAdapter({ root, standalone: true });
		await adapter.connect();

		await adapter.createTable({
			name: "User",
			tableName: "users",
			fields: {
				id: { type: "number" },
				name: { type: "string", required: true },
				posts: {
					type: "relation",
					kind: "hasMany",
					model: "Post",
					foreignKey: "authorId",
				},
				profile: {
					type: "relation",
					kind: "hasOne",
					model: "Profile",
					foreignKey: "userId",
				},
			},
		});

		await adapter.createTable({
			name: "Post",
			tableName: "posts",
			fields: {
				id: { type: "number" },
				title: { type: "string", required: true },
				authorId: { type: "number", required: false },
				author: {
					type: "relation",
					kind: "belongsTo",
					model: "User",
					foreignKey: "authorId",
				},
				comments: {
					type: "relation",
					kind: "hasMany",
					model: "Comment",
					foreignKey: "PostId",
				},
				categories: {
					type: "relation",
					kind: "manyToMany",
					model: "Category",
					through: "post_categories",
				},
			},
		});

		await adapter.createTable({
			name: "Profile",
			tableName: "profiles",
			fields: {
				id: { type: "number" },
				bio: { type: "string", required: true },
				userId: { type: "number", required: true },
				user: {
					type: "relation",
					kind: "belongsTo",
					model: "User",
					foreignKey: "userId",
				},
			},
		});

		await adapter.createTable({
			name: "Comment",
			tableName: "comments",
			fields: {
				id: { type: "number" },
				text: { type: "string", required: true },
				PostId: { type: "number", required: true },
				authorId: { type: "number", required: true },
				post: {
					type: "relation",
					kind: "belongsTo",
					model: "Post",
					foreignKey: "PostId",
				},
				author: {
					type: "relation",
					kind: "belongsTo",
					model: "User",
					foreignKey: "authorId",
				},
			},
		});

		await adapter.createTable({
			name: "Category",
			tableName: "categories",
			fields: {
				name: { type: "string", required: true },
				posts: {
					type: "relation",
					kind: "manyToMany",
					model: "Post",
					through: "post_categories",
				},
			},
		});

		await adapter.createTable({
			name: "PostCategory",
			tableName: "post_categories",
			_isJunctionTable: true,
			fields: {
				PostId: { type: "number", required: true },
				CategoryId: { type: "number", required: true },
			},
		});
	});

	afterEach(async () => {
		await adapter.disconnect();
		await fs.rm(root, { recursive: true, force: true });
	});

	describe("belongsTo Relations", () => {
		it("should populate single belongsTo relation", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Burak" }],
			});

			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 1", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 2", authorId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "posts",
				populate: { author: true },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));

			expect(result.rows).toHaveLength(2);

			const row1 = result.rows[0] as any;
			expect(row1.title).toBe("Post 1");
			expect(row1.author).toBeDefined();
			expect(row1.author.id).toBe(1);
			expect(row1.author.name).toBe("Burak");
		});

		it.fails(
			"should handle missing relation gracefully (orphaned FK)",
			async () => {
				await adapter.executeQuery({
					type: "insert",
					table: "posts",
					data: [{ title: "Orphan Post", authorId: 999 }], // this ll throw an error, change the expectation
				});

				const query: QueryObject = {
					type: "select",
					table: "posts",
					populate: { author: true },
				};

				const result = expectSuccessData(await adapter.executeQuery(query));
				const row = result.rows[0] as any;

				expect(row.author).toBeNull();
			},
		);

		it("should handle null foreign key", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post without author", authorId: null }],
			});

			const query: QueryObject = {
				type: "select",
				table: "posts",
				populate: { author: true },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const row = result.rows[0] as any;

			expect(row.author).toBeNull();
		});

		it("should populate multiple belongsTo relations simultaneously", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Bob" }],
			});

			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Tech Post", authorId: 1 }],
			});

			await adapter.executeQuery({
				type: "insert",
				table: "comments",
				data: [{ text: "Great post!", PostId: 1, authorId: 2 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "comments",
				populate: { post: true, author: true },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const comment = result.rows[0] as any;

			expect(comment.post).toBeDefined();
			expect(comment.post.title).toBe("Tech Post");
			expect(comment.author).toBeDefined();
			expect(comment.author.name).toBe("Bob");
		});

		it("should populate belongsTo with select fields", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 1", authorId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "posts",
				select: ["id"],
				populate: {
					author: {
						select: ["name"],
					},
				},
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const post = result.rows[0] as any;

			expect(post.author.name).toBe("Alice");
			expect(post.author.id).toBeUndefined();
		});

		it("should handle 0 as valid foreign key", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "System" }],
			});

			const usersPath = path.join(root, "users.json");
			const content = JSON.parse(await fs.readFile(usersPath, "utf-8"));
			content.data[0].id = 0;
			await fs.writeFile(usersPath, JSON.stringify(content, null, 2));

			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "System Post", authorId: 0 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "posts",
				select: ["id"],
				populate: {
					author: {
						select: ["name", "id"],
					},
				},
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const post = result.rows[0] as any;

			expect(post.author).toBeDefined();
			expect(post.author.id).toBe(0);
			expect(post.author.name).toBe("System");
		});
	});

	describe("hasMany Relations", () => {
		it("should populate hasMany as array", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});

			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 1", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 2", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 3", authorId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "users",
				populate: { posts: true },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const user = result.rows[0] as any;

			expect(user.posts).toBeDefined();
			expect(Array.isArray(user.posts)).toBe(true);
			expect(user.posts).toHaveLength(3);
			expect(user.posts[0].title).toBe("Post 1");
		});

		it("should return empty array when no matches", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Lonely User" }],
			});

			const query: QueryObject = {
				type: "select",
				table: "users",
				populate: { posts: true },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const user = result.rows[0] as any;

			expect(user.posts).toBeDefined();
			expect(Array.isArray(user.posts)).toBe(true);
			expect(user.posts).toHaveLength(0);
		});

		it("should handle multiple users with different post counts", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Bob" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Charlie" }],
			});

			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Alice Post 1", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Alice Post 2", authorId: 1 }],
			});

			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Bob Post", authorId: 2 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "users",
				populate: { posts: true },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));

			const alice = result.rows[0] as any;
			const bob = result.rows[1] as any;
			const charlie = result.rows[2] as any;

			expect(alice.posts).toHaveLength(2);
			expect(bob.posts).toHaveLength(1);
			expect(charlie.posts).toHaveLength(0);
		});

		it("should populate hasMany with select fields", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 1", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 2", authorId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "users",
				populate: {
					posts: {
						select: ["title"],
					},
				},
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const user = result.rows[0] as any;

			expect(user.posts).toHaveLength(2);
			expect(user.posts[0].title).toBe("Post 1");
			expect(user.posts[0].authorId).toBeUndefined();
		});
	});

	describe("hasOne Relations", () => {
		it("should populate hasOne as single object", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "profiles",
				data: [{ bio: "Developer", userId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "users",
				populate: { profile: true },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const user = result.rows[0] as any;

			expect(user.profile).toBeDefined();
			expect(user.profile).not.toBeNull();
			expect(user.profile.bio).toBe("Developer");
			expect(Array.isArray(user.profile)).toBe(false);
		});

		it("should return null when no hasOne match", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "ProfilelessUser" }],
			});

			const query: QueryObject = {
				type: "select",
				table: "users",
				populate: { profile: true },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const user = result.rows[0] as any;

			expect(user.profile).toBeNull();
		});

		it("should return first match when multiple hasOne records exist", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "profiles",
				data: [{ bio: "First Profile", userId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "profiles",
				data: [{ bio: "Second Profile", userId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "users",
				populate: { profile: true },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const user = result.rows[0] as any;

			expect(user.profile).toBeDefined();
			expect(user.profile.bio).toBe("First Profile");
			expect(Array.isArray(user.profile)).toBe(false);
		});

		it("should populate hasOne with select fields", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "profiles",
				data: [{ bio: "Developer", userId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "users",
				populate: {
					profile: {
						select: ["bio"],
					},
				},
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const user = result.rows[0] as any;

			expect(user.profile.bio).toBe("Developer");
			expect(user.profile.id).toBeUndefined();
			expect(user.profile.userId).toBeUndefined();
		});
	});

	describe("manyToMany Relations", () => {
		it("should populate manyToMany as array", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Tech Post", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "categories",
				data: [{ name: "Technology" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "categories",
				data: [{ name: "Programming" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "post_categories",
				data: [{ PostId: 1, CategoryId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "post_categories",
				data: [{ PostId: 1, CategoryId: 2 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "posts",
				populate: { categories: "*" },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const post = result.rows[0] as any;

			expect(post.categories).toBeDefined();
			expect(Array.isArray(post.categories)).toBe(true);
			expect(post.categories).toHaveLength(2);
			expect(post.categories[0].name).toBe("Technology");
			expect(post.categories[1].name).toBe("Programming");
		});

		it("should return empty array when no manyToMany matches", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Uncategorized Post", authorId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "posts",
				populate: { categories: true },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const post = result.rows[0] as any;

			expect(post.categories).toBeDefined();
			expect(Array.isArray(post.categories)).toBe(true);
			expect(post.categories).toHaveLength(0);
		});

		it("should handle bidirectional manyToMany", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "categories",
				data: [{ name: "Technology" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 1", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 2", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "post_categories",
				data: [{ PostId: 1, CategoryId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "post_categories",
				data: [{ PostId: 2, CategoryId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "categories",
				populate: { posts: true },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const category = result.rows[0] as any;

			expect(category.posts).toBeDefined();
			expect(category.posts).toHaveLength(2);
		});

		it("should populate manyToMany with select fields", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Tech Post", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "categories",
				data: [{ name: "Technology" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "post_categories",
				data: [{ PostId: 1, CategoryId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "posts",
				populate: {
					categories: {
						select: ["name"],
					},
				},
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const post = result.rows[0] as any;

			expect(post.categories[0].name).toBe("Technology");
			expect(post.categories[0].id).toBeUndefined();
		});
	});

	describe("Nested Populate", () => {
		it("should populate 2 levels deep (belongsTo -> hasOne)", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "profiles",
				data: [{ bio: "Developer", userId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "My Post", authorId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "posts",
				populate: {
					author: {
						populate: {
							profile: true,
						},
					},
				},
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const post = result.rows[0] as any;

			expect(post.author).toBeDefined();
			expect(post.author.name).toBe("Alice");
			expect(post.author.profile).toBeDefined();
			expect(post.author.profile.bio).toBe("Developer");
		});

		it("should populate 2 levels deep (belongsTo -> hasMany)", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Alice Post 1", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Alice Post 2", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "comments",
				data: [{ text: "Great!", PostId: 1, authorId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "comments",
				populate: {
					author: {
						populate: {
							posts: true,
						},
					},
				},
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const comment = result.rows[0] as any;

			expect(comment.author).toBeDefined();
			expect(comment.author.name).toBe("Alice");
			expect(comment.author.posts).toBeDefined();
			expect(comment.author.posts).toHaveLength(2);
		});

		it("should populate 3 levels deep", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "profiles",
				data: [{ bio: "Developer", userId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 1", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "comments",
				data: [{ text: "Comment 1", PostId: 1, authorId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "comments",
				populate: {
					post: {
						populate: {
							author: {
								populate: {
									profile: true,
								},
							},
						},
					},
				},
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const comment = result.rows[0] as any;

			expect(comment.post).toBeDefined();
			expect(comment.post.author).toBeDefined();
			expect(comment.post.author.profile).toBeDefined();
			expect(comment.post.author.profile.bio).toBe("Developer");
		});

		it("should populate 4 levels deep", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Bob" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "profiles",
				data: [{ bio: "Alice Bio", userId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 1", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "comments",
				data: [{ text: "Comment 1", PostId: 1, authorId: 2 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "comments",
				populate: {
					author: {
						populate: {
							posts: {
								populate: {
									author: {
										populate: {
											profile: true,
										},
									},
								},
							},
						},
					},
				},
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const comment = result.rows[0] as any;

			expect(comment.author.name).toBe("Bob");
			expect(comment.author.posts).toHaveLength(0);
		});

		it("should populate with nested select fields", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "profiles",
				data: [{ bio: "Developer", userId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 1", authorId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "posts",
				select: ["title"],
				populate: {
					author: {
						select: ["name"],
						populate: {
							profile: {
								select: ["bio"],
							},
						},
					},
				},
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const post = result.rows[0] as any;

			expect(post.title).toBe("Post 1");
			expect(post.authorId).toBeUndefined();
			expect(post.author.name).toBe("Alice");
			expect(post.author.id).toBeUndefined();
			expect(post.author.profile.bio).toBe("Developer");
			expect(post.author.profile.id).toBeUndefined();
		});
	});

	describe("Complex Scenarios", () => {
		it("should handle empty result set with populate", async () => {
			const query: QueryObject = {
				type: "select",
				table: "posts",
				where: { id: 999 },
				populate: { author: {} },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			expect(result.rows).toHaveLength(0);
		});

		it("should work with WHERE filters and populate", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Bob" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Alice Post", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Bob Post", authorId: 2 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "posts",
				where: { title: "Alice Post" },
				populate: { author: true },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));

			expect(result.rows).toHaveLength(1);
			const post = result.rows[0] as any;
			expect(post.title).toBe("Alice Post");
			expect(post.author.name).toBe("Alice");
		});

		it("should work with LIMIT and populate", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 1", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 2", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 3", authorId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "posts",
				limit: 2,
				populate: { author: true },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			expect(result.rows).toHaveLength(2);
			expect(result.rows[0]).toHaveProperty("author");
			expect(result.rows[1]).toHaveProperty("author");
		});

		it("should work with OFFSET and populate", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 1", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 2", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 3", authorId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "posts",
				offset: 1,
				limit: 2,
				populate: { author: true },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			expect(result.rows).toHaveLength(2);
			const post = result.rows[0] as any;
			expect(post.title).toBe("Post 2");
		});

		it("should work with ORDER BY and populate", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "C Post", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "A Post", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "B Post", authorId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "posts",
				orderBy: [{ field: "title", direction: "asc" }],
				populate: { author: true },
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			expect(result.rows[0]).toMatchObject({ title: "A Post" });
			expect(result.rows[1]).toMatchObject({ title: "B Post" });
			expect(result.rows[2]).toMatchObject({ title: "C Post" });
		});

		it("should populate multiple relations with mixed types", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "profiles",
				data: [{ bio: "Developer", userId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 1", authorId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "posts",
				data: [{ title: "Post 2", authorId: 1 }],
			});

			const query: QueryObject = {
				type: "select",
				table: "users",
				populate: {
					profile: true,
					posts: true,
				},
			};

			const result = expectSuccessData(await adapter.executeQuery(query));
			const user = result.rows[0] as any;

			expect(user.profile).toBeDefined();
			expect(user.profile.bio).toBe("Developer");
			expect(Array.isArray(user.profile)).toBe(false);

			expect(user.posts).toBeDefined();
			expect(Array.isArray(user.posts)).toBe(true);
			expect(user.posts).toHaveLength(2);
		});
	});
});
