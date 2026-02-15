/**
 * Migration E2E Tests - Relation Changes
 *
 * Tests for relation field migrations:
 * - belongsTo: FK column on this table
 * - hasMany/hasOne: FK column on target table
 * - manyToMany: Junction table creation/deletion
 * - Relation kind changes with data migration options
 *
 * IMPORTANT: Migration does NOT look at relation fields directly.
 * It compares the final schema state (after registry.processRelations())
 * with the database state. Relations are translated to:
 * - belongsTo/hasOne → FK column
 * - hasMany → FK column on target table
 * - manyToMany → Junction table
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
	baseProfileSchema,
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
	assertNoChanges,
	assertTablesToCreate,
	assertTablesToDrop,
	assertTablesToAlter,
	assertTableInCreate,
	assertTableInDrop,
	assertColumnInAdd,
	assertColumnInDrop,
	assertAmbiguousExists,
	assertAmbiguousCount,
	assertHasAmbiguous,
	applyMigration,
	autoResolveAmbiguous,
} from "./setup/helpers";
import type { DatabaseAdapter } from "forja-types/adapter";

describe("Migration E2E - Relation Changes", () => {
	const tmpDir = getTmpDir("relation-changes");
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
	// 1. belongsTo Relation Tests
	// ============================================

	describe("belongsTo relation", () => {
		describe("Add belongsTo", () => {
			it("should add foreign key column when belongsTo is added", async () => {
				// Setup: post without any relation, category exists
				await dropAllTables(adapter);

				const forja1 = await createForjaWithSchemas(tmpDir, [
					baseUserSchema,
					basePostSchemaNoRelation,
					baseCategorySchema,
				]);
				const session1Result = await forja1.beginMigrate();
				if (session1Result.success) {
					await applyMigration(session1Result.data);
				}
				await forja1.shutdown();

				// Add category relation to post
				const postWithCategory = cloneSchema(basePostSchemaNoRelation, {
					addFields: {
						category: { type: "relation", kind: "belongsTo", model: "category" },
					},
				});

				const forja = await createForjaWithSchemas(tmpDir, [
					baseUserSchema,
					postWithCategory,
					baseCategorySchema,
				]);
				const sessionResult = await forja.beginMigrate();
				expect(sessionResult.success).toBe(true);
				if (!sessionResult.success) {
					await forja.shutdown();
					return;
				}

				const session = sessionResult.data;

				// Should detect FK column addition
				assertHasChanges(session);
				assertTablesToAlter(session, 1);
				assertColumnInAdd(session, TABLE_NAMES.post, "categoryId");

				// Apply
				await applyMigration(session);

				// Verify FK column exists
				await assertColumnExists(forja, "post", "categoryId");

				await forja.shutdown();
			});

			it("should add FK column with custom foreignKey name", async () => {
				await dropAllTables(adapter);

				const forja1 = await createForjaWithSchemas(tmpDir, [
					baseUserSchema,
					basePostSchemaNoRelation,
				]);
				const session1Result = await forja1.beginMigrate();
				if (session1Result.success) {
					await applyMigration(session1Result.data);
				}
				await forja1.shutdown();

				// Add writer relation with custom foreignKey
				const postWithWriter = cloneSchema(basePostSchemaNoRelation, {
					addFields: {
						writer: {
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

				assertHasChanges(session);
				assertColumnInAdd(session, TABLE_NAMES.post, "writerId");

				await applyMigration(session);

				// Verify custom FK column exists
				await assertColumnExists(forja, "post", "writerId");
				// Default name should NOT exist
				await assertColumnNotExists(forja, "post", "userId");

				await forja.shutdown();
			});
		});

		describe("Remove belongsTo", () => {
			it("should show confirmation before dropping FK column", async () => {
				// Setup: post with author relation
				await dropAllTables(adapter);

				const forja1 = await createForjaWithSchemas(tmpDir, [
					baseUserSchema,
					basePostSchema, // has author belongsTo
				]);
				const session1Result = await forja1.beginMigrate();
				if (session1Result.success) {
					await applyMigration(session1Result.data);
				}

				// Insert data to make it more realistic
				await forja1.create("user", { email: "test@test.com", name: "Test" });
				await forja1.create("post", {
					title: "Test Post",
					author: { set: 1 },
				});

				await forja1.shutdown();

				// Remove author relation
				const postWithoutAuthor = cloneSchema(basePostSchema, {
					removeFields: ["author"],
				});

				const forja = await createForjaWithSchemas(tmpDir, [
					baseUserSchema,
					postWithoutAuthor,
				]);
				const sessionResult = await forja.beginMigrate();
				expect(sessionResult.success).toBe(true);
				if (!sessionResult.success) {
					await forja.shutdown();
					return;
				}

				const session = sessionResult.data;

				// Should detect FK column removal
				assertHasChanges(session);
				assertColumnInDrop(session, TABLE_NAMES.post, "authorId");

				// TODO: Should have ambiguous confirmation for FK drop
				// assertAmbiguousExists(session, "fk_column_drop", TABLE_NAMES.post);

				await forja.shutdown();
			});

			it("should drop FK column after confirmation", async () => {
				await dropAllTables(adapter);

				const forja1 = await createForjaWithSchemas(tmpDir, [
					baseUserSchema,
					basePostSchema,
				]);
				const session1Result = await forja1.beginMigrate();
				if (session1Result.success) {
					await applyMigration(session1Result.data);
				}
				await forja1.shutdown();

				// Remove author relation
				const postWithoutAuthor = cloneSchema(basePostSchema, {
					removeFields: ["author"],
				});

				const forja = await createForjaWithSchemas(tmpDir, [
					baseUserSchema,
					postWithoutAuthor,
				]);
				const sessionResult = await forja.beginMigrate();
				expect(sessionResult.success).toBe(true);
				if (!sessionResult.success) {
					await forja.shutdown();
					return;
				}

				const session = sessionResult.data;

				// Apply (with auto-resolve if ambiguous)
				await applyMigration(session);

				// Verify FK column is gone
				await assertColumnNotExists(forja, "post", "authorId");

				await forja.shutdown();
			});
		});

		describe("Modify belongsTo", () => {
			it("should detect foreignKey rename as ambiguous", async () => {
				// Setup: post with author (authorId)
				await dropAllTables(adapter);

				const forja1 = await createForjaWithSchemas(tmpDir, [
					baseUserSchema,
					basePostSchema,
				]);
				const session1Result = await forja1.beginMigrate();
				if (session1Result.success) {
					await applyMigration(session1Result.data);
				}
				await forja1.shutdown();

				// Change foreignKey from 'authorId' to 'writerId'
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

				// Should detect as ambiguous (rename or drop+add?)
				assertHasChanges(session);
				// authorId removed, writerId added → ambiguous
				assertHasAmbiguous(session, TABLE_NAMES.post, "authorId", "writerId");

				await forja.shutdown();
			});

			it("should rename FK column when resolved as rename", async () => {
				await dropAllTables(adapter);

				const forja1 = await createForjaWithSchemas(tmpDir, [
					baseUserSchema,
					basePostSchema,
				]);
				const session1Result = await forja1.beginMigrate();
				if (session1Result.success) {
					await applyMigration(session1Result.data);
				}

				// Insert data
				await forja1.create("user", { email: "test@test.com", name: "Test" });
				await forja1.create("post", {
					title: "Test Post",
					author: { set: 1 },
				});

				await forja1.shutdown();

				// Change foreignKey
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

				// Apply
				await applyMigration(session);

				// Verify: old column gone, new column exists
				await assertColumnNotExists(forja, "post", "authorId");
				await assertColumnExists(forja, "post", "writerId");

				await forja.shutdown();
			});

			it("should handle model change with warning", async () => {
				// Setup: post with author pointing to user
				await dropAllTables(adapter);

				// Create admin schema
				const adminSchema = cloneSchema(baseUserSchema, {
					name: "admin",
				});
				// Fix tableName for admin
				(adminSchema as { tableName: string }).tableName = "admins";

				const forja1 = await createForjaWithSchemas(tmpDir, [
					baseUserSchema,
					adminSchema,
					basePostSchema,
				]);
				const session1Result = await forja1.beginMigrate();
				if (session1Result.success) {
					await applyMigration(session1Result.data);
				}
				await forja1.shutdown();

				// Change author to point to admin instead of user
				const postWithAdmin = cloneSchema(basePostSchema, {
					modifyFields: {
						author: {
							type: "relation",
							kind: "belongsTo",
							model: "admin",
						},
					},
				});

				const forja = await createForjaWithSchemas(tmpDir, [
					baseUserSchema,
					adminSchema,
					postWithAdmin,
				]);
				const sessionResult = await forja.beginMigrate();
				expect(sessionResult.success).toBe(true);
				if (!sessionResult.success) {
					await forja.shutdown();
					return;
				}

				const session = sessionResult.data;

				// Model change should be detected
				// TODO: Should have specific ambiguous type for model change
				// assertAmbiguousExists(session, "fk_model_change", TABLE_NAMES.post);
				assertHasChanges(session);

				await forja.shutdown();
			});
		});
	});

	// ============================================
	// 2. hasMany Relation Tests
	// ============================================

	describe("hasMany relation", () => {
		describe("Add hasMany", () => {
			it("should add FK column to TARGET table", async () => {
				// Setup: user without posts relation, post exists (no author)
				await dropAllTables(adapter);

				const forja1 = await createForjaWithSchemas(tmpDir, [
					baseUserSchema,
					basePostSchemaNoRelation,
				]);
				const session1Result = await forja1.beginMigrate();
				if (session1Result.success) {
					await applyMigration(session1Result.data);
				}
				await forja1.shutdown();

				// Add hasMany relation to user
				const userWithPosts = cloneSchema(baseUserSchema, {
					addFields: {
						posts: { type: "relation", kind: "hasMany", model: "post" },
					},
				});

				const forja = await createForjaWithSchemas(tmpDir, [
					userWithPosts,
					basePostSchemaNoRelation,
				]);
				const sessionResult = await forja.beginMigrate();
				expect(sessionResult.success).toBe(true);
				if (!sessionResult.success) {
					await forja.shutdown();
					return;
				}

				const session = sessionResult.data;

				// Should detect FK column addition on TARGET table (posts)
				assertHasChanges(session);
				assertColumnInAdd(session, TABLE_NAMES.post, "userId");

				// Apply
				await applyMigration(session);

				// Verify FK column on target table
				await assertColumnExists(forja, "post", "userId");

				await forja.shutdown();
			});

			it("should use custom foreignKey on target table", async () => {
				await dropAllTables(adapter);

				const forja1 = await createForjaWithSchemas(tmpDir, [
					baseUserSchema,
					basePostSchemaNoRelation,
				]);
				const session1Result = await forja1.beginMigrate();
				if (session1Result.success) {
					await applyMigration(session1Result.data);
				}
				await forja1.shutdown();

				// Add hasMany with custom foreignKey
				const userWithArticles = cloneSchema(baseUserSchema, {
					addFields: {
						articles: {
							type: "relation",
							kind: "hasMany",
							model: "post",
							foreignKey: "authorId",
						},
					},
				});

				const forja = await createForjaWithSchemas(tmpDir, [
					userWithArticles,
					basePostSchemaNoRelation,
				]);
				const sessionResult = await forja.beginMigrate();
				expect(sessionResult.success).toBe(true);
				if (!sessionResult.success) {
					await forja.shutdown();
					return;
				}

				const session = sessionResult.data;

				assertHasChanges(session);
				assertColumnInAdd(session, TABLE_NAMES.post, "authorId");

				await applyMigration(session);

				// Verify custom FK column on target
				await assertColumnExists(forja, "post", "authorId");
				// Default name should NOT exist
				await assertColumnNotExists(forja, "post", "userId");

				await forja.shutdown();
			});
		});

		describe("Remove hasMany", () => {
			it("should drop FK column from TARGET table with confirmation", async () => {
				// Setup: user with posts hasMany
				await dropAllTables(adapter);

				const userWithPosts = cloneSchema(baseUserSchema, {
					addFields: {
						posts: { type: "relation", kind: "hasMany", model: "post" },
					},
				});

				const forja1 = await createForjaWithSchemas(tmpDir, [
					userWithPosts,
					basePostSchemaNoRelation,
				]);
				const session1Result = await forja1.beginMigrate();
				if (session1Result.success) {
					await applyMigration(session1Result.data);
				}

				// Verify FK exists on target
				await assertColumnExists(forja1, "post", "userId");
				await forja1.shutdown();

				// Remove hasMany relation
				const forja = await createForjaWithSchemas(tmpDir, [
					baseUserSchema, // no posts relation
					basePostSchemaNoRelation,
				]);
				const sessionResult = await forja.beginMigrate();
				expect(sessionResult.success).toBe(true);
				if (!sessionResult.success) {
					await forja.shutdown();
					return;
				}

				const session = sessionResult.data;

				// Should detect FK removal from target table
				assertHasChanges(session);
				assertColumnInDrop(session, TABLE_NAMES.post, "userId");

				// Apply
				await applyMigration(session);

				// Verify FK column removed from target
				await assertColumnNotExists(forja, "post", "userId");

				await forja.shutdown();
			});
		});
	});

	// ============================================
	// 3. hasOne Relation Tests
	// ============================================

	describe("hasOne relation", () => {
		it("should add FK column to target table (same as hasMany)", async () => {
			await dropAllTables(adapter);

			const forja1 = await createForjaWithSchemas(tmpDir, [
				baseUserSchema,
				baseProfileSchema,
			]);
			const session1Result = await forja1.beginMigrate();
			if (session1Result.success) {
				await applyMigration(session1Result.data);
			}
			await forja1.shutdown();

			// Add hasOne relation to user
			const userWithProfile = cloneSchema(baseUserSchema, {
				addFields: {
					profile: { type: "relation", kind: "hasOne", model: "profile" },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [
				userWithProfile,
				baseProfileSchema,
			]);
			const sessionResult = await forja.beginMigrate();
			expect(sessionResult.success).toBe(true);
			if (!sessionResult.success) {
				await forja.shutdown();
				return;
			}

			const session = sessionResult.data;

			// DEBUG: Log session state
			console.log("=== DEBUG hasOne test ===");
			console.log("tablesToCreate:", JSON.stringify(session.tablesToCreate.map(t => t.name), null, 2));
			console.log("tablesToDrop:", JSON.stringify(session.tablesToDrop, null, 2));
			console.log("tablesToAlter:", JSON.stringify(session.tablesToAlter, null, 2));
			console.log("ambiguous:", JSON.stringify(session.ambiguous, null, 2));
			console.log("differences:", JSON.stringify(session.differences, null, 2));
			console.log("currentSchemas:", JSON.stringify(Array.from(forja.getSchemas().entries()).map(([k, v]) => ({ name: k, fields: Object.keys(v.fields) })), null, 2));
			console.log("databaseSchemas:", JSON.stringify(session.databaseSchemas, null, 2));

			// Should add FK to profile table
			assertHasChanges(session);
			assertColumnInAdd(session, TABLE_NAMES.profile, "userId");

			await applyMigration(session);

			// Verify FK on target
			await assertColumnExists(forja, "profile", "userId");

			await forja.shutdown();
		});

		it("should handle hasOne to hasMany conversion without schema change", async () => {
			// hasOne and hasMany produce same FK structure
			await dropAllTables(adapter);

			// Setup with hasOne
			const userWithProfileOne = cloneSchema(baseUserSchema, {
				addFields: {
					profile: { type: "relation", kind: "hasOne", model: "profile" },
				},
			});

			const forja1 = await createForjaWithSchemas(tmpDir, [
				userWithProfileOne,
				baseProfileSchema,
			]);
			const session1Result = await forja1.beginMigrate();
			if (session1Result.success) {
				await applyMigration(session1Result.data);
			}
			await forja1.shutdown();

			// Change to hasMany (same FK structure)
			const userWithProfileMany = cloneSchema(baseUserSchema, {
				addFields: {
					profiles: { type: "relation", kind: "hasMany", model: "profile" },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [
				userWithProfileMany,
				baseProfileSchema,
			]);
			const sessionResult = await forja.beginMigrate();
			expect(sessionResult.success).toBe(true);
			if (!sessionResult.success) {
				await forja.shutdown();
				return;
			}

			const session = sessionResult.data;

			// DEBUG: Log session state
			console.log("=== DEBUG hasOne->hasMany test ===");
			console.log("tablesToCreate:", JSON.stringify(session.tablesToCreate.map(t => t.name), null, 2));
			console.log("tablesToDrop:", JSON.stringify(session.tablesToDrop, null, 2));
			console.log("tablesToAlter:", JSON.stringify(session.tablesToAlter, null, 2));
			console.log("ambiguous:", JSON.stringify(session.ambiguous, null, 2));
			console.log("differences:", JSON.stringify(session.differences, null, 2));
			console.log("currentSchemas:", JSON.stringify(Array.from(forja.getSchemas().entries()).map(([k, v]) => ({ name: k, fields: Object.keys(v.fields) })), null, 2));
			console.log("databaseSchemas:", JSON.stringify(session.databaseSchemas, null, 2));

			// Should have NO schema changes (same FK structure)
			// Only difference is query behavior, not database schema
			assertNoChanges(session);

			await forja.shutdown();
		});
	});

	// ============================================
	// 4. manyToMany Relation Tests
	// ============================================

	describe("manyToMany relation", () => {
		describe("Add manyToMany", () => {
			it("should create junction table", async () => {
				await dropAllTables(adapter);

				// Setup: post and tag exist, no relation
				const forja1 = await createForjaWithSchemas(tmpDir, [
					basePostSchemaNoRelation,
					baseTagSchema,
				]);
				const session1Result = await forja1.beginMigrate();
				if (session1Result.success) {
					await applyMigration(session1Result.data);
				}
				await forja1.shutdown();

				// Add manyToMany relation
				const postWithTags = cloneSchema(basePostSchemaNoRelation, {
					addFields: {
						tags: { type: "relation", kind: "manyToMany", model: "tag" },
					},
				});

				const forja = await createForjaWithSchemas(tmpDir, [
					postWithTags,
					baseTagSchema,
				]);
				const sessionResult = await forja.beginMigrate();
				expect(sessionResult.success).toBe(true);
				if (!sessionResult.success) {
					await forja.shutdown();
					return;
				}

				const session = sessionResult.data;

				// DEBUG: Log session state
				console.log("=== DEBUG manyToMany test ===");
				console.log("tablesToCreate:", JSON.stringify(session.tablesToCreate.map(t => t.name), null, 2));
				console.log("tablesToDrop:", JSON.stringify(session.tablesToDrop, null, 2));
				console.log("tablesToAlter:", JSON.stringify(session.tablesToAlter, null, 2));
				console.log("ambiguous:", JSON.stringify(session.ambiguous, null, 2));
				console.log("differences:", JSON.stringify(session.differences, null, 2));
				console.log("currentSchemas:", JSON.stringify(Array.from(forja.getSchemas().entries()).map(([k, v]) => ({ name: k, fields: Object.keys(v.fields) })), null, 2));
				console.log("databaseSchemas:", JSON.stringify(session.databaseSchemas, null, 2));

				// Should detect junction table creation
				assertHasChanges(session);
				assertTablesToCreate(session, 1);
				assertTableInCreate(session, "post_tag");

				// Apply
				await applyMigration(session);

				// Verify junction table exists with FK columns
				await assertTableExists(forja, "post_tag");
				await assertColumnExists(forja, "post_tag", "postId");
				await assertColumnExists(forja, "post_tag", "tagId");

				await forja.shutdown();
			});

			it("should use alphabetical order for junction table name", async () => {
				await dropAllTables(adapter);

				// Create apple and banana schemas
				const appleSchema = {
					name: "apple",
					tableName: "apples",
					fields: {
						name: { type: "string" as const, required: true },
					},
				};

				const bananaSchema = {
					name: "banana",
					tableName: "bananas",
					fields: {
						name: { type: "string" as const, required: true },
					},
				};

				const forja1 = await createForjaWithSchemas(tmpDir, [
					appleSchema,
					bananaSchema,
				]);
				const session1Result = await forja1.beginMigrate();
				if (session1Result.success) {
					await applyMigration(session1Result.data);
				}
				await forja1.shutdown();

				// Add manyToMany from banana to apple
				const bananaWithApples = {
					...bananaSchema,
					fields: {
						...bananaSchema.fields,
						apples: { type: "relation" as const, kind: "manyToMany" as const, model: "apple" },
					},
				};

				const forja = await createForjaWithSchemas(tmpDir, [
					appleSchema,
					bananaWithApples,
				]);
				const sessionResult = await forja.beginMigrate();
				expect(sessionResult.success).toBe(true);
				if (!sessionResult.success) {
					await forja.shutdown();
					return;
				}

				const session = sessionResult.data;

				// Junction table should be alphabetically sorted: apple_banana (not banana_apple)
				assertTableInCreate(session, "apple_banana");

				await forja.shutdown();
			});

			it("should use custom through table name", async () => {
				await dropAllTables(adapter);

				const forja1 = await createForjaWithSchemas(tmpDir, [
					basePostSchemaNoRelation,
					baseTagSchema,
				]);
				const session1Result = await forja1.beginMigrate();
				if (session1Result.success) {
					await applyMigration(session1Result.data);
				}
				await forja1.shutdown();

				// Add manyToMany with custom through name
				const postWithTags = cloneSchema(basePostSchemaNoRelation, {
					addFields: {
						tags: {
							type: "relation",
							kind: "manyToMany",
							model: "tag",
							through: "post_tags", // custom name
						},
					},
				});

				const forja = await createForjaWithSchemas(tmpDir, [
					postWithTags,
					baseTagSchema,
				]);
				const sessionResult = await forja.beginMigrate();
				expect(sessionResult.success).toBe(true);
				if (!sessionResult.success) {
					await forja.shutdown();
					return;
				}

				const session = sessionResult.data;

				// Should use custom table name
				assertTableInCreate(session, "post_tags");

				await applyMigration(session);

				await assertTableExists(forja, "post_tags");

				await forja.shutdown();
			});
		});

		describe("Remove manyToMany", () => {
			it("should show confirmation before dropping junction table", async () => {
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

				// Add some data
				await forja1.create("tag", { name: "JavaScript" });
				await forja1.create("tag", { name: "TypeScript" });
				const post = await forja1.create("post", { title: "Test Post" });
				await forja1.create("post_tag", { post: { set: post.id }, tag: { set: 1 } });
				await forja1.create("post_tag", { post: { set: post.id }, tag: { set: 2 } });

				await forja1.shutdown();

				// Remove tags relation
				const forja = await createForjaWithSchemas(tmpDir, [
					basePostSchemaNoRelation, // no tags
					baseTagSchema,
				]);
				const sessionResult = await forja.beginMigrate();
				expect(sessionResult.success).toBe(true);
				if (!sessionResult.success) {
					await forja.shutdown();
					return;
				}

				const session = sessionResult.data;

				// Should detect junction table drop
				assertHasChanges(session);
				assertTablesToDrop(session, 1);
				assertTableInDrop(session, "post_tag");

				// TODO: Should have ambiguous confirmation
				// assertAmbiguousExists(session, "junction_table_drop");

				await forja.shutdown();
			});

			it("should drop junction table after confirmation", async () => {
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
				await forja1.shutdown();

				// Remove relation
				const forja = await createForjaWithSchemas(tmpDir, [
					basePostSchemaNoRelation,
					baseTagSchema,
				]);
				const sessionResult = await forja.beginMigrate();
				expect(sessionResult.success).toBe(true);
				if (!sessionResult.success) {
					await forja.shutdown();
					return;
				}

				const session = sessionResult.data;

				// Apply
				await applyMigration(session);

				// Verify junction table dropped
				await assertTableNotExists(adapter, "post_tag");

				await forja.shutdown();
			});
		});

		describe("Modify manyToMany - through name change", () => {
			it("should detect through name change as ambiguous", async () => {
				await dropAllTables(adapter);

				// Setup with custom through name
				const postWithTags = cloneSchema(basePostSchemaNoRelation, {
					addFields: {
						tags: {
							type: "relation",
							kind: "manyToMany",
							model: "tag",
							through: "post_tags",
						},
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
				await forja1.shutdown();

				// Change through name
				const postWithNewTags = cloneSchema(basePostSchemaNoRelation, {
					addFields: {
						tags: {
							type: "relation",
							kind: "manyToMany",
							model: "tag",
							through: "article_tags", // new name
						},
					},
				});

				const forja = await createForjaWithSchemas(tmpDir, [
					postWithNewTags,
					baseTagSchema,
				]);
				const sessionResult = await forja.beginMigrate();
				expect(sessionResult.success).toBe(true);
				if (!sessionResult.success) {
					await forja.shutdown();
					return;
				}

				const session = sessionResult.data;

				// Should see: post_tags drop, article_tags create → ambiguous
				assertHasChanges(session);
				assertTableInDrop(session, "post_tags");
				assertTableInCreate(session, "article_tags");

				// TODO: Should have specific ambiguous type
				// assertAmbiguousExists(session, "junction_table_rename_or_replace");

				await forja.shutdown();
			});
		});
	});

	// ============================================
	// 5. Relation Kind Changes (Complex)
	// ============================================

	describe("Relation kind changes", () => {
		describe("belongsTo to manyToMany conversion", () => {
			it("should detect as migration opportunity", async () => {
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

				// Insert data
				await forja1.create("category", { name: "Tech", slug: "tech" });
				await forja1.create("post", { title: "Post1", category: { set: 1 } });

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

				// Migration should see:
				// - posts.categoryId columnToDrop
				// - category_post tableToCreate
				assertHasChanges(session);
				assertColumnInDrop(session, TABLE_NAMES.post, "categoryId");
				assertTableInCreate(session, "category_post");

				// TODO: Should detect as relation upgrade opportunity
				// assertAmbiguousExists(session, "relation_upgrade_single_to_many");

				await forja.shutdown();
			});
		});

		describe("manyToMany to belongsTo conversion", () => {
			it("should detect as migration opportunity", async () => {
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

				// Insert data with multiple tags
				await forja1.create("tag", { name: "JS" });
				await forja1.create("tag", { name: "TS" });
				const post = await forja1.create("post", { title: "Post1" });
				await forja1.create("post_tag", { post: { set: post.id }, tag: { set: 1 } });
				await forja1.create("post_tag", { post: { set: post.id }, tag: { set: 2 } });

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

				// Migration should see:
				// - post_tag tableToDrop
				// - posts.tagId columnToAdd
				assertHasChanges(session);
				assertTableInDrop(session, "post_tag");
				assertColumnInAdd(session, TABLE_NAMES.post, "tagId");

				// TODO: Should detect as relation downgrade opportunity
				// assertAmbiguousExists(session, "relation_downgrade_many_to_single");

				await forja.shutdown();
			});
		});

		describe("hasMany to belongsTo flip", () => {
			it("should move FK column between tables", async () => {
				await dropAllTables(adapter);

				// Setup: user.posts hasMany → posts.userId
				const userWithPosts = cloneSchema(baseUserSchema, {
					addFields: {
						posts: { type: "relation", kind: "hasMany", model: "post" },
					},
				});

				const forja1 = await createForjaWithSchemas(tmpDir, [
					userWithPosts,
					basePostSchemaNoRelation,
				]);
				const session1Result = await forja1.beginMigrate();
				if (session1Result.success) {
					await applyMigration(session1Result.data);
				}

				// Verify: posts has userId
				await assertColumnExists(forja1, "post", "userId");

				await forja1.shutdown();

				// Flip: post.user belongsTo → posts.userId (same result actually)
				// But let's try inverse: post.users hasMany → users.postId
				const postWithUsers = cloneSchema(basePostSchemaNoRelation, {
					addFields: {
						users: { type: "relation", kind: "hasMany", model: "user" },
					},
				});

				const forja = await createForjaWithSchemas(tmpDir, [
					baseUserSchema, // no posts relation
					postWithUsers,
				]);
				const sessionResult = await forja.beginMigrate();
				expect(sessionResult.success).toBe(true);
				if (!sessionResult.success) {
					await forja.shutdown();
					return;
				}

				const session = sessionResult.data;

				// Should see:
				// - posts.userId columnToDrop
				// - users.postId columnToAdd
				assertHasChanges(session);
				assertColumnInDrop(session, TABLE_NAMES.post, "userId");
				assertColumnInAdd(session, TABLE_NAMES.user, "postId");

				// TODO: Should warn about direction flip
				// assertAmbiguousExists(session, "relation_direction_flip");

				await forja.shutdown();
			});
		});
	});
});
