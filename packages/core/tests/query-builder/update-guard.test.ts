/**
 * Query Builder - UPDATE without WHERE guard
 *
 * core Issue 12: DELETE was guarded against a missing WHERE (would wipe the
 * whole table), but UPDATE was not. Now both throw when `.where()` is never
 * called; `.where({})` remains the explicit opt-in for an intentional
 * full-table update (see end-to-end/update/multi-update.test.ts for that
 * positive case via the public `datrix.updateMany` API, which always calls
 * `.where()` and therefore can never trigger this guard itself).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SchemaRegistry } from "../../src/schema";
import { SchemaDefinition } from "../../src/types/core/schema";
import { updateTable } from "../../src/query-builder/builder";

describe("Query Builder - UPDATE without WHERE guard", () => {
	let schemaRegistry: SchemaRegistry;

	beforeEach(() => {
		schemaRegistry = new SchemaRegistry({
			strict: true,
			allowOverwrite: false,
			validateRelations: true,
		});

		const userSchema: SchemaDefinition = {
			name: "User",
			fields: {
				email: { type: "string", required: true },
				name: { type: "string" },
			},
		};
		schemaRegistry.register(userSchema);
		schemaRegistry.finalizeRegistry();
	});

	it("throws when build() is called without ever calling .where()", () => {
		expect(() =>
			updateTable("User", { name: "Changed" }, schemaRegistry).build(),
		).toThrow();
	});

	it("does not throw when .where({}) opts into a full-table update", () => {
		expect(() =>
			updateTable("User", { name: "Changed" }, schemaRegistry)
				.where({})
				.build(),
		).not.toThrow();
	});

	it("does not throw when .where() is called with real conditions", () => {
		expect(() =>
			updateTable("User", { name: "Changed" }, schemaRegistry)
				.where({ email: "a@test.com" })
				.build(),
		).not.toThrow();
	});
});
