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
import { createDatrixWithSchemas, getTmpDir } from "./setup/config";
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
	assertHasAmbiguous,
	applyMigration,
	autoResolveAmbiguous,
} from "./setup/helpers";
import type { DatabaseAdapter } from "@datrix/core";

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

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					baseUserSchema,
					basePostSchemaNoRelation,
					baseCategorySchema,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);
				await datrix1.shutdown();

				// Add category relation to post
				const postWithCategory = cloneSchema(basePostSchemaNoRelation, {
					addFields: {
						category: {
							type: "relation",
							kind: "belongsTo",
							model: "category",
						},
					},
				});

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[baseUserSchema, postWithCategory, baseCategorySchema],
					true,
				);
				const session = await datrix.beginMigrate();

				// Should detect FK column addition
				assertHasChanges(session);
				assertTablesToAlter(session, 1);
				assertColumnInAdd(session, TABLE_NAMES.post, "categoryId");

				// Apply
				await applyMigration(session);

				// Verify FK column exists
				await assertColumnExists(datrix, "post", "categoryId");

				await datrix.shutdown();
			});

			it("should add FK column with custom foreignKey name", async () => {
				await dropAllTables(adapter);

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					baseUserSchema,
					basePostSchemaNoRelation,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);
				await datrix1.shutdown();

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

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[baseUserSchema, postWithWriter],
					true,
				);
				const session = await datrix.beginMigrate();

				assertHasChanges(session);
				assertColumnInAdd(session, TABLE_NAMES.post, "writerId");

				await applyMigration(session);

				// Verify custom FK column exists
				await assertColumnExists(datrix, "post", "writerId");
				// Default name should NOT exist
				await assertColumnNotExists(datrix, "post", "userId");

				await datrix.shutdown();
			});
		});

		describe("Remove belongsTo", () => {
			it("should show confirmation before dropping FK column", async () => {
				// Setup: post with author relation
				await dropAllTables(adapter);

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					baseUserSchema,
					basePostSchema, // has author belongsTo
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);

				// Insert data to make it more realistic
				await datrix1.create("user", { email: "test@test.com", name: "Test" });
				await datrix1.create("post", {
					title: "Test Post",
					author: { set: 1 },
				});

				await datrix1.shutdown();

				// Remove author relation
				const postWithoutAuthor = cloneSchema(basePostSchema, {
					removeFields: ["author"],
				});

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[baseUserSchema, postWithoutAuthor],
					true,
				);
				const session = await datrix.beginMigrate();

				// Should detect FK column removal
				assertHasChanges(session);
				assertColumnInDrop(session, TABLE_NAMES.post, "authorId");

				assertAmbiguousExists(session, "fk_column_drop", TABLE_NAMES.post);

				await datrix.shutdown();
			});

			it("should drop FK column after confirmation", async () => {
				await dropAllTables(adapter);

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					baseUserSchema,
					basePostSchema,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);
				await datrix1.shutdown();

				// Remove author relation
				const postWithoutAuthor = cloneSchema(basePostSchema, {
					removeFields: ["author"],
				});

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[baseUserSchema, postWithoutAuthor],
					true,
				);
				const session = await datrix.beginMigrate();

				// Apply (with auto-resolve if ambiguous)
				await applyMigration(session);

				// Verify FK column is gone
				await assertColumnNotExists(datrix, "post", "authorId");

				await datrix.shutdown();
			});
		});

		describe("Modify belongsTo", () => {
			it("should detect foreignKey rename as ambiguous", async () => {
				// Setup: post with author (authorId)
				await dropAllTables(adapter);

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					baseUserSchema,
					basePostSchema,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);
				await datrix1.shutdown();

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

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[baseUserSchema, postWithWriter],
					true,
				);
				const session = await datrix.beginMigrate();

				// Should detect as ambiguous (rename or drop+add?)
				assertHasChanges(session);
				// authorId removed, writerId added → ambiguous
				assertHasAmbiguous(session, TABLE_NAMES.post, "authorId", "writerId");

				await datrix.shutdown();
			});

			it("should rename FK column when resolved as rename", async () => {
				await dropAllTables(adapter);

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					baseUserSchema,
					basePostSchema,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);

				// Insert data
				await datrix1.create("user", { email: "test@test.com", name: "Test" });
				await datrix1.create("post", {
					title: "Test Post",
					author: { set: 1 },
				});

				await datrix1.shutdown();

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

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[baseUserSchema, postWithWriter],
					true,
				);
				const session = await datrix.beginMigrate();

				// Resolve as rename
				autoResolveAmbiguous(session, "rename");

				// Apply
				await applyMigration(session);

				// Verify: old column gone, new column exists
				await assertColumnNotExists(datrix, "post", "authorId");
				await assertColumnExists(datrix, "post", "writerId");

				await datrix.shutdown();
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

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					baseUserSchema,
					adminSchema,
					basePostSchema,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);
				await datrix1.shutdown();

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

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[baseUserSchema, adminSchema, postWithAdmin],
					true,
				);
				const session = await datrix.beginMigrate();

				// Model change should be detected
				assertAmbiguousExists(session, "fk_model_change", TABLE_NAMES.post);
				assertHasChanges(session);

				await datrix.shutdown();
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

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					baseUserSchema,
					basePostSchemaNoRelation,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);
				await datrix1.shutdown();

				// Add hasMany relation to user
				const userWithPosts = cloneSchema(baseUserSchema, {
					addFields: {
						posts: { type: "relation", kind: "hasMany", model: "post" },
					},
				});

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[userWithPosts, basePostSchemaNoRelation],
					true,
				);
				const session = await datrix.beginMigrate();

				// Should detect FK column addition on TARGET table (posts)
				assertHasChanges(session);
				assertColumnInAdd(session, TABLE_NAMES.post, "userId");

				// Apply
				await applyMigration(session);

				// Verify FK column on target table
				await assertColumnExists(datrix, "post", "userId");

				await datrix.shutdown();
			});

			it("should use custom foreignKey on target table", async () => {
				await dropAllTables(adapter);

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					baseUserSchema,
					basePostSchemaNoRelation,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);
				await datrix1.shutdown();

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

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[userWithArticles, basePostSchemaNoRelation],
					true,
				);
				const session = await datrix.beginMigrate();

				assertHasChanges(session);
				assertColumnInAdd(session, TABLE_NAMES.post, "authorId");

				await applyMigration(session);

				// Verify custom FK column on target
				await assertColumnExists(datrix, "post", "authorId");
				// Default name should NOT exist
				await assertColumnNotExists(datrix, "post", "userId");

				await datrix.shutdown();
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

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					userWithPosts,
					basePostSchemaNoRelation,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);

				// Verify FK exists on target
				await assertColumnExists(datrix1, "post", "userId");
				await datrix1.shutdown();

				// Remove hasMany relation
				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[
						baseUserSchema, // no posts relation
						basePostSchemaNoRelation,
					],
					true,
				);
				const session = await datrix.beginMigrate();

				// Should detect FK removal from target table
				assertHasChanges(session);
				assertColumnInDrop(session, TABLE_NAMES.post, "userId");

				// Apply
				await applyMigration(session);

				// Verify FK column removed from target
				await assertColumnNotExists(datrix, "post", "userId");

				await datrix.shutdown();
			});
		});
	});

	// ============================================
	// 3. hasOne Relation Tests
	// ============================================

	describe("hasOne relation", () => {
		it("should add FK column to target table", async () => {
			await dropAllTables(adapter);

			const datrix1 = await createDatrixWithSchemas(tmpDir, [
				baseUserSchema,
				baseProfileSchema,
			]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			const userWithProfile = cloneSchema(baseUserSchema, {
				addFields: {
					profile: { type: "relation", kind: "hasOne", model: "profile" },
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userWithProfile, baseProfileSchema],
				true,
			);
			const session = await datrix.beginMigrate();

			assertHasChanges(session);
			assertColumnInAdd(session, TABLE_NAMES.profile, "userId");

			await applyMigration(session);

			await assertColumnExists(datrix, "profile", "userId");

			await datrix.shutdown();
		});

		it("should add FK column with custom foreignKey", async () => {
			await dropAllTables(adapter);

			const datrix1 = await createDatrixWithSchemas(tmpDir, [
				baseUserSchema,
				baseProfileSchema,
			]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			const userWithProfile = cloneSchema(baseUserSchema, {
				addFields: {
					profile: {
						type: "relation",
						kind: "hasOne",
						model: "profile",
						foreignKey: "ownerId",
					},
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userWithProfile, baseProfileSchema],
				true,
			);
			const session = await datrix.beginMigrate();

			assertHasChanges(session);
			assertColumnInAdd(session, TABLE_NAMES.profile, "ownerId");

			await applyMigration(session);

			await assertColumnExists(datrix, "profile", "ownerId");
			await assertColumnNotExists(datrix, "profile", "userId");

			await datrix.shutdown();
		});

		it("should drop FK column from target table when hasOne is removed", async () => {
			await dropAllTables(adapter);

			const userWithProfile = cloneSchema(baseUserSchema, {
				addFields: {
					profile: { type: "relation", kind: "hasOne", model: "profile" },
				},
			});

			const datrix1 = await createDatrixWithSchemas(tmpDir, [
				userWithProfile,
				baseProfileSchema,
			]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await assertColumnExists(datrix1, "profile", "userId");
			await datrix1.shutdown();

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[baseUserSchema, baseProfileSchema],
				true,
			);
			const session = await datrix.beginMigrate();

			assertHasChanges(session);
			assertColumnInDrop(session, TABLE_NAMES.profile, "userId");

			await applyMigration(session);

			await assertColumnNotExists(datrix, "profile", "userId");

			await datrix.shutdown();
		});

		it("should not change DB when hasOne switches to hasMany (field name changes)", async () => {
			await dropAllTables(adapter);

			const userWithProfileOne = cloneSchema(baseUserSchema, {
				addFields: {
					profile: { type: "relation", kind: "hasOne", model: "profile" },
				},
			});

			const datrix1 = await createDatrixWithSchemas(tmpDir, [
				userWithProfileOne,
				baseProfileSchema,
			]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			const userWithProfileMany = cloneSchema(baseUserSchema, {
				addFields: {
					profiles: { type: "relation", kind: "hasMany", model: "profile" },
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userWithProfileMany, baseProfileSchema],
				true,
			);
			const session = await datrix.beginMigrate();
			assertNoChanges(session);

			await datrix.shutdown();
		});

		it("should not change DB when hasOne switches to hasMany (field name same)", async () => {
			await dropAllTables(adapter);

			const userWithProfileOne = cloneSchema(baseUserSchema, {
				addFields: {
					profile: { type: "relation", kind: "hasOne", model: "profile" },
				},
			});

			const datrix1 = await createDatrixWithSchemas(tmpDir, [
				userWithProfileOne,
				baseProfileSchema,
			]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			const userWithProfileMany = cloneSchema(baseUserSchema, {
				addFields: {
					profile: { type: "relation", kind: "hasMany", model: "profile" },
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userWithProfileMany, baseProfileSchema],
				true,
			);
			const session = await datrix.beginMigrate();
			assertNoChanges(session);

			await datrix.shutdown();
		});

		it("should not change DB when hasMany switches to hasOne", async () => {
			await dropAllTables(adapter);

			const userWithProfiles = cloneSchema(baseUserSchema, {
				addFields: {
					profiles: { type: "relation", kind: "hasMany", model: "profile" },
				},
			});

			const datrix1 = await createDatrixWithSchemas(tmpDir, [
				userWithProfiles,
				baseProfileSchema,
			]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			const userWithProfileOne = cloneSchema(baseUserSchema, {
				addFields: {
					profile: { type: "relation", kind: "hasOne", model: "profile" },
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userWithProfileOne, baseProfileSchema],
				true,
			);
			const session = await datrix.beginMigrate();
			assertNoChanges(session);

			await datrix.shutdown();
		});

		it("should change DB when foreignKey differs in hasOne to hasMany switch", async () => {
			await dropAllTables(adapter);

			const userWithProfile = cloneSchema(baseUserSchema, {
				addFields: {
					profile: {
						type: "relation",
						kind: "hasOne",
						model: "profile",
						foreignKey: "ownerId",
					},
				},
			});

			const datrix1 = await createDatrixWithSchemas(tmpDir, [
				userWithProfile,
				baseProfileSchema,
			]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			const userWithProfiles = cloneSchema(baseUserSchema, {
				addFields: {
					profiles: {
						type: "relation",
						kind: "hasMany",
						model: "profile",
						foreignKey: "userId",
					},
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userWithProfiles, baseProfileSchema],
				true,
			);
			const session = await datrix.beginMigrate();

			assertHasChanges(session);
			assertColumnInDrop(session, TABLE_NAMES.profile, "ownerId");
			assertColumnInAdd(session, TABLE_NAMES.profile, "userId");

			await datrix.shutdown();
		});

		it("should not change DB when switching from hasOne to belongsTo with same FK column", async () => {
			await dropAllTables(adapter);

			const userWithProfile = cloneSchema(baseUserSchema, {
				addFields: {
					profile: { type: "relation", kind: "hasOne", model: "profile" },
				},
			});

			const datrix1 = await createDatrixWithSchemas(tmpDir, [
				userWithProfile,
				baseProfileSchema,
			]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await assertColumnExists(datrix1, "profile", "userId");
			await datrix1.shutdown();

			// profiles.userId already exists from hasOne
			// belongsTo on profile side also uses profiles.userId — no change
			const profileWithUser = cloneSchema(baseProfileSchema, {
				addFields: {
					user: { type: "relation", kind: "belongsTo", model: "user" },
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[baseUserSchema, profileWithUser],
				true,
			);
			const session = await datrix.beginMigrate();
			assertNoChanges(session);

			await datrix.shutdown();
		});

		it("should not change DB when switching from belongsTo to hasMany with same FK column", async () => {
			await dropAllTables(adapter);

			const profileWithUser = cloneSchema(baseProfileSchema, {
				addFields: {
					user: { type: "relation", kind: "belongsTo", model: "user" },
				},
			});

			const datrix1 = await createDatrixWithSchemas(tmpDir, [
				baseUserSchema,
				profileWithUser,
			]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await assertColumnExists(datrix1, "profile", "userId");
			await datrix1.shutdown();

			// profiles.userId already exists from belongsTo
			// hasMany on user side also uses profiles.userId — no change
			const userWithProfiles = cloneSchema(baseUserSchema, {
				addFields: {
					profiles: { type: "relation", kind: "hasMany", model: "profile" },
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userWithProfiles, baseProfileSchema],
				true,
			);
			const session = await datrix.beginMigrate();
			assertNoChanges(session);

			await datrix.shutdown();
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
				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					basePostSchemaNoRelation,
					baseTagSchema,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);
				await datrix1.shutdown();

				// Add manyToMany relation
				const postWithTags = cloneSchema(basePostSchemaNoRelation, {
					addFields: {
						tags: { type: "relation", kind: "manyToMany", model: "tag" },
					},
				});

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[postWithTags, baseTagSchema],
					true,
				);
				const session = await datrix.beginMigrate();

				// Should detect junction table creation
				assertHasChanges(session);
				assertTablesToCreate(session, 1);
				assertTableInCreate(session, "post_tag");

				// Apply
				await applyMigration(session);

				// Verify junction table exists with FK columns
				await assertTableExists(datrix, "post_tag");
				await assertColumnExists(datrix, "post_tag", "postId");
				await assertColumnExists(datrix, "post_tag", "tagId");

				await datrix.shutdown();
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

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					appleSchema,
					bananaSchema,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);
				await datrix1.shutdown();

				// Add manyToMany from banana to apple
				const bananaWithApples = {
					...bananaSchema,
					fields: {
						...bananaSchema.fields,
						apples: {
							type: "relation" as const,
							kind: "manyToMany" as const,
							model: "apple",
						},
					},
				};

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[appleSchema, bananaWithApples],
					true,
				);
				const session = await datrix.beginMigrate();

				// Junction table should be alphabetically sorted: apple_banana (not banana_apple)
				assertTableInCreate(session, "apple_banana");

				await datrix.shutdown();
			});

			it("should use custom through table name", async () => {
				await dropAllTables(adapter);

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					basePostSchemaNoRelation,
					baseTagSchema,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);
				await datrix1.shutdown();

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

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[postWithTags, baseTagSchema],
					true,
				);
				const session = await datrix.beginMigrate();

				// Should use custom table name
				assertTableInCreate(session, "post_tags");

				await applyMigration(session);

				await assertTableExists(datrix, "post_tags");

				await datrix.shutdown();
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

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					postWithTags,
					baseTagSchema,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);

				// Add some data
				await datrix1.create("tag", { name: "JavaScript" });
				await datrix1.create("tag", { name: "TypeScript" });
				const post = await datrix1.create("post", { title: "Test Post" });
				await datrix1.create("post_tag", {
					post: { set: post.id },
					tag: { set: 1 },
				});
				await datrix1.create("post_tag", {
					post: { set: post.id },
					tag: { set: 2 },
				});

				await datrix1.shutdown();

				// Remove tags relation
				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[
						basePostSchemaNoRelation, // no tags
						baseTagSchema,
					],
					true,
				);
				const session = await datrix.beginMigrate();

				// Should detect junction table drop
				assertHasChanges(session);
				assertTablesToDrop(session, 1);
				assertTableInDrop(session, "post_tag");

				assertAmbiguousExists(session, "junction_table_drop");

				await datrix.shutdown();
			});

			it("should drop junction table after confirmation", async () => {
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
				await datrix1.shutdown();

				// Remove relation
				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[basePostSchemaNoRelation, baseTagSchema],
					true,
				);
				const session = await datrix.beginMigrate();

				// Apply
				await applyMigration(session);

				// Verify junction table dropped
				await assertTableNotExists(adapter, "post_tag");

				await datrix.shutdown();
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

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					postWithTags,
					baseTagSchema,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);
				await datrix1.shutdown();

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

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[postWithNewTags, baseTagSchema],
					true,
				);
				const session = await datrix.beginMigrate();

				// Should see: post_tags drop, article_tags create → ambiguous
				assertHasChanges(session);
				assertTableInDrop(session, "post_tags");
				assertTableInCreate(session, "article_tags");

				assertAmbiguousExists(session, "junction_table_rename_or_replace");

				await datrix.shutdown();
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
						category: {
							type: "relation",
							kind: "belongsTo",
							model: "category",
						},
					},
				});

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					postWithCategory,
					baseCategorySchema,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);

				// Insert data
				await datrix1.create("category", { name: "Tech", slug: "tech" });
				await datrix1.create("post", { title: "Post1", category: { set: 1 } });

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

				// Migration should see:
				// - posts.categoryId columnToDrop
				// - category_post tableToCreate
				assertHasChanges(session);
				assertColumnInDrop(session, TABLE_NAMES.post, "categoryId");
				assertTableInCreate(session, "category_post");

				assertAmbiguousExists(session, "relation_upgrade_single_to_many");

				await datrix.shutdown();
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

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					postWithTags,
					baseTagSchema,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);

				// Insert data with multiple tags
				await datrix1.create("tag", { name: "JS" });
				await datrix1.create("tag", { name: "TS" });
				const post = await datrix1.create("post", { title: "Post1" });
				await datrix1.create("post_tag", {
					post: { set: post.id },
					tag: { set: 1 },
				});
				await datrix1.create("post_tag", {
					post: { set: post.id },
					tag: { set: 2 },
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

				// Migration should see:
				// - post_tag tableToDrop
				// - posts.tagId columnToAdd
				assertHasChanges(session);
				assertTableInDrop(session, "post_tag");
				assertColumnInAdd(session, TABLE_NAMES.post, "tagId");

				assertAmbiguousExists(session, "relation_downgrade_many_to_single");

				await datrix.shutdown();
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

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					userWithPosts,
					basePostSchemaNoRelation,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);

				// Verify: posts has userId
				await assertColumnExists(datrix1, "post", "userId");

				await datrix1.shutdown();

				// Flip: post.user belongsTo → posts.userId (same result actually)
				// But let's try inverse: post.users hasMany → users.postId
				const postWithUsers = cloneSchema(basePostSchemaNoRelation, {
					addFields: {
						users: { type: "relation", kind: "hasMany", model: "user" },
					},
				});

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[
						baseUserSchema, // no posts relation
						postWithUsers,
					],
					true,
				);
				const session = await datrix.beginMigrate();

				// Should see:
				// - posts.userId columnToDrop
				// - users.postId columnToAdd
				assertHasChanges(session);
				assertColumnInDrop(session, TABLE_NAMES.post, "userId");
				assertColumnInAdd(session, TABLE_NAMES.user, "postId");

				assertAmbiguousExists(session, "relation_direction_flip");

				await datrix.shutdown();
			});
		});
	});

	// ============================================
	// 6. Cross-Schema Relation Mirror Tests
	// ============================================

	describe("Cross-schema relation mirrors", () => {
		describe("hasOne/hasMany ↔ belongsTo flip", () => {
			it("should not change DB when hasOne owner side is removed and belongsTo target side is added", async () => {
				await dropAllTables(adapter);

				const userWithProfile = cloneSchema(baseUserSchema, {
					addFields: {
						profile: { type: "relation", kind: "hasOne", model: "profile" },
					},
				});

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					userWithProfile,
					baseProfileSchema,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);
				await assertColumnExists(datrix1, "profile", "userId");
				await datrix1.shutdown();

				// Remove hasOne from user, add belongsTo on profile side
				// Both point to the same profiles.userId column
				const profileWithUser = cloneSchema(baseProfileSchema, {
					addFields: {
						user: { type: "relation", kind: "belongsTo", model: "user" },
					},
				});

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[baseUserSchema, profileWithUser],
					true,
				);
				const session = await datrix.beginMigrate();
				assertNoChanges(session);

				await datrix.shutdown();
			});

			it("should not change DB when hasMany owner side is removed and belongsTo target side is added", async () => {
				await dropAllTables(adapter);

				const userWithProfiles = cloneSchema(baseUserSchema, {
					addFields: {
						profiles: { type: "relation", kind: "hasMany", model: "profile" },
					},
				});

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					userWithProfiles,
					baseProfileSchema,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);
				await assertColumnExists(datrix1, "profile", "userId");
				await datrix1.shutdown();

				// Remove hasMany from user, add belongsTo on profile side
				const profileWithUser = cloneSchema(baseProfileSchema, {
					addFields: {
						user: { type: "relation", kind: "belongsTo", model: "user" },
					},
				});

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[baseUserSchema, profileWithUser],
					true,
				);
				const session = await datrix.beginMigrate();
				assertNoChanges(session);

				await datrix.shutdown();
			});

			it("should not change DB when belongsTo target side is removed and hasOne owner side is added", async () => {
				await dropAllTables(adapter);

				const profileWithUser = cloneSchema(baseProfileSchema, {
					addFields: {
						user: { type: "relation", kind: "belongsTo", model: "user" },
					},
				});

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					baseUserSchema,
					profileWithUser,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);
				await assertColumnExists(datrix1, "profile", "userId");
				await datrix1.shutdown();

				// Remove belongsTo from profile, add hasOne on user side
				const userWithProfile = cloneSchema(baseUserSchema, {
					addFields: {
						profile: { type: "relation", kind: "hasOne", model: "profile" },
					},
				});

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[userWithProfile, baseProfileSchema],
					true,
				);
				const session = await datrix.beginMigrate();
				assertNoChanges(session);

				await datrix.shutdown();
			});
		});

		describe("manyToMany bidirectional", () => {
			it("should not change DB when second side of manyToMany is added", async () => {
				await dropAllTables(adapter);

				// Only post side has the manyToMany relation
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
				await datrix1.shutdown();

				// Now tag side also declares the manyToMany relation
				// Junction table post_tag already exists
				const tagWithPosts = cloneSchema(baseTagSchema, {
					addFields: {
						posts: { type: "relation", kind: "manyToMany", model: "post" },
					},
				});

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[postWithTags, tagWithPosts],
					true,
				);
				const session = await datrix.beginMigrate();
				assertNoChanges(session);

				await datrix.shutdown();
			});

			it("should not change DB when first side of manyToMany is removed and second side remains", async () => {
				await dropAllTables(adapter);

				const postWithTags = cloneSchema(basePostSchemaNoRelation, {
					addFields: {
						tags: { type: "relation", kind: "manyToMany", model: "tag" },
					},
				});

				const tagWithPosts = cloneSchema(baseTagSchema, {
					addFields: {
						posts: { type: "relation", kind: "manyToMany", model: "post" },
					},
				});

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					postWithTags,
					tagWithPosts,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);
				await datrix1.shutdown();

				// Remove manyToMany from post side — tag side still has it
				// Junction table should NOT be dropped
				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[basePostSchemaNoRelation, tagWithPosts],
					true,
				);
				const session = await datrix.beginMigrate();
				assertNoChanges(session);

				await datrix.shutdown();
			});

			it("should drop junction table only when both sides are removed", async () => {
				await dropAllTables(adapter);

				const postWithTags = cloneSchema(basePostSchemaNoRelation, {
					addFields: {
						tags: { type: "relation", kind: "manyToMany", model: "tag" },
					},
				});

				const tagWithPosts = cloneSchema(baseTagSchema, {
					addFields: {
						posts: { type: "relation", kind: "manyToMany", model: "post" },
					},
				});

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					postWithTags,
					tagWithPosts,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);
				await datrix1.shutdown();

				// Remove manyToMany from both sides
				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[basePostSchemaNoRelation, baseTagSchema],
					true,
				);
				const session = await datrix.beginMigrate();
				assertHasChanges(session);
				assertTableInDrop(session, "post_tag");

				await datrix.shutdown();
			});
		});

		describe("belongsTo mirror (both sides declared)", () => {
			it("should not change DB when hasMany is added to owner side while belongsTo already exists on target", async () => {
				await dropAllTables(adapter);

				const profileWithUser = cloneSchema(baseProfileSchema, {
					addFields: {
						user: { type: "relation", kind: "belongsTo", model: "user" },
					},
				});

				const datrix1 = await createDatrixWithSchemas(tmpDir, [
					baseUserSchema,
					profileWithUser,
				]);
				const s1 = await datrix1.beginMigrate();
				await applyMigration(s1);
				await assertColumnExists(datrix1, "profile", "userId");
				await datrix1.shutdown();

				// Add hasMany on user side — profiles.userId already exists
				const userWithProfiles = cloneSchema(baseUserSchema, {
					addFields: {
						profiles: { type: "relation", kind: "hasMany", model: "profile" },
					},
				});

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[userWithProfiles, profileWithUser],
					true,
				);
				const session = await datrix.beginMigrate();
				assertNoChanges(session);

				await datrix.shutdown();
			});
		});

		describe("manyToMany ownership transfer", () => {
			it("should not change DB when manyToMany is removed from A and added to B simultaneously", async () => {
				await dropAllTables(adapter);

				// Only post side declares the relation
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
				await datrix1.shutdown();

				// Remove from post, add to tag — junction table post_tag must stay
				const tagWithPosts = cloneSchema(baseTagSchema, {
					addFields: {
						posts: { type: "relation", kind: "manyToMany", model: "post" },
					},
				});

				const datrix = await createDatrixWithSchemas(
					tmpDir,
					[basePostSchemaNoRelation, tagWithPosts],
					true,
				);
				const session = await datrix.beginMigrate();
				assertNoChanges(session);

				await datrix.shutdown();
			});
		});
	});
});
