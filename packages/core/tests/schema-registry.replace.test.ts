/**
 * Core - Schema Registry - replace()
 *
 * Regression tests for issue 3.5: plugin schema extensions re-register a
 * schema that came from get(), which register() rejects (DUPLICATE_SCHEMA /
 * RESERVED_FIELD_NAME). replace() must accept it.
 */

import { SchemaRegistry } from "../src/schema";
import { SchemaDefinition } from "../src/types/core/schema";
import { describe, it, expect, beforeEach } from "vitest";

describe("Core - Schema Registry - replace()", () => {
	let registry: SchemaRegistry;

	beforeEach(() => {
		registry = new SchemaRegistry({
			strict: true,
			allowOverwrite: false,
			validateRelations: true,
		});
		registry.register({
			name: "User",
			fields: {
				email: { type: "string", required: true },
			},
		});
	});

	it("should replace a registered schema that already carries reserved fields", () => {
		// Simulate the extendSchemas flow: take the enhanced schema from get()
		// and add a field to it
		const existing = registry.get("User")!;
		expect(existing.fields["id"]).toBeDefined();
		expect(existing.fields["createdAt"]).toBeDefined();

		const extended: SchemaDefinition = {
			...existing,
			fields: {
				...existing.fields,
				nickname: { type: "string" },
			},
		};

		const replaced = registry.replace(extended);

		expect(replaced.fields["nickname"]).toBeDefined();
		expect(registry.get("User")!.fields["nickname"]).toBeDefined();
		// Reserved fields survive untouched
		expect(registry.get("User")!.fields["id"]).toBeDefined();
	});

	it("should throw SCHEMA_NOT_FOUND when replacing an unregistered schema", () => {
		expect(() =>
			registry.replace({
				name: "Ghost",
				fields: { a: { type: "string" } },
			}),
		).toThrowError(/Cannot replace unregistered schema/);
	});

	it("should throw when registry is locked", () => {
		registry.finalizeRegistry();
		registry.lock();

		const existing = registry.get("User")!;
		expect(() => registry.replace(existing)).toThrowError(/locked/i);
	});
});
