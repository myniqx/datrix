/**
 * Schema Default Tests
 *
 * The executor fills `default` values for fields the caller did not provide,
 * BEFORE validation — so a `required` field with a default passes and the
 * default itself is validated. The DB-level DEFAULT stays as a fallback.
 *
 * Covers:
 * - required + default, optional + default, every scalar/json/array type
 * - provided values win (including falsy 0 / false / "")
 * - explicit null is not replaced (required → error, optional → null)
 * - invalid defaults are rejected by validation
 * - function defaults are called per row
 * - object/array defaults are not shared between rows
 * - createMany, nested relation create, raw mode, beforeCreate hooks
 * - update never re-applies defaults
 * - upsert: insert path gets defaults, conflict path keeps existing values
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Datrix, defineConfig, defineSchema } from "@datrix/core";
import type { DatrixEntry } from "@datrix/core";
import fs from "node:fs/promises";
import { getTestEnv, getTmpDir } from "../setup";

interface DfItem extends DatrixEntry {
	title: string;
	status: string;
	level: "low" | "mid" | "high";
	priority: number;
	active: boolean;
	note: string | null;
	settings: { theme: string; tags: string[] };
	labels: string[];
	stamp: string;
	owner?: { id: number } | null;
}

interface DfOwner extends DatrixEntry {
	name: string;
	tier: string;
	items?: DfItem[];
}

interface DfStrict extends DatrixEntry {
	code: number;
}

interface DfSlot extends DatrixEntry {
	key: string;
	label: string;
	hits: number;
}

let stampCounter = 0;

describe("Schema defaults", () => {
	let datrix: Datrix;
	const tmpDir = getTmpDir("create_defaults");

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const ownerSchema = defineSchema({
			name: "dfOwner",
			fields: {
				name: { type: "string", required: true, maxLength: 50 },
				tier: {
					type: "string",
					required: true,
					maxLength: 20,
					default: "free",
				},
				items: { type: "relation", kind: "hasMany", model: "dfItem" },
			},
		});
		const itemSchema = defineSchema({
			name: "dfItem",
			fields: {
				title: { type: "string", required: true, maxLength: 100 },
				status: {
					type: "string",
					required: true,
					maxLength: 20,
					default: "draft",
				},
				level: {
					type: "enum",
					values: ["low", "mid", "high"] as const,
					required: true,
					default: "mid",
				},
				priority: { type: "number", required: true, default: 0 },
				active: { type: "boolean", required: true, default: false },
				note: { type: "string", maxLength: 100, default: "none" },
				settings: {
					type: "json",
					default: { theme: "light", tags: ["a"] },
				},
				labels: {
					type: "array",
					items: { type: "string" },
					default: ["x", "y"],
				},
				stamp: {
					type: "string",
					required: true,
					maxLength: 30,
					default: () => `stamp-${++stampCounter}`,
				},
				owner: { type: "relation", kind: "belongsTo", model: "dfOwner" },
			},
			hooks: {
				beforeCreate: (query) => ({
					...query,
					data: query.data.map((row) =>
						row["title"] === "hook-status"
							? { ...row, status: "from-hook" }
							: row,
					),
				}),
			},
		});
		const strictSchema = defineSchema({
			name: "dfStrict",
			fields: {
				// default violates its own min — must be rejected, not stored
				// (a rule no database DDL enforces, so only validation catches it)
				code: {
					type: "number",
					required: true,
					min: 1,
					default: 0,
				},
			},
		});
		const slotSchema = defineSchema({
			name: "dfSlot",
			fields: {
				key: { type: "string", required: true, unique: true, maxLength: 50 },
				label: {
					type: "string",
					required: true,
					maxLength: 50,
					default: "unnamed",
				},
				hits: { type: "number", required: true, default: 0 },
			},
		});

		const { adapter, idType } = await getTestEnv(tmpDir);
		const getDatrix = defineConfig(() => ({
			adapter,
			idType,
			schemas: [ownerSchema, itemSchema, strictSchema, slotSchema],
			plugins: [],
		}));
		datrix = await getDatrix();
		const migration = await datrix.beginMigrate();
		await migration.apply();
	});

	afterAll(async () => {
		await datrix.shutdown();
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	describe("create", () => {
		it("fills every default when only the non-default fields are given", async () => {
			const item = await datrix.create<DfItem>("dfItem", { title: "plain" });
			expect(item.status).toBe("draft");
			expect(item.level).toBe("mid");
			expect(item.priority).toBe(0);
			expect(item.active).toBe(false);
			expect(item.note).toBe("none");
			expect(item.settings).toEqual({ theme: "light", tags: ["a"] });
			expect(item.labels).toEqual(["x", "y"]);
			expect(item.stamp).toMatch(/^stamp-\d+$/);
		});

		it("persists defaults (re-read from the database)", async () => {
			const created = await datrix.create<DfItem>("dfItem", {
				title: "persisted",
			});
			const read = await datrix.findById<DfItem>("dfItem", created.id);
			expect(read!.status).toBe("draft");
			expect(read!.priority).toBe(0);
			expect(read!.settings).toEqual({ theme: "light", tags: ["a"] });
			expect(read!.labels).toEqual(["x", "y"]);
			expect(read!.stamp).toBe(created.stamp);
		});

		it("provided values win, including falsy ones", async () => {
			const item = await datrix.create<DfItem>("dfItem", {
				title: "explicit",
				status: "",
				level: "high",
				priority: 7,
				active: true,
				note: "",
				settings: { theme: "dark", tags: [] },
				labels: [],
				stamp: "manual",
			});
			expect(item.status).toBe("");
			expect(item.level).toBe("high");
			expect(item.priority).toBe(7);
			expect(item.active).toBe(true);
			expect(item.note).toBe("");
			expect(item.settings).toEqual({ theme: "dark", tags: [] });
			expect(item.labels).toEqual([]);
			expect(item.stamp).toBe("manual");
		});

		it("keeps falsy 0 / false instead of the default", async () => {
			const zero = await datrix.create<DfSlot>("dfSlot", {
				key: "zero",
				hits: 0,
			});
			expect(zero.hits).toBe(0);
			const off = await datrix.create<DfItem>("dfItem", {
				title: "off",
				active: false,
				priority: 0,
			});
			expect(off.active).toBe(false);
			expect(off.priority).toBe(0);
		});

		it("treats an explicit undefined like an omitted field", async () => {
			const item = await datrix.create<DfItem>("dfItem", {
				title: "undef",
				status: undefined as unknown as string,
			});
			expect(item.status).toBe("draft");
		});

		it("does not replace an explicit null on a required field", async () => {
			await expect(
				datrix.create("dfItem", {
					title: "null-required",
					status: null as unknown as string,
				}),
			).rejects.toThrow(/status/);
		});

		it("keeps an explicit null on an optional field", async () => {
			const item = await datrix.create<DfItem>("dfItem", {
				title: "null-optional",
				note: null,
			});
			expect(item.note).toBeNull();
		});

		it("still rejects a missing required field that has no default", async () => {
			await expect(
				datrix.create("dfItem", { status: "x" } as never),
			).rejects.toThrow(/title/);
		});

		it("validates the default itself", async () => {
			await expect(datrix.create("dfStrict", {})).rejects.toThrow(/code/);
			expect(await datrix.count("dfStrict", {})).toBe(0);
		});

		it("calls function defaults once per row", async () => {
			const a = await datrix.create<DfItem>("dfItem", { title: "fn-a" });
			const b = await datrix.create<DfItem>("dfItem", { title: "fn-b" });
			expect(a.stamp).not.toBe(b.stamp);
		});

		it("does not share object/array defaults between rows", async () => {
			const first = await datrix.create<DfItem>("dfItem", { title: "share-1" });
			await datrix.update("dfItem", first.id, {
				settings: { theme: "changed", tags: ["mutated"] },
				labels: ["mutated"],
			});
			first.settings.tags.push("local-mutation");
			first.labels.push("local-mutation");

			const second = await datrix.create<DfItem>("dfItem", {
				title: "share-2",
			});
			expect(second.settings).toEqual({ theme: "light", tags: ["a"] });
			expect(second.labels).toEqual(["x", "y"]);
		});

		it("applies defaults before a beforeCreate hook's value is validated", async () => {
			const hooked = await datrix.create<DfItem>("dfItem", {
				title: "hook-status",
			});
			expect(hooked.status).toBe("from-hook");
			expect(hooked.priority).toBe(0);
		});
	});

	describe("createMany", () => {
		it("fills defaults per row and keeps per-row provided values", async () => {
			const rows = await datrix.createMany<DfItem>("dfItem", [
				{ title: "bulk-1" },
				{ title: "bulk-2", status: "published", priority: 3 },
				{ title: "bulk-3", active: true },
			]);
			const byTitle = new Map(rows.map((r) => [r.title, r]));
			expect(byTitle.get("bulk-1")!.status).toBe("draft");
			expect(byTitle.get("bulk-1")!.priority).toBe(0);
			expect(byTitle.get("bulk-2")!.status).toBe("published");
			expect(byTitle.get("bulk-2")!.priority).toBe(3);
			expect(byTitle.get("bulk-3")!.active).toBe(true);
			expect(byTitle.get("bulk-3")!.status).toBe("draft");
			expect(new Set(rows.map((r) => r.stamp)).size).toBe(3);
		});
	});

	describe("nested relation create", () => {
		it("fills defaults on a belongsTo nested create", async () => {
			const item = await datrix.create<DfItem>(
				"dfItem",
				{ title: "nested-bt", owner: { create: { name: "Owner A" } } },
				{ populate: { owner: true } },
			);
			const owner = item.owner as unknown as DfOwner;
			expect(owner.name).toBe("Owner A");
			expect(owner.tier).toBe("free");
		});

		it("fills defaults on hasMany nested creates", async () => {
			const owner = await datrix.create<DfOwner>(
				"dfOwner",
				{
					name: "Owner B",
					items: {
						create: [{ title: "child-1" }, { title: "child-2", priority: 5 }],
					},
				} as never,
				{ populate: { items: true } },
			);
			expect(owner.tier).toBe("free");
			const children = new Map(owner.items!.map((c) => [c.title, c]));
			expect(children.get("child-1")!.status).toBe("draft");
			expect(children.get("child-1")!.priority).toBe(0);
			expect(children.get("child-2")!.priority).toBe(5);
		});
	});

	describe("raw mode", () => {
		it("raw.create fills defaults too", async () => {
			const item = await datrix.raw.create<DfItem>("dfItem", {
				title: "raw",
			});
			expect(item.status).toBe("draft");
			expect(item.level).toBe("mid");
			expect(item.stamp).toMatch(/^stamp-\d+$/);
		});
	});

	describe("update", () => {
		it("never re-applies defaults to fields left out", async () => {
			const item = await datrix.create<DfItem>("dfItem", {
				title: "upd",
				status: "published",
				priority: 9,
				note: null,
			});
			const updated = await datrix.update<DfItem>("dfItem", item.id, {
				title: "upd-2",
			});
			expect(updated.status).toBe("published");
			expect(updated.priority).toBe(9);
			expect(updated.note).toBeNull();
			expect(updated.stamp).toBe(item.stamp);
		});

		it("updateMany leaves omitted fields untouched", async () => {
			await datrix.createMany("dfItem", [
				{ title: "um-1", status: "a" },
				{ title: "um-2", status: "b" },
			]);
			await datrix.updateMany(
				"dfItem",
				{ title: { $in: ["um-1", "um-2"] } },
				{ priority: 4 },
			);
			const rows = await datrix.findMany<DfItem>("dfItem", {
				where: { title: { $in: ["um-1", "um-2"] } },
			});
			const byTitle = new Map(rows.map((r) => [r.title, r]));
			expect(byTitle.get("um-1")!.status).toBe("a");
			expect(byTitle.get("um-2")!.status).toBe("b");
			expect(rows.every((r) => r.priority === 4)).toBe(true);
		});
	});

	describe("upsert", () => {
		it("insert path fills defaults", async () => {
			const slot = await datrix.upsert<DfSlot>(
				"dfSlot",
				{ key: "up-new" },
				{ conflictOn: ["key"] },
			);
			expect(slot.label).toBe("unnamed");
			expect(slot.hits).toBe(0);
		});

		it("conflict path keeps existing values for fields not given", async () => {
			await datrix.create("dfSlot", {
				key: "up-existing",
				label: "Home",
				hits: 12,
			});
			const slot = await datrix.upsert<DfSlot>(
				"dfSlot",
				{ key: "up-existing" },
				{ conflictOn: ["key"] },
			);
			expect(slot.label).toBe("Home");
			expect(slot.hits).toBe(12);
		});

		it("conflict path updates given fields and keeps the rest", async () => {
			await datrix.create("dfSlot", {
				key: "up-partial",
				label: "Keep",
				hits: 3,
			});
			const slot = await datrix.upsert<DfSlot>(
				"dfSlot",
				{ key: "up-partial", hits: 4 },
				{ conflictOn: ["key"] },
			);
			expect(slot.label).toBe("Keep");
			expect(slot.hits).toBe(4);
		});

		it("upsertMany mixes insert (defaults) and conflict (kept) rows", async () => {
			await datrix.create("dfSlot", { key: "um-old", label: "Old", hits: 8 });
			const rows = await datrix.upsertMany<DfSlot>(
				"dfSlot",
				[{ key: "um-old" }, { key: "um-fresh" }],
				{ conflictOn: ["key"] },
			);
			const byKey = new Map(rows.map((r) => [r.key, r]));
			expect(byKey.get("um-old")!.label).toBe("Old");
			expect(byKey.get("um-old")!.hits).toBe(8);
			expect(byKey.get("um-fresh")!.label).toBe("unnamed");
			expect(byKey.get("um-fresh")!.hits).toBe(0);
		});
	});
});
