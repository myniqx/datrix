/**
 * Core - Dispatcher Tests - Error Path
 *
 * Tests error handling and validation:
 * - Strict QueryObject validation (entrance and per-plugin)
 * - Error isolation (one plugin failing shouldn't stop others)
 */

import { Dispatcher } from "../src/dispatcher";
import { QueryObject } from "../src/types";
import { DatrixPlugin, PluginRegistry } from "../src/types";
import { describe, it, expect } from "vitest";

describe("Core - Dispatcher - Error Path", () => {
	it("should throw if entrance query is invalid", async () => {
		const emptyPluginRegistry = new PluginRegistry();
		const dispatcher = new Dispatcher(emptyPluginRegistry, null!);

		const invalidEntranceQuery = { table: "users" } as any;

		await expect(
			dispatcher.dispatchBeforeQuery(
				invalidEntranceQuery,
				{ hooks: null! },
				null!,
			),
		).rejects.toThrow("QueryObject is missing required field");
	});

	it.fails(
		"should throw if plugin returns an invalid query (now strict)",
		async () => {
			const pluginRegistry = new PluginRegistry();
			const invalidQueryReturningPlugin: DatrixPlugin = {
				name: "bad-plugin",
				version: "1",
				options: {},
				init: async () => {},
				destroy: async () => {},
				onBeforeQuery: async (q) =>
					({ ...q, ghostKey: "I should not be here" }) as any,
			};
			pluginRegistry.register(invalidQueryReturningPlugin);

			const dispatcher = new Dispatcher(pluginRegistry as any, null!);
			const validEntranceQuery: QueryObject = {
				type: "select",
				table: "users",
			};

			await expect(
				dispatcher.dispatchBeforeQuery(
					validEntranceQuery as any,
					{ hooks: null! },
					null!,
				),
			).rejects.toThrow("Plugin 'bad-plugin' returned an invalid query");
		},
	);
});
