/**
 * Export/Import End-to-End Tests
 *
 * Tests the full export → import cycle using the CLI commands.
 *
 * Flow:
 * 1. forja1 (fromAdapter) — create tables, seed data (1500+ rows in some tables)
 * 2. exportCommand — write zip file
 * 3. forja1.shutdown()
 * 4. forja2 (toAdapter) — fresh instance, different dir/db
 * 5. importCommand --agree — restore from zip
 * 6. Assert all data is identical to original
 *
 * Change these two constants to test cross-adapter scenarios:
 */
const FROM_ADAPTER: AdapterType = "mongodb";
const TO_ADAPTER: AdapterType = "json";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { defineConfig, Forja } from "@forja/core";
import type { ForjaConfig, ForjaEntry } from "@forja/types";
import { defineSchema } from "@forja/types/core/schema";
import fs from "node:fs/promises";
import path from "node:path";
import { getAdapter, type AdapterType } from "../../api/tests/data/adapter";
import { exportCommand } from "../src/commands/export";
import { importCommand } from "../src/commands/import";

// ============================================================================
// Schemas
// ============================================================================

/**
 * AllFields — covers every supported field type
 * No relations to keep it self-contained.
 */
const allFieldsSchema = defineSchema({
	name: "allFields",
	fields: {
		title: { type: "string", required: true, minLength: 1, maxLength: 200 },
		description: { type: "string" },
		score: { type: "number", min: 0, max: 9999 },
		isActive: { type: "boolean", default: true },
		metadata: { type: "json" },
		tags: { type: "array", items: { type: "string" } },
		status: {
			type: "enum",
			values: ["draft", "published", "archived"] as const,
		},
	},
	permission: { create: true, read: true, update: true, delete: true },
} as const);

/**
 * Author — has many posts, manyToMany with tag
 */
const authorSchema = defineSchema({
	name: "author",
	fields: {
		name: { type: "string", required: true, minLength: 2, maxLength: 100 },
		email: {
			type: "string",
			required: true,
			pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
		},
		bio: { type: "string" },
		isVerified: { type: "boolean", default: false },
		posts: {
			type: "relation",
			kind: "hasMany",
			model: "post",
			foreignKey: "authorId",
		},
	},
	indexes: [{ fields: ["email"], unique: true }],
	permission: { create: true, read: true, update: true, delete: true },
} as const);

/**
 * Tag — manyToMany with post
 */
const tagSchema = defineSchema({
	name: "tag",
	fields: {
		name: { type: "string", required: true, minLength: 1, maxLength: 50 },
		color: { type: "string", pattern: /^#[0-9A-Fa-f]{6}$/ },
		posts: { type: "relation", kind: "manyToMany", model: "post" },
	},
	indexes: [{ fields: ["name"], unique: true }],
	permission: { create: true, read: true, update: true, delete: true },
} as const);

/**
 * Post — belongsTo author, manyToMany tag, hasMany comment
 * Self-ref: featuredIn (another post that features this one)
 */
const postSchema = defineSchema({
	name: "post",
	fields: {
		title: { type: "string", required: true, minLength: 3, maxLength: 200 },
		slug: { type: "string", required: true, pattern: /^[a-z0-9-]+$/ },
		content: { type: "string", required: true },
		isPublished: { type: "boolean", default: false },
		viewCount: { type: "number", default: 0, min: 0 },
		author: { type: "relation", kind: "belongsTo", model: "author" },
		tags: { type: "relation", kind: "manyToMany", model: "tag" },
		comments: { type: "relation", kind: "hasMany", model: "comment" },
		// Self-reference: a post can reference another post as "related"
		relatedPost: { type: "relation", kind: "belongsTo", model: "post" },
	},
	indexes: [{ fields: ["slug"], unique: true }, { fields: ["authorId"] }],
	permission: { create: true, read: true, update: true, delete: true },
} as const);

/**
 * Comment — belongsTo post, belongsTo author, self-ref parent
 * Circular: comment → post → comment (via hasMany)
 *           comment → comment (replies)
 */
const commentSchema = defineSchema({
	name: "comment",
	fields: {
		content: { type: "string", required: true, minLength: 1, maxLength: 2000 },
		isApproved: { type: "boolean", default: false },
		post: { type: "relation", kind: "belongsTo", model: "post" },
		author: { type: "relation", kind: "belongsTo", model: "author" },
		// Self-reference: reply to another comment
		parent: { type: "relation", kind: "belongsTo", model: "comment" },
	},
	indexes: [{ fields: ["postId"] }, { fields: ["authorId"] }],
	permission: { create: true, read: true, update: true, delete: true },
} as const);

const exportImportSchemas = [
	allFieldsSchema,
	authorSchema,
	tagSchema,
	postSchema,
	commentSchema,
];

// ============================================================================
// Helpers
// ============================================================================

const TEST_ROOT = path.join(
	process.cwd(),
	"packages",
	"cli",
	"tests",
	".tmp-cli-export-test",
);

function getTmpDir(name: string): string {
	return path.join(TEST_ROOT, name);
}

async function initForja(
	adapterType: AdapterType,
	dirName: string,
): Promise<Forja> {
	const dir = getTmpDir(dirName);
	await fs.rm(dir, { recursive: true, force: true });
	await fs.mkdir(dir, { recursive: true });

	const adapter = await getAdapter(adapterType, dir);

	const getForja = defineConfig(() => {
		const config: ForjaConfig = {
			adapter,
			schemas: exportImportSchemas,
			plugins: [],
		};
		return config;
	});

	return getForja();
}

async function setupTables(forja: Forja): Promise<void> {
	const adapter = forja.getAdapter();
	for (const schema of forja.getSchemas().getAll()) {
		try {
			await adapter.dropTable(schema.tableName!);
		} catch {
			// ignore — table may not exist yet
		}
		await adapter.createTable(schema);
	}
}

// ============================================================================
// Data generators
// ============================================================================

function makeAllFieldsRows(count: number) {
	const statuses = ["draft", "published", "archived"] as const;
	return Array.from({ length: count }, (_, i) => ({
		title: `AllFields Record ${i}`,
		description: i % 3 === 0 ? null : `Description for record ${i}`,
		score: i % 10000,
		isActive: i % 2 === 0,
		metadata: i % 4 === 0 ? null : { index: i, nested: { value: `val-${i}` } },
		tags: i % 5 === 0 ? [] : [`tag-a-${i}`, `tag-b-${i}`],
		status: statuses[i % statuses.length],
	}));
}

function makeAuthorRows(count: number) {
	return Array.from({ length: count }, (_, i) => ({
		name: `Author ${i}`,
		email: `author${i}@test.com`,
		bio: i % 2 === 0 ? `Bio for author ${i}` : null,
		isVerified: i % 3 === 0,
	}));
}

function makeTagRows(count: number) {
	const colors = [
		"#FF0000",
		"#00FF00",
		"#0000FF",
		"#FFFF00",
		"#FF00FF",
		"#00FFFF",
	];
	return Array.from({ length: count }, (_, i) => ({
		name: `Tag ${i}`,
		color: colors[i % colors.length],
	}));
}

// ============================================================================
// Test suite
// ============================================================================

describe(`Export/Import (${FROM_ADAPTER} → ${TO_ADAPTER})`, () => {
	let forja1: Forja;
	let forja2: Forja;
	let zipPath: string;

	// Seeded data refs — used for assertion after import
	let authorIds: number[];
	let tagIds: number[];
	let postIds: number[];
	let expectedCommentCount: number;

	// IDs that were deleted before export — must not exist after import
	let deletedAuthorId: number;
	let deletedPostId: number;

	// Last ID before export — new inserts after import must be greater
	let lastAuthorIdBeforeExport: number;
	let lastPostIdBeforeExport: number;

	// A known FK pair to verify relation integrity after import
	let knownPostId: number;
	let knownAuthorId: number;

	beforeAll(async () => {
		// Clean root tmp dir
		await fs.rm(TEST_ROOT, { recursive: true, force: true });
		await fs.mkdir(TEST_ROOT, { recursive: true });

		zipPath = path.join(TEST_ROOT, "export.zip");

		// ---- Phase 1: Seed data with forja1 ----
		forja1 = await initForja(FROM_ADAPTER, "source");
		await setupTables(forja1);

		// allFields — 1501 rows, 1 will be deleted before export → net 1500
		const allFieldsBatch1 = makeAllFieldsRows(1000);
		const allFieldsBatch2 = makeAllFieldsRows(501).map((r, i) => ({
			...r,
			title: `AllFields Record B${i}`,
		}));
		const allFields1 = await forja1.createMany("allFields", allFieldsBatch1);
		const allFields2 = await forja1.createMany("allFields", allFieldsBatch2);
		const allFieldIds = [...allFields1, ...allFields2].map(
			(r) => r.id as number,
		);

		// authors — 1501 rows, 1 will be deleted before export → net 1500
		const authorBatch1 = makeAuthorRows(1000);
		const authorBatch2 = makeAuthorRows(501).map((r, i) => ({
			...r,
			email: `authorb${i}@test.com`,
			name: `Author B${i}`,
		}));
		const authors1 = await forja1.createMany("author", authorBatch1);
		const authors2 = await forja1.createMany("author", authorBatch2);
		authorIds = [...authors1, ...authors2].map((a) => a.id as number);

		// tags — 50 tags
		const tagRows = makeTagRows(50);
		const tags = await forja1.createMany("tag", tagRows);
		tagIds = tags.map((t) => t.id as number);

		// posts — 301 posts, 1 will be deleted before export → net 300
		// Created one at a time so self-ref (relatedPost) can reference already-created IDs
		const createdPostIds: number[] = [];

		for (let i = 0; i < 301; i++) {
			const entry: {
				title: string;
				slug: string;
				content: string;
				isPublished: boolean;
				viewCount: number;
				author: number;
				tags: { connect: number[] };
				relatedPost?: number;
			} = {
				title: `Post Title ${i}`,
				slug: `post-slug-${i}`,
				content: `Content of post ${i}. Lorem ipsum dolor sit amet.`,
				isPublished: i % 2 === 0,
				viewCount: i * 3,
				author: authorIds[i % authorIds.length]!,
				tags: {
					connect: [
						tagIds[i % tagIds.length]!,
						tagIds[(i + 1) % tagIds.length]!,
					],
				},
			};

			// Self-ref: post i references post i-5 (ID is known at this point)
			if (i >= 5) {
				entry.relatedPost = createdPostIds[i - 5]!;
			}

			const post = await forja1.create("post", entry);
			createdPostIds.push(post.id as number);
		}
		postIds = createdPostIds;

		// comments — 600 comments (> CHUNK_SIZE when combined)
		// Top-level comments on posts, then some replies (parent ref)
		const topLevelComments = await forja1.createMany(
			"comment",
			Array.from({ length: 300 }, (_, i) => ({
				content: `Top-level comment ${i}`,
				isApproved: i % 2 === 0,
				post: postIds[i % postIds.length]!,
				author: authorIds[i % authorIds.length]!,
			})),
		);

		const topLevelIds = topLevelComments.map((c) => c.id as number);

		await forja1.createMany(
			"comment",
			Array.from({ length: 300 }, (_, i) => ({
				content: `Reply comment ${i}`,
				isApproved: true,
				post: postIds[i % postIds.length]!,
				author: authorIds[(i + 1) % authorIds.length]!,
				parent: topLevelIds[i % topLevelIds.length]!,
			})),
		);

		// ---- Phase 1b: Deletions — gaps in ID sequence must survive export/import ----

		// Delete one allFields row from the middle → net 1500
		const deletedAllFieldsId = allFieldIds[500]!;
		await forja1.delete("allFields", deletedAllFieldsId);

		// Delete an author from the middle of the batch → net 1500
		deletedAuthorId = authorIds[500]!;
		await forja1.delete("author", deletedAuthorId);
		authorIds = authorIds.filter((id) => id !== deletedAuthorId);

		// Delete a post from the middle of the batch → net 300
		deletedPostId = postIds[150]!;
		await forja1.delete("post", deletedPostId);
		postIds = postIds.filter((id) => id !== deletedPostId);

		// Record the max IDs before export so we can verify auto-increment continues after import
		lastAuthorIdBeforeExport = Math.max(...authorIds);
		lastPostIdBeforeExport = Math.max(...postIds);

		// Record a known post→author FK pair for relation integrity assertion
		knownPostId = postIds[0]!;
		knownAuthorId = authorIds[0]!;

		// Snapshot actual comment count after cascaded deletes — used in count assertion
		expectedCommentCount = (await forja1.findMany("comment", {})).length;

		// ---- Phase 2: Export ----
		await exportCommand(forja1.getAdapter(), { output: zipPath });
		await forja1.shutdown();

		// ---- Phase 3: Import into forja2 ----
		forja2 = await initForja(TO_ADAPTER, "destination");
		// importCommand creates tables itself — no setupTables needed
		await importCommand(forja2.getAdapter(), zipPath, { agree: true });
	}, 120_000);

	afterAll(async () => {
		await forja2?.shutdown();
		await fs.rm(TEST_ROOT, { recursive: true, force: true });
	});

	// ==========================================================================
	// Row count assertions
	// ==========================================================================

	it("should import correct number of allFields rows", async () => {
		const result = await forja2.findMany("allFields", {});
		expect(result.length).toBe(1500);
	});

	it("should import correct number of authors", async () => {
		const result = await forja2.findMany("author", {});
		expect(result.length).toBe(1500);
	});

	it("should import correct number of tags", async () => {
		const result = await forja2.findMany("tag", {});
		expect(result.length).toBe(50);
	});

	it("should import correct number of posts", async () => {
		const result = await forja2.findMany("post", {});
		expect(result.length).toBe(300);
	});

	it("should import correct number of comments", async () => {
		const result = await forja2.findMany("comment", {});
		expect(result.length).toBe(expectedCommentCount);
	});

	// ==========================================================================
	// Field fidelity — allFields schema
	// ==========================================================================

	it("should preserve all field types in allFields schema", async () => {
		const result = await forja2.findMany<
			{
				title: string;
				score: number;
				isActive: boolean;
				status: string;
				metadata: unknown;
				tags: unknown[];
			} & ForjaEntry
		>("allFields", {
			where: { title: { $eq: "AllFields Record 0" } },
		});

		expect(result).toHaveLength(1);
		const row = result[0]!;

		expect(row.title).toBe("AllFields Record 0");
		expect(row.score).toBe(0);
		expect(row.isActive).toBe(true);
		expect(row.status).toBe("draft");
		// metadata and tags should be parsed back as objects/arrays
		expect(typeof row.metadata).toBe("object");
		expect(Array.isArray(row.tags)).toBe(true);
	});

	it("should preserve null values in optional fields", async () => {
		// Record at index 0: description is null (0 % 3 === 0), metadata is null (0 % 4 === 0)
		const result = await forja2.findMany<
			{
				description: string | null;
				metadata: unknown | null;
				title: string;
			} & ForjaEntry
		>("allFields", {
			where: { title: { $eq: "AllFields Record 0" } },
		});

		const row = result[0]!;
		expect(row.description).toBeNull();
		expect(row.metadata).toBeNull();
	});

	it("should preserve boolean false correctly", async () => {
		// Record at index 1: isActive = false (1 % 2 !== 0)
		const result = await forja2.findMany<
			{ isActive: boolean; title: string } & ForjaEntry
		>("allFields", {
			where: { title: { $eq: "AllFields Record 1" } },
		});

		expect(result[0]!.isActive).toBe(false);
	});

	it("should preserve empty array correctly", async () => {
		// Record at index 0: tags = [] (0 % 5 === 0)
		const result = await forja2.findMany<
			{ tags: unknown[]; title: string } & ForjaEntry
		>("allFields", {
			where: { title: { $eq: "AllFields Record 0" } },
		});

		expect(result[0]!.tags).toEqual([]);
	});

	// ==========================================================================
	// Relation fidelity
	// ==========================================================================

	it("should preserve post → author FK", async () => {
		const result = await forja2.findMany("post", {
			where: { slug: { $eq: "post-slug-0" } },
			populate: ["author"],
		});

		expect(result).toHaveLength(1);
		const author = result[0]!.author as Record<string, unknown>;
		expect(author).not.toBeNull();
		expect(author["id"]).toBe(authorIds[0]);
	});

	it("should preserve post → relatedPost self-reference FK", async () => {
		// Verify the FK value is restored correctly via populate
		const result = await forja2.findMany("post", {
			where: { slug: { $eq: "post-slug-5" } },
			populate: ["relatedPost"],
		});

		expect(result).toHaveLength(1);
		const relatedPost = result[0]!.relatedPost as Record<
			string,
			unknown
		> | null;
		expect(relatedPost).not.toBeNull();
		expect(relatedPost!["id"]).toBe(postIds[0]);
	});

	it("should preserve comment → parent self-reference", async () => {
		const replies = await forja2.findMany("comment", {
			where: { content: { $eq: "Reply comment 0" } },
			populate: ["parent"],
		});

		expect(replies).toHaveLength(1);
		const parent = replies[0]!.parent as Record<string, unknown> | null;
		expect(parent).not.toBeNull();
		expect(typeof parent!["id"]).toBe("number");
	});

	it("should preserve manyToMany post ↔ tag relations", async () => {
		const post = await forja2.findMany("post", {
			where: { slug: { $eq: "post-slug-0" } },
			populate: ["tags"],
		});

		expect(post).toHaveLength(1);
		const tags = post[0]!.tags as unknown[];
		expect(Array.isArray(tags)).toBe(true);
		expect((tags as Array<unknown>).length).toBeGreaterThan(0);
	});

	// ==========================================================================
	// Deleted rows — gaps in ID sequence must not reappear after import
	// ==========================================================================

	it("should not contain deleted author after import", async () => {
		const result = await forja2.findMany("author", {
			where: { id: { $eq: deletedAuthorId } },
		});
		expect(result).toHaveLength(0);
	});

	it("should not contain deleted post after import", async () => {
		const result = await forja2.findMany("post", {
			where: { id: { $eq: deletedPostId } },
		});
		expect(result).toHaveLength(0);
	});

	// ==========================================================================
	// ID continuity — auto-increment must continue from the last exported ID
	// ==========================================================================

	it("should continue auto-increment from last author ID after import", async () => {
		const newAuthor = await forja2.create("author", {
			name: "New Author After Import",
			email: "new-after-import@test.com",
		});
		expect(newAuthor.id as number).toBeGreaterThan(lastAuthorIdBeforeExport);
	});

	it("should continue auto-increment from last post ID after import", async () => {
		const newPost = await forja2.create("post", {
			title: "Post After Import",
			slug: "post-after-import",
			content: "Written after import.",
			isPublished: false,
		});
		expect(newPost.id as number).toBeGreaterThan(lastPostIdBeforeExport);
	});

	// ==========================================================================
	// FK integrity — the reconstructed DB must enforce relations like a fresh one
	// ==========================================================================

	it("should resolve FK relation correctly via populate after import", async () => {
		const result = await forja2.findMany("post", {
			where: { id: { $eq: knownPostId } },
			populate: ["author"],
			select: ["id", "title"],
		});

		expect(result).toHaveLength(1);
		const post = result[0]! as unknown as Record<string, unknown>;
		const author = post["author"] as Record<string, unknown>;
		expect(author).toBeDefined();
		expect(author["id"]).toBe(knownAuthorId);
	});

	it("should reject insert with non-existent FK after import", async () => {
		// Use an ID that was deleted before export — FK must reject it
		await expect(
			forja2.create("post", {
				title: "Invalid FK Post",
				slug: "invalid-fk-post",
				content: "This post references a deleted author.",
				isPublished: false,
				author: deletedAuthorId,
			}),
		).rejects.toThrow();
	});
});
