/**
 * Lifecycle Hook Tests
 *
 * Tests for schema lifecycle hooks and plugin query hooks.
 *
 * Covers:
 *
 * Schema hooks (hooks field in defineSchema):
 * - beforeCreate / afterCreate — data modification, metadata sharing, must return
 * - beforeUpdate / afterUpdate — data modification, must return
 * - beforeDelete / afterDelete — id pass-through, must return id
 * - beforeFind  / afterFind   — query injection, result filtering, must return
 * - hooks skipped on forja.raw.*
 * - hooks NOT called when hook is undefined
 *
 * Plugin hooks (onCreateQueryContext / onBeforeQuery / onAfterQuery):
 * - onCreateQueryContext — enrich context.metadata before query
 * - onBeforeQuery        — modify query, must return
 * - onAfterQuery         — modify result, must return
 * - execution order: plugin hooks run before schema hooks
 * - plugin hooks skipped on forja.raw.*
 */

import { describe, it, expect } from "vitest";
import { Forja, defineConfig } from "@forja/core";
import { BasePlugin } from "@forja/core/plugin/plugin";
import { defineSchema } from "@forja/types/core/schema";
import type { ForjaEntry, LifecycleHooks } from "@forja/types/core/schema";
import type { PluginContext, SchemaDefinition } from "@forja/types/core/plugin";
import type { QueryContext } from "@forja/types/core/query-context";
import type { QueryObject } from "@forja/types/core/query-builder";
import fs from "node:fs/promises";
import { getAdapter, getAdapterType, getTmpDir } from "../setup";

// ============================================================================
// Shared schema type
// ============================================================================

interface HookItem extends ForjaEntry {
	name: string;
	value: string;
}

// ============================================================================
// Schema factory — rebuilds schema with given hooks each test
// ============================================================================

function makeItemSchema(hooks?: LifecycleHooks<HookItem>): SchemaDefinition {
	return defineSchema({
		name: "hookItem",
		fields: {
			name: { type: "string", required: true },
			value: { type: "string", required: true },
		},
		...(hooks ? { hooks } : {}),
	});
}

// ============================================================================
// Helper — spin up an isolated Forja instance with the given schema
// ============================================================================

async function createIsolatedForja(
	tmpDir: string,
	schema: SchemaDefinition,
	plugins: PluginContext["adapter"] extends never ? never : unknown[] = [],
): Promise<Forja> {
	const adapterType = getAdapterType();
	const adapter = await getAdapter(adapterType, tmpDir);

	const getForja = defineConfig(() => ({
		adapter,
		schemas: [schema],
		plugins: plugins as never[],
	}));

	const forja = await getForja();
	const migration = await forja.beginMigrate();
	await migration.apply();

	return forja;
}

// ============================================================================
// Test Suite
// ============================================================================

describe("Lifecycle Hooks", () => {
	// ─── Schema hooks ─────────────────────────────────────────────────────────

	describe("Schema hooks", () => {
		describe("beforeCreate / afterCreate", () => {
			it("beforeCreate can modify data before insert", async () => {
				const tmpDir = getTmpDir("hooks_before_create");
				await fs.rm(tmpDir, { recursive: true, force: true });
				await fs.mkdir(tmpDir, { recursive: true });

				const schema = makeItemSchema({
					beforeCreate: (query) => ({
						...query,
						data: query.data.map((d) => ({ ...d, value: "injected" })),
					}),
					afterCreate: (records) => records,
				});

				const forja = await createIsolatedForja(tmpDir, schema);
				const item = await forja.create("hookItem", {
					name: "test",
					value: "original",
				});

				expect(item["value"]).toBe("injected");
				await fs.rm(tmpDir, { recursive: true, force: true });
			});

			it("beforeCreate must return data — returning undefined throws or drops data", async () => {
				const tmpDir = getTmpDir("hooks_before_create_no_return");
				await fs.rm(tmpDir, { recursive: true, force: true });
				await fs.mkdir(tmpDir, { recursive: true });

				// Simulates a developer forgetting to return — the hook returns undefined
				const schema = makeItemSchema({
					// @ts-expect-error intentionally not returning to test runtime behavior
					beforeCreate: (_data) => {
						/* forgot to return */
					},
				});

				const forja = await createIsolatedForja(tmpDir, schema);

				// Should throw because validated data becomes undefined/null
				await expect(
					forja.create("hookItem", { name: "test", value: "x" }),
				).rejects.toThrow();

				await fs.rm(tmpDir, { recursive: true, force: true });
			});

			it("afterCreate receives the saved record", async () => {
				const tmpDir = getTmpDir("hooks_after_create");
				await fs.rm(tmpDir, { recursive: true, force: true });
				await fs.mkdir(tmpDir, { recursive: true });

				const captured: HookItem[] = [];

				const schema = makeItemSchema({
					beforeCreate: (query) => query,
					afterCreate: (records) => {
						for (const r of records) captured.push(r);
						return records;
					},
				});

				const forja = await createIsolatedForja(tmpDir, schema);
				const item = await forja.create("hookItem", {
					name: "capture",
					value: "v",
				});

				expect(captured).toHaveLength(1);
				expect(captured[0]!.id).toBe(item.id);
				await fs.rm(tmpDir, { recursive: true, force: true });
			});

			it("metadata is shared between beforeCreate and afterCreate", async () => {
				const tmpDir = getTmpDir("hooks_metadata_create");
				await fs.rm(tmpDir, { recursive: true, force: true });
				await fs.mkdir(tmpDir, { recursive: true });

				let sharedValue: unknown;

				const schema = makeItemSchema({
					beforeCreate: (query, ctx) => {
						ctx.metadata.stamp = "hello";
						return query;
					},
					afterCreate: (records, ctx) => {
						sharedValue = ctx.metadata.stamp;
						return records;
					},
				});

				const forja = await createIsolatedForja(tmpDir, schema);
				await forja.create("hookItem", { name: "meta", value: "v" });

				expect(sharedValue).toBe("hello");
				await fs.rm(tmpDir, { recursive: true, force: true });
			});

			it("hooks skipped on forja.raw.create", async () => {
				const tmpDir = getTmpDir("hooks_raw_create");
				await fs.rm(tmpDir, { recursive: true, force: true });
				await fs.mkdir(tmpDir, { recursive: true });

				const schema = makeItemSchema({
					beforeCreate: (query) => ({
						...query,
						data: query.data.map((d) => ({ ...d, value: "hook-injected" })),
					}),
					afterCreate: (records) => records,
				});

				const forja = await createIsolatedForja(tmpDir, schema);
				const item = await forja.raw.create("hookItem", {
					name: "raw",
					value: "raw-value",
				});

				expect(item["value"]).toBe("raw-value"); // hook did NOT run
				await fs.rm(tmpDir, { recursive: true, force: true });
			});
		});

		describe("beforeUpdate / afterUpdate", () => {
			it("beforeUpdate can modify data before update", async () => {
				const tmpDir = getTmpDir("hooks_before_update");
				await fs.rm(tmpDir, { recursive: true, force: true });
				await fs.mkdir(tmpDir, { recursive: true });

				const schema = makeItemSchema({
					beforeCreate: (query) => query,
					afterCreate: (records) => records,
					beforeUpdate: (query) => ({
						...query,
						data: { ...query.data, value: "updated-by-hook" },
					}),
					afterUpdate: (records) => records,
				});

				const forja = await createIsolatedForja(tmpDir, schema);
				const item = await forja.create("hookItem", {
					name: "u",
					value: "original",
				});
				const updated = await forja.update("hookItem", item.id, {
					value: "manual",
				});

				expect(updated["value"]).toBe("updated-by-hook");
				await fs.rm(tmpDir, { recursive: true, force: true });
			});

			it("beforeUpdate must return data", async () => {
				const tmpDir = getTmpDir("hooks_before_update_no_return");
				await fs.rm(tmpDir, { recursive: true, force: true });
				await fs.mkdir(tmpDir, { recursive: true });

				const schema = makeItemSchema({
					beforeCreate: (query) => query,
					afterCreate: (records) => records,
					// @ts-expect-error intentionally not returning
					beforeUpdate: (_query) => {
						/* forgot to return */
					},
				});

				const forja = await createIsolatedForja(tmpDir, schema);
				const item = await forja.create("hookItem", { name: "u", value: "v" });

				await expect(
					forja.update("hookItem", item.id, { value: "new" }),
				).rejects.toThrow();

				await fs.rm(tmpDir, { recursive: true, force: true });
			});

			it("metadata is shared between beforeUpdate and afterUpdate", async () => {
				const tmpDir = getTmpDir("hooks_metadata_update");
				await fs.rm(tmpDir, { recursive: true, force: true });
				await fs.mkdir(tmpDir, { recursive: true });

				let sharedValue: unknown;

				const schema = makeItemSchema({
					beforeCreate: (query) => query,
					afterCreate: (records) => records,
					beforeUpdate: (query, ctx) => {
						ctx.metadata.tag = "update-tag";
						return query;
					},
					afterUpdate: (records, ctx) => {
						sharedValue = ctx.metadata.tag;
						return records;
					},
				});

				const forja = await createIsolatedForja(tmpDir, schema);
				const item = await forja.create("hookItem", { name: "m", value: "v" });
				await forja.update("hookItem", item.id, { value: "new" });

				expect(sharedValue).toBe("update-tag");
				await fs.rm(tmpDir, { recursive: true, force: true });
			});

			it("hooks skipped on forja.raw.update", async () => {
				const tmpDir = getTmpDir("hooks_raw_update");
				await fs.rm(tmpDir, { recursive: true, force: true });
				await fs.mkdir(tmpDir, { recursive: true });

				const schema = makeItemSchema({
					beforeCreate: (query) => query,
					afterCreate: (records) => records,
					beforeUpdate: (query) => ({
						...query,
						data: { ...query.data, value: "hook-value" },
					}),
					afterUpdate: (records) => records,
				});

				const forja = await createIsolatedForja(tmpDir, schema);
				const item = await forja.create("hookItem", { name: "r", value: "v" });
				const updated = await forja.raw.update("hookItem", item.id, {
					value: "raw-value",
				});

				expect(updated["value"]).toBe("raw-value");
				await fs.rm(tmpDir, { recursive: true, force: true });
			});
		});

		describe("beforeDelete / afterDelete", () => {
			it("beforeDelete must return the id", async () => {
				const tmpDir = getTmpDir("hooks_before_delete");
				await fs.rm(tmpDir, { recursive: true, force: true });
				await fs.mkdir(tmpDir, { recursive: true });

				const deletedIds: number[] = [];

				const schema = makeItemSchema({
					beforeCreate: (query) => query,
					afterCreate: (records) => records,
					beforeDelete: (query) => {
						const id = (query.where as { id?: number })?.id;
						if (id !== undefined) deletedIds.push(id);
						return query;
					},
				});

				const forja = await createIsolatedForja(tmpDir, schema);
				const item = await forja.create("hookItem", { name: "d", value: "v" });
				await forja.delete("hookItem", item.id);

				expect(deletedIds).toContain(item.id);
				await fs.rm(tmpDir, { recursive: true, force: true });
			});

			it("beforeDelete returning undefined causes failure", async () => {
				const tmpDir = getTmpDir("hooks_before_delete_no_return");
				await fs.rm(tmpDir, { recursive: true, force: true });
				await fs.mkdir(tmpDir, { recursive: true });

				const schema = makeItemSchema({
					beforeCreate: (query) => query,
					afterCreate: (records) => records,
					// @ts-expect-error intentionally not returning
					beforeDelete: (_query) => {
						/* forgot to return */
					},
				});

				const forja = await createIsolatedForja(tmpDir, schema);
				const item = await forja.create("hookItem", { name: "d", value: "v" });

				await expect(forja.delete("hookItem", item.id)).rejects.toThrow();

				await fs.rm(tmpDir, { recursive: true, force: true });
			});

			it("afterDelete is called with the deleted records", async () => {
				const tmpDir = getTmpDir("hooks_after_delete");
				await fs.rm(tmpDir, { recursive: true, force: true });
				await fs.mkdir(tmpDir, { recursive: true });

				const afterIds: number[] = [];

				const schema = makeItemSchema({
					beforeCreate: (query) => query,
					afterCreate: (records) => records,
					beforeDelete: (query) => query,
					afterDelete: (records) => {
						for (const r of records) afterIds.push(r.id);
					},
				});

				const forja = await createIsolatedForja(tmpDir, schema);
				const item = await forja.create("hookItem", { name: "ad", value: "v" });
				await forja.delete("hookItem", item.id);

				expect(afterIds).toContain(item.id);
				await fs.rm(tmpDir, { recursive: true, force: true });
			});

			it("hooks skipped on forja.raw.delete", async () => {
				const tmpDir = getTmpDir("hooks_raw_delete");
				await fs.rm(tmpDir, { recursive: true, force: true });
				await fs.mkdir(tmpDir, { recursive: true });

				const called = { before: false, after: false };

				const schema = makeItemSchema({
					beforeCreate: (query) => query,
					afterCreate: (records) => records,
					beforeDelete: (query) => {
						called.before = true;
						return query;
					},
					afterDelete: () => {
						called.after = true;
					},
				});

				const forja = await createIsolatedForja(tmpDir, schema);
				const item = await forja.create("hookItem", { name: "rd", value: "v" });
				await forja.raw.delete("hookItem", item.id);

				expect(called.before).toBe(false);
				expect(called.after).toBe(false);
				await fs.rm(tmpDir, { recursive: true, force: true });
			});
		});

		describe("beforeFind / afterFind", () => {
			it("beforeFind can inject additional WHERE conditions", async () => {
				const tmpDir = getTmpDir("hooks_before_find");
				await fs.rm(tmpDir, { recursive: true, force: true });
				await fs.mkdir(tmpDir, { recursive: true });

				// Only items with value="visible" should be returned
				const schema = makeItemSchema({
					beforeCreate: (query) => query,
					afterCreate: (records) => records,
					beforeFind: (query) => ({
						...query,
						where: { ...query.where, value: "visible" },
					}),
					afterFind: (results) => results,
				});

				const forja = await createIsolatedForja(tmpDir, schema);
				await forja.create("hookItem", { name: "a", value: "visible" });
				await forja.create("hookItem", { name: "b", value: "hidden" });

				const results = await forja.findMany("hookItem");

				expect(results.length).toBe(1);
				expect(results[0]!["value"]).toBe("visible");
				await fs.rm(tmpDir, { recursive: true, force: true });
			});

			it("beforeFind must return the query", async () => {
				const tmpDir = getTmpDir("hooks_before_find_no_return");
				await fs.rm(tmpDir, { recursive: true, force: true });
				await fs.mkdir(tmpDir, { recursive: true });

				const schema = makeItemSchema({
					beforeCreate: (query) => query,
					afterCreate: (records) => records,
					// @ts-expect-error intentionally not returning
					beforeFind: (_query) => {
						/* forgot to return */
					},
				});

				const forja = await createIsolatedForja(tmpDir, schema);
				await forja.create("hookItem", { name: "x", value: "v" });

				await expect(forja.findMany("hookItem")).rejects.toThrow();
				await fs.rm(tmpDir, { recursive: true, force: true });
			});

			it("afterFind can filter results", async () => {
				const tmpDir = getTmpDir("hooks_after_find");
				await fs.rm(tmpDir, { recursive: true, force: true });
				await fs.mkdir(tmpDir, { recursive: true });

				const schema = makeItemSchema({
					beforeCreate: (query) => query,
					afterCreate: (records) => records,
					beforeFind: (query) => query,
					afterFind: (results) => results.filter((r) => r.value !== "filtered"),
				});

				const forja = await createIsolatedForja(tmpDir, schema);
				await forja.create("hookItem", { name: "keep", value: "keep" });
				await forja.create("hookItem", { name: "remove", value: "filtered" });

				const results = await forja.findMany("hookItem");

				expect(results.every((r) => r["value"] !== "filtered")).toBe(true);
				await fs.rm(tmpDir, { recursive: true, force: true });
			});

			it("afterFind must return the results array", async () => {
				const tmpDir = getTmpDir("hooks_after_find_no_return");
				await fs.rm(tmpDir, { recursive: true, force: true });
				await fs.mkdir(tmpDir, { recursive: true });

				const schema = makeItemSchema({
					beforeCreate: (query) => query,
					afterCreate: (records) => records,
					beforeFind: (query) => query,
					// @ts-expect-error intentionally not returning
					afterFind: (_results) => {
						/* forgot to return */
					},
				});

				const forja = await createIsolatedForja(tmpDir, schema);
				await forja.create("hookItem", { name: "x", value: "v" });

				// afterFind returning undefined means caller gets undefined instead of array
				const result = await forja.findMany("hookItem");
				expect(result).toBeUndefined();
				await fs.rm(tmpDir, { recursive: true, force: true });
			});

			it("hooks skipped on forja.raw.findMany", async () => {
				const tmpDir = getTmpDir("hooks_raw_find");
				await fs.rm(tmpDir, { recursive: true, force: true });
				await fs.mkdir(tmpDir, { recursive: true });

				// beforeFind hides all items — raw should bypass this
				const schema = makeItemSchema({
					beforeCreate: (query) => query,
					afterCreate: (records) => records,
					beforeFind: (query) => ({
						...query,
						where: { ...query.where, value: "__never__" },
					}),
					afterFind: (results) => results,
				});

				const forja = await createIsolatedForja(tmpDir, schema);
				await forja.create("hookItem", { name: "visible", value: "v" });

				const normal = await forja.findMany("hookItem");
				const raw = await forja.raw.findMany("hookItem");

				expect(normal).toHaveLength(0); // hook filtered everything
				expect(raw).toHaveLength(1); // raw bypassed hook
				await fs.rm(tmpDir, { recursive: true, force: true });
			});
		});
	});

	// ─── Plugin hooks ──────────────────────────────────────────────────────────

	describe("Plugin hooks", () => {
		// Reusable plugin builder
		function makePlugin(
			overrides: Partial<{
				onCreateQueryContext: (ctx: QueryContext) => Promise<QueryContext>;
				onBeforeQuery: <T extends ForjaEntry>(
					q: QueryObject<T>,
					ctx: QueryContext,
				) => Promise<QueryObject<T>>;
				onAfterQuery: <T extends ForjaEntry>(
					r: T,
					ctx: QueryContext,
				) => Promise<T>;
			}>,
		) {
			class TestPlugin extends BasePlugin<Record<string, never>> {
				readonly name = "test-plugin";
				readonly version = "1.0.0";
				async init(ctx: PluginContext): Promise<void> {
					this.context = ctx;
				}
				async destroy(): Promise<void> {}
				override async onCreateQueryContext(
					ctx: QueryContext,
				): Promise<QueryContext> {
					return overrides.onCreateQueryContext?.(ctx) ?? ctx;
				}
				override async onBeforeQuery<T extends ForjaEntry>(
					q: QueryObject<T>,
					ctx: QueryContext,
				): Promise<QueryObject<T>> {
					return overrides.onBeforeQuery?.(q, ctx) ?? q;
				}
				override async onAfterQuery<T extends ForjaEntry>(
					r: T,
					ctx: QueryContext,
				): Promise<T> {
					return overrides.onAfterQuery?.(r, ctx) ?? r;
				}
			}
			return new TestPlugin({});
		}

		async function createForjaWithPlugin(
			tmpDir: string,
			plugin: unknown,
		): Promise<Forja> {
			const adapterType = getAdapterType();
			const adapter = await getAdapter(adapterType, tmpDir);
			const schema = makeItemSchema();

			const getForja = defineConfig(() => ({
				adapter,
				schemas: [schema as SchemaDefinition],
				plugins: [plugin as never],
			}));

			const forja = await getForja();
			const migration = await forja.beginMigrate();
			await migration.apply();
			return forja;
		}

		it("onCreateQueryContext enriches context.metadata before query", async () => {
			const tmpDir = getTmpDir("plugin_create_context");
			await fs.rm(tmpDir, { recursive: true, force: true });
			await fs.mkdir(tmpDir, { recursive: true });

			const captured: string[] = [];

			const plugin = makePlugin({
				onCreateQueryContext: async (ctx) => {
					ctx.metadata.requestId = "req-123";
					return ctx;
				},
				onBeforeQuery: async (query, ctx) => {
					captured.push(ctx.metadata.requestId as string);
					return query;
				},
			});

			const forja = await createForjaWithPlugin(tmpDir, plugin);
			await forja.create("hookItem", { name: "n", value: "v" });

			expect(captured).toContain("req-123");
			await fs.rm(tmpDir, { recursive: true, force: true });
		});

		it("onBeforeQuery can modify the query object and must return it", async () => {
			const tmpDir = getTmpDir("plugin_before_query");
			await fs.rm(tmpDir, { recursive: true, force: true });
			await fs.mkdir(tmpDir, { recursive: true });

			// Plugin injects value = "plugin-value" on every insert
			const plugin = makePlugin({
				onBeforeQuery: async (query, _ctx) => {
					if (query.type === "insert") {
						const q = query as typeof query & {
							data: Record<string, unknown>[];
						};
						return {
							...query,
							data: q.data.map((d) => ({ ...d, value: "plugin-value" })),
						} as typeof query;
					}
					return query;
				},
			});

			const forja = await createForjaWithPlugin(tmpDir, plugin);
			const item = await forja.create("hookItem", {
				name: "n",
				value: "original",
			});

			expect(item["value"]).toBe("plugin-value");
			await fs.rm(tmpDir, { recursive: true, force: true });
		});

		it("onAfterQuery can modify the result and must return it", async () => {
			const tmpDir = getTmpDir("plugin_after_query");
			await fs.rm(tmpDir, { recursive: true, force: true });
			await fs.mkdir(tmpDir, { recursive: true });

			// Plugin appends "-enriched" to name in results
			// onAfterQuery receives an array for create action
			const plugin = makePlugin({
				onAfterQuery: async (result, ctx) => {
					if (ctx.action === "create") {
						const rows = result as unknown as HookItem[];
						return rows.map((r) => ({
							...r,
							name: r.name + "-enriched",
						})) as unknown as typeof result;
					}
					return result;
				},
			});

			const forja = await createForjaWithPlugin(tmpDir, plugin);
			const item = await forja.create("hookItem", { name: "test", value: "v" });

			expect((item as unknown as HookItem).name).toBe("test-enriched");
			await fs.rm(tmpDir, { recursive: true, force: true });
		});

		it("plugin hooks run before schema hooks — plugin modifies data, schema hook sees modified data", async () => {
			const tmpDir = getTmpDir("plugin_before_schema_hook");
			await fs.rm(tmpDir, { recursive: true, force: true });
			await fs.mkdir(tmpDir, { recursive: true });

			const order: string[] = [];

			// Plugin sets value = "plugin"
			const plugin = makePlugin({
				onBeforeQuery: async (query, _ctx) => {
					order.push("plugin:before");
					if (query.type === "insert") {
						const q = query as typeof query & {
							data: Record<string, unknown>[];
						};
						return {
							...query,
							data: q.data.map((d) => ({ ...d, value: "plugin" })),
						} as typeof query;
					}
					return query;
				},
			});

			// Schema beforeCreate appends "-schema" to whatever value is at that point
			const adapterType = getAdapterType();
			const adapter = await getAdapter(adapterType, tmpDir);
			const schema = defineSchema({
				name: "hookItem",
				fields: {
					name: { type: "string", required: true },
					value: { type: "string", required: true },
				},
				hooks: {
					beforeCreate: (query) => {
						order.push("schema:before");
						return {
							...query,
							data: query.data.map((d) => ({
								...d,
								value: (d.value as string) + "-schema",
							})),
						};
					},
					afterCreate: (records) => records,
				},
			} as const) as unknown as SchemaDefinition;

			const getForja = defineConfig(() => ({
				adapter,
				schemas: [schema],
				plugins: [plugin as never],
			}));
			const forja = await getForja();

			const migration = await forja.beginMigrate();
			await migration.apply();

			const item = await forja.create("hookItem", {
				name: "n",
				value: "original",
			});

			// Plugin ran first, then schema hook
			expect(order).toEqual(["plugin:before", "schema:before"]);
			expect(item["value"]).toBe("plugin-schema");
			await fs.rm(tmpDir, { recursive: true, force: true });
		});

		it("plugin hooks skipped on forja.raw.*", async () => {
			const tmpDir = getTmpDir("plugin_raw_skip");
			await fs.rm(tmpDir, { recursive: true, force: true });
			await fs.mkdir(tmpDir, { recursive: true });

			const called = { before: false, after: false };

			const plugin = makePlugin({
				onBeforeQuery: async (q, _ctx) => {
					called.before = true;
					return q;
				},
				onAfterQuery: async (r, _ctx) => {
					called.after = true;
					return r;
				},
			});

			const forja = await createForjaWithPlugin(tmpDir, plugin);
			await forja.raw.create("hookItem", { name: "n", value: "v" });

			expect(called.before).toBe(false);
			expect(called.after).toBe(false);
			await fs.rm(tmpDir, { recursive: true, force: true });
		});

		it("context.action reflects the correct operation type", async () => {
			const tmpDir = getTmpDir("plugin_action_type");
			await fs.rm(tmpDir, { recursive: true, force: true });
			await fs.mkdir(tmpDir, { recursive: true });

			const actions: string[] = [];

			const plugin = makePlugin({
				onCreateQueryContext: async (ctx) => {
					actions.push(ctx.action);
					return ctx;
				},
			});

			const forja = await createForjaWithPlugin(tmpDir, plugin);
			const item = await forja.create("hookItem", { name: "n", value: "v" });
			await forja.findMany("hookItem");
			await forja.update("hookItem", item.id, { value: "new" });
			await forja.delete("hookItem", item.id);

			expect(actions).toContain("create");
			expect(actions).toContain("findMany");
			expect(actions).toContain("update");
			expect(actions).toContain("delete");
			await fs.rm(tmpDir, { recursive: true, force: true });
		});
	});
});
