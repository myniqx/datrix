/**
 * Migration E2E Tests - Fresh Start
 *
 * Tests for creating tables from scratch and basic add/drop operations.
 */

import { describe, it, beforeAll, afterAll } from "vitest";
import { createDatrixWithSchemas, getTmpDir } from "./setup/config";
import { getAdapter, getAdapterType } from "./setup/adapter";
import {
	baseUserSchema,
	basePostSchema,
	baseCategorySchema,
	baseTagSchema,
	allBaseSchemas,
	TABLE_NAMES,
} from "./setup/schemas-base";
import {
	dropAllTables,
	assertTableExists,
	assertTableNotExists,
	assertTablesToCreate,
	assertTablesToDrop,
	assertNoChanges,
	assertHasChanges,
	applyMigration,
} from "./setup/helpers";
import type { DatabaseAdapter } from "@datrix/core";

describe("Migration E2E - Fresh Start", () => {
	const tmpDir = getTmpDir("fresh-start");
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

	describe("Create tables from scratch", () => {
		it("should create all tables when DB is empty", async () => {
			// Clean slate
			await dropAllTables(adapter);

			// Create Datrix with all base schemas
			const datrix = await createDatrixWithSchemas(tmpDir, [...allBaseSchemas]);

			// Begin migration
			const session = await datrix.beginMigrate();

			// Should detect 3 tables to create
			assertHasChanges(session);
			assertTablesToCreate(session, 3);
			assertTablesToDrop(session, 0);

			// Apply migration
			await applyMigration(session);

			// Verify tables exist (before shutdown)
			await assertTableExists(datrix, "user");
			await assertTableExists(datrix, "post");
			await assertTableExists(datrix, "category");

			await datrix.shutdown();
		});

		it("should detect no changes when schemas match DB", async () => {
			// DB already has tables from previous test
			// Create Datrix with same schemas
			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[...allBaseSchemas],
				true,
			);

			// Begin migration
			const session = await datrix.beginMigrate();

			// Should detect no changes
			assertNoChanges(session);

			await datrix.shutdown();
		});
	});

	describe("Add new table", () => {
		it("should add new table when schema added", async () => {
			// Start fresh with user, post, category
			await dropAllTables(adapter);
			const datrix1 = await createDatrixWithSchemas(tmpDir, [...allBaseSchemas]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Now add 'tag' schema
			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[...allBaseSchemas, baseTagSchema],
				true,
			);

			const session = await datrix.beginMigrate();

			// Should detect 1 new table
			assertHasChanges(session);
			assertTablesToCreate(session, 1);
			assertTablesToDrop(session, 0);
			expect(session.tablesToCreate[0]?.name).toBe("tag");

			// Apply
			await applyMigration(session);

			// Verify
			await assertTableExists(datrix, "tag");
			await assertTableExists(datrix, "user");
			await assertTableExists(datrix, "post");
			await assertTableExists(datrix, "category");

			await datrix.shutdown();
		});

		it("should add multiple new tables at once", async () => {
			// Start fresh with only user
			await dropAllTables(adapter);
			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Now add post, category, tag
			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[baseUserSchema, basePostSchema, baseCategorySchema, baseTagSchema],
				true,
			);

			const session = await datrix.beginMigrate();

			// Should detect 3 new tables
			assertHasChanges(session);
			assertTablesToCreate(session, 3);
			assertTablesToDrop(session, 0);

			// Apply
			await applyMigration(session);

			// Verify all exist
			await assertTableExists(datrix, "user");
			await assertTableExists(datrix, "post");
			await assertTableExists(datrix, "category");
			await assertTableExists(datrix, "tag");

			await datrix.shutdown();
		});
	});

	describe("Drop table", () => {
		it("should drop table when schema removed", async () => {
			// Start with user, post, category
			await dropAllTables(adapter);
			const datrix1 = await createDatrixWithSchemas(tmpDir, [...allBaseSchemas]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Remove category
			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[baseUserSchema, basePostSchema],
				true,
			);

			const session = await datrix.beginMigrate();

			// Should detect 1 table to drop
			assertHasChanges(session);
			assertTablesToCreate(session, 0);
			assertTablesToDrop(session, 1);
			expect(session.tablesToDrop).toContain(TABLE_NAMES.category);

			// Apply
			await applyMigration(session);

			// Verify (use adapter + TABLE_NAMES for dropped table)
			await assertTableNotExists(adapter, TABLE_NAMES.category);
			await assertTableExists(datrix, "user");
			await assertTableExists(datrix, "post");

			await datrix.shutdown();
		});

		it("should drop multiple tables at once", async () => {
			// Start with all 4 tables
			await dropAllTables(adapter);
			const datrix1 = await createDatrixWithSchemas(tmpDir, [
				...allBaseSchemas,
				baseTagSchema,
			]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Keep only user
			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[baseUserSchema],
				true,
			);

			const session = await datrix.beginMigrate();

			// Should detect 3 tables to drop
			assertHasChanges(session);
			assertTablesToCreate(session, 0);
			assertTablesToDrop(session, 3);

			// Apply
			await applyMigration(session);

			// Verify (use adapter + TABLE_NAMES for dropped tables)
			await assertTableExists(datrix, "user");
			await assertTableNotExists(adapter, TABLE_NAMES.post);
			await assertTableNotExists(adapter, TABLE_NAMES.category);
			await assertTableNotExists(adapter, TABLE_NAMES.tag);

			await datrix.shutdown();
		});
	});

	describe("Add and drop together", () => {
		it("should add and drop tables in same migration", async () => {
			// Start with user, post
			await dropAllTables(adapter);
			const datrix1 = await createDatrixWithSchemas(tmpDir, [
				baseUserSchema,
				basePostSchema,
			]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Remove post, add category and tag
			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[baseUserSchema, baseCategorySchema, baseTagSchema],
				true,
			);

			const session = await datrix.beginMigrate();

			// Should detect changes
			assertHasChanges(session);
			assertTablesToCreate(session, 2); // category, tag
			assertTablesToDrop(session, 1); // post

			// Apply
			await applyMigration(session);

			// Verify (use adapter + TABLE_NAMES for dropped table)
			await assertTableExists(datrix, "user");
			await assertTableNotExists(adapter, TABLE_NAMES.post);
			await assertTableExists(datrix, "category");
			await assertTableExists(datrix, "tag");

			await datrix.shutdown();
		});
	});
});
