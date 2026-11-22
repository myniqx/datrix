/**
 * idType: "uuid" — adapter conformance
 *
 * Runs against whichever adapter `ADAPTER` selects (json by default), so the
 * same file proves every adapter behaves identically in uuid mode:
 * - ids are core-generated UUID v7, stored and returned as lowercase strings
 * - belongsTo / hasMany / manyToMany link, populate and filter by uuid
 * - where on id is case-insensitive (builder normalizes)
 * - update, upsert, delete, onDelete (cascade / setNull)
 * - orderBy id keeps creation order (time-ordered ids)
 * - internal tables (`_datrix`) keep integer ids
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Datrix, defineConfig, defineSchema } from "@datrix/core";
import type { DatrixEntry } from "@datrix/core";
import fs from "node:fs/promises";
import { getTestEnv, getTmpDir } from "../setup";
import { isCanonicalUuid } from "../../../src/schema/id";

// Without the DatrixRegister augmentation DatrixId types as number; at runtime
// ids are uuid strings in this suite.
type Id = number;
const id = (value: unknown): Id => value as Id;

interface UAuthor extends DatrixEntry {
	name: string;
	posts?: UPost[];
}

interface UTag extends DatrixEntry {
	label: string;
}

interface UPost extends DatrixEntry {
	title: string;
	sku: string;
	author?: UAuthor | null;
	tags?: UTag[];
	comments?: UComment[];
}

interface UComment extends DatrixEntry {
	body: string;
}

describe("idType: uuid", () => {
	let datrix: Datrix;
	const tmpDir = getTmpDir("id_type_uuid");

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const author = defineSchema({
			name: "uAuthor",
			fields: {
				name: { type: "string", required: true },
				posts: { type: "relation", kind: "hasMany", model: "uPost" },
			},
		});
		const tag = defineSchema({
			name: "uTag",
			fields: {
				label: { type: "string", required: true },
			},
		});
		const post = defineSchema({
			name: "uPost",
			fields: {
				title: { type: "string", required: true },
				sku: { type: "string", required: true, unique: true },
				author: {
					type: "relation",
					kind: "belongsTo",
					model: "uAuthor",
					onDelete: "setNull",
				},
				tags: { type: "relation", kind: "manyToMany", model: "uTag" },
				comments: {
					type: "relation",
					kind: "hasMany",
					model: "uComment",
					onDelete: "cascade",
				},
			},
		});
		const comment = defineSchema({
			name: "uComment",
			fields: {
				body: { type: "string", required: true },
			},
		});

		const { adapter } = await getTestEnv(tmpDir);
		const getDatrix = defineConfig(() => ({
			adapter,
			idType: "uuid" as const,
			schemas: [author, tag, post, comment],
			plugins: [],
		}));
		datrix = await getDatrix();
		const migration = await datrix.beginMigrate();
		await migration.apply();
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("creates records with core-generated uuid ids", async () => {
		const a = await datrix.create<UAuthor>("uAuthor", { name: "Ada" });
		expect(isCanonicalUuid(a.id)).toBe(true);

		const many = await datrix.createMany<UTag>("uTag", [
			{ label: "t1" },
			{ label: "t2" },
			{ label: "t3" },
		]);
		expect(many).toHaveLength(3);
		for (const t of many) expect(isCanonicalUuid(t.id)).toBe(true);
		expect(new Set(many.map((t) => t.id)).size).toBe(3);
	});

	it("findById / where id are case-insensitive", async () => {
		const a = await datrix.create<UAuthor>("uAuthor", { name: "Case" });
		const upper = id(String(a.id).toUpperCase());

		const byId = await datrix.findById<UAuthor>("uAuthor", upper);
		expect(byId?.id).toBe(a.id);

		const found = await datrix.findMany<UAuthor>("uAuthor", {
			where: { id: { $in: [upper] } },
		});
		expect(found.map((r) => r.id)).toEqual([a.id]);
	});

	it("rejects numeric and malformed ids", async () => {
		await expect(datrix.findById("uAuthor", 1)).rejects.toThrow();
		await expect(
			datrix.findById("uAuthor", id("not-a-uuid")),
		).rejects.toThrow();
	});

	it("links and populates belongsTo / hasMany / manyToMany", async () => {
		const a = await datrix.create<UAuthor>("uAuthor", { name: "Rel" });
		const tags = await datrix.createMany<UTag>("uTag", [
			{ label: "r1" },
			{ label: "r2" },
		]);

		const p = await datrix.create<UPost>(
			"uPost",
			{
				title: "Post",
				sku: "rel-1",
				author: a.id,
				tags: tags.map((t) => t.id),
				comments: { create: [{ body: "c1" }, { body: "c2" }] },
			} as never,
			{ populate: { author: true, tags: true, comments: true } },
		);

		expect(isCanonicalUuid(p.id)).toBe(true);
		expect(p.author?.id).toBe(a.id);
		expect(p.tags!.map((t) => t.id).sort()).toEqual(
			tags.map((t) => t.id).sort(),
		);
		expect(p.comments).toHaveLength(2);
		for (const c of p.comments!) {
			expect(isCanonicalUuid(c.id)).toBe(true);
		}
		expect(await datrix.count("uComment", { uPostId: p.id } as never)).toBe(2);

		// author.posts is its own hasMany (FK uPost.uAuthorId), not the inverse
		// of post.author
		await datrix.update("uAuthor", a.id, {
			posts: { connect: [p.id] },
		} as never);
		const withPosts = await datrix.findById<UAuthor>("uAuthor", a.id, {
			populate: { posts: true },
		});
		expect(withPosts!.posts!.map((x) => x.id)).toEqual([p.id]);
	});

	it("filters by relation id and nested relation where", async () => {
		const a = await datrix.create<UAuthor>("uAuthor", { name: "Filter" });
		const t = await datrix.create<UTag>("uTag", { label: "filter-tag" });
		const p = await datrix.create<UPost>("uPost", {
			title: "F",
			sku: "flt-1",
			author: a.id,
			tags: [t.id],
		} as never);

		const byFk = await datrix.findMany<UPost>("uPost", {
			where: { author: id(String(a.id).toUpperCase()) } as never,
		});
		expect(byFk.map((r) => r.id)).toEqual([p.id]);

		const byTag = await datrix.findMany<UPost>("uPost", {
			where: { tags: { id: { $eq: t.id } } } as never,
		});
		expect(byTag.map((r) => r.id)).toEqual([p.id]);
	});

	it("connect / disconnect / set on manyToMany with populate limit", async () => {
		const tags = await datrix.createMany<UTag>("uTag", [
			{ label: "m1" },
			{ label: "m2" },
			{ label: "m3" },
		]);
		const p = await datrix.create<UPost>("uPost", {
			title: "M",
			sku: "m2m-1",
			tags: { connect: [tags[0]!.id, { id: tags[1]!.id }] },
		} as never);

		await datrix.update<UPost>("uPost", p.id, {
			tags: { connect: [tags[2]!.id], disconnect: [tags[0]!.id] },
		} as never);

		const after = await datrix.findById<UPost>("uPost", p.id, {
			populate: { tags: true },
		});
		expect(after!.tags!.map((x) => x.id).sort()).toEqual(
			[tags[1]!.id, tags[2]!.id].sort(),
		);

		// limit without orderBy falls back to id order (= creation order)
		const limited = await datrix.findById<UPost>("uPost", p.id, {
			populate: { tags: { limit: 1 } },
		});
		expect(limited!.tags!.map((x) => x.id)).toEqual([tags[1]!.id]);

		await datrix.update<UPost>("uPost", p.id, {
			tags: { set: [tags[0]!.id] },
		} as never);
		const reset = await datrix.findById<UPost>("uPost", p.id, {
			populate: { tags: true },
		});
		expect(reset!.tags!.map((x) => x.id)).toEqual([tags[0]!.id]);
	});

	it("orderBy id keeps creation order", async () => {
		const created: UTag[] = [];
		for (let i = 0; i < 5; i++) {
			created.push(await datrix.create<UTag>("uTag", { label: `ord-${i}` }));
			await new Promise((resolve) => setTimeout(resolve, 2));
		}
		const rows = await datrix.findMany<UTag>("uTag", {
			where: { label: { $startsWith: "ord-" } },
			orderBy: [{ field: "id", direction: "asc" }],
		} as never);
		expect(rows.map((r) => r.id)).toEqual(created.map((r) => r.id));
	});

	it("updates and deletes by uuid", async () => {
		const a = await datrix.create<UAuthor>("uAuthor", { name: "Before" });
		const updated = await datrix.update<UAuthor>("uAuthor", a.id, {
			name: "After",
		});
		expect(updated.id).toBe(a.id);
		expect(updated.name).toBe("After");

		const deleted = await datrix.delete<UAuthor>("uAuthor", a.id);
		expect(deleted.id).toBe(a.id);
		expect(await datrix.findById("uAuthor", a.id)).toBeNull();
	});

	it("upsert inserts with a new uuid and updates the matched row", async () => {
		const first = await datrix.upsert<UPost>(
			"uPost",
			{ title: "U1", sku: "ups-1" },
			{ conflictOn: ["sku"] },
		);
		expect(isCanonicalUuid(first.id)).toBe(true);

		const second = await datrix.upsert<UPost>(
			"uPost",
			{ title: "U2", sku: "ups-1" },
			{ conflictOn: ["sku"] },
		);
		expect(second.id).toBe(first.id);
		expect(second.title).toBe("U2");

		const many = await datrix.upsertMany<UPost>(
			"uPost",
			[
				{ title: "U3", sku: "ups-1" },
				{ title: "N1", sku: "ups-2" },
			],
			{ conflictOn: ["sku"] },
		);
		expect(many[0]!.id).toBe(first.id);
		expect(isCanonicalUuid(many[1]!.id)).toBe(true);
		expect(many[1]!.id).not.toBe(first.id);
	});

	it("onDelete setNull / cascade follow uuid foreign keys", async () => {
		const a = await datrix.create<UAuthor>("uAuthor", { name: "Gone" });
		const p = await datrix.create<UPost>("uPost", {
			title: "Orphan",
			sku: "del-1",
			author: a.id,
			comments: { create: [{ body: "x" }] },
		} as never);

		await datrix.delete("uAuthor", a.id);
		const orphan = await datrix.findById<UPost>("uPost", p.id, {
			populate: { author: true },
		});
		expect(orphan!.author ?? null).toBeNull();
		expect(await datrix.count("uComment", { uPostId: p.id } as never)).toBe(1);

		await datrix.delete("uPost", p.id);
		expect(await datrix.count("uComment", { uPostId: p.id } as never)).toBe(0);
	});

	it("internal _datrix table keeps integer ids", () => {
		const meta = datrix.getSchemas().get("_datrix")!;
		expect(meta.fields["id"]!.type).toBe("number");
		expect(datrix.getSchemas().get("uPost")!.fields["id"]!.type).toBe("uuid");
	});
});
