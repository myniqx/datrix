/**
 * Complex Populate Tests
 *
 * Tests for advanced relation population scenarios
 *
 * Covers:
 * - Deep nested populate (2, 3, 4+ levels)
 * - Multiple relations in single query
 * - Nested options (select, populate within populate)
 * - Self-referencing relations
 * - Circular relations
 * - ManyToMany populate
 * - Null/empty handling
 * - Large data performance
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";

describe("Complex Populate", () => {
	let forja: Forja;
	const tmpDir = getTmpDir("complex_populate");

	// Store IDs for reference
	let orgId: number;
	let deptId: number;
	let userId: number;
	let postId: number;
	let commentId: number;
	let parentCatId: number;
	let childCatId: number;
	let grandchildCatId: number;
	let tagIds: number[];
	let roleIds: number[];

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const getForja = await createTestConfig(tmpDir);
		forja = await getForja();

		await setupTables(forja);

		// Create hierarchical test data
		// Organization → Department → User → Post → Comment

		const org = await forja.create("organization", {
			name: "Deep Test Org",
			country: "USA",
		});
		orgId = org.id;

		const dept = await forja.create("department", {
			name: "Deep Test Dept",
			code: "DTD",
			budget: 100000,
			organization: orgId,
		});
		deptId = dept.id;

		// Create roles
		const roles = await forja.createMany("role", [
			{ name: "Admin", level: 100 },
			{ name: "Editor", level: 50 },
			{ name: "Viewer", level: 10 },
		]);
		roleIds = roles.map((r) => r.id);

		const user = await forja.create("user", {
			email: "deep@test.com",
			name: "Deep User",
			age: 30,
			organization: orgId,
			department: deptId,
			roles: { connect: roleIds },
		});
		userId = user.id;

		// Create self-referencing categories
		const parentCat = await forja.create("category", {
			name: "Parent Category",
			slug: "parent-cat",
		});
		parentCatId = parentCat.id;

		const childCat = await forja.create("category", {
			name: "Child Category",
			slug: "child-cat",
			parent: parentCatId,
		});
		childCatId = childCat.id;

		const grandchildCat = await forja.create("category", {
			name: "Grandchild Category",
			slug: "grandchild-cat",
			parent: childCatId,
		});
		grandchildCatId = grandchildCat.id;

		// Create tags
		const tags = await forja.createMany("tag", [
			{ name: "Tag1", color: "#111111" },
			{ name: "Tag2", color: "#222222" },
			{ name: "Tag3", color: "#333333" },
		]);
		tagIds = tags.map((t) => t.id);

		// Create post
		const post = await forja.create("post", {
			title: "Deep Test Post",
			content: "Content for deep populate test",
			slug: "deep-test-post",
			isPublished: true,
			author: userId,
			category: childCatId,
			tags: { connect: tagIds },
		});
		postId = post.id;

		// Create comment (circular: comment.author → user → posts → comments)
		const comment = await forja.create("comment", {
			content: "Deep test comment",
			post: postId,
			author: userId,
		});
		commentId = comment.id;
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// ==========================================================================
	// Deep Nested Populate (2, 3, 4+ levels)
	// ==========================================================================

	describe("Deep Nested Populate", () => {
		it("should populate 2 levels deep with select *", async () => {
			// post → author → organization (using select: "*")
			const post = await forja.findById("post", postId, {
				populate: {
					author: {
						select: "*",
						populate: {
							organization: { select: "*" },
						},
					},
				},
			});

			expect(post).not.toBeNull();
			expect(post!.author).toBeDefined();
			expect(typeof post!.author).toBe("object");

			const author = post!.author as {
				name: string;
				organization: { name: string };
			};
			expect(author.name).toBe("Deep User");
			expect(author.organization).toBeDefined();
			expect(author.organization.name).toBe("Deep Test Org");
		});

		it("should populate 2 levels deep with dot notation shortcut", async () => {
			// post → author → organization (using "author.organization" in populate)
			const post = await forja.findById("post", postId, {
				select: ["id", "title"],
				populate: ["author.organization"],
			});

			expect(post).not.toBeNull();
			expect(post!.author).toBeDefined();

			const author = post!.author as {
				name: string;
				organization: { name: string };
			};
			expect(author.name).toBe("Deep User");
			expect(author.organization).toBeDefined();
			expect(author.organization.name).toBe("Deep Test Org");
		});

		it("should populate 3 levels deep with explicit select", async () => {
			// post → author → department → organization
			const post = await forja.findById("post", postId, {
				populate: {
					author: {
						select: ["id", "name"],
						populate: {
							department: {
								select: ["id", "name"],
								populate: {
									organization: { select: ["id", "name"] },
								},
							},
						},
					},
				},
			});

			expect(post).not.toBeNull();
			const author = post!.author as {
				name: string;
				department: {
					name: string;
					organization: { name: string };
				};
			};
			expect(author.name).toBe("Deep User");
			expect(author.department).toBeDefined();
			expect(author.department.name).toBe("Deep Test Dept");
			expect(author.department.organization).toBeDefined();
			expect(author.department.organization.name).toBe("Deep Test Org");
		});

		it("should populate 4 levels deep with mixed approaches", async () => {
			// comment → post → author → department → organization
			const comment = await forja.findById("comment", commentId, {
				populate: {
					post: {
						select: "*",
						populate: {
							author: {
								select: "*",
								populate: {
									department: {
										select: "*",
										populate: {
											organization: { select: "*" },
										},
									},
								},
							},
						},
					},
				},
			});

			expect(comment).not.toBeNull();
			const post = comment!.post as {
				author: {
					department: {
						organization: { name: string };
					};
				};
			};
			expect(post.author.department.organization.name).toBe("Deep Test Org");
		});
	});

	// ==========================================================================
	// Multiple Relations
	// ==========================================================================

	describe("Multiple Relations", () => {
		it("should populate multiple relations in single query", async () => {
			const post = await forja.findById("post", postId, {
				populate: {
					author: { select: "*" },
					category: { select: "*" },
					tags: { select: "*" },
				},
			});

			expect(post).not.toBeNull();

			// Author (belongsTo)
			expect(post!.author).toBeDefined();
			expect((post!.author as { name: string }).name).toBe("Deep User");

			// Category (belongsTo)
			expect(post!.category).toBeDefined();
			expect((post!.category as { name: string }).name).toBe("Child Category");

			// Tags (manyToMany)
			expect(post!.tags).toBeDefined();
			expect(Array.isArray(post!.tags)).toBe(true);
			expect((post!.tags as unknown[]).length).toBe(3);
		});

		it("should populate multiple relations with mixed depths", async () => {
			const post = await forja.findById("post", postId, {
				populate: {
					author: {
						select: "*",
						populate: {
							organization: { select: "*" },
						},
					},
					category: {
						select: "*",
						populate: {
							parent: { select: "*" },
						},
					},
					tags: { select: "*" },
				},
			});

			expect(post).not.toBeNull();

			// Author with nested organization
			const author = post!.author as { organization: { name: string } };
			expect(author.organization.name).toBe("Deep Test Org");

			// Category with parent
			const category = post!.category as { parent: { name: string } };
			expect(category.parent.name).toBe("Parent Category");

			// Tags (simple)
			expect((post!.tags as unknown[]).length).toBe(3);
		});
	});

	// ==========================================================================
	// Nested Options (select within populate)
	// ==========================================================================

	describe("Nested Options", () => {
		it("should apply select within populate", async () => {
			const post = await forja.findById("post", postId, {
				populate: {
					author: {
						select: ["id", "name"],
					},
				},
			});

			expect(post).not.toBeNull();
			const author = post!.author as Record<string, unknown>;

			expect(author).toHaveProperty("id");
			expect(author).toHaveProperty("name");
			expect(author).not.toHaveProperty("email");
			expect(author).not.toHaveProperty("age");
		});

		it("should apply select at multiple levels", async () => {
			const post = await forja.findById("post", postId, {
				select: ["id", "title"],
				populate: {
					author: {
						select: ["id", "name"],
						populate: {
							organization: {
								select: ["id", "name"],
							},
						},
					},
				},
			});

			expect(post).not.toBeNull();

			// Post level
			expect(post).toHaveProperty("id");
			expect(post).toHaveProperty("title");
			expect(post).not.toHaveProperty("content");

			// Author level
			const author = post!.author as Record<string, unknown>;
			expect(author).toHaveProperty("id");
			expect(author).toHaveProperty("name");
			expect(author).not.toHaveProperty("email");

			// Organization level
			const org = author.organization as Record<string, unknown>;
			expect(org).toHaveProperty("id");
			expect(org).toHaveProperty("name");
			expect(org).not.toHaveProperty("country");
		});
	});

	// ==========================================================================
	// Self-Referencing Relations
	// ==========================================================================

	describe("Self-Referencing Relations", () => {
		it("should populate self-referencing parent", async () => {
			const category = await forja.findById("category", childCatId, {
				populate: { parent: { select: "*" } },
			});

			expect(category).not.toBeNull();
			expect(category!.parent).toBeDefined();
			expect((category!.parent as { name: string }).name).toBe(
				"Parent Category",
			);
		});

		it("should populate 2 levels of self-reference", async () => {
			const category = await forja.findById("category", grandchildCatId, {
				populate: {
					parent: {
						select: "*",
						populate: { parent: { select: "*" } },
					},
				},
			});

			expect(category).not.toBeNull();
			const parent = category!.parent as {
				name: string;
				parent: { name: string };
			};
			expect(parent.name).toBe("Child Category");
			expect(parent.parent.name).toBe("Parent Category");
		});

		it("should handle null parent (root category)", async () => {
			const category = await forja.findById("category", parentCatId, {
				populate: { parent: { select: "*" } },
			});

			expect(category).not.toBeNull();
			expect(category!.parent).toBeNull();
		});
	});

	// ==========================================================================
	// Circular Relations
	// ==========================================================================

	describe("Circular Relations", () => {
		it("should handle circular populate without infinite loop", async () => {
			// comment → author → (user has posts, posts have comments)
			// Should not infinitely recurse
			const comment = await forja.findById("comment", commentId, {
				populate: {
					author: { select: "*" },
					post: {
						select: "*",
						populate: {
							author: { select: "*" },
						},
					},
				},
			});

			expect(comment).not.toBeNull();

			// Comment author
			expect(comment!.author).toBeDefined();
			expect((comment!.author as { name: string }).name).toBe("Deep User");

			// Post author (same user)
			const post = comment!.post as { author: { name: string } };
			expect(post.author.name).toBe("Deep User");
		});

		it("should populate same relation at different paths", async () => {
			// Create another user who commented
			const anotherUser = await forja.create("user", {
				email: "another@test.com",
				name: "Another User",
			});

			const anotherComment = await forja.create("comment", {
				content: "Another comment",
				post: postId,
				author: anotherUser.id,
			});

			// Populate both comment author and post author
			const comment = await forja.findById("comment", anotherComment.id, {
				populate: {
					author: { select: "*" },
					post: {
						select: "*",
						populate: { author: { select: "*" } },
					},
				},
			});

			expect(comment).not.toBeNull();
			expect((comment!.author as { name: string }).name).toBe("Another User");

			const post = comment!.post as { author: { name: string } };
			expect(post.author.name).toBe("Deep User"); // Original post author
		});
	});

	// ==========================================================================
	// ManyToMany Populate
	// ==========================================================================

	describe("ManyToMany Populate", () => {
		it("should populate manyToMany relation", async () => {
			const post = await forja.findById("post", postId, {
				populate: { tags: { select: "*" } },
			});

			expect(post).not.toBeNull();
			expect(Array.isArray(post!.tags)).toBe(true);

			const tags = post!.tags as { id: number; name: string; color: string }[];
			expect(tags.length).toBe(3);

			const tagNames = tags.map((t) => t.name);
			expect(tagNames).toContain("Tag1");
			expect(tagNames).toContain("Tag2");
			expect(tagNames).toContain("Tag3");
		});

		it("should populate manyToMany with select", async () => {
			const post = await forja.findById("post", postId, {
				populate: {
					tags: {
						select: ["id", "name"],
					},
				},
			});

			expect(post).not.toBeNull();
			const tags = post!.tags as Record<string, unknown>[];

			for (const tag of tags) {
				expect(tag).toHaveProperty("id");
				expect(tag).toHaveProperty("name");
				expect(tag).not.toHaveProperty("color");
			}
		});

		it("should populate nested manyToMany (user → roles)", async () => {
			const user = await forja.findById("user", userId, {
				populate: { roles: { select: "*" } },
			});

			expect(user).not.toBeNull();
			expect(Array.isArray(user!.roles)).toBe(true);

			const roles = user!.roles as { name: string; level: number }[];
			expect(roles.length).toBe(3);

			const roleNames = roles.map((r) => r.name);
			expect(roleNames).toContain("Admin");
			expect(roleNames).toContain("Editor");
			expect(roleNames).toContain("Viewer");
		});

		it("should populate manyToMany through nested path", async () => {
			// post → author → roles
			const post = await forja.findById("post", postId, {
				populate: {
					author: {
						select: "*",
						populate: { roles: { select: "*" } },
					},
				},
			});

			expect(post).not.toBeNull();
			const author = post!.author as { roles: { name: string }[] };
			expect(Array.isArray(author.roles)).toBe(true);
			expect(author.roles.length).toBe(3);
		});
	});

	// ==========================================================================
	// Null/Empty Handling
	// ==========================================================================

	describe("Null/Empty Handling", () => {
		it("should return null for unpopulated optional belongsTo", async () => {
			// Create user without organization
			const userWithoutOrg = await forja.create("user", {
				email: "no-org@test.com",
				name: "No Org User",
			});

			const user = await forja.findById("user", userWithoutOrg.id, {
				populate: { organization: { select: "*" } },
			});

			expect(user).not.toBeNull();
			expect(user!.organization).toBeNull();
		});

		it("should return empty array for manyToMany with no relations", async () => {
			// Create post without tags
			const postWithoutTags = await forja.create("post", {
				title: "No Tags Post",
				content: "Content",
				slug: "no-tags-post",
				author: userId,
			});

			const post = await forja.findById("post", postWithoutTags.id, {
				populate: { tags: { select: "*" } },
			});

			expect(post).not.toBeNull();
			expect(Array.isArray(post!.tags)).toBe(true);
			expect((post!.tags as unknown[]).length).toBe(0);
		});

		it("should handle mixed null and populated in findMany", async () => {
			const users = await forja.findMany("user", {
				populate: { organization: { select: "*" } },
			});

			const withOrg = users.filter((u) => u.organization !== null);
			const withoutOrg = users.filter((u) => u.organization === null);

			expect(withOrg.length).toBeGreaterThan(0);
			expect(withoutOrg.length).toBeGreaterThan(0);
		});

		it("should handle null in nested populate", async () => {
			// User without department
			const userNoDept = await forja.create("user", {
				email: "no-dept@test.com",
				name: "No Dept User",
				organization: orgId,
			});

			const user = await forja.findById("user", userNoDept.id, {
				populate: {
					organization: { select: "*" },
					department: {
						select: "*",
						populate: { organization: { select: "*" } },
					},
				},
			});

			expect(user).not.toBeNull();
			expect(user!.organization).not.toBeNull();
			expect(user!.department).toBeNull();
		});
	});

	// ==========================================================================
	// Large Data Performance
	// ==========================================================================

	describe("Large Data Performance", () => {
		it("should populate many records efficiently", async () => {
			// Create 50 posts with tags
			const bulkPosts = Array.from({ length: 50 }, (_, i) => ({
				title: `Bulk Post ${i}`,
				content: `Content ${i}`,
				slug: `bulk-post-${i}`,
				author: userId,
				tags: { connect: tagIds },
			}));

			await forja.createMany("post", bulkPosts);

			const start = performance.now();

			const posts = await forja.findMany("post", {
				where: { title: { $like: "Bulk Post%" } },
				populate: {
					author: { select: "*" },
					tags: { select: "*" },
				},
			});

			const duration = performance.now() - start;

			expect(posts.length).toBe(50);

			// Each post should have author and tags populated
			for (const post of posts) {
				expect(post.author).toBeDefined();
				expect(Array.isArray(post.tags)).toBe(true);
			}

			// Should complete in reasonable time (adjust threshold as needed)
			expect(duration).toBeLessThan(5000); // 5 seconds max
		});

		it("should handle deep populate on multiple records", async () => {
			const start = performance.now();

			const posts = await forja.findMany("post", {
				where: { title: { $like: "Bulk Post%" } },
				limit: 20,
				populate: {
					author: {
						select: "*",
						populate: {
							organization: { select: "*" },
							department: { select: "*" },
						},
					},
					category: { select: "*" },
					tags: { select: "*" },
				},
			});

			const duration = performance.now() - start;

			expect(posts.length).toBe(20);

			// Should complete in reasonable time
			expect(duration).toBeLessThan(3000); // 3 seconds max
		});
	});

	// ==========================================================================
	// Populate with where
	// ==========================================================================

	describe("Populate with where", () => {
		let postWithMixedComments: number;

		beforeAll(async () => {
			const post = await forja.create("post", {
				title: "Filtered Comments Post",
				content: "Content",
				slug: "filtered-comments-post",
				author: userId,
			});
			postWithMixedComments = post.id;

			await forja.createMany("comment", [
				{
					content: "Approved comment 1",
					post: postWithMixedComments,
					author: userId,
					isApproved: true,
				},
				{
					content: "Approved comment 2",
					post: postWithMixedComments,
					author: userId,
					isApproved: true,
				},
				{
					content: "Pending comment",
					post: postWithMixedComments,
					author: userId,
					isApproved: false,
				},
			]);
		});

		it("should filter hasMany results with where", async () => {
			const post = await forja.findById("post", postWithMixedComments, {
				populate: {
					comments: {
						where: { isApproved: true },
					},
				},
			});

			expect(post).not.toBeNull();
			const comments = post!.comments as {
				content: string;
				isApproved: boolean;
			}[];
			expect(Array.isArray(comments)).toBe(true);
			expect(comments.length).toBe(2);
			for (const c of comments) {
				expect(c.isApproved).toBe(true);
			}
		});

		it("should return empty array when where matches nothing", async () => {
			const post = await forja.findById("post", postWithMixedComments, {
				populate: {
					comments: {
						where: { content: "nonexistent" },
					},
				},
			});

			expect(post).not.toBeNull();
			expect(Array.isArray(post!.comments)).toBe(true);
			expect((post!.comments as unknown[]).length).toBe(0);
		});

		it("should filter manyToMany results with where", async () => {
			const user = await forja.findById("user", userId, {
				populate: {
					roles: {
						where: { level: { $gte: 50 } },
					},
				},
			});

			expect(user).not.toBeNull();
			const roles = user!.roles as { name: string; level: number }[];
			expect(Array.isArray(roles)).toBe(true);
			expect(roles.length).toBeGreaterThan(0);
			for (const r of roles) {
				expect(r.level).toBeGreaterThanOrEqual(50);
			}
		});
	});

	// ==========================================================================
	// Populate with orderBy
	// ==========================================================================

	describe("Populate with orderBy", () => {
		let orderedPostId: number;

		beforeAll(async () => {
			const post = await forja.create("post", {
				title: "Ordered Comments Post",
				content: "Content",
				slug: "ordered-comments-post",
				author: userId,
			});
			orderedPostId = post.id;

			await forja.createMany("comment", [
				{ content: "Comment C", post: orderedPostId, author: userId },
				{ content: "Comment A", post: orderedPostId, author: userId },
				{ content: "Comment B", post: orderedPostId, author: userId },
			]);
		});

		it("should order hasMany results ascending", async () => {
			const post = await forja.findById("post", orderedPostId, {
				populate: {
					comments: {
						orderBy: [{ field: "content", direction: "asc" }],
					},
				},
			});

			expect(post).not.toBeNull();
			const comments = post!.comments as { content: string }[];
			expect(comments.length).toBe(3);
			expect(comments[0].content).toBe("Comment A");
			expect(comments[1].content).toBe("Comment B");
			expect(comments[2].content).toBe("Comment C");
		});

		it("should order hasMany results descending", async () => {
			const post = await forja.findById("post", orderedPostId, {
				populate: {
					comments: {
						orderBy: [{ field: "content", direction: "desc" }],
					},
				},
			});

			expect(post).not.toBeNull();
			const comments = post!.comments as { content: string }[];
			expect(comments[0].content).toBe("Comment C");
			expect(comments[2].content).toBe("Comment A");
		});

		it("should order manyToMany results by field", async () => {
			const user = await forja.findById("user", userId, {
				populate: {
					roles: {
						orderBy: [{ field: "level", direction: "asc" }],
					},
				},
			});

			expect(user).not.toBeNull();
			const roles = user!.roles as { level: number }[];
			expect(roles.length).toBeGreaterThan(1);
			for (let i = 1; i < roles.length; i++) {
				expect(roles[i].level).toBeGreaterThanOrEqual(roles[i - 1].level);
			}
		});
	});

	// ==========================================================================
	// Populate with limit and offset
	// ==========================================================================

	describe("Populate with limit and offset", () => {
		let paginatedPostId: number;

		beforeAll(async () => {
			const post = await forja.create("post", {
				title: "Paginated Comments Post",
				content: "Content",
				slug: "paginated-comments-post",
				author: userId,
			});
			paginatedPostId = post.id;

			await forja.createMany("comment", [
				{ content: "Page Comment 1", post: paginatedPostId, author: userId },
				{ content: "Page Comment 2", post: paginatedPostId, author: userId },
				{ content: "Page Comment 3", post: paginatedPostId, author: userId },
				{ content: "Page Comment 4", post: paginatedPostId, author: userId },
				{ content: "Page Comment 5", post: paginatedPostId, author: userId },
			]);
		});

		it("should limit hasMany results", async () => {
			const post = await forja.findById("post", paginatedPostId, {
				populate: {
					comments: {
						limit: 3,
					},
				},
			});

			expect(post).not.toBeNull();
			const comments = post!.comments as unknown[];
			expect(comments.length).toBe(3);
		});

		it("should apply offset to hasMany results", async () => {
			const post = await forja.findById("post", paginatedPostId, {
				populate: {
					comments: {
						orderBy: [{ field: "content", direction: "asc" }],
						offset: 2,
					},
				},
			});

			expect(post).not.toBeNull();
			const comments = post!.comments as { content: string }[];
			expect(comments.length).toBe(3);
			expect(comments[0].content).toBe("Page Comment 3");
		});

		it("should apply limit and offset together (pagination)", async () => {
			const page1 = await forja.findById("post", paginatedPostId, {
				populate: {
					comments: {
						orderBy: [{ field: "content", direction: "asc" }],
						limit: 2,
						offset: 0,
					},
				},
			});

			const page2 = await forja.findById("post", paginatedPostId, {
				populate: {
					comments: {
						orderBy: [{ field: "content", direction: "asc" }],
						limit: 2,
						offset: 2,
					},
				},
			});

			const p1Comments = page1!.comments as { content: string }[];
			const p2Comments = page2!.comments as { content: string }[];

			expect(p1Comments.length).toBe(2);
			expect(p2Comments.length).toBe(2);

			// Pages should not overlap
			const p1Contents = p1Comments.map((c) => c.content);
			const p2Contents = p2Comments.map((c) => c.content);
			for (const content of p2Contents) {
				expect(p1Contents).not.toContain(content);
			}
		});

		it("should limit manyToMany results", async () => {
			const post = await forja.findById("post", postId, {
				populate: {
					tags: {
						limit: 2,
					},
				},
			});

			expect(post).not.toBeNull();
			const tags = post!.tags as unknown[];
			expect(tags.length).toBe(2);
		});
	});

	// ==========================================================================
	// Error Cases
	// ==========================================================================

	describe("Error Cases", () => {
		it("should throw for invalid relation name", async () => {
			await expect(
				forja.findById("post", postId, {
					populate: { nonExistentRelation: true },
				}),
			).rejects.toThrow();
		});

		it("should throw for non-relation field in populate", async () => {
			await expect(
				forja.findById("post", postId, {
					populate: { title: true } as Record<string, unknown>,
				}),
			).rejects.toThrow();
		});
	});

	// ==========================================================================
	// Strategy Coverage
	//
	// Postgres/MySQL have 3 strategies:
	//   json-aggregation : depth 1, no complex options   → covered in populate.test.ts
	//   lateral-joins    : depth 1 + complex options     → covered above (where/orderBy/limit sections)
	//   batched-queries  : depth > 1                     → covered above (Deep Nested Populate)
	//
	// The cases below specifically target:
	//   batched-queries depth > 1 WITH complex options (where/orderBy inside nested populate)
	//   This exercises the populateBatchedRows where/orderBy branch in postgres/mysql adaptors.
	// ==========================================================================

	describe("Strategy Coverage: batched-queries depth>1 + complex options", () => {
		it("should filter nested hasMany with where (depth>1)", async () => {
			// post → author (depth 1) → posts (depth 2) with where filter on nested hasMany
			// In postgres/mysql this forces batched-queries path with where clause
			const post = await forja.findById("post", postId, {
				populate: {
					author: {
						populate: {
							posts: {
								where: { isPublished: true },
							},
						},
					},
				},
			});

			expect(post).not.toBeNull();
			const author = post!.author as {
				name: string;
				posts: { isPublished: boolean }[];
			};
			expect(author).toBeDefined();
			expect(Array.isArray(author.posts)).toBe(true);
			for (const p of author.posts) {
				expect(p.isPublished).toBe(true);
			}
		});

		it("should order nested hasMany with orderBy (depth>1)", async () => {
			// post → author (depth 1) → posts (depth 2) with orderBy
			const post = await forja.findById("post", postId, {
				populate: {
					author: {
						populate: {
							posts: {
								orderBy: [{ field: "title", direction: "asc" }],
							},
						},
					},
				},
			});

			expect(post).not.toBeNull();
			const author = post!.author as {
				posts: { title: string }[];
			};
			expect(author).toBeDefined();
			expect(Array.isArray(author.posts)).toBe(true);

			const titles = author.posts.map((p) => p.title);
			const sorted = [...titles].sort();
			expect(titles).toEqual(sorted);
		});

		it("should filter nested manyToMany with where (depth>1)", async () => {
			// post → author (depth 1) → roles (depth 2, manyToMany) with where filter
			const post = await forja.findById("post", postId, {
				populate: {
					author: {
						populate: {
							roles: {
								where: { level: { $gte: 50 } },
							},
						},
					},
				},
			});

			expect(post).not.toBeNull();
			const author = post!.author as {
				roles: { name: string; level: number }[];
			};
			expect(author).toBeDefined();
			expect(Array.isArray(author.roles)).toBe(true);
			expect(author.roles.length).toBeGreaterThan(0);
			for (const r of author.roles) {
				expect(r.level).toBeGreaterThanOrEqual(50);
			}
		});

		it("should apply limit on nested hasMany (depth>1)", async () => {
			// post → author (depth 1) → posts (depth 2) with limit
			const post = await forja.findById("post", postId, {
				populate: {
					author: {
						populate: {
							posts: {
								limit: 1,
							},
						},
					},
				},
			});

			expect(post).not.toBeNull();
			const author = post!.author as {
				posts: unknown[];
			};
			expect(author).toBeDefined();
			expect(Array.isArray(author.posts)).toBe(true);
			expect(author.posts.length).toBeLessThanOrEqual(1);
		});

		it("should combine where + orderBy + limit on nested hasMany (depth>1)", async () => {
			// post → author (depth 1) → posts (depth 2) combining all complex options
			const post = await forja.findById("post", postId, {
				populate: {
					author: {
						populate: {
							posts: {
								where: { isPublished: true },
								orderBy: [{ field: "title", direction: "desc" }],
								limit: 2,
							},
						},
					},
				},
			});

			expect(post).not.toBeNull();
			const author = post!.author as {
				posts: { title: string; isPublished: boolean }[];
			};
			expect(author).toBeDefined();
			expect(Array.isArray(author.posts)).toBe(true);
			expect(author.posts.length).toBeLessThanOrEqual(2);
			for (const p of author.posts) {
				expect(p.isPublished).toBe(true);
			}

			const titles = author.posts.map((p) => p.title);
			const sortedDesc = [...titles].sort().reverse();
			expect(titles).toEqual(sortedDesc);
		});
	});
});
