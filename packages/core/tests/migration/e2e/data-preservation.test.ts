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
import { createDatrixWithSchemas, getTmpDir } from "./setup/config";
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
	assertAmbiguousExists,
	applyMigration,
	autoResolveAmbiguous,
} from "./setup/helpers";
import type { DatabaseAdapter } from "@datrix/core";

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
			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);

			// Insert test data
			await datrix1.create("user", {
				email: "john@test.com",
				name: "John Doe",
				age: 30,
			});
			await datrix1.create("user", {
				email: "jane@test.com",
				name: "Jane Smith",
				age: 25,
			});

			// Verify data exists
			const usersBefore = await datrix1.findMany("user", {});
			expect(usersBefore).toHaveLength(2);

			await datrix1.shutdown();

			// Change: rename 'name' to 'fullName'
			const userWithFullName = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					fullName: { type: "string", required: true },
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userWithFullName],
				true,
			);
			const session = await datrix.beginMigrate();
			assertHasChanges(session);

			// Resolve as rename (not drop+add)
			autoResolveAmbiguous(session, "rename");

			// Apply migration
			await applyMigration(session);

			// Verify data preserved with new column name
			const usersAfter = await datrix.findMany("user", {});
			expect(usersAfter).toHaveLength(2);

			const john = usersAfter.find((u) => u.email === "john@test.com");
			const jane = usersAfter.find((u) => u.email === "jane@test.com");

			expect(john?.fullName).toBe("John Doe");
			expect(jane?.fullName).toBe("Jane Smith");

			// Old column should not exist
			await assertColumnNotExists(datrix, "user", "name");
			await assertColumnExists(datrix, "user", "fullName");

			await datrix.shutdown();
		});

		it("should lose data when resolved as drop_and_add", async () => {
			await dropAllTables(adapter);

			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);

			// Insert test data
			await datrix1.create("user", {
				email: "john@test.com",
				name: "John Doe",
				age: 30,
			});

			await datrix1.shutdown();

			// Rename name to fullName
			const userWithFullName = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					fullName: { type: "string" }, // not required so insert works
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userWithFullName],
				true,
			);
			const session = await datrix.beginMigrate();

			// Resolve as drop_and_add (data loss)
			autoResolveAmbiguous(session, "drop_and_add");

			await applyMigration(session);

			// Verify data is NULL (lost)
			const users = await datrix.findMany("user", {});
			expect(users).toHaveLength(1);
			expect(users[0].fullName).toBeNull();

			await datrix.shutdown();
		});
	});

	// ============================================
	// FK Column Rename Data Preservation
	// ============================================

	describe("FK column rename", () => {
		it("should preserve FK references when foreignKey renamed", async () => {
			await dropAllTables(adapter);

			// Setup: post with author belongsTo
			const datrix1 = await createDatrixWithSchemas(tmpDir, [
				baseUserSchema,
				basePostSchema,
			]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);

			// Insert test data
			const user = await datrix1.create("user", {
				email: "author@test.com",
				name: "Author",
			});
			await datrix1.create("post", {
				title: "My First Post",
				author: { set: user.id },
			});
			await datrix1.create("post", {
				title: "My Second Post",
				author: { set: user.id },
			});

			// Verify relation works
			const postsBefore = await datrix1.findMany("post", { populate: true });
			expect(postsBefore).toHaveLength(2);
			expect(postsBefore[0].author.id).toBe(user.id);

			await datrix1.shutdown();

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

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[baseUserSchema, postWithWriter],
				true,
			);
			const session = await datrix.beginMigrate();

			// Resolve as rename
			autoResolveAmbiguous(session, "rename");

			await applyMigration(session);

			// Verify FK references preserved - use populate to get relation
			const postsAfter = await datrix.findMany("post", { populate: true });
			expect(postsAfter).toHaveLength(2);
			expect(postsAfter[0].author.id).toBe(user.id);
			expect(postsAfter[1].author.id).toBe(user.id);

			// Column should be renamed
			await assertColumnNotExists(datrix, "post", "authorId");
			await assertColumnExists(datrix, "post", "writerId");

			await datrix.shutdown();
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

			const datrix1 = await createDatrixWithSchemas(tmpDir, [
				postWithCategory,
				baseCategorySchema,
			]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);

			// Insert test data
			const tech = await datrix1.create("category", {
				name: "Tech",
				slug: "tech",
			});
			const news = await datrix1.create("category", {
				name: "News",
				slug: "news",
			});
			const post1 = await datrix1.create(
				"post",
				{
					title: "Tech Post",
					category: { set: tech.id },
				},
				{
					populate: true,
				},
			);
			const post2 = await datrix1.create("post", {
				title: "News Post",
				category: { set: news.id },
			});
			const post3 = await datrix1.create("post", {
				title: "Another Tech Post",
				category: { set: tech.id },
			});

			await datrix1.shutdown();

			// Change to manyToMany
			const postWithCategories = cloneSchema(basePostSchemaNoRelation, {
				addFields: {
					categories: {
						type: "relation",
						kind: "manyToMany",
						model: "category",
					},
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[postWithCategories, baseCategorySchema],
				true,
			);
			const session = await datrix.beginMigrate();
			assertHasChanges(session);

			autoResolveAmbiguous(session, "migrate");
			await applyMigration(session);

			// Verify junction table exists
			await assertTableExists(datrix, "category_post");

			// Verify data migrated to junction table
			const post1WithCats = await datrix.findOne(
				"post",
				{ id: { $eq: post1.id } },
				{ populate: true },
			);
			const post2WithCats = await datrix.findOne(
				"post",
				{ id: { $eq: post2.id } },
				{ populate: true },
			);
			const post3WithCats = await datrix.findOne(
				"post",
				{ id: { $eq: post3.id } },
				{ populate: true },
			);

			expect(post1WithCats?.categories).toHaveLength(1);
			expect(post1WithCats?.categories[0]?.id).toBe(tech.id);
			expect(post2WithCats?.categories).toHaveLength(1);
			expect(post2WithCats?.categories[0]?.id).toBe(news.id);
			expect(post3WithCats?.categories).toHaveLength(1);
			expect(post3WithCats?.categories[0]?.id).toBe(tech.id);

			await datrix.shutdown();
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

			const datrix1 = await createDatrixWithSchemas(tmpDir, [
				postWithTags,
				baseTagSchema,
			]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);

			// Insert test data - post with multiple tags
			const js = await datrix1.create("tag", { name: "JavaScript" });
			const ts = await datrix1.create("tag", { name: "TypeScript" });
			const react = await datrix1.create("tag", { name: "React" });
			const post = await datrix1.create("post", { title: "Multi-tag Post" });

			// Add multiple tags to post
			await datrix1.create("post_tag", {
				post: { set: post.id },
				tag: { set: js.id },
			});
			await datrix1.create("post_tag", {
				post: { set: post.id },
				tag: { set: ts.id },
			});
			await datrix1.create("post_tag", {
				post: { set: post.id },
				tag: { set: react.id },
			});

			await datrix1.shutdown();

			// Change to belongsTo (single tag)
			const postWithTag = cloneSchema(basePostSchemaNoRelation, {
				addFields: {
					tag: { type: "relation", kind: "belongsTo", model: "tag" },
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[postWithTag, baseTagSchema],
				true,
			);
			const session = await datrix.beginMigrate();
			assertHasChanges(session);

			autoResolveAmbiguous(session, "migrate");
			await applyMigration(session);

			// Verify junction table dropped
			await assertTableNotExists(adapter, "post_tag");

			// Verify FK column exists with first tag's ID
			await assertColumnExists(datrix, "post", "tagId");

			const updatedPost = await datrix.findOne(
				"post",
				{ id: { $eq: post.id } },
				{ populate: true },
			);
			expect(updatedPost?.tag?.id).toBe(js.id);

			await datrix.shutdown();
		});

		it("should warn about data loss for posts with multiple tags", async () => {
			await dropAllTables(adapter);

			const postWithTags = cloneSchema(basePostSchemaNoRelation, {
				addFields: {
					tags: { type: "relation", kind: "manyToMany", model: "tag" },
				},
			});

			const datrix1 = await createDatrixWithSchemas(tmpDir, [
				postWithTags,
				baseTagSchema,
			]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);

			// Post with 3 tags (will lose 2)
			const tag1 = await datrix1.create("tag", { name: "Tag1" });
			const tag2 = await datrix1.create("tag", { name: "Tag2" });
			const tag3 = await datrix1.create("tag", { name: "Tag3" });
			const post = await datrix1.create("post", { title: "Post" });
			await datrix1.create("post_tag", {
				post: { set: post.id },
				tag: { set: tag1.id },
			});
			await datrix1.create("post_tag", {
				post: { set: post.id },
				tag: { set: tag2.id },
			});
			await datrix1.create("post_tag", {
				post: { set: post.id },
				tag: { set: tag3.id },
			});

			await datrix1.shutdown();

			// Change to belongsTo
			const postWithTag = cloneSchema(basePostSchemaNoRelation, {
				addFields: {
					tag: { type: "relation", kind: "belongsTo", model: "tag" },
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[postWithTag, baseTagSchema],
				true,
			);
			const session = await datrix.beginMigrate();

			// relation_downgrade_many_to_single ambiguous is detected with data loss warning
			const ambiguous = assertAmbiguousExists(
				session,
				"relation_downgrade_many_to_single",
			);
			expect(ambiguous.warning).toContain("lose data");

			await datrix.shutdown();
		});
	});

	// ============================================
	// Multiple Data Preservation in Single Migration
	// ============================================

	describe("Multiple changes with data preservation", () => {
		it("should preserve data across multiple renames in single migration", async () => {
			await dropAllTables(adapter);

			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);

			// Insert test data
			await datrix1.create("user", {
				email: "test@test.com",
				name: "Test User",
				age: 25,
			});

			await datrix1.shutdown();

			// Multiple renames: name → fullName, age → yearsOld
			const userRenamed = cloneSchema(baseUserSchema, {
				removeFields: ["name", "age"],
				addFields: {
					fullName: { type: "string", required: true },
					yearsOld: { type: "number" },
				},
			});

			const datrix = await createDatrixWithSchemas(tmpDir, [userRenamed], true);
			const session = await datrix.beginMigrate();

			// Resolve all as rename
			autoResolveAmbiguous(session, "rename");

			await applyMigration(session);

			// Verify all data preserved
			const users = await datrix.findMany("user", {});
			expect(users).toHaveLength(1);
			expect(users[0].fullName).toBe("Test User");
			expect(users[0].yearsOld).toBe(25);

			await datrix.shutdown();
		});
	});

	// ============================================
	// Edge Cases
	// ============================================

	describe("Edge cases", () => {
		it("should handle empty tables gracefully", async () => {
			await dropAllTables(adapter);

			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			// No data inserted
			await datrix1.shutdown();

			// Rename column
			const userRenamed = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					fullName: { type: "string", required: true },
				},
			});

			const datrix = await createDatrixWithSchemas(tmpDir, [userRenamed], true);
			const session = await datrix.beginMigrate();
			autoResolveAmbiguous(session, "rename");

			// Should not error on empty table
			await applyMigration(session);

			await assertColumnExists(datrix, "user", "fullName");
			await assertColumnNotExists(datrix, "user", "name");

			await datrix.shutdown();
		});

		it("should handle NULL values in renamed columns", async () => {
			await dropAllTables(adapter);

			// User with optional age field
			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);

			// Insert user with NULL age
			await datrix1.create("user", {
				email: "test@test.com",
				name: "Test",
				// age not provided (NULL)
			});

			await datrix1.shutdown();

			// Rename age to yearsOld
			const userRenamed = cloneSchema(baseUserSchema, {
				removeFields: ["age"],
				addFields: {
					yearsOld: { type: "number" },
				},
			});

			const datrix = await createDatrixWithSchemas(tmpDir, [userRenamed], true);
			const session = await datrix.beginMigrate();
			autoResolveAmbiguous(session, "rename");

			await applyMigration(session);

			// NULL should be preserved
			const users = await datrix.findMany("user", {});
			expect(users[0].yearsOld).toBeNull();

			await datrix.shutdown();
		});

		it("should handle large datasets efficiently", async () => {
			await dropAllTables(adapter);

			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);

			// Insert many records
			const insertPromises = [];
			for (let i = 0; i < 100; i++) {
				insertPromises.push({
					email: `user${i}@test.com`,
					name: `User ${i}`,
					age: 20 + (i % 50),
				});
			}

			await datrix1.createMany("user", insertPromises);

			await datrix1.shutdown();

			// Rename column
			const userRenamed = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					fullName: { type: "string", required: true },
				},
			});

			const datrix = await createDatrixWithSchemas(tmpDir, [userRenamed], true);
			const session = await datrix.beginMigrate();
			autoResolveAmbiguous(session, "rename");

			const startTime = Date.now();
			await applyMigration(session);
			const duration = Date.now() - startTime;

			// Should complete reasonably fast (< 5 seconds for 100 records)
			expect(duration).toBeLessThan(5000);

			// Verify all data preserved
			const users = await datrix.findMany("user", {});
			expect(users).toHaveLength(100);
			expect(users.every((u) => u.fullName?.startsWith("User "))).toBe(true);

			await datrix.shutdown();
		});
	});
});
