/**
 * Migration E2E Tests - Data Preservation
 *
 * Tests that verify data is preserved correctly during migrations:
 * - Column rename preserves data
 * - FK column rename preserves references
 * - Relation type changes can migrate data
 *
 * These tests are CRITICAL - they ensure migrations don't lose user data.
 *
 * API Notes:
 * - findOne(model, where, options?) - where is direct WhereClause
 * - FK columns are hidden by default, use populate: true to get relations
 * - Relations come as objects: post.author.id not post.authorId
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { createForjaWithSchemas, getTmpDir } from "./setup/config";
import { getAdapter, getAdapterType } from "./setup/adapter";
import {
	baseUserSchema,
	basePostSchema,
	basePostSchemaNoRelation,
	baseCategorySchema,
	baseTagSchema,
	cloneSchema,
	TABLE_NAMES,
} from "./setup/schemas-base";
import {
	dropAllTables,
	assertTableExists,
	assertTableNotExists,
	assertColumnExists,
	assertColumnNotExists,
	assertHasChanges,
	applyMigration,
	autoResolveAmbiguous,
} from "./setup/helpers";
import type { DatabaseAdapter } from "forja-types/adapter";

describe("Migration E2E - Data Preservation", () => {
	const tmpDir = getTmpDir("data-preservation");
	let adapter: DatabaseAdapter;

	beforeAll(async () => {
		const adapterType = getAdapterType();
		adapter = await getAdapter(adapterType, tmpDir);
		await adapter.connect();
		await dropAllTables(adapter);
	});

	afterAll(async () => {
		await dropAllTables(adapter);
		await adapter.disconnect();
	});

	// ============================================
	// Column Rename Data Preservation
	// ============================================

	describe("Column rename", () => {
		it("should preserve data when column is renamed", async () => {
			await dropAllTables(adapter);

			// Setup: create user with data
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const session1Result = await forja1.beginMigrate();
			if (session1Result.success) {
				await applyMigration(session1Result.data);
			}

			// Insert test data
			await forja1.create("user", {
				email: "john@test.com",
				name: "John Doe",
				age: 30,
			});
			await forja1.create("user", {
				email: "jane@test.com",
				name: "Jane Smith",
				age: 25,
			});

			// Verify data exists
			const usersBefore = await forja1.findMany("user", {});
			expect(usersBefore).toHaveLength(2);

			await forja1.shutdown();

			// Change: rename 'name' to 'fullName'
			const userWithFullName = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					fullName: { type: "string", required: true },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userWithFullName]);
			const sessionResult = await forja.beginMigrate();
			expect(sessionResult.success).toBe(true);
			if (!sessionResult.success) {
				await forja.shutdown();
				return;
			}

			const session = sessionResult.data;
			assertHasChanges(session);

			// Resolve as rename (not drop+add)
			autoResolveAmbiguous(session, "rename");

			// Apply migration
			await applyMigration(session);

			// Verify data preserved with new column name
			const usersAfter = await forja.findMany("user", {});
			expect(usersAfter).toHaveLength(2);

			const john = usersAfter.find((u) => u.email === "john@test.com");
			const jane = usersAfter.find((u) => u.email === "jane@test.com");

			expect(john?.fullName).toBe("John Doe");
			expect(jane?.fullName).toBe("Jane Smith");

			// Old column should not exist
			await assertColumnNotExists(forja, "user", "name");
			await assertColumnExists(forja, "user", "fullName");

			await forja.shutdown();
		});

		it("should lose data when resolved as drop_and_add", async () => {
			await dropAllTables(adapter);

			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const session1Result = await forja1.beginMigrate();
			if (session1Result.success) {
				await applyMigration(session1Result.data);
			}

			// Insert test data
			await forja1.create("user", {
				email: "john@test.com",
				name: "John Doe",
				age: 30,
			});

			await forja1.shutdown();

			// Rename name to fullName
			const userWithFullName = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					fullName: { type: "string" }, // not required so insert works
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userWithFullName]);
			const sessionResult = await forja.beginMigrate();
			expect(sessionResult.success).toBe(true);
			if (!sessionResult.success) {
				await forja.shutdown();
				return;
			}

			const session = sessionResult.data;

			// Resolve as drop_and_add (data loss)
			autoResolveAmbiguous(session, "drop_and_add");

			await applyMigration(session);

			// Verify data is NULL (lost)
			const users = await forja.findMany("user", {});
			expect(users).toHaveLength(1);
			expect(users[0].fullName).toBeNull();

			await forja.shutdown();
		});
	});

	// ============================================
	// FK Column Rename Data Preservation
	// ============================================

	describe("FK column rename", () => {
		it("should preserve FK references when foreignKey renamed", async () => {
			await dropAllTables(adapter);

			// Setup: post with author belongsTo
			const forja1 = await createForjaWithSchemas(tmpDir, [
				baseUserSchema,
				basePostSchema,
			]);
			const session1Result = await forja1.beginMigrate();
			if (session1Result.success) {
				await applyMigration(session1Result.data);
			}

			// Insert test data
			const user = await forja1.create("user", {
				email: "author@test.com",
				name: "Author",
			});
			await forja1.create("post", {
				title: "My First Post",
				author: { set: user.id },
			});
			await forja1.create("post", {
				title: "My Second Post",
				author: { set: user.id },
			});

			// Verify relation works
			const postsBefore = await forja1.findMany("post", { populate: true });
			expect(postsBefore).toHaveLength(2);
			expect(postsBefore[0].author.id).toBe(user.id);

			await forja1.shutdown();

			// Change: rename foreignKey from 'authorId' to 'writerId'
			const postWithWriter = cloneSchema(basePostSchema, {
				modifyFields: {
					author: {
						type: "relation",
						kind: "belongsTo",
						model: "user",
						foreignKey: "writerId",
					},
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [
				baseUserSchema,
				postWithWriter,
			]);
			const sessionResult = await forja.beginMigrate();
			expect(sessionResult.success).toBe(true);
			if (!sessionResult.success) {
				await forja.shutdown();
				return;
			}

			const session = sessionResult.data;

			// Resolve as rename
			autoResolveAmbiguous(session, "rename");

			await applyMigration(session);

			// Verify FK references preserved - use populate to get relation
			const postsAfter = await forja.findMany("post", { populate: true });
			expect(postsAfter).toHaveLength(2);
			expect(postsAfter[0].author.id).toBe(user.id);
			expect(postsAfter[1].author.id).toBe(user.id);

			// Column should be renamed
			await assertColumnNotExists(forja, "post", "authorId");
			await assertColumnExists(forja, "post", "writerId");

			await forja.shutdown();
		});
	});

	// ============================================
	// Relation Type Change Data Migration
	// ============================================

	describe("Relation type change - belongsTo to manyToMany", () => {
		it("should migrate belongsTo data to junction table when resolved as migrate", async () => {
			await dropAllTables(adapter);

			// Setup: post with category belongsTo
			const postWithCategory = cloneSchema(basePostSchemaNoRelation, {
				addFields: {
					category: { type: "relation", kind: "belongsTo", model: "category" },
				},
			});

			const forja1 = await createForjaWithSchemas(tmpDir, [
				postWithCategory,
				baseCategorySchema,
			]);
			const session1Result = await forja1.beginMigrate();
			if (session1Result.success) {
				await applyMigration(session1Result.data);
			}

			// Insert test data
			const tech = await forja1.create("category", { name: "Tech", slug: "tech" });
			const news = await forja1.create("category", { name: "News", slug: "news" });
			const post1 = await forja1.create("post", {
				title: "Tech Post",
				category: { set: tech.id },
			}, {
				populate: true
			});
			const post2 = await forja1.create("post", {
				title: "News Post",
				category: { set: news.id },
			});
			const post3 = await forja1.create("post", {
				title: "Another Tech Post",
				category: { set: tech.id },
			});

			await forja1.shutdown();

			// Change to manyToMany
			const postWithCategories = cloneSchema(basePostSchemaNoRelation, {
				addFields: {
					categories: { type: "relation", kind: "manyToMany", model: "category" },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [
				postWithCategories,
				baseCategorySchema,
			]);
			const sessionResult = await forja.beginMigrate();
			expect(sessionResult.success).toBe(true);
			if (!sessionResult.success) {
				await forja.shutdown();
				return;
			}

			const session = sessionResult.data;
			assertHasChanges(session);

			autoResolveAmbiguous(session, "migrate");
			await applyMigration(session);

			// Verify junction table exists
			await assertTableExists(forja, "category_post");

			// Verify data migrated to junction table
			const post1WithCats = await forja.findOne("post", { id: { $eq: post1.id } }, { populate: true });
			const post2WithCats = await forja.findOne("post", { id: { $eq: post2.id } }, { populate: true });
			const post3WithCats = await forja.findOne("post", { id: { $eq: post3.id } }, { populate: true });

			expect(post1WithCats?.categories).toHaveLength(1);
			expect(post1WithCats?.categories[0]?.id).toBe(tech.id);
			expect(post2WithCats?.categories).toHaveLength(1);
			expect(post2WithCats?.categories[0]?.id).toBe(news.id);
			expect(post3WithCats?.categories).toHaveLength(1);
			expect(post3WithCats?.categories[0]?.id).toBe(tech.id);

			await forja.shutdown();
		});
	});

	describe("Relation type change - manyToMany to belongsTo", () => {
		it("should migrate first junction record to belongsTo when resolved as migrate_first", async () => {
			await dropAllTables(adapter);

			// Setup: post with tags manyToMany
			const postWithTags = cloneSchema(basePostSchemaNoRelation, {
				addFields: {
					tags: { type: "relation", kind: "manyToMany", model: "tag" },
				},
			});

			const forja1 = await createForjaWithSchemas(tmpDir, [
				postWithTags,
				baseTagSchema,
			]);
			const session1Result = await forja1.beginMigrate();
			if (session1Result.success) {
				await applyMigration(session1Result.data);
			}

			// Insert test data - post with multiple tags
			const js = await forja1.create("tag", { name: "JavaScript" });
			const ts = await forja1.create("tag", { name: "TypeScript" });
			const react = await forja1.create("tag", { name: "React" });
			const post = await forja1.create("post", { title: "Multi-tag Post" });

			// Add multiple tags to post
			await forja1.create("post_tag", { post: { set: post.id }, tag: { set: js.id } });
			await forja1.create("post_tag", { post: { set: post.id }, tag: { set: ts.id } });
			await forja1.create("post_tag", { post: { set: post.id }, tag: { set: react.id } });

			await forja1.shutdown();

			// Change to belongsTo (single tag)
			const postWithTag = cloneSchema(basePostSchemaNoRelation, {
				addFields: {
					tag: { type: "relation", kind: "belongsTo", model: "tag" },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [
				postWithTag,
				baseTagSchema,
			]);
			const sessionResult = await forja.beginMigrate();
			expect(sessionResult.success).toBe(true);
			if (!sessionResult.success) {
				await forja.shutdown();
				return;
			}

			const session = sessionResult.data;
			assertHasChanges(session);

			autoResolveAmbiguous(session, "migrate");
			await applyMigration(session);

			// Verify junction table dropped
			await assertTableNotExists(adapter, "post_tag");

			// Verify FK column exists with first tag's ID
			await assertColumnExists(forja, "post", "tagId");

			const updatedPost = await forja.findOne("post", { id: { $eq: post.id } }, { populate: true });
			expect(updatedPost?.tag?.id).toBe(js.id);

			await forja.shutdown();
		});

		it("should warn about data loss for posts with multiple tags", async () => {
			await dropAllTables(adapter);

			const postWithTags = cloneSchema(basePostSchemaNoRelation, {
				addFields: {
					tags: { type: "relation", kind: "manyToMany", model: "tag" },
				},
			});

			const forja1 = await createForjaWithSchemas(tmpDir, [
				postWithTags,
				baseTagSchema,
			]);
			const session1Result = await forja1.beginMigrate();
			if (session1Result.success) {
				await applyMigration(session1Result.data);
			}

			// Post with 3 tags (will lose 2)
			const tag1 = await forja1.create("tag", { name: "Tag1" });
			const tag2 = await forja1.create("tag", { name: "Tag2" });
			const tag3 = await forja1.create("tag", { name: "Tag3" });
			const post = await forja1.create("post", { title: "Post" });
			await forja1.create("post_tag", { post: { set: post.id }, tag: { set: tag1.id } });
			await forja1.create("post_tag", { post: { set: post.id }, tag: { set: tag2.id } });
			await forja1.create("post_tag", { post: { set: post.id }, tag: { set: tag3.id } });

			await forja1.shutdown();

			// Change to belongsTo
			const postWithTag = cloneSchema(basePostSchemaNoRelation, {
				addFields: {
					tag: { type: "relation", kind: "belongsTo", model: "tag" },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [
				postWithTag,
				baseTagSchema,
			]);
			const sessionResult = await forja.beginMigrate();
			expect(sessionResult.success).toBe(true);
			if (!sessionResult.success) {
				await forja.shutdown();
				return;
			}

			const session = sessionResult.data;

			// TODO: Should have ambiguous with data loss warning
			// const ambiguous = assertAmbiguousExists(session, "relation_downgrade_many_to_single");
			// expect(ambiguous.warning).toContain("data loss");
			// expect(ambiguous.affectedRows).toBe(1); // 1 post with multiple tags

			await forja.shutdown();
		});
	});

	// ============================================
	// Multiple Data Preservation in Single Migration
	// ============================================

	describe("Multiple changes with data preservation", () => {
		it("should preserve data across multiple renames in single migration", async () => {
			await dropAllTables(adapter);

			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const session1Result = await forja1.beginMigrate();
			if (session1Result.success) {
				await applyMigration(session1Result.data);
			}

			// Insert test data
			await forja1.create("user", {
				email: "test@test.com",
				name: "Test User",
				age: 25,
			});

			await forja1.shutdown();

			// Multiple renames: name → fullName, age → yearsOld
			const userRenamed = cloneSchema(baseUserSchema, {
				removeFields: ["name", "age"],
				addFields: {
					fullName: { type: "string", required: true },
					yearsOld: { type: "number" },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userRenamed]);
			const sessionResult = await forja.beginMigrate();
			expect(sessionResult.success).toBe(true);
			if (!sessionResult.success) {
				await forja.shutdown();
				return;
			}

			const session = sessionResult.data;

			// Resolve all as rename
			autoResolveAmbiguous(session, "rename");

			await applyMigration(session);

			// Verify all data preserved
			const users = await forja.findMany("user", {});
			expect(users).toHaveLength(1);
			expect(users[0].fullName).toBe("Test User");
			expect(users[0].yearsOld).toBe(25);

			await forja.shutdown();
		});
	});

	// ============================================
	// Edge Cases
	// ============================================

	describe("Edge cases", () => {
		it("should handle empty tables gracefully", async () => {
			await dropAllTables(adapter);

			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const session1Result = await forja1.beginMigrate();
			if (session1Result.success) {
				await applyMigration(session1Result.data);
			}
			// No data inserted
			await forja1.shutdown();

			// Rename column
			const userRenamed = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					fullName: { type: "string", required: true },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userRenamed]);
			const sessionResult = await forja.beginMigrate();
			expect(sessionResult.success).toBe(true);
			if (!sessionResult.success) {
				await forja.shutdown();
				return;
			}

			const session = sessionResult.data;
			autoResolveAmbiguous(session, "rename");

			// Should not error on empty table
			await applyMigration(session);

			await assertColumnExists(forja, "user", "fullName");
			await assertColumnNotExists(forja, "user", "name");

			await forja.shutdown();
		});

		it("should handle NULL values in renamed columns", async () => {
			await dropAllTables(adapter);

			// User with optional age field
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const session1Result = await forja1.beginMigrate();
			if (session1Result.success) {
				await applyMigration(session1Result.data);
			}

			// Insert user with NULL age
			await forja1.create("user", {
				email: "test@test.com",
				name: "Test",
				// age not provided (NULL)
			});

			await forja1.shutdown();

			// Rename age to yearsOld
			const userRenamed = cloneSchema(baseUserSchema, {
				removeFields: ["age"],
				addFields: {
					yearsOld: { type: "number" },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userRenamed]);
			const sessionResult = await forja.beginMigrate();
			expect(sessionResult.success).toBe(true);
			if (!sessionResult.success) {
				await forja.shutdown();
				return;
			}

			const session = sessionResult.data;
			autoResolveAmbiguous(session, "rename");

			await applyMigration(session);

			// NULL should be preserved
			const users = await forja.findMany("user", {});
			expect(users[0].yearsOld).toBeNull();

			await forja.shutdown();
		});

		it("should handle large datasets efficiently", async () => {
			await dropAllTables(adapter);

			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const session1Result = await forja1.beginMigrate();
			if (session1Result.success) {
				await applyMigration(session1Result.data);
			}

			// Insert many records
			const insertPromises = [];
			for (let i = 0; i < 100; i++) {
				insertPromises.push(
					forja1.create("user", {
						email: `user${i}@test.com`,
						name: `User ${i}`,
						age: 20 + (i % 50),
					}),
				);
			}
			await Promise.all(insertPromises);

			await forja1.shutdown();

			// Rename column
			const userRenamed = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					fullName: { type: "string", required: true },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userRenamed]);
			const sessionResult = await forja.beginMigrate();
			expect(sessionResult.success).toBe(true);
			if (!sessionResult.success) {
				await forja.shutdown();
				return;
			}

			const session = sessionResult.data;
			autoResolveAmbiguous(session, "rename");

			const startTime = Date.now();
			await applyMigration(session);
			const duration = Date.now() - startTime;

			// Should complete reasonably fast (< 5 seconds for 100 records)
			expect(duration).toBeLessThan(5000);

			// Verify all data preserved
			const users = await forja.findMany("user", {});
			expect(users).toHaveLength(100);
			expect(users.every((u) => u.fullName?.startsWith("User "))).toBe(true);

			await forja.shutdown();
		});
	});
});
