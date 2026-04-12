/**
 * Core - Dispatcher Tests - Happy Path
 *
 * Tests the Dispatcher:
 * - Proper hook execution order
 * - Query manipulation by plugins
 * - Result manipulation by plugins
 * - Cross-plugin communication via 'meta' field
 */

import { Dispatcher } from "../src/dispatcher";
import { QueryObject } from "../src/types/core/query-builder";
import { DatrixPlugin, PluginRegistry } from "../src/types/core";
import { describe, it, expect, vi } from "vitest";

describe("Core - Dispatcher - Happy Path", () => {
	it("should call onSchemaLoad on all plugins", async () => {
		const pluginRegistry = new PluginRegistry();
		const firstPlugin: DatrixPlugin = {
			name: "p1",
			version: "1",
			options: {},
			init: async () => {},
			destroy: async () => {},
			onSchemaLoad: vi.fn(),
		};
		const secondPlugin: DatrixPlugin = {
			name: "p2",
			version: "1",
			options: {},
			init: async () => {},
			destroy: async () => {},
			onSchemaLoad: vi.fn(),
		};

		pluginRegistry.register(firstPlugin);
		pluginRegistry.register(secondPlugin);

		const dispatcher = new Dispatcher(pluginRegistry, null!);
		const mockSchemaRegistry: any = { name: "Registry" };

		await dispatcher.dispatchSchemaLoad(mockSchemaRegistry);

		expect(firstPlugin.onSchemaLoad).toHaveBeenCalledWith(mockSchemaRegistry);
		expect(secondPlugin.onSchemaLoad).toHaveBeenCalledWith(mockSchemaRegistry);
	});

	it("should allow plugins to modify query in sequence", async () => {
		const pluginRegistry = new PluginRegistry();
		const tableAppendingPlugin1: DatrixPlugin = {
			name: "p1",
			version: "1",
			options: {},
			init: async () => {},
			destroy: async () => {},
			onBeforeQuery: async (q) => ({ ...q, table: q.table + "_p1" }),
		};
		const tableAppendingPlugin2: DatrixPlugin = {
			name: "p2",
			version: "1",
			options: {},
			init: async () => {},
			destroy: async () => {},
			onBeforeQuery: async (q) => ({ ...q, table: q.table + "_p2" }),
		};

		pluginRegistry.register(tableAppendingPlugin1);
		pluginRegistry.register(tableAppendingPlugin2);

		const dispatcher = new Dispatcher(pluginRegistry, null!);
		const initialQuery: QueryObject = { type: "select", table: "users" };

		const modifiedQuery = await dispatcher.dispatchBeforeQuery(
			initialQuery,
			{ hooks: null! },
			null!,
		);

		expect(modifiedQuery.table).toBe("users_p1_p2");
	});

	it("should allow modifying results in sequence", async () => {
		const pluginRegistry = new PluginRegistry();
		const countIncrementingPlugin: DatrixPlugin = {
			name: "p1",
			version: "1",
			options: {},
			init: async () => {},
			destroy: async () => {},
			onAfterQuery: async (r: any) => ({ ...r, count: (r.count || 0) + 1 }),
		};

		pluginRegistry.register(countIncrementingPlugin);

		const dispatcher = new Dispatcher(pluginRegistry, null!);
		const initialResult = { count: 10 };
		const modifiedResult = await dispatcher.dispatchAfterQuery(
			initialResult,
			{ hooks: null! },
			null!,
		);

		expect(modifiedResult.count).toBe(11);
	});

	it("should allow plugins to communicate via meta field", async () => {
		const pluginRegistry = new PluginRegistry();
		const metaSettingPlugin: DatrixPlugin = {
			name: "p1",
			version: "1",
			options: {},
			init: async () => {},
			destroy: async () => {},
			onBeforeQuery: async (q) => ({
				...q,
				meta: { ...q.meta, p1_data: "hello" },
			}),
		};
		const metaReadingPlugin: DatrixPlugin = {
			name: "p2",
			version: "1",
			options: {},
			init: async () => {},
			destroy: async () => {},
			onBeforeQuery: async (q) => {
				const p1Data = q.meta?.["p1_data"];
				return { ...q, table: q.table + "_" + p1Data };
			},
		};

		pluginRegistry.register(metaSettingPlugin);
		pluginRegistry.register(metaReadingPlugin);

		const dispatcher = new Dispatcher(pluginRegistry, null!);
		const initialQuery: QueryObject = { type: "select", table: "users" };
		const finalQuery = await dispatcher.dispatchBeforeQuery(
			initialQuery,
			{ hooks: null! },
			null!,
		);

		expect(finalQuery.table).toBe("users_hello");
		expect(finalQuery.meta?.["p1_data"]).toBe("hello");
	});
});
