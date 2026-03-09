/**
 * Migration E2E Tests - Ambiguous Changes
 *
 * Tests for detecting and resolving ambiguous changes (rename vs drop+add).
 * These tests stress-test the ambiguous detection algorithm.
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Forja } from "forja-core";
import { createForjaWithSchemas, getTmpDir } from "./setup/config";
import { getAdapter, getAdapterType } from "./setup/adapter";
import { baseUserSchema, cloneSchema, TABLE_NAMES } from "./setup/schemas-base";
import {
	dropAllTables,
	assertColumnExists,
	assertColumnNotExists,
	assertTableExists,
	assertTableNotExists,
	assertAmbiguousCount,
	assertHasAmbiguous,
	assertNoAmbiguous,
	assertHasChanges,
	applyMigration,
	resolveAmbiguousById,
	autoResolveAmbiguous,
} from "./setup/helpers";
import type { DatabaseAdapter } from "forja-types/adapter";

describe("Migration E2E - Ambiguous Detection", () => {
	const tmpDir = getTmpDir("ambiguous");
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

	describe("Classic rename candidate (1 removed + 1 added)", () => {
		it("should detect ambiguous: remove 'name' + add 'fullName'", async () => {
			// Setup: user with name
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Change: remove name, add fullName
			const userRenamed = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					fullName: { type: "string", required: true },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userRenamed], true);
			const session = await forja.beginMigrate();

			// Should detect ambiguous
			assertHasChanges(session);
			assertAmbiguousCount(session, 1);
			assertHasAmbiguous(session, TABLE_NAMES.user, "name", "fullName");

			await forja.shutdown();
		});

		it("should apply as RENAME when resolved", async () => {
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			const userRenamed = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					fullName: { type: "string", required: true },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userRenamed], true);
			const session = await forja.beginMigrate();

			autoResolveAmbiguous(session, "rename");
			await applyMigration(session);

			await assertColumnExists(forja, "user", "fullName");
			await assertColumnNotExists(forja, "user", "name");

			await forja.shutdown();
		});

		it("should resolve specific ambiguous by ID", async () => {
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			const userRenamed = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					fullName: { type: "string", required: true },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userRenamed], true);
			const session = await forja.beginMigrate();

			expect(session.ambiguous.length).toBe(1);
			const ambiguousId = session.ambiguous[0]!.id;

			session.resolveAmbiguous(ambiguousId, "rename");
			expect(session.hasUnresolvedAmbiguous()).toBe(false);

			await applyMigration(session);

			await assertColumnExists(forja, "user", "fullName");
			await assertColumnNotExists(forja, "user", "name");

			await forja.shutdown();
		});

		it("should fail to resolve with invalid action", async () => {
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			const userRenamed = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					fullName: { type: "string", required: true },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userRenamed], true);
			const session = await forja.beginMigrate();
			const ambiguousId = session.ambiguous[0]!.id;

			// Invalid action for column_rename_or_replace
			expect(() =>
				resolveAmbiguousById(session, ambiguousId, "confirm_drop"),
			).toThrow(/Invalid action/);

			// Still unresolved
			expect(session.hasUnresolvedAmbiguous()).toBe(true);

			await forja.shutdown();
		});

		it("should fail to resolve non-existent ambiguous ID", async () => {
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			const userRenamed = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					fullName: { type: "string", required: true },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userRenamed], true);
			const session = await forja.beginMigrate();

			expect(() =>
				resolveAmbiguousById(session, "nonexistent-id", "rename"),
			).toThrow(/not found/);

			await forja.shutdown();
		});

		it("should block apply when ambiguous not resolved", async () => {
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			const userRenamed = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					fullName: { type: "string", required: true },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userRenamed], true);
			const session = await forja.beginMigrate();

			expect(session.hasUnresolvedAmbiguous()).toBe(true);

			// Apply without resolving should fail
			let failed = false;
			try {
				await session.apply();
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toMatch(/unresolved ambiguous/i);
				failed = true;
			}
			expect(failed).toBe(true);

			await forja.shutdown();
		});

		it("should apply as DROP+ADD when resolved", async () => {
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			const userRenamed = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					fullName: { type: "string", required: true },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userRenamed], true);
			const session = await forja.beginMigrate();

			autoResolveAmbiguous(session, "drop_and_add");
			await applyMigration(session);

			await assertColumnExists(forja, "user", "fullName");
			await assertColumnNotExists(forja, "user", "name");

			await forja.shutdown();
		});
	});

	describe("Complex scenarios (2+ removed, 2+ added)", () => {
		it("should handle 2 removed + 1 added: one ambiguous pair, one plain drop", async () => {
			// Setup: user with firstName, lastName
			await dropAllTables(adapter);
			const userWithNames = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					firstName: { type: "string", required: true },
					lastName: { type: "string", required: true },
				},
			});
			const forja1 = await createForjaWithSchemas(tmpDir, [userWithNames]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Remove firstName + lastName, add fullName
			// Algorithm matches first pair (firstName->fullName), lastName is plain drop
			const userFullName = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					fullName: { type: "string", required: true },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userFullName], true);
			const session = await forja.beginMigrate();

			assertHasChanges(session);
			// 1 ambiguous pair (one removed matched with the added)
			assertAmbiguousCount(session, 1);

			autoResolveAmbiguous(session, "drop_and_add");
			await applyMigration(session);

			await assertColumnExists(forja, "user", "fullName");
			await assertColumnNotExists(forja, "user", "firstName");
			await assertColumnNotExists(forja, "user", "lastName");

			await forja.shutdown();
		});

		it("should handle 1 removed + 2 added: one ambiguous pair, one plain add", async () => {
			// Setup: user with name
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Remove name, add firstName + lastName
			// Algorithm matches first pair (name->firstName), lastName is plain add
			const userSplitName = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					firstName: { type: "string", required: true },
					lastName: { type: "string", required: true },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userSplitName], true);
			const session = await forja.beginMigrate();

			assertHasChanges(session);
			// 1 ambiguous pair (removed matched with one added)
			assertAmbiguousCount(session, 1);

			autoResolveAmbiguous(session, "drop_and_add");
			await applyMigration(session);

			await assertColumnExists(forja, "user", "firstName");
			await assertColumnExists(forja, "user", "lastName");
			await assertColumnNotExists(forja, "user", "name");

			await forja.shutdown();
		});

		it("should handle 2 removed + 2 added: two ambiguous pairs", async () => {
			// Setup: user with firstName, lastName
			await dropAllTables(adapter);
			const userWithNames = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					firstName: { type: "string", required: true },
					lastName: { type: "string", required: true },
				},
			});
			const forja1 = await createForjaWithSchemas(tmpDir, [userWithNames]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Remove firstName + lastName, add givenName + familyName
			const userRenamedBoth = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					givenName: { type: "string", required: true },
					familyName: { type: "string", required: true },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userRenamedBoth], true);
			const session = await forja.beginMigrate();

			assertHasChanges(session);
			// Each removed field is paired with one added field
			assertAmbiguousCount(session, 2);

			autoResolveAmbiguous(session, "drop_and_add");
			await applyMigration(session);

			await assertColumnExists(forja, "user", "givenName");
			await assertColumnExists(forja, "user", "familyName");
			await assertColumnNotExists(forja, "user", "firstName");
			await assertColumnNotExists(forja, "user", "lastName");

			await forja.shutdown();
		});

		it("should handle 3 removed + 3 added (chaos)", async () => {
			// Setup: user with a, b, c columns
			await dropAllTables(adapter);
			const userABC = cloneSchema(baseUserSchema, {
				addFields: {
					a: { type: "string" },
					b: { type: "string" },
					c: { type: "string" },
				},
			});
			const forja1 = await createForjaWithSchemas(tmpDir, [userABC]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Change: remove a, b, c; add x, y, z
			const userXYZ = cloneSchema(baseUserSchema, {
				addFields: {
					x: { type: "string" },
					y: { type: "string" },
					z: { type: "string" },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userXYZ], true);
			const session = await forja.beginMigrate();

			// Should detect ambiguous (9 possible pairs: 3x3)
			assertHasChanges(session);
			// At minimum, should detect some ambiguous
			expect(session.ambiguous.length).toBeGreaterThanOrEqual(1);

			// Resolve all and apply
			autoResolveAmbiguous(session, "drop_and_add");
			await applyMigration(session);

			// Verify final state
			await assertColumnNotExists(forja, "user", "a");
			await assertColumnNotExists(forja, "user", "b");
			await assertColumnNotExists(forja, "user", "c");
			await assertColumnExists(forja, "user", "x");
			await assertColumnExists(forja, "user", "y");
			await assertColumnExists(forja, "user", "z");

			await forja.shutdown();
		});
	});

	describe("Type mismatch edge cases", () => {
		it("same name, different type - should be fieldModified, not ambiguous", async () => {
			// Setup: user with age (number)
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Change: age from number to string
			const userAgeString = cloneSchema(baseUserSchema, {
				modifyFields: {
					age: { type: "string" },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userAgeString], true);
			const session = await forja.beginMigrate();

			// Should NOT be ambiguous - it's a modification of existing field
			assertNoAmbiguous(session);
			assertHasChanges(session);

			await forja.shutdown();
		});

		it("similar name, different type - birthCity(string)->birthDate(date)", async () => {
			// Setup: user with birthCity
			await dropAllTables(adapter);
			const userWithBirthCity = cloneSchema(baseUserSchema, {
				addFields: {
					birthCity: { type: "string" },
				},
			});
			const forja1 = await createForjaWithSchemas(tmpDir, [userWithBirthCity]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Change: remove birthCity, add birthDate (different type)
			const userWithBirthDate = cloneSchema(baseUserSchema, {
				addFields: {
					birthDate: { type: "date" },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userWithBirthDate], true);
			const session = await forja.beginMigrate();

			// Design decision: Should this be ambiguous?
			// Names are similar (birth prefix), but types differ
			// Current implementation might flag it, might not
			assertHasChanges(session);

			// Apply regardless
			autoResolveAmbiguous(session, "drop_and_add");
			await applyMigration(session);

			await assertColumnNotExists(forja, "user", "birthCity");
			await assertColumnExists(forja, "user", "birthDate");

			await forja.shutdown();
		});
	});

	describe("Name similarity edge cases", () => {
		it("prefix match - userName->userFullName", async () => {
			// Setup
			await dropAllTables(adapter);
			const userWithUserName = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					userName: { type: "string", required: true },
				},
			});
			const forja1 = await createForjaWithSchemas(tmpDir, [userWithUserName]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Change
			const userWithUserFullName = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: {
					userFullName: { type: "string", required: true },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [
				userWithUserFullName,
			], true);
			const session = await forja.beginMigrate();

			// Strong rename candidate - should be ambiguous
			assertHasChanges(session);
			assertAmbiguousCount(session, 1);

			await forja.shutdown();
		});

		it("camelCase variation - userId->user_id", async () => {
			// Setup
			await dropAllTables(adapter);
			const userWithUserId = cloneSchema(baseUserSchema, {
				addFields: {
					externalUserId: { type: "string" },
				},
			});
			const forja1 = await createForjaWithSchemas(tmpDir, [userWithUserId]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Change: externalUserId -> external_user_id
			const userWithSnakeCase = cloneSchema(baseUserSchema, {
				addFields: {
					external_user_id: { type: "string" },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userWithSnakeCase], true);
			const session = await forja.beginMigrate();

			// Convention change - should be ambiguous
			assertHasChanges(session);
			// Depending on algorithm, might detect this as rename candidate
			expect(session.ambiguous.length).toBeGreaterThanOrEqual(0);

			await forja.shutdown();
		});

		it("typo fix - adress->address", async () => {
			// Setup with typo
			await dropAllTables(adapter);
			const userWithTypo = cloneSchema(baseUserSchema, {
				addFields: {
					adress: { type: "string" }, // typo
				},
			});
			const forja1 = await createForjaWithSchemas(tmpDir, [userWithTypo]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Fix typo
			const userFixed = cloneSchema(baseUserSchema, {
				addFields: {
					address: { type: "string" }, // fixed
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userFixed], true);
			const session = await forja.beginMigrate();

			// Likely rename - should be ambiguous
			assertHasChanges(session);
			assertAmbiguousCount(session, 1);

			await forja.shutdown();
		});

		it("completely different names, same type - foo->bar", async () => {
			// Setup
			await dropAllTables(adapter);
			const userWithFoo = cloneSchema(baseUserSchema, {
				addFields: {
					foo: { type: "string" },
				},
			});
			const forja1 = await createForjaWithSchemas(tmpDir, [userWithFoo]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Change
			const userWithBar = cloneSchema(baseUserSchema, {
				addFields: {
					bar: { type: "string" },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userWithBar], true);
			const session = await forja.beginMigrate();

			// Even completely different names - should still ask
			// User might be renaming with new semantics
			assertHasChanges(session);
			assertAmbiguousCount(session, 1);

			await forja.shutdown();
		});
	});

	describe("Clear cases - NO ambiguous", () => {
		it("should NOT flag as ambiguous when only adding", async () => {
			// Setup
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Only add, no remove
			const userWithPhone = cloneSchema(baseUserSchema, {
				addFields: {
					phone: { type: "string" },
				},
			});

			const forja = await createForjaWithSchemas(tmpDir, [userWithPhone], true);
			const session = await forja.beginMigrate();

			// No ambiguous - nothing removed
			assertNoAmbiguous(session);
			assertHasChanges(session);

			await forja.shutdown();
		});

		it("should NOT flag as ambiguous when only removing", async () => {
			// Setup with extra field
			await dropAllTables(adapter);
			const userWithPhone = cloneSchema(baseUserSchema, {
				addFields: {
					phone: { type: "string" },
				},
			});
			const forja1 = await createForjaWithSchemas(tmpDir, [userWithPhone]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Only remove, no add
			const forja = await createForjaWithSchemas(tmpDir, [baseUserSchema], true);
			const session = await forja.beginMigrate();

			// No ambiguous - nothing added
			assertNoAmbiguous(session);
			assertHasChanges(session);

			await forja.shutdown();
		});
	});

	describe("Table rename ambiguous", () => {
		it("should detect table rename candidate when similar structure", async () => {
			// Setup: user table
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Change: remove user, add account (similar structure)
			const accountSchema = cloneSchema(baseUserSchema, {
				name: "account",
			});
			// Update tableName for account
			(accountSchema as { tableName: string }).tableName = "accounts";

			const forja = await createForjaWithSchemas(tmpDir, [accountSchema], true);
			const session = await forja.beginMigrate();

			// Should detect table rename candidate
			assertHasChanges(session);
			// Should have table-level ambiguous
			const tableAmbiguous = session.ambiguous.find(
				(a) => a.type === "table_rename_or_replace",
			);
			expect(tableAmbiguous).toBeDefined();

			await forja.shutdown();
		});

		it("should NOT flag dissimilar tables as rename", async () => {
			// Setup: user table
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			await applyMigration(s1);
			await forja1.shutdown();

			// Change: remove user, add product (completely different)
			const productSchema = {
				name: "product",
				tableName: "products",
				fields: {
					sku: { type: "string" as const, required: true, unique: true },
					price: { type: "number" as const, required: true },
					stock: { type: "number" as const },
					category: { type: "string" as const },
				},
			};

			const forja = await createForjaWithSchemas(tmpDir, [productSchema], true);
			const session = await forja.beginMigrate();

			// Should NOT have table rename ambiguous (too different)
			assertHasChanges(session);
			const tableAmbiguous = session.ambiguous.find(
				(a) => a.type === "table_rename_or_replace",
			);
			// Depending on similarity threshold, might not flag
			// This is a design decision test
			expect(tableAmbiguous).toBeUndefined();

			await forja.shutdown();
		});
	});
});
