/**
 * Migration E2E Tests - Column Changes
 *
 * Tests for adding and dropping columns.
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { createDatrixWithSchemas, getTmpDir } from "./setup/config";
import { getAdapter, getAdapterType } from "./setup/adapter";
import { baseUserSchema, cloneSchema, TABLE_NAMES } from "./setup/schemas-base";
import {
	dropAllTables,
	assertColumnExists,
	assertColumnNotExists,
	assertTablesToAlter,
	assertHasChanges,
	applyMigration,
} from "./setup/helpers";
import type { DatabaseAdapter } from "@datrix/core";

describe("Migration E2E - Column Changes", () => {
	const tmpDir = getTmpDir("column-changes");
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

	describe("Add columns", () => {
		it("should add single column to existing table", async () => {
			// Start with base user schema
			await dropAllTables(adapter);
			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Add 'phone' field
			const userWithPhone = cloneSchema(baseUserSchema, {
				addFields: {
					phone: { type: "string" },
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userWithPhone],
				true,
			);
			const session = await datrix.beginMigrate();

			// Should detect column addition
			assertHasChanges(session);
			assertTablesToAlter(session, 1);

			// Apply
			await applyMigration(session);

			// Verify
			await assertColumnExists(datrix, "user", "phone");
			await assertColumnExists(datrix, "user", "email");
			await assertColumnExists(datrix, "user", "name");

			await datrix.shutdown();
		});

		it("should add multiple columns at once", async () => {
			// Start fresh with base user
			await dropAllTables(adapter);
			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Add phone, address, country
			const userWithExtras = cloneSchema(baseUserSchema, {
				addFields: {
					phone: { type: "string" },
					address: { type: "string" },
					country: { type: "string" },
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userWithExtras],
				true,
			);
			const session = await datrix.beginMigrate();

			// Should detect alterations
			assertHasChanges(session);
			assertTablesToAlter(session, 1);

			// Apply
			await applyMigration(session);

			// Verify all columns exist
			await assertColumnExists(datrix, "user", "phone");
			await assertColumnExists(datrix, "user", "address");
			await assertColumnExists(datrix, "user", "country");

			await datrix.shutdown();
		});

		it("should add column with constraints", async () => {
			await dropAllTables(adapter);
			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Add required, unique field
			const userWithUsername = cloneSchema(baseUserSchema, {
				addFields: {
					username: { type: "string", required: true, unique: true },
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userWithUsername],
				true,
			);
			const session = await datrix.beginMigrate();
			assertHasChanges(session);

			// Apply
			await applyMigration(session);

			// Verify
			await assertColumnExists(datrix, "user", "username");

			await datrix.shutdown();
		});
	});

	describe("Drop columns", () => {
		it("should drop single column", async () => {
			// Start with user that has age
			await dropAllTables(adapter);
			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);

			// Verify age exists
			await assertColumnExists(datrix1, "user", "age");
			await datrix1.shutdown();

			// Remove 'age' field
			const userWithoutAge = cloneSchema(baseUserSchema, {
				removeFields: ["age"],
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userWithoutAge],
				true,
			);
			const session = await datrix.beginMigrate();

			// Should detect column removal
			assertHasChanges(session);
			assertTablesToAlter(session, 1);

			// Apply
			await applyMigration(session);

			// Verify age is gone
			await assertColumnNotExists(datrix, "user", "age");
			await assertColumnExists(datrix, "user", "email");
			await assertColumnExists(datrix, "user", "name");

			await datrix.shutdown();
		});

		it("should drop multiple columns at once", async () => {
			// Start with user that has extra fields
			await dropAllTables(adapter);
			const userWithExtras = cloneSchema(baseUserSchema, {
				addFields: {
					phone: { type: "string" },
					address: { type: "string" },
				},
			});
			const datrix1 = await createDatrixWithSchemas(tmpDir, [userWithExtras]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);

			// Verify extras exist
			await assertColumnExists(datrix1, "user", "phone");
			await assertColumnExists(datrix1, "user", "address");
			await datrix1.shutdown();

			// Remove age, phone, address (keep only email, name)
			const userMinimal = cloneSchema(baseUserSchema, {
				removeFields: ["age"],
			});

			const datrix = await createDatrixWithSchemas(tmpDir, [userMinimal], true);
			const session = await datrix.beginMigrate();
			assertHasChanges(session);

			// Apply
			await applyMigration(session);

			// Verify removals
			await assertColumnNotExists(datrix, "user", "age");
			await assertColumnNotExists(datrix, "user", "phone");
			await assertColumnNotExists(datrix, "user", "address");
			// Core fields still there
			await assertColumnExists(datrix, "user", "email");
			await assertColumnExists(datrix, "user", "name");

			await datrix.shutdown();
		});
	});

	describe("Add and drop columns together", () => {
		it("should add and drop columns in same migration", async () => {
			// Start with base user
			await dropAllTables(adapter);
			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Remove age, add phone and bio
			const userModified = cloneSchema(baseUserSchema, {
				removeFields: ["age"],
				addFields: {
					phone: { type: "string" },
					bio: { type: "string" },
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userModified],
				true,
			);
			const session = await datrix.beginMigrate();
			assertHasChanges(session);

			// Apply
			await applyMigration(session);

			// Verify
			await assertColumnNotExists(datrix, "user", "age");
			await assertColumnExists(datrix, "user", "phone");
			await assertColumnExists(datrix, "user", "bio");
			await assertColumnExists(datrix, "user", "email");
			await assertColumnExists(datrix, "user", "name");

			await datrix.shutdown();
		});
	});

	describe("Column type changes", () => {
		it("should detect column type modification", async () => {
			// Start with age as number
			await dropAllTables(adapter);
			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Change age from number to string
			const userAgeString = cloneSchema(baseUserSchema, {
				modifyFields: {
					age: { type: "string" },
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userAgeString],
				true,
			);
			const session = await datrix.beginMigrate();

			// Should detect modification
			assertHasChanges(session);
			assertTablesToAlter(session, 1);

			// Check that tablesToAlter contains fieldModified
			const userAlter = session.tablesToAlter.find(
				(t) => t.tableName === TABLE_NAMES.user,
			);
			expect(userAlter).toBeDefined();
			if (userAlter) {
				const fieldMod = userAlter.changes.find(
					(c) => c.type === "fieldModified" && c.fieldName === "age",
				);
				expect(fieldMod).toBeDefined();
			}

			await datrix.shutdown();
		});

		it("should detect constraint changes", async () => {
			// Start with name as required
			await dropAllTables(adapter);
			const datrix1 = await createDatrixWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await datrix1.beginMigrate();
			await applyMigration(s1);
			await datrix1.shutdown();

			// Make name optional
			const userNameOptional = cloneSchema(baseUserSchema, {
				modifyFields: {
					name: { type: "string", required: false },
				},
			});

			const datrix = await createDatrixWithSchemas(
				tmpDir,
				[userNameOptional],
				true,
			);
			const session = await datrix.beginMigrate();

			// Should detect modification
			assertHasChanges(session);

			await datrix.shutdown();
		});
	});
});
