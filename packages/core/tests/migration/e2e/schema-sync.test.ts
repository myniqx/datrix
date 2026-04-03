/**
 * Migration E2E Tests - Schema Sync
 *
 * Tests that _forja meta schema stays in sync with core registry
 * across multiple sequential migrations, especially for relation fields.
 *
 * Covers: addMetaField, dropMetaField, modifyMetaField operations.
 *
 * Flow:
 * - v1: Initial schemas with relations + data
 * - v2: Drop some relations, add new ones, modify existing
 * - v3: Further changes — add, drop, modify relations again
 *
 * Each step verifies:
 * 1. Data preservation
 * 2. Schema sync between registry and adapter (_forja)
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { createForjaWithSchemas, getTmpDir } from "./setup/config";
import { getAdapter, getAdapterType } from "./setup/adapter";
import {
	baseUserSchema,
	basePostSchemaNoRelation,
	baseCategorySchema,
	baseTagSchema,
	cloneSchema,
} from "./setup/schemas-base";
import {
	dropAllTables,
	assertTableExists,
	applyMigration,
	assertSchemaSync,
	assertNoChanges,
	resolveAmbiguousById,
} from "./setup/helpers";
import type { DatabaseAdapter } from "@forja/types/adapter";

describe("Migration E2E - Schema Sync", () => {
	const tmpDir = getTmpDir("schema-sync");
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

	it("should keep _forja schema in sync across 3 sequential migrations", async () => {
		await dropAllTables(adapter);

		// ============================================
		// v1: Initial setup
		// post has author (belongsTo user) + category (belongsTo category)
		// ============================================

		const postV1 = cloneSchema(basePostSchemaNoRelation, {
			addFields: {
				author: { type: "relation", kind: "belongsTo", model: "user" },
				category: {
					type: "relation",
					kind: "belongsTo",
					model: "category",
				},
			},
		});

		const forja1 = await createForjaWithSchemas(tmpDir, [
			baseUserSchema,
			postV1,
			baseCategorySchema,
		]);
		const s1 = await forja1.beginMigrate();
		await applyMigration(s1);

		// Insert test data
		const user1 = await forja1.create("user", {
			email: "alice@test.com",
			name: "Alice",
			age: 30,
		});
		const user2 = await forja1.create("user", {
			email: "bob@test.com",
			name: "Bob",
			age: 25,
		});
		const cat1 = await forja1.create("category", {
			name: "Tech",
			slug: "tech",
		});
		const cat2 = await forja1.create("category", {
			name: "News",
			slug: "news",
		});

		const post1 = await forja1.create("post", {
			title: "Alice Tech Post",
			author: { set: user1.id },
			category: { set: cat1.id },
		});
		const post2 = await forja1.create("post", {
			title: "Bob News Post",
			author: { set: user2.id },
			category: { set: cat2.id },
		});

		// Verify v1 data with populate
		const postsV1 = await forja1.findMany("post", { populate: true });
		expect(postsV1).toHaveLength(2);
		expect(postsV1[0]!.author.id).toBe(user1.id);
		expect(postsV1[0]!.category.id).toBe(cat1.id);
		expect(postsV1[1]!.author.id).toBe(user2.id);
		expect(postsV1[1]!.category.id).toBe(cat2.id);

		// Verify v1 schema sync
		await assertSchemaSync(forja1, "post");
		await assertSchemaSync(forja1, "user");
		await assertSchemaSync(forja1, "category");

		await forja1.shutdown();

		// ============================================
		// v2: Drop category relation, add tags (manyToMany),
		//     modify author foreignKey (authorId → writerId)
		// ============================================

		const postV2 = cloneSchema(basePostSchemaNoRelation, {
			addFields: {
				author: {
					type: "relation",
					kind: "belongsTo",
					model: "user",
					foreignKey: "writerId",
				},
				tags: { type: "relation", kind: "manyToMany", model: "tag" },
			},
		});

		const forja2 = await createForjaWithSchemas(
			tmpDir,
			[baseUserSchema, postV2, baseCategorySchema, baseTagSchema],
			true,
		);
		const s2 = await forja2.beginMigrate();

		// Resolve ambiguous changes individually:
		// - authorId→writerId: rename (FK column rename)
		// - category→tags: drop_and_add (different relation, not a rename)
		// - categoryId FK drop: confirm_drop
		for (const change of s2.ambiguous) {
			if (
				change.type === "column_rename_or_replace" &&
				change.removedName === "authorId"
			) {
				resolveAmbiguousById(s2, change.id, "rename");
			} else if (
				change.type === "column_rename_or_replace" &&
				change.removedName === "category"
			) {
				resolveAmbiguousById(s2, change.id, "drop_and_add");
			} else if (change.type === "fk_column_drop") {
				resolveAmbiguousById(s2, change.id, "confirm_drop");
			} else if (change.type === "junction_table_drop") {
				resolveAmbiguousById(s2, change.id, "confirm_drop");
			} else {
				resolveAmbiguousById(s2, change.id, "drop_and_add");
			}
		}
		await s2.apply();

		// Insert tags
		const tag1 = await forja2.create("tag", { name: "JavaScript" });
		const tag2 = await forja2.create("tag", { name: "TypeScript" });

		// Assign tags to posts via manyToMany
		await forja2.update("post", post1.id, {
			tags: { set: [tag1.id, tag2.id] },
		});
		await forja2.update("post", post2.id, {
			tags: { set: [tag1.id] },
		});

		// Verify v2 schema sync (CRITICAL — relation changes must be reflected in _forja)
		await assertSchemaSync(forja2, "post");
		await assertSchemaSync(forja2, "user");
		await assertSchemaSync(forja2, "tag");

		// Verify v2 data preservation — author relation still works with renamed FK
		const postsV2 = await forja2.findMany("post", { populate: true });
		expect(postsV2).toHaveLength(2);

		const p1v2 = postsV2.find((p) => p.title === "Alice Tech Post");
		const p2v2 = postsV2.find((p) => p.title === "Bob News Post");

		expect(p1v2!.author.id).toBe(user1.id);
		expect(p2v2!.author.id).toBe(user2.id);

		// Verify tags populated
		expect(p1v2!.tags).toHaveLength(2);
		expect(p2v2!.tags).toHaveLength(1);

		// category relation should no longer exist
		expect(p1v2!.category).toBeUndefined();

		// Verify junction table exists
		await assertTableExists(forja2, "tag");

		// Re-check: no pending changes (schema is fully synced)
		const s2check = await forja2.beginMigrate();
		assertNoChanges(s2check);

		await forja2.shutdown();

		// ============================================
		// v3: Drop tags (manyToMany), add reviewer (belongsTo user),
		//     modify author foreignKey (writerId → creatorId)
		// ============================================

		const postV3 = cloneSchema(basePostSchemaNoRelation, {
			addFields: {
				author: {
					type: "relation",
					kind: "belongsTo",
					model: "user",
					foreignKey: "creatorId",
				},
				reviewer: {
					type: "relation",
					kind: "belongsTo",
					model: "user",
				},
			},
		});

		const forja3 = await createForjaWithSchemas(
			tmpDir,
			[baseUserSchema, postV3, baseCategorySchema, baseTagSchema],
			true,
		);
		const s3 = await forja3.beginMigrate();

		// Resolve ambiguous changes individually:
		// - writerId→creatorId: rename (FK column rename)
		// - tags→reviewer: drop_and_add (different relation, not a rename)
		// - junction table drop: confirm_drop
		for (const change of s3.ambiguous) {
			if (
				change.type === "column_rename_or_replace" &&
				change.removedName === "writerId"
			) {
				resolveAmbiguousById(s3, change.id, "rename");
			} else if (
				change.type === "column_rename_or_replace" &&
				change.removedName === "tags"
			) {
				resolveAmbiguousById(s3, change.id, "drop_and_add");
			} else if (change.type === "fk_column_drop") {
				resolveAmbiguousById(s3, change.id, "confirm_drop");
			} else if (change.type === "junction_table_drop") {
				resolveAmbiguousById(s3, change.id, "confirm_drop");
			} else {
				resolveAmbiguousById(s3, change.id, "drop_and_add");
			}
		}
		await s3.apply();

		// Assign reviewer
		await forja3.update("post", post1.id, {
			reviewer: { set: user2.id },
		});

		// Verify v3 schema sync
		await assertSchemaSync(forja3, "post");
		await assertSchemaSync(forja3, "user");

		// Verify v3 data preservation
		const postsV3 = await forja3.findMany("post", { populate: true });
		expect(postsV3).toHaveLength(2);

		const p1v3 = postsV3.find((p) => p.title === "Alice Tech Post");
		const p2v3 = postsV3.find((p) => p.title === "Bob News Post");

		// Author relation still works (FK renamed again: writerId → creatorId)
		expect(p1v3!.author.id).toBe(user1.id);
		expect(p2v3!.author.id).toBe(user2.id);

		// Reviewer relation works
		expect(p1v3!.reviewer.id).toBe(user2.id);

		// tags relation should no longer exist
		expect(p1v3!.tags).toBeUndefined();

		// Re-check: no pending changes
		const s3check = await forja3.beginMigrate();
		assertNoChanges(s3check);

		await forja3.shutdown();
	});
});
