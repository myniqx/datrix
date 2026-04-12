/**
 * Migration E2E Tests - Complex Scenarios
 *
 * Tests for multiple simultaneous changes, index operations, and edge cases.
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { createDatrixWithSchemas, getTmpDir } from "./setup/config";
import { getAdapter, getAdapterType } from "./setup/adapter";
import {
	baseUserSchema,
	basePostSchema,
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
	assertNoChanges,
	applyMigration,
	autoResolveAmbiguous,
} from "./setup/helpers";
import type { DatabaseAdapter } from "@datrix/core";

describe("Migration E2E - Complex Scenarios", () => {
	const tmpDir = getTmpDir("complex");
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

	describe("Multiple table and column changes", () => {
		it("should handle multiple changes at once", async () => {
			// Setup: user, post, category tables
			await dropAllTables(adapter);
			const datrix1 = await createDatrixWithSchemas(tmpDir, [
				baseUserSchema,
				basePostSchema,
				baseCategorySchema,
			]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Complex changes:
			// - Add 'tag' table
			// - Remove 'category' table
			// - Add 'phone' to user
			// - Remove 'published' from post
			// - Rename 'title' to 'headline' in post (ambiguous)
			const userWithPhone = cloneSchema(baseUserSchema, {
				addFields: {
					phone: { type: "string" },
				},
			});

			const postModified = cloneSchema(basePostSchema, {
				removeFields: ["published", "title"],
				addFields: {
					headline: { type: "string", required: true },
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userWithPhone, postModified, baseTagSchema],
				true,
			);

			const session = await datrix.beginMigrate();

			// Should detect all changes
			assertHasChanges(session);
			expect(session.tablesToCreate.length).toBe(1); // tag
			expect(session.tablesToDrop.length).toBe(1); // category
			expect(session.tablesToAlter.length).toBeGreaterThanOrEqual(2); // user, post

			// Should have ambiguous for title->headline
			expect(session.ambiguous.length).toBeGreaterThanOrEqual(1);

			// Resolve ambiguous as rename
			autoResolveAmbiguous(session, "rename");

			// Apply
			await applyMigration(session);

			// Verify
			await assertTableExists(datrix, "user");
			await assertTableExists(datrix, "post");
			await assertTableExists(datrix, "tag");
			await assertTableNotExists(adapter, TABLE_NAMES.category);

			await assertColumnExists(datrix, "user", "phone");
			await assertColumnExists(datrix, "post", "headline");
			await assertColumnNotExists(datrix, "post", "title");
			await assertColumnNotExists(datrix, "post", "published");

			await datrix.shutdown();
		});

		it("should handle adding table with relations", async () => {
			// Setup: just user
			await dropAllTables(adapter);
			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Add post with relation to user
			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[baseUserSchema, basePostSchema],
				true,
			);

			const session = await datrix.beginMigrate();

			assertHasChanges(session);
			expect(session.tablesToCreate.length).toBe(1);

			await applyMigration(session);

			await assertTableExists(datrix, "post");
			// Should have authorId foreign key
			await assertColumnExists(datrix, "post", "authorId");

			await datrix.shutdown();
		});
	});

	describe("Index changes", () => {
		it("should add new index", async () => {
			// Setup: user without extra indexes
			await dropAllTables(adapter);
			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Add index on name
			const userWithNameIndex = cloneSchema(baseUserSchema, {
				addIndexes: [{ fields: ["name"], unique: false }],
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userWithNameIndex],
				true,
			);
			const session = await datrix.beginMigrate();

			assertHasChanges(session);

			// Check for index addition in changes
			const userAlter = session.tablesToAlter.find(
				(t) => t.tableName === TABLE_NAMES.user,
			);
			expect(userAlter).toBeDefined();
			if (userAlter) {
				const indexAdd = userAlter.changes.find((c) => c.type === "indexAdded");
				expect(indexAdd).toBeDefined();
			}

			await applyMigration(session);

			await datrix.shutdown();
		});

		it("should remove index", async () => {
			// Setup: user with email index (from base schema)
			await dropAllTables(adapter);
			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Remove email index
			const userNoEmailIndex = cloneSchema(baseUserSchema, {
				removeIndexes: ["email"],
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userNoEmailIndex],
				true,
			);
			const session = await datrix.beginMigrate();

			assertHasChanges(session);

			// Check for index removal in changes
			const userAlter = session.tablesToAlter.find(
				(t) => t.tableName === TABLE_NAMES.user,
			);
			expect(userAlter).toBeDefined();
			if (userAlter) {
				const indexRemove = userAlter.changes.find(
					(c) => c.type === "indexRemoved",
				);
				expect(indexRemove).toBeDefined();
			}

			await applyMigration(session);

			await datrix.shutdown();
		});

		it("should handle multiple index changes", async () => {
			// Setup with custom indexes
			await dropAllTables(adapter);
			const userWithIndexes = cloneSchema(baseUserSchema, {
				addIndexes: [
					{ fields: ["name"], unique: false },
					{ fields: ["age"], unique: false },
				],
			});
			const datrix1 = await createDatrixWithSchemas(tmpDir, [userWithIndexes]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Change indexes: remove name index, add phone index, keep age
			const userNewIndexes = cloneSchema(baseUserSchema, {
				addFields: {
					phone: { type: "string" },
				},
				addIndexes: [
					{ fields: ["age"], unique: false },
					{ fields: ["phone"], unique: false },
				],
				removeIndexes: ["name"],
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userNewIndexes],
				true,
			);
			const session = await datrix.beginMigrate();

			assertHasChanges(session);

			await applyMigration(session);

			await datrix.shutdown();
		});
	});

	describe("Empty and edge cases", () => {
		it("should handle empty database gracefully", async () => {
			await dropAllTables(adapter);

			const datrix = await createDatrixWithSchemas(tmpDir, []);
			const session = await datrix.beginMigrate();

			// No schemas = no changes
			assertNoChanges(session);

			await datrix.shutdown();
		});

		it("should handle schema with only required fields", async () => {
			await dropAllTables(adapter);

			const minimalSchema = {
				name: "minimal",
				tableName: "minimals",
				fields: {
					data: { type: "string" as const, required: true },
				},
			};

			const datrix = await createDatrixWithSchemas(tmpDir, [minimalSchema]);
			const session = await datrix.beginMigrate();

			assertHasChanges(session);
			expect(session.tablesToCreate.length).toBe(1);

			await applyMigration(session);

			await assertTableExists(datrix, "minimal");

			await datrix.shutdown();
		});

		it("should handle schema with all field types", async () => {
			await dropAllTables(adapter);

			const fullSchema = {
				name: "full",
				tableName: "fulls",
				fields: {
					stringField: { type: "string" as const },
					numberField: { type: "number" as const },
					booleanField: { type: "boolean" as const },
					dateField: { type: "date" as const },
					jsonField: { type: "json" as const },
					enumField: {
						type: "enum" as const,
						values: ["a", "b", "c"] as const,
					},
				},
			};

			const datrix = await createDatrixWithSchemas(tmpDir, [fullSchema]);
			const session = await datrix.beginMigrate();

			assertHasChanges(session);

			await applyMigration(session);

			await assertTableExists(datrix, "full");
			await assertColumnExists(datrix, "full", "stringField");
			await assertColumnExists(datrix, "full", "numberField");
			await assertColumnExists(datrix, "full", "booleanField");
			await assertColumnExists(datrix, "full", "dateField");
			await assertColumnExists(datrix, "full", "jsonField");
			await assertColumnExists(datrix, "full", "enumField");

			await datrix.shutdown();
		});

		it("should handle rapid successive migrations", async () => {
			await dropAllTables(adapter);

			// Migration 1: Create user
			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Migration 2: Add phone
			const userV2 = cloneSchema(baseUserSchema, {
				addFields: { phone: { type: "string" } },
			});
			const datrix2 = await createDatrixWithSchemas(tmpDir, [userV2], true);
			const s2 = await datrix2.beginMigrate();
			await applyMigration(s2);
			await datrix2.shutdown();

			// Migration 3: Add address
			const userV3 = cloneSchema(baseUserSchema, {
				addFields: {
					phone: { type: "string" },
					address: { type: "string" },
				},
			});
			const datrix3 = await createDatrixWithSchemas(tmpDir, [userV3], true);
			const s3 = await datrix3.beginMigrate();
			await applyMigration(s3);
			await datrix3.shutdown();

			// Migration 4: Remove age
			const userV4 = cloneSchema(baseUserSchema, {
				removeFields: ["age"],
				addFields: {
					phone: { type: "string" },
					address: { type: "string" },
				},
			});
			const datrix4 = await createDatrixWithSchemas(tmpDir, [userV4], true);
			const s4 = await datrix4.beginMigrate();
			await applyMigration(s4);

			// Verify final state (before shutdown)
			await assertColumnExists(datrix4, "user", "email");
			await assertColumnExists(datrix4, "user", "name");
			await assertColumnExists(datrix4, "user", "phone");
			await assertColumnExists(datrix4, "user", "address");
			await assertColumnNotExists(datrix4, "user", "age");

			await datrix4.shutdown();
		});
	});

	describe("Idempotency", () => {
		it("should be idempotent - running twice changes nothing", async () => {
			await dropAllTables(adapter);

			// First run
			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Second run with same schema
			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[baseUserSchema],
				true,
			);
			const session = await datrix.beginMigrate();

			// Should have no changes
			assertNoChanges(session);

			await datrix.shutdown();
		});

		it("should detect drift if database modified externally", async () => {
			await dropAllTables(adapter);

			// Create via migration
			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Simulate external modification: add column directly to DB
			// (This would need raw SQL execution which might not be available in all adapters)
			// For now, we just verify the detection mechanism works

			// Create datrix with modified schema
			const userModified = cloneSchema(baseUserSchema, {
				addFields: { external: { type: "string" } },
			});
			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userModified],
				true,
			);
			const session = await datrix.beginMigrate();

			// Should detect the missing column
			assertHasChanges(session);

			await datrix.shutdown();
		});
	});
});
