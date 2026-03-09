/**
 * Migration E2E Tests - Column Changes
 *
 * Tests for adding and dropping columns.
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { createForjaWithSchemas, getTmpDir } from "./setup/config";
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
import type { DatabaseAdapter } from "forja-types/adapter";

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
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Add 'phone' field
			const userWithPhone = cloneSchema(baseUserSchema, {
				addFields: {
					phone: { type: "string" },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userWithPhone], true);
			const session = await forja.beginMigrate();

			// Should detect column addition
			assertHasChanges(session);
			assertTablesToAlter(session, 1);

			// Apply
			await applyMigration(session);

			// Verify
			await assertColumnExists(forja, "user", "phone");
			await assertColumnExists(forja, "user", "email");
			await assertColumnExists(forja, "user", "name");

			await forja.shutdown();
		});

		it("should add multiple columns at once", async () => {
			// Start fresh with base user
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Add phone, address, country
			const userWithExtras = cloneSchema(baseUserSchema, {
				addFields: {
					phone: { type: "string" },
					address: { type: "string" },
					country: { type: "string" },
				},
			});

			const forja = await createForjaWithSchemas(
				tmpDir,
				[userWithExtras],
				true,
			);
			const session = await forja.beginMigrate();

			// Should detect alterations
			assertHasChanges(session);
			assertTablesToAlter(session, 1);

			// Apply
			await applyMigration(session);

			// Verify all columns exist
			await assertColumnExists(forja, "user", "phone");
			await assertColumnExists(forja, "user", "address");
			await assertColumnExists(forja, "user", "country");

			await forja.shutdown();
		});

		it("should add column with constraints", async () => {
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Add required, unique field
			const userWithUsername = cloneSchema(baseUserSchema, {
				addFields: {
					username: { type: "string", required: true, unique: true },
				},
			});

			const forja = await createForjaWithSchemas(
				tmpDir,
				[userWithUsername],
				true,
			);
			const session = await forja.beginMigrate();
			assertHasChanges(session);

			// Apply
			await applyMigration(session);

			// Verify
			await assertColumnExists(forja, "user", "username");

			await forja.shutdown();
		});
	});

	describe("Drop columns", () => {
		it("should drop single column", async () => {
			// Start with user that has age
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);

			// Verify age exists
			await assertColumnExists(forja1, "user", "age");
			await forja1.shutdown();

			// Remove 'age' field
			const userWithoutAge = cloneSchema(baseUserSchema, {
				removeFields: ["age"],
			});

			const forja = await createForjaWithSchemas(
				tmpDir,
				[userWithoutAge],
				true,
			);
			const session = await forja.beginMigrate();

			// Should detect column removal
			assertHasChanges(session);
			assertTablesToAlter(session, 1);

			// Apply
			await applyMigration(session);

			// Verify age is gone
			await assertColumnNotExists(forja, "user", "age");
			await assertColumnExists(forja, "user", "email");
			await assertColumnExists(forja, "user", "name");

			await forja.shutdown();
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
			const forja1 = await createForjaWithSchemas(tmpDir, [userWithExtras]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);

			// Verify extras exist
			await assertColumnExists(forja1, "user", "phone");
			await assertColumnExists(forja1, "user", "address");
			await forja1.shutdown();

			// Remove age, phone, address (keep only email, name)
			const userMinimal = cloneSchema(baseUserSchema, {
				removeFields: ["age"],
			});

			const forja = await createForjaWithSchemas(tmpDir, [userMinimal], true);
			const session = await forja.beginMigrate();
			assertHasChanges(session);

			// Apply
			await applyMigration(session);

			// Verify removals
			await assertColumnNotExists(forja, "user", "age");
			await assertColumnNotExists(forja, "user", "phone");
			await assertColumnNotExists(forja, "user", "address");
			// Core fields still there
			await assertColumnExists(forja, "user", "email");
			await assertColumnExists(forja, "user", "name");

			await forja.shutdown();
		});
	});

	describe("Add and drop columns together", () => {
		it("should add and drop columns in same migration", async () => {
			// Start with base user
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Remove age, add phone and bio
			const userModified = cloneSchema(baseUserSchema, {
				removeFields: ["age"],
				addFields: {
					phone: { type: "string" },
					bio: { type: "string" },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userModified], true);
			const session = await forja.beginMigrate();
			assertHasChanges(session);

			// Apply
			await applyMigration(session);

			// Verify
			await assertColumnNotExists(forja, "user", "age");
			await assertColumnExists(forja, "user", "phone");
			await assertColumnExists(forja, "user", "bio");
			await assertColumnExists(forja, "user", "email");
			await assertColumnExists(forja, "user", "name");

			await forja.shutdown();
		});
	});

	describe("Column type changes", () => {
		it("should detect column type modification", async () => {
			// Start with age as number
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Change age from number to string
			const userAgeString = cloneSchema(baseUserSchema, {
				modifyFields: {
					age: { type: "string" },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userAgeString], true);
			const session = await forja.beginMigrate();

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

			await forja.shutdown();
		});

		it("should detect constraint changes", async () => {
			// Start with name as required
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Make name optional
			const userNameOptional = cloneSchema(baseUserSchema, {
				modifyFields: {
					name: { type: "string", required: false },
				},
			});

			const forja = await createForjaWithSchemas(
				tmpDir,
				[userNameOptional],
				true,
			);
			const session = await forja.beginMigrate();

			// Should detect modification
			assertHasChanges(session);

			await forja.shutdown();
		});
	});
});
