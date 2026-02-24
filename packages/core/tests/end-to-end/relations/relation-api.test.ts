/**
 * Relation API Tests
 *
 * Comprehensive tests for all relation types and all relation operations.
 * Each relation type (belongsTo, hasOne, hasMany, manyToMany) is tested with:
 * - set (shortcut: relation: id or relation: [ids])
 * - connect
 * - disconnect
 * - create (nested)
 * - update (nested)
 * - delete (nested)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";

describe("Relation API", () => {
	let forja: Forja;
	const tmpDir = getTmpDir("relation-api");

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const getForja = await createTestConfig(tmpDir);
		forja = await getForja();

		await setupTables(forja);
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// ==========================================================================
	// belongsTo - FK is on owner table
	// Example: post.author (belongsTo user) -> posts table has authorId
	// ==========================================================================
	describe("belongsTo", () => {
		let userId1: number;
		let userId2: number;
		let categoryId: number;

		beforeAll(async () => {
			// Create test users
			const user1 = await forja.create("user", {
				email: "belongsto-user1@test.com",
				name: "BelongsTo User 1",
			});
			userId1 = user1.id;

			const user2 = await forja.create("user", {
				email: "belongsto-user2@test.com",
				name: "BelongsTo User 2",
			});
			userId2 = user2.id;

			// Create category for posts
			const category = await forja.create("category", {
				name: "BelongsTo Category",
				slug: "belongsto-category",
			});
			categoryId = category.id;
		});

		describe("set (shortcut)", () => {
			it("should set belongsTo relation with ID shortcut on create", async () => {
				const post = await forja.create("post", {
					title: "BelongsTo Set Test",
					content: "Testing belongsTo set",
					slug: "belongsto-set-test",
					author: userId1, // shortcut for { set: [userId1] }
					category: categoryId,
				});

				const fetched = await forja.findById("post", post.id, {
					populate: { author: true },
				});

				expect(fetched!.author).toBeDefined();
				expect((fetched!.author as { id: number }).id).toBe(userId1);
			});

			it("should change belongsTo relation with set on update", async () => {
				const post = await forja.create("post", {
					title: "BelongsTo Set Update",
					content: "Testing belongsTo set update",
					slug: "belongsto-set-update",
					author: userId1,
					category: categoryId,
				});

				// Change author to user2
				await forja.update("post", post.id, {
					author: userId2,
				});

				const fetched = await forja.findById("post", post.id, {
					populate: { author: true },
				});

				expect((fetched!.author as { id: number }).id).toBe(userId2);
			});
		});

		describe("connect", () => {
			it("should connect belongsTo relation", async () => {
				const post = await forja.create("post", {
					title: "BelongsTo Connect Test",
					content: "Testing belongsTo connect",
					slug: "belongsto-connect-test",
					category: categoryId,
				});

				// Connect author
				await forja.update("post", post.id, {
					author: { connect: userId1 },
				});

				const fetched = await forja.findById("post", post.id, {
					populate: { author: true },
				});

				expect((fetched!.author as { id: number }).id).toBe(userId1);
			});
		});

		describe("disconnect", () => {
			it("should disconnect belongsTo relation with null", async () => {
				const post = await forja.create("post", {
					title: "BelongsTo Disconnect Test",
					content: "Testing belongsTo disconnect",
					slug: "belongsto-disconnect-test",
					author: userId1,
					category: categoryId,
				});

				// Disconnect author
				await forja.update("post", post.id, {
					author: null,
				});

				const fetched = await forja.findById("post", post.id, {
					populate: { author: true },
				});

				expect(fetched!.author).toBeNull();
			});

			it("should disconnect belongsTo relation with disconnect operation", async () => {
				const post = await forja.create("post", {
					title: "BelongsTo Disconnect Op Test",
					content: "Testing belongsTo disconnect op",
					slug: "belongsto-disconnect-op",
					author: userId1,
					category: categoryId,
				});

				// Disconnect using operation
				await forja.update("post", post.id, {
					author: { disconnect: true },
				});

				const fetched = await forja.findById("post", post.id, {
					populate: { author: true },
				});

				expect(fetched!.author).toBeNull();
			});
		});

		describe("create (nested)", () => {
			it("should create belongsTo relation inline", async () => {
				const post = await forja.create("post", {
					title: "BelongsTo Nested Create",
					content: "Testing belongsTo nested create",
					slug: "belongsto-nested-create",
					category: categoryId,
					author: {
						create: {
							email: "nested-author@test.com",
							name: "Nested Author",
						},
					},
				});

				const fetched = await forja.findById("post", post.id, {
					populate: { author: true },
				});

				expect(fetched!.author).toBeDefined();
				expect((fetched!.author as { name: string }).name).toBe(
					"Nested Author",
				);
			});
		});

		describe("update (nested)", () => {
			it("should update belongsTo relation inline", async () => {
				// Create user and post
				const user = await forja.create("user", {
					email: "belongsto-update-target@test.com",
					name: "Original Name",
				});

				const post = await forja.create("post", {
					title: "BelongsTo Update Test",
					content: "Testing belongsTo nested update",
					slug: "belongsto-nested-update",
					author: user.id,
					category: categoryId,
				});

				// Update author via post
				await forja.update("post", post.id, {
					author: {
						update: {
							where: { id: user.id },
							data: { name: "Updated Name" },
						},
					},
				});

				const fetched = await forja.findById("post", post.id, {
					populate: { author: true },
				});

				expect((fetched!.author as { name: string }).name).toBe("Updated Name");
			});
		});

		describe("delete (nested)", () => {
			it("should delete belongsTo relation target", async () => {
				// Create user and post
				const user = await forja.create("user", {
					email: "belongsto-delete-target@test.com",
					name: "To Be Deleted",
				});

				const post = await forja.create("post", {
					title: "BelongsTo Delete Test",
					content: "Testing belongsTo nested delete",
					slug: "belongsto-nested-delete",
					author: user.id,
					category: categoryId,
				});

				// Delete author via post
				await forja.update("post", post.id, {
					author: { delete: [user.id] },
				});

				// Verify user is deleted
				const deletedUser = await forja.findById("user", user.id);
				expect(deletedUser).toBeNull();

				// Post should still exist but author should be null
				const fetchedPost = await forja.findById("post", post.id, {
					populate: { author: true },
				});
				expect(fetchedPost).toBeDefined();
				expect(fetchedPost!.author).toBeNull();
			});
		});
	});

	// ==========================================================================
	// hasOne - FK is on target table
	// Example: user.favoriteCategory (hasOne category) -> categories table has userId
	// ==========================================================================
	describe("hasOne", () => {
		describe("set (shortcut)", () => {
			it("should set hasOne relation with ID shortcut on create", async () => {
				// Create category first
				const category = await forja.create("category", {
					name: "HasOne Set Category",
					slug: "hasone-set-category",
				});

				// Create user and set favoriteCategory
				const user = await forja.create("user", {
					email: "hasone-set@test.com",
					name: "HasOne Set User",
					favoriteCategory: category.id,
				});

				const fetched = await forja.findById("user", user.id, {
					populate: { favoriteCategory: true },
				});

				expect(fetched!.favoriteCategory).toBeDefined();
				expect((fetched!.favoriteCategory as { id: number }).id).toBe(
					category.id,
				);
			});

			it("should change hasOne relation with set on update", async () => {
				const cat1 = await forja.create("category", {
					name: "HasOne Cat 1",
					slug: "hasone-cat-1",
				});
				const cat2 = await forja.create("category", {
					name: "HasOne Cat 2",
					slug: "hasone-cat-2",
				});

				const user = await forja.create("user", {
					email: "hasone-change@test.com",
					name: "HasOne Change User",
					favoriteCategory: cat1.id,
				});

				// Change to cat2
				await forja.update("user", user.id, {
					favoriteCategory: cat2.id,
				});

				const fetched = await forja.findById("user", user.id, {
					populate: { favoriteCategory: true },
				});

				expect((fetched!.favoriteCategory as { id: number }).id).toBe(cat2.id);
			});
		});

		describe("connect", () => {
			it("should connect hasOne relation", async () => {
				const category = await forja.create("category", {
					name: "HasOne Connect Cat",
					slug: "hasone-connect-cat",
				});

				const user = await forja.create("user", {
					email: "hasone-connect@test.com",
					name: "HasOne Connect User",
				});

				// Connect favoriteCategory
				await forja.update("user", user.id, {
					favoriteCategory: { connect: category.id },
				});

				const fetched = await forja.findById("user", user.id, {
					populate: { favoriteCategory: true },
				});

				expect((fetched!.favoriteCategory as { id: number }).id).toBe(
					category.id,
				);
			});
		});

		describe("disconnect", () => {
			it("should disconnect hasOne relation with null", async () => {
				const category = await forja.create("category", {
					name: "HasOne Disconnect Cat",
					slug: "hasone-disconnect-cat",
				});

				const user = await forja.create("user", {
					email: "hasone-disconnect@test.com",
					name: "HasOne Disconnect User",
					favoriteCategory: category.id,
				});

				// Disconnect
				await forja.update("user", user.id, {
					favoriteCategory: null,
				});

				const fetched = await forja.findById("user", user.id, {
					populate: { favoriteCategory: true },
				});

				expect(fetched!.favoriteCategory).toBeNull();
			});

			it("should disconnect hasOne relation with disconnect operation", async () => {
				const category = await forja.create("category", {
					name: "HasOne Disconnect Op Cat",
					slug: "hasone-disconnect-op-cat",
				});

				const user = await forja.create("user", {
					email: "hasone-disconnect-op@test.com",
					name: "HasOne Disconnect Op User",
					favoriteCategory: category.id,
				});

				// Disconnect using operation
				await forja.update("user", user.id, {
					favoriteCategory: { disconnect: true },
				});

				const fetched = await forja.findById("user", user.id, {
					populate: { favoriteCategory: true },
				});

				expect(fetched!.favoriteCategory).toBeNull();
			});
		});

		describe("create (nested)", () => {
			it("should create hasOne relation inline", async () => {
				const user = await forja.create("user", {
					email: "hasone-nested@test.com",
					name: "HasOne Nested User",
					favoriteCategory: {
						create: {
							name: "Nested Favorite",
							slug: "nested-favorite",
						},
					},
				});

				const fetched = await forja.findById("user", user.id, {
					populate: { favoriteCategory: true },
				});

				expect(fetched!.favoriteCategory).toBeDefined();
				expect((fetched!.favoriteCategory as { name: string }).name).toBe(
					"Nested Favorite",
				);
			});
		});

		describe("update (nested)", () => {
			it("should update hasOne relation inline", async () => {
				const category = await forja.create("category", {
					name: "HasOne Update Cat",
					slug: "hasone-update-cat",
				});

				const user = await forja.create("user", {
					email: "hasone-update@test.com",
					name: "HasOne Update User",
					favoriteCategory: category.id,
				});

				// Update category via user
				await forja.update("user", user.id, {
					favoriteCategory: {
						update: {
							where: { id: category.id },
							data: { name: "Updated Category Name" },
						},
					},
				});

				const fetched = await forja.findById("user", user.id, {
					populate: { favoriteCategory: true },
				});

				expect((fetched!.favoriteCategory as { name: string }).name).toBe(
					"Updated Category Name",
				);
			});
		});

		describe("delete (nested)", () => {
			it("should delete hasOne relation target", async () => {
				const category = await forja.create("category", {
					name: "HasOne Delete Cat",
					slug: "hasone-delete-cat",
				});

				const user = await forja.create("user", {
					email: "hasone-delete@test.com",
					name: "HasOne Delete User",
					favoriteCategory: category.id,
				});

				// Delete category via user
				await forja.update("user", user.id, {
					favoriteCategory: { delete: [category.id] },
				});

				// Verify category is deleted
				const deletedCategory = await forja.findById("category", category.id);
				expect(deletedCategory).toBeNull();

				// User should still exist but favoriteCategory should be null
				const fetchedUser = await forja.findById("user", user.id, {
					populate: { favoriteCategory: true },
				});
				expect(fetchedUser).toBeDefined();
				expect(fetchedUser!.favoriteCategory).toBeNull();
			});
		});
	});

	// ==========================================================================
	// hasMany - FK is on target table (plural)
	// Example: user.posts (hasMany post) -> posts table has userId FK
	// NOTE: user.posts and post.author are INDEPENDENT relations!
	// ==========================================================================
	describe("hasMany", () => {
		let categoryId: number;

		beforeAll(async () => {
			// Create a shared category for posts
			const category = await forja.create("category", {
				name: "HasMany Test Category",
				slug: "hasmany-test-category",
			});
			categoryId = category.id;
		});

		describe("set (shortcut)", () => {
			it("should set hasMany relation with array shortcut", async () => {
				// Step 1: Create user with no posts
				const user = await forja.create(
					"user",
					{
						email: "hasmany-set@test.com",
						name: "HasMany Set User",
					},
					{ populate: { posts: true } },
				);

				expect((user.posts as []).length).toBe(0);

				// Step 2: Create posts (not connected to user yet)
				const post1 = await forja.create("post", {
					title: "HM Set Post 1",
					content: "Content 1",
					slug: "hm-set-post-1",
					category: categoryId,
				});
				const post2 = await forja.create("post", {
					title: "HM Set Post 2",
					content: "Content 2",
					slug: "hm-set-post-2",
					category: categoryId,
				});

				// Step 3: Set posts to user using array shortcut
				const updated = await forja.update(
					"user",
					user.id,
					{
						posts: [post1.id, post2.id],
					},
					{ populate: { posts: true } },
				);

				const posts = updated!.posts as { id: number }[];
				expect(posts.length).toBe(2);
				expect(posts.map((p) => p.id).sort()).toEqual(
					[post1.id, post2.id].sort(),
				);
			});

			it("should replace hasMany relations with set", async () => {
				// Step 1: Create user
				const user = await forja.create(
					"user",
					{
						email: "hasmany-replace@test.com",
						name: "HasMany Replace User",
					},
					{ populate: { posts: true } },
				);

				expect((user.posts as []).length).toBe(0);

				// Step 2: Create post1 and post2
				const post1 = await forja.create("post", {
					title: "HM Replace 1",
					content: "Content",
					slug: "hm-replace-1",
					category: categoryId,
				});
				const post2 = await forja.create("post", {
					title: "HM Replace 2",
					content: "Content",
					slug: "hm-replace-2",
					category: categoryId,
				});

				// Step 3: Set both posts to user
				const withBoth = await forja.update(
					"user",
					user.id,
					{
						posts: { set: [post1.id, post2.id] },
					},
					{ populate: { posts: true } },
				);

				expect((withBoth!.posts as []).length).toBe(2);

				// Step 4: Replace with only post2
				const replaced = await forja.update(
					"user",
					user.id,
					{
						posts: { set: [post2.id] },
					},
					{ populate: { posts: true } },
				);

				const posts = replaced!.posts as { id: number }[];
				expect(posts.length).toBe(1);
				expect(posts[0].id).toBe(post2.id);
			});

			it("should clear hasMany relations with empty set", async () => {
				// Step 1: Create user with posts
				const user = await forja.create("user", {
					email: "hasmany-clear@test.com",
					name: "HasMany Clear User",
				});

				const post = await forja.create("post", {
					title: "HM Clear Post",
					content: "Content",
					slug: "hm-clear-post",
					category: categoryId,
				});

				await forja.update("user", user.id, {
					posts: [post.id],
				});

				// Step 2: Clear all posts
				const cleared = await forja.update(
					"user",
					user.id,
					{
						posts: { set: [] },
					},
					{ populate: { posts: true } },
				);

				expect((cleared!.posts as []).length).toBe(0);
			});
		});

		describe("connect", () => {
			it("should connect hasMany relations", async () => {
				// Step 1: Create user with no posts
				const user = await forja.create(
					"user",
					{
						email: "hasmany-connect@test.com",
						name: "HasMany Connect User",
					},
					{ populate: { posts: true } },
				);

				expect((user.posts as []).length).toBe(0);

				// Step 2: Create post
				const post = await forja.create("post", {
					title: "HM Connect Post",
					content: "Content",
					slug: "hm-connect-post",
					category: categoryId,
				});

				// Step 3: Connect post to user
				const updated = await forja.update(
					"user",
					user.id,
					{
						posts: { connect: [post.id] },
					},
					{ populate: { posts: true } },
				);

				const posts = updated!.posts as { id: number }[];
				expect(posts.length).toBe(1);
				expect(posts[0].id).toBe(post.id);
			});

			it("should add to existing hasMany relations with connect", async () => {
				// Step 1: Create user
				const user = await forja.create("user", {
					email: "hasmany-add@test.com",
					name: "HasMany Add User",
				});

				// Step 2: Create and connect post1
				const post1 = await forja.create("post", {
					title: "HM Add 1",
					content: "Content",
					slug: "hm-add-1",
					category: categoryId,
				});

				const withPost1 = await forja.update(
					"user",
					user.id,
					{
						posts: { connect: [post1.id] },
					},
					{ populate: { posts: true } },
				);

				expect((withPost1!.posts as []).length).toBe(1);

				// Step 3: Create and connect post2 (should add, not replace)
				const post2 = await forja.create("post", {
					title: "HM Add 2",
					content: "Content",
					slug: "hm-add-2",
					category: categoryId,
				});

				const withBoth = await forja.update(
					"user",
					user.id,
					{
						posts: { connect: [post2.id] },
					},
					{ populate: { posts: true } },
				);

				const posts = withBoth!.posts as { id: number }[];
				expect(posts.length).toBe(2);
			});
		});

		describe("disconnect", () => {
			it("should disconnect hasMany relations", async () => {
				// Step 1: Create user with two posts
				const user = await forja.create("user", {
					email: "hasmany-disconnect@test.com",
					name: "HasMany Disconnect User",
				});

				const post1 = await forja.create("post", {
					title: "HM Disconnect 1",
					content: "Content",
					slug: "hm-disconnect-1",
					category: categoryId,
				});
				const post2 = await forja.create("post", {
					title: "HM Disconnect 2",
					content: "Content",
					slug: "hm-disconnect-2",
					category: categoryId,
				});

				const withBoth = await forja.update(
					"user",
					user.id,
					{
						posts: { set: [post1.id, post2.id] },
					},
					{ populate: { posts: true } },
				);

				expect((withBoth!.posts as []).length).toBe(2);

				// Step 2: Disconnect post1
				const afterDisconnect = await forja.update(
					"user",
					user.id,
					{
						posts: { disconnect: [post1.id] },
					},
					{ populate: { posts: true } },
				);

				const posts = afterDisconnect!.posts as { id: number }[];
				expect(posts.length).toBe(1);
				expect(posts[0].id).toBe(post2.id);
			});
		});

		describe("create (nested)", () => {
			it("should create hasMany relations inline", async () => {
				const user = await forja.create(
					"user",
					{
						email: "hasmany-nested@test.com",
						name: "HasMany Nested User",
						posts: {
							create: [
								{
									title: "Nested Post 1",
									content: "Content",
									slug: "hm-nested-post-1",
									category: categoryId,
								},
								{
									title: "Nested Post 2",
									content: "Content",
									slug: "hm-nested-post-2",
									category: categoryId,
								},
							],
						},
					},
					{ populate: { posts: true } },
				);

				const posts = user.posts as { title: string }[];
				expect(posts.length).toBe(2);
				expect(posts.map((p) => p.title).sort()).toEqual([
					"Nested Post 1",
					"Nested Post 2",
				]);
			});
		});

		describe("update (nested)", () => {
			it("should update hasMany relations inline", async () => {
				// Step 1: Create user with posts
				const user = await forja.create("user", {
					email: "hasmany-update@test.com",
					name: "HasMany Update User",
				});

				const post = await forja.create("post", {
					title: "HM Update Post",
					content: "Original Content",
					slug: "hm-update-post",
					category: categoryId,
				});

				await forja.update("user", user.id, {
					posts: { set: [post.id] },
				});

				// Step 2: Update post via user
				await forja.update("user", user.id, {
					posts: {
						update: {
							where: { id: post.id },
							data: { title: "Updated Post Title" },
						},
					},
				});

				const fetched = await forja.findById("user", user.id, {
					populate: { posts: true },
				});

				const posts = fetched!.posts as { title: string }[];
				expect(posts.length).toBe(1);
				expect(posts[0].title).toBe("Updated Post Title");
			});
		});

		describe("delete (nested)", () => {
			it("should delete hasMany relations", async () => {
				// Step 1: Create user with two posts
				const user = await forja.create("user", {
					email: "hasmany-delete@test.com",
					name: "HasMany Delete User",
				});

				const post1 = await forja.create("post", {
					title: "HM Delete 1",
					content: "Content",
					slug: "hm-delete-1",
					category: categoryId,
				});
				const post2 = await forja.create("post", {
					title: "HM Delete 2",
					content: "Content",
					slug: "hm-delete-2",
					category: categoryId,
				});

				await forja.update("user", user.id, {
					posts: { set: [post1.id, post2.id] },
				});

				// Step 2: Delete post1
				const afterDelete = await forja.update(
					"user",
					user.id,
					{
						posts: { delete: [post1.id] },
					},
					{ populate: { posts: true } },
				);

				const posts = afterDelete!.posts as { id: number }[];
				expect(posts.length).toBe(1);
				expect(posts[0].id).toBe(post2.id);

				// Step 3: Verify post1 is actually deleted from database
				const deletedPost = await forja.findById("post", post1.id);
				expect(deletedPost).toBeNull();
			});
		});
	});

	// ==========================================================================
	// manyToMany - Uses junction table
	// Example: user.roles (manyToMany role) -> user_role junction table
	// ==========================================================================
	describe("manyToMany", () => {
		let roleId1: number;
		let roleId2: number;
		let roleId3: number;

		beforeAll(async () => {
			const role1 = await forja.create("role", {
				name: "M2M Role 1",
				level: 10,
			});
			const role2 = await forja.create("role", {
				name: "M2M Role 2",
				level: 20,
			});
			const role3 = await forja.create("role", {
				name: "M2M Role 3",
				level: 30,
			});
			roleId1 = role1.id;
			roleId2 = role2.id;
			roleId3 = role3.id;
		});

		describe("set (shortcut)", () => {
			it("should set manyToMany relation with array shortcut on create", async () => {
				const user = await forja.create("user", {
					email: "m2m-set@test.com",
					name: "M2M Set User",
					roles: [roleId1, roleId2],
				});

				const fetched = await forja.findById("user", user.id, {
					populate: { roles: true },
				});

				const roles = fetched!.roles as { id: number }[];
				expect(roles.length).toBe(2);
				expect(roles.map((r) => r.id).sort()).toEqual(
					[roleId1, roleId2].sort(),
				);
			});

			it("should replace manyToMany relations with set", async () => {
				const user = await forja.create("user", {
					email: "m2m-replace@test.com",
					name: "M2M Replace User",
					roles: [roleId1, roleId2],
				});

				// Replace with only role3
				await forja.update("user", user.id, {
					roles: { set: [roleId3] },
				});

				const fetched = await forja.findById("user", user.id, {
					populate: { roles: true },
				});

				const roles = fetched!.roles as { id: number }[];
				expect(roles.length).toBe(1);
				expect(roles[0].id).toBe(roleId3);
			});

			it("should clear manyToMany relations with empty set", async () => {
				const user = await forja.create("user", {
					email: "m2m-clear@test.com",
					name: "M2M Clear User",
					roles: [roleId1, roleId2],
				});

				// Clear all roles
				await forja.update("user", user.id, {
					roles: { set: [] },
				});

				const fetched = await forja.findById("user", user.id, {
					populate: { roles: true },
				});

				const roles = fetched!.roles as { id: number }[];
				expect(roles.length).toBe(0);
			});
		});

		describe("connect", () => {
			it("should connect manyToMany relations", async () => {
				const user = await forja.create("user", {
					email: "m2m-connect@test.com",
					name: "M2M Connect User",
				});

				// Connect roles
				await forja.update("user", user.id, {
					roles: { connect: [roleId1, roleId2] },
				});

				const fetched = await forja.findById("user", user.id, {
					populate: { roles: true },
				});

				const roles = fetched!.roles as { id: number }[];
				expect(roles.length).toBe(2);
			});

			it("should add to existing manyToMany relations with connect", async () => {
				const user = await forja.create("user", {
					email: "m2m-add@test.com",
					name: "M2M Add User",
					roles: [roleId1],
				});

				// Add role2
				await forja.update("user", user.id, {
					roles: { connect: [roleId2] },
				});

				const fetched = await forja.findById("user", user.id, {
					populate: { roles: true },
				});

				const roles = fetched!.roles as { id: number }[];
				expect(roles.length).toBe(2);
			});
		});

		describe("disconnect", () => {
			it("should disconnect manyToMany relations", async () => {
				const user = await forja.create("user", {
					email: "m2m-disconnect@test.com",
					name: "M2M Disconnect User",
					roles: [roleId1, roleId2, roleId3],
				});

				// Disconnect role1
				await forja.update("user", user.id, {
					roles: { disconnect: [roleId1] },
				});

				const fetched = await forja.findById("user", user.id, {
					populate: { roles: true },
				});

				const roles = fetched!.roles as { id: number }[];
				expect(roles.length).toBe(2);
				expect(roles.map((r) => r.id)).not.toContain(roleId1);
			});
		});

		describe("create (nested)", () => {
			it("should create manyToMany relations inline", async () => {
				const user = await forja.create("user", {
					email: "m2m-nested@test.com",
					name: "M2M Nested User",
					roles: {
						create: [
							{ name: "Nested Role 1", level: 40 },
							{ name: "Nested Role 2", level: 50 },
						],
					},
				});

				const fetched = await forja.findById("user", user.id, {
					populate: { roles: true },
				});

				const roles = fetched!.roles as { name: string }[];
				expect(roles.length).toBe(2);
				expect(roles.map((r) => r.name).sort()).toEqual([
					"Nested Role 1",
					"Nested Role 2",
				]);
			});

			it("should mix connect and create in manyToMany", async () => {
				const user = await forja.create("user", {
					email: "m2m-mix@test.com",
					name: "M2M Mix User",
					roles: {
						connect: [roleId1],
						create: [{ name: "Mixed New Role", level: 60 }],
					},
				});

				const fetched = await forja.findById("user", user.id, {
					populate: { roles: true },
				});

				const roles = fetched!.roles as { id: number; name: string }[];
				expect(roles.length).toBe(2);
				expect(roles.some((r) => r.id === roleId1)).toBe(true);
				expect(roles.some((r) => r.name === "Mixed New Role")).toBe(true);
			});
		});

		describe("update (nested)", () => {
			it("should update manyToMany relations inline", async () => {
				// Create a role that will be updated
				const role = await forja.create("role", {
					name: "M2M Update Role",
					level: 80,
				});

				const user = await forja.create("user", {
					email: "m2m-update@test.com",
					name: "M2M Update User",
					roles: [role.id],
				});

				// Update role via user
				await forja.update("user", user.id, {
					roles: {
						update: {
							where: { id: role.id },
							data: { name: "Updated Role Name" },
						},
					},
				});

				const fetched = await forja.findById("user", user.id, {
					populate: { roles: true },
				});

				const roles = fetched!.roles as { name: string }[];
				expect(roles.length).toBe(1);
				expect(roles[0].name).toBe("Updated Role Name");
			});
		});

		describe("delete (nested)", () => {
			it("should delete manyToMany relations (removes record entirely)", async () => {
				// Create a role that will be deleted
				const tempRole = await forja.create("role", {
					name: "Temp Role",
					level: 70,
				});

				const user = await forja.create("user", {
					email: "m2m-delete@test.com",
					name: "M2M Delete User",
					roles: [tempRole.id, roleId1],
				});

				// Delete tempRole
				await forja.update("user", user.id, {
					roles: { delete: [tempRole.id] },
				});

				const fetched = await forja.findById("user", user.id, {
					populate: { roles: true },
				});

				const roles = fetched!.roles as { id: number }[];
				expect(roles.length).toBe(1);
				expect(roles[0].id).toBe(roleId1);

				// Verify tempRole is actually deleted
				const deletedRole = await forja.findById("role", tempRole.id);
				expect(deletedRole).toBeNull();
			});
		});
	});
});
