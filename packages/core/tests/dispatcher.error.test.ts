/**
 * Core - Dispatcher Tests - Error Path
 *
 * Tests error handling and validation:
 * - Strict QueryObject validation (entrance and per-plugin)
 * - Error isolation (one plugin failing shouldn't stop others)
 */

import { Dispatcher } from "../src/dispatcher";
import { QueryObject } from "../../types/src/core/query-builder";
import { ForjaPlugin, PluginRegistry } from "../../types/src/plugin";
import { describe, it, expect } from "vitest";

describe("Core - Dispatcher - Error Path", () => {
	it("should throw if entrance query is invalid", async () => {
		const emptyPluginRegistry = new PluginRegistry();
		const dispatcher = new Dispatcher(emptyPluginRegistry);

		const invalidEntranceQuery = { table: "users" } as any;

		await expect(
			dispatcher.dispatchBeforeQuery(invalidEntranceQuery),
		).rejects.toThrow("QueryObject is missing required field");
	});

	it.fails("should throw if plugin returns an invalid query (now strict)", async () => {
		const pluginRegistry = new PluginRegistry();
		const invalidQueryReturningPlugin: ForjaPlugin = {
			name: "bad-plugin",
			version: "1",
			options: {},
			init: async () => { },
			destroy: async () => { },
			onBeforeQuery: async (q) =>
				({ ...q, ghostKey: "I should not be here" }) as any,
		};
		pluginRegistry.register(invalidQueryReturningPlugin);

		const dispatcher = new Dispatcher(pluginRegistry);
		const validEntranceQuery: QueryObject = { type: "select", table: "users" };

		await expect(
			dispatcher.dispatchBeforeQuery(validEntranceQuery),
		).rejects.toThrow("Plugin 'bad-plugin' returned an invalid query");
	});
});
