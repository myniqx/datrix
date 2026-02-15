/**
 * Migration E2E Tests - Rollback
 *
 * Tests for rollback functionality (--down flag).
 * NOTE: Rollback is not yet implemented in MigrationSession.
 * These tests document the expected behavior and will fail until implemented.
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Forja } from "forja-core";
import { createForjaWithSchemas, getTmpDir } from "./setup/config";
import { getAdapter, getAdapterType } from "./setup/adapter";
import {
	baseUserSchema,
	basePostSchema,
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
	applyMigration,
	autoResolveAmbiguous,
} from "./setup/helpers";
import type { DatabaseAdapter } from "forja-types/adapter";

describe("Migration E2E - Rollback", () => {
	const tmpDir = getTmpDir("rollback");
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

	describe("Rollback last migration", () => {
		it.todo("should rollback last migration that added a column", async () => {
			// Setup: user table
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			if (s1.success) await applyMigration(s1.data);
			await forja1.shutdown();

			// Apply migration: add phone
			const userWithPhone = cloneSchema(baseUserSchema, {
				addFields: { phone: { type: "string" } },
			});
			const forja2 = await createForjaWithSchemas(tmpDir, [userWithPhone]);
			const s2 = await forja2.beginMigrate();
			if (s2.success) await applyMigration(s2.data);

			// Verify phone exists
			await assertColumnExists(forja2, "user", "phone");
			await forja2.shutdown();

			// TODO: Rollback last migration
			// const forja3 = await createForjaWithSchemas(tmpDir, [userWithPhone]);
			// const session = await forja3.beginMigrate();
			// await session.rollbackLast();

			// Verify phone removed
			// await assertColumnNotExists(adapter, TABLE_NAMES.user + ".phone");
		});

		it.todo("should rollback last migration that created a table", async () => {
			// Setup: user table
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			if (s1.success) await applyMigration(s1.data);
			await forja1.shutdown();

			// Apply migration: add post table
			const forja2 = await createForjaWithSchemas(tmpDir, [
				baseUserSchema,
				basePostSchema,
			]);
			const s2 = await forja2.beginMigrate();
			if (s2.success) await applyMigration(s2.data);

			// Verify post exists
			await assertTableExists(forja2, "post");
			await forja2.shutdown();

			// TODO: Rollback last migration
			// await session.rollbackLast();

			// Verify post removed
			// await assertTableNotExists(adapter, TABLE_NAMES.post);
			// await assertTableExists(forja, "user");
		});

		it.todo("should rollback last migration that dropped a column", async () => {
			// Setup: user with age
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			if (s1.success) await applyMigration(s1.data);

			await assertColumnExists(forja1, "user", "age");
			await forja1.shutdown();

			// Apply migration: remove age
			const userNoAge = cloneSchema(baseUserSchema, {
				removeFields: ["age"],
			});
			const forja2 = await createForjaWithSchemas(tmpDir, [userNoAge]);
			const s2 = await forja2.beginMigrate();
			if (s2.success) await applyMigration(s2.data);

			await assertColumnNotExists(forja2, "user", "age");
			await forja2.shutdown();

			// TODO: Rollback - age should come back
			// This is tricky because we need to know the original column definition
			// await session.rollbackLast();
			// await assertColumnExists(forja, "user", "age");
		});
	});

	describe("Rollback to specific version", () => {
		it.todo("should rollback to specific version", async () => {
			// Setup: create 3 migrations
			await dropAllTables(adapter);

			// V1: user table
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			if (s1.success) await applyMigration(s1.data);
			await forja1.shutdown();

			// V2: add post
			const forja2 = await createForjaWithSchemas(tmpDir, [
				baseUserSchema,
				basePostSchema,
			]);
			const s2 = await forja2.beginMigrate();
			if (s2.success) await applyMigration(s2.data);
			await forja2.shutdown();

			// V3: add tag
			const forja3 = await createForjaWithSchemas(tmpDir, [
				baseUserSchema,
				basePostSchema,
				baseTagSchema,
			]);
			const s3 = await forja3.beginMigrate();
			if (s3.success) await applyMigration(s3.data);

			// Verify all exist
			await assertTableExists(forja3, "user");
			await assertTableExists(forja3, "post");
			await assertTableExists(forja3, "tag");
			await forja3.shutdown();

			// TODO: Rollback to V1 (just user)
			// This should remove post and tag
			// const session = await forja.beginMigrate();
			// await session.rollbackTo('v1');

			// await assertTableExists(forja, "user");
			// await assertTableNotExists(adapter, TABLE_NAMES.post);
			// await assertTableNotExists(adapter, TABLE_NAMES.tag);
		});

		it.todo("should rollback multiple column changes", async () => {
			// Setup: user with multiple changes over time
			await dropAllTables(adapter);

			// V1: base user
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			if (s1.success) await applyMigration(s1.data);
			await forja1.shutdown();

			// V2: add phone
			const userV2 = cloneSchema(baseUserSchema, {
				addFields: { phone: { type: "string" } },
			});
			const forja2 = await createForjaWithSchemas(tmpDir, [userV2]);
			const s2 = await forja2.beginMigrate();
			if (s2.success) await applyMigration(s2.data);
			await forja2.shutdown();

			// V3: add address, remove age
			const userV3 = cloneSchema(baseUserSchema, {
				removeFields: ["age"],
				addFields: {
					phone: { type: "string" },
					address: { type: "string" },
				},
			});
			const forja3 = await createForjaWithSchemas(tmpDir, [userV3]);
			const s3 = await forja3.beginMigrate();
			if (s3.success) await applyMigration(s3.data);

			// Verify current state
			await assertColumnExists(forja3, "user", "phone");
			await assertColumnExists(forja3, "user", "address");
			await assertColumnNotExists(forja3, "user", "age");
			await forja3.shutdown();

			// TODO: Rollback to V1 (just base user)
			// await session.rollbackTo('v1');

			// await assertColumnNotExists(forja, "user", "phone");
			// await assertColumnNotExists(forja, "user", "address");
			// await assertColumnExists(forja, "user", "age");
		});
	});

	describe("Rollback column rename", () => {
		it.todo("should rollback column rename", async () => {
			// Setup: user with name
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			if (s1.success) await applyMigration(s1.data);
			await forja1.shutdown();

			// Apply rename: name -> fullName
			const userRenamed = cloneSchema(baseUserSchema, {
				removeFields: ["name"],
				addFields: { fullName: { type: "string", required: true } },
			});
			const forja2 = await createForjaWithSchemas(tmpDir, [userRenamed]);
			const s2 = await forja2.beginMigrate();
			if (s2.success) {
				autoResolveAmbiguous(s2.data, "rename");
				await applyMigration(s2.data);
			}

			// Verify rename applied
			await assertColumnExists(forja2, "user", "fullName");
			await assertColumnNotExists(forja2, "user", "name");
			await forja2.shutdown();

			// TODO: Rollback should reverse the rename
			// await session.rollbackLast();
			// await assertColumnExists(forja, "user", "name");
			// await assertColumnNotExists(forja, "user", "fullName");
		});
	});

	describe("Rollback table rename", () => {
		it.todo("should rollback table rename", async () => {
			// Setup: user table
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			if (s1.success) await applyMigration(s1.data);
			await forja1.shutdown();

			// Apply rename: user -> account
			const accountSchema = cloneSchema(baseUserSchema, { name: "account" });
			(accountSchema as { tableName: string }).tableName = "accounts";

			const forja2 = await createForjaWithSchemas(tmpDir, [accountSchema]);
			const s2 = await forja2.beginMigrate();
			if (s2.success) {
				autoResolveAmbiguous(s2.data, "rename");
				await applyMigration(s2.data);
			}

			// Verify rename applied
			await assertTableExists(forja2, "account");
			await assertTableNotExists(adapter, TABLE_NAMES.user);
			await forja2.shutdown();

			// TODO: Rollback should reverse the rename
			// await session.rollbackLast();
			// await assertTableExists(forja, "user");
			// await assertTableNotExists(adapter, "accounts");
		});
	});

	describe("Rollback edge cases", () => {
		it.todo("should fail gracefully when nothing to rollback", async () => {
			// Fresh database, no migrations applied
			await dropAllTables(adapter);

			const forja = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const sessionResult = await forja.beginMigrate();
			expect(sessionResult.success).toBe(true);
			if (!sessionResult.success) {
				await forja.shutdown();
				return;
			}

			// Don't apply, just try to rollback
			// const session = sessionResult.data;
			// const result = await session.rollbackLast();
			// expect(result.success).toBe(false);
			// expect(result.error.message).toContain("nothing to rollback");

			await forja.shutdown();
		});

		it.todo("should fail when rollback target version not found", async () => {
			// Setup: user table
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			if (s1.success) await applyMigration(s1.data);
			await forja1.shutdown();

			// Try to rollback to non-existent version
			// const forja = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			// const session = await forja.beginMigrate();
			// const result = await session.rollbackTo('non-existent-version');
			// expect(result.success).toBe(false);
		});

		it.todo("should preserve data on column rename rollback", async () => {
			// This is a critical test - data should not be lost
			// when rolling back a rename operation

			// Setup: user with name and some data
			await dropAllTables(adapter);
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			if (s1.success) await applyMigration(s1.data);

			// Insert test data
			// await forja1.create('user', { email: 'test@test.com', name: 'John Doe' });

			await forja1.shutdown();

			// Apply rename: name -> fullName
			// ...

			// Verify data migrated to fullName
			// const userAfterRename = await forja.findOne('user', { email: 'test@test.com' });
			// expect(userAfterRename.fullName).toBe('John Doe');

			// Rollback
			// ...

			// Verify data preserved in name column
			// const userAfterRollback = await forja.findOne('user', { email: 'test@test.com' });
			// expect(userAfterRollback.name).toBe('John Doe');
		});
	});

	describe("Migration history", () => {
		it.todo("should track applied migrations in history", async () => {
			await dropAllTables(adapter);

			// Apply multiple migrations
			const forja1 = await createForjaWithSchemas(tmpDir, [baseUserSchema]);
			const s1 = await forja1.beginMigrate();
			if (s1.success)