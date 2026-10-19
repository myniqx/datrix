/**
 * upsert / upsertMany Tests
 *
 * Covers:
 * - insert when nothing conflicts, update the matched row otherwise
 * - `update` column list and `update: []` (leave matched rows untouched)
 * - unique field and composite unique index as conflict targets
 * - timestamps, belongsTo FK and manyToMany relations
 * - beforeUpsert / afterUpsert hooks (create/update hooks don't fire)
 * - builder rejections, create-level validation, raw mode, transactions
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { BasePlugin, Datrix, defineConfig, defineSchema } from "@datrix/core";
import type { DatrixEntry, PluginContext, QueryContext } from "@datrix/core";
import fs from "node:fs/promises";
import { getAdapter, getAdapterType, getTmpDir } from "../setup";

interface UpProduct extends DatrixEntry {
	sku: string;
	name: string;
	price: number;
	stock: number;
	category?: { id: number } | null;
	tags?: { id: number }[];
}

interface UpSlot extends DatrixEntry {
	tenant: string;
	slug: string;
	label: string;
}

describe("upsert / upsertMany", () => {
	let datrix: Datrix;
	const tmpDir = getTmpDir("upsert");
	const hookLog: {
		beforeUpsert: number;
		beforeCreate: number;
		afterCreate: number;
		beforeUpdate: number;
		afterUpdate: number;
		afterUpsert: { created: string[]; updated: string[] }[];
	} = {
		beforeUpsert: 0,
		beforeCreate: 0,
		afterCreate: 0,
		beforeUpdate: 0,
		afterUpdate: 0,
		afterUpsert: [],
	};
	const pluginCreatedIds: { action: string; ids: number[] | undefined }[] = [];

	class CreatedIdsPlugin extends BasePlugin<Record<string, never>> {
		readonly name = "created-ids-plugin";
		readonly version = "1.0.0";
		async init(ctx: PluginContext): Promise<void> {
			this.context = ctx;
		}
		async destroy(): Promise<void> {}
		override async onAfterQuery<T>(result: T, ctx: QueryContext): Promise<T> {
			pluginCreatedIds.push({
				action: ctx.action,
				ids: ctx.createdIds ? [...ctx.createdIds].sort((a, b) => a - b) : undefined,
			});
			return result;
		}
	}

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const categorySchema = defineSchema({
			name: "upCategory",
			fields: {
				name: { type: "string", required: true },
			},
		});
		const tagSchema = defineSchema({
			name: "upTag",
			fields: {
				name: { type: "string", required: true },
			},
		});
		const productSchema = defineSchema({
			name: "upProduct",
			fields: {
				sku: { type: "string", required: true, unique: true },
				name: { type: "string", required: true, minLength: 2 },
				price: { type: "number", required: true },
				stock: { type: "number", default: 0 },
				category: { type: "relation", kind: "belongsTo", model: "upCategory" },
				tags: { type: "relation", kind: "manyToMany", model: "upTag" },
			},
			hooks: {
				beforeUpsert: (query) => {
					hookLog.beforeUpsert++;
					return {
						...query,
						data: query.data.map((row) =>
							row.name === "rename-me" ? { ...row, name: "renamed" } : row,
						),
					};
				},
				afterUpsert: (records: UpProduct[], _ctx, result) => {
					hookLog.afterUpsert.push({
						created: result.created.map((r) => (r as UpProduct).sku),
						updated: result.updated.map((r) => (r as UpProduct).sku),
					});
					return records;
				},
				beforeCreate: (query) => {
					hookLog.beforeCreate++;
					return query;
				},
				afterCreate: (records) => {
					hookLog.afterCreate++;
					return records;
				},
				beforeUpdate: (query) => {
					hookLog.beforeUpdate++;
					return query;
				},
				afterUpdate: (records) => {
					hookLog.afterUpdate++;
					return records;
				},
			},
		});
		const slotSchema = defineSchema({
			name: "upSlot",
			fields: {
				tenant: { type: "string", required: true },
				slug: { type: "string", required: true },
				label: { type: "string", required: true },
			},
			indexes: [{ fields: ["tenant", "slug"], unique: true }],
		});

		const adapter = await getAdapter(getAdapterType(), tmpDir);
		const getDatrix = defineConfig(() => ({
			adapter,
			schemas: [categorySchema, tagSchema, productSchema, slotSchema],
			plugins: [new CreatedIdsPlugin({})],
		}));
		datrix = await getDatrix();
		const migration = await datrix.beginMigrate();
		await migration.apply();
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	beforeEach(() => {
		hookLog.beforeUpsert = 0;
		hookLog.beforeCreate = 0;
		hookLog.afterCreate = 0;
		hookLog.beforeUpdate = 0;
		hookLog.afterUpdate = 0;
		hookLog.afterUpsert = [];
		pluginCreatedIds.length = 0;
	});

	const product = (sku: string, extra: Partial<UpProduct> = {}) => ({
		sku,
		name: `Product ${sku}`,
		price: 10,
		...extra,
	});

	describe("insert or update", () => {
		it("inserts when nothing conflicts", async () => {
			const created = await datrix.upsert<UpProduct>(
				"upProduct",
				product("ins-1", { price: 15 }),
				{ conflictOn: ["sku"] },
			);

			expect(created.id).toBeDefined();
			expect(created.sku).toBe("ins-1");
			expect(created.price).toBe(15);
			expect(created.stock).toBe(0);
			expect(created.createdAt).toBeInstanceOf(Date);
			expect(await datrix.count("upProduct", { sku: "ins-1" })).toBe(1);
		});

		it("updates the matched row with the incoming values", async () => {
			const first = await datrix.upsert<UpProduct>(
				"upProduct",
				product("upd-1", { price: 10 }),
				{ conflictOn: ["sku"] },
			);
			await new Promise((resolve) => setTimeout(resolve, 10));

			const second = await datrix.upsert<UpProduct>(
				"upProduct",
				product("upd-1", { name: "Updated", price: 20 }),
				{ conflictOn: ["sku"] },
			);

			expect(second.id).toBe(first.id);
			expect(second.name).toBe("Updated");
			expect(second.price).toBe(20);
			expect(second.createdAt!.getTime()).toBe(first.createdAt!.getTime());
			expect(second.updatedAt!.getTime()).toBeGreaterThan(
				first.updatedAt!.getTime(),
			);
			expect(await datrix.count("upProduct", { sku: "upd-1" })).toBe(1);
		});

		it("upsertMany inserts new rows and updates existing ones", async () => {
			await datrix.create("upProduct", product("many-1", { price: 1 }));

			const rows = await datrix.upsertMany<UpProduct>(
				"upProduct",
				[product("many-1", { price: 100 }), product("many-2", { price: 200 })],
				{ conflictOn: ["sku"] },
			);

			expect(rows).toHaveLength(2);
			const bySku = new Map(rows.map((r) => [r.sku, r]));
			expect(bySku.get("many-1")!.price).toBe(100);
			expect(bySku.get("many-2")!.price).toBe(200);
			expect(
				await datrix.count("upProduct", { sku: { $in: ["many-1", "many-2"] } }),
			).toBe(2);
		});
	});

	describe("update columns", () => {
		it("overwrites only the listed fields on conflict", async () => {
			await datrix.create("upProduct", product("cols-1", { price: 5, stock: 3 }));

			const row = await datrix.upsert<UpProduct>(
				"upProduct",
				product("cols-1", { name: "Ignored", price: 50, stock: 30 }),
				{ conflictOn: ["sku"], update: ["price"] },
			);

			expect(row.price).toBe(50);
			expect(row.name).toBe("Product cols-1");
			expect(row.stock).toBe(3);
		});

		it("update: [] leaves matched rows untouched and still inserts new ones", async () => {
			const existing = await datrix.create<UpProduct>(
				"upProduct",
				product("noop-1", { price: 5 }),
			);

			const rows = await datrix.upsertMany<UpProduct>(
				"upProduct",
				[product("noop-1", { price: 99 }), product("noop-2", { price: 7 })],
				{ conflictOn: ["sku"], update: [] },
			);

			const bySku = new Map(rows.map((r) => [r.sku, r]));
			expect(bySku.get("noop-1")!.id).toBe(existing.id);
			expect(bySku.get("noop-1")!.price).toBe(5);
			expect(bySku.get("noop-1")!.updatedAt!.getTime()).toBe(
				existing.updatedAt!.getTime(),
			);
			expect(bySku.get("noop-2")!.price).toBe(7);
		});
	});

	describe("conflict targets", () => {
		it("supports a composite unique index", async () => {
			await datrix.upsert("upSlot", { tenant: "a", slug: "home", label: "A" }, {
				conflictOn: ["tenant", "slug"],
			});
			await datrix.upsert("upSlot", { tenant: "b", slug: "home", label: "B" }, {
				conflictOn: ["slug", "tenant"],
			});
			const updated = await datrix.upsert<UpSlot>(
				"upSlot",
				{ tenant: "a", slug: "home", label: "A2" },
				{ conflictOn: ["tenant", "slug"] },
			);

			expect(updated.label).toBe("A2");
			expect(await datrix.count("upSlot", { slug: "home" })).toBe(2);
		});

		it("rejects a conflict target that is not unique", async () => {
			await expect(
				datrix.upsert("upProduct", product("bad-1"), { conflictOn: ["name"] }),
			).rejects.toThrow(/unique/);
			await expect(
				datrix.upsert("upSlot", { tenant: "a", slug: "x", label: "x" }, {
					conflictOn: ["slug"],
				}),
			).rejects.toThrow(/unique/);
		});

		it("rejects rows without a value for the conflict target", async () => {
			await expect(
				datrix.upsertMany(
					"upSlot",
					[{ tenant: "a", label: "no slug" }],
					{ conflictOn: ["tenant", "slug"] },
				),
			).rejects.toThrow(/conflictOn/);
		});

		it("rejects rows that conflict with each other in one batch", async () => {
			await expect(
				datrix.upsertMany(
					"upProduct",
					[product("dup-1"), product("dup-1", { price: 2 })],
					{ conflictOn: ["sku"] },
				),
			).rejects.toThrow(/unique within the batch/);
			expect(await datrix.count("upProduct", { sku: "dup-1" })).toBe(0);
		});

		it("rejects update fields missing from a row or reserved", async () => {
			await expect(
				datrix.upsertMany(
					"upProduct",
					[product("miss-1", { stock: 1 }), product("miss-2")],
					{ conflictOn: ["sku"], update: ["stock"] },
				),
			).rejects.toThrow(/every row/);
			await expect(
				datrix.upsert("upProduct", product("res-1"), {
					conflictOn: ["sku"],
					update: ["createdAt"],
				}),
			).rejects.toThrow(/reserved/);
		});
	});

	describe("validation and relations", () => {
		it("validates rows as creates even when they match an existing row", async () => {
			await datrix.create("upProduct", product("val-1"));

			await expect(
				datrix.upsert("upProduct", { sku: "val-1", price: 1 }, {
					conflictOn: ["sku"],
				}),
			).rejects.toThrow();
			await expect(
				datrix.upsert("upProduct", product("val-1", { name: "x" }), {
					conflictOn: ["sku"],
				}),
			).rejects.toThrow();
		});

		it("sets and overwrites a belongsTo relation", async () => {
			const c1 = await datrix.create("upCategory", { name: "c1" });
			const c2 = await datrix.create("upCategory", { name: "c2" });

			await datrix.upsert("upProduct", product("rel-1", { category: c1.id } as never), {
				conflictOn: ["sku"],
			});
			const updated = await datrix.upsert<UpProduct>(
				"upProduct",
				product("rel-1", { category: c2.id } as never),
				{ conflictOn: ["sku"], populate: { category: true } },
			);

			expect(updated.category?.id).toBe(c2.id);
		});

		it("applies manyToMany relations to inserted and updated rows", async () => {
			const t1 = await datrix.create("upTag", { name: "t1" });
			const t2 = await datrix.create("upTag", { name: "t2" });
			await datrix.create("upProduct", product("m2m-1"));

			const rows = await datrix.upsertMany<UpProduct>(
				"upProduct",
				[
					product("m2m-1", { tags: [t1.id, t2.id] } as never),
					product("m2m-2", { tags: [t1.id, t2.id] } as never),
				],
				{ conflictOn: ["sku"], populate: { tags: true } },
			);

			for (const row of rows) {
				expect(row.tags!.map((t) => t.id).sort()).toEqual(
					[t1.id, t2.id].sort(),
				);
			}
		});

		it("update: [] does not touch relations of matched rows", async () => {
			const t1 = await datrix.create("upTag", { name: "keep" });
			const t2 = await datrix.create("upTag", { name: "other" });
			await datrix.create("upProduct", product("m2m-keep", { tags: [t1.id] } as never));

			const row = await datrix.upsert<UpProduct>(
				"upProduct",
				product("m2m-keep", { tags: [t2.id] } as never),
				{ conflictOn: ["sku"], update: [], populate: { tags: true } },
			);

			expect(row.tags!.map((t) => t.id)).toEqual([t1.id]);
		});
	});

	describe("hooks", () => {
		it("runs beforeUpsert/afterUpsert only, with created/updated split", async () => {
			await datrix.raw.create("upProduct", product("hook-1"));

			const rows = await datrix.upsertMany<UpProduct>(
				"upProduct",
				[product("hook-1", { price: 2 }), product("hook-2", { name: "rename-me" })],
				{ conflictOn: ["sku"] },
			);

			expect(hookLog.beforeUpsert).toBe(1);
			expect(hookLog.afterUpsert).toEqual([
				{ created: ["hook-2"], updated: ["hook-1"] },
			]);
			expect(hookLog.beforeCreate).toBe(0);
			expect(hookLog.afterCreate).toBe(0);
			expect(hookLog.beforeUpdate).toBe(0);
			expect(hookLog.afterUpdate).toBe(0);
			expect(rows.find((r) => r.sku === "hook-2")!.name).toBe("renamed");
		});

		it("exposes inserted ids to plugins as context.createdIds", async () => {
			const existing = await datrix.create<UpProduct>(
				"upProduct",
				product("ctx-1"),
			);
			const rows = await datrix.upsertMany<UpProduct>(
				"upProduct",
				[product("ctx-1", { price: 3 }), product("ctx-2")],
				{ conflictOn: ["sku"] },
			);
			const inserted = rows.find((r) => r.sku === "ctx-2")!;
			await datrix.update("upProduct", existing.id, { price: 4 });

			expect(pluginCreatedIds).toEqual([
				{ action: "create", ids: [existing.id] },
				{ action: "upsertMany", ids: [inserted.id] },
				{ action: "update", ids: undefined },
			]);
		});

		it("raw.upsert skips hooks", async () => {
			await datrix.raw.upsert("upProduct", product("raw-1"), {
				conflictOn: ["sku"],
			});

			expect(hookLog.beforeUpsert).toBe(0);
			expect(hookLog.afterUpsert).toEqual([]);
		});
	});

	describe("transactions", () => {
		it("rolls back upserts with the transaction", async () => {
			await datrix.create("upProduct", product("tx-1", { price: 1 }));

			await expect(
				datrix.transaction(async (tx) => {
					await tx.upsertMany(
						"upProduct",
						[product("tx-1", { price: 50 }), product("tx-2")],
						{ conflictOn: ["sku"] },
					);
					throw new Error("rollback");
				}),
			).rejects.toThrow("rollback");

			const existing = await datrix.findOne<UpProduct>("upProduct", {
				sku: "tx-1",
			});
			expect(existing!.price).toBe(1);
			expect(await datrix.count("upProduct", { sku: "tx-2" })).toBe(0);
		});
	});
});
