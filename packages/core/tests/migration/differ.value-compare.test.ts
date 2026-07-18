/**
 * Schema Differ - Value-based Field Comparison
 *
 * Regression tests for issues 5.1 / 5.2: the "old" schemas come from the
 * database (JSON-serialized), so pattern / items / default are never
 * reference-equal to the in-memory definitions. Comparing by reference
 * produced endless spurious fieldModified diffs.
 */

import { describe, it, expect } from "vitest";
import { ForgeSchemaDiffer } from "../../src/migration/differ";
import { SchemaDefinition } from "../../src/types/core";

function compareFields(
	oldFields: SchemaDefinition["fields"],
	newFields: SchemaDefinition["fields"],
) {
	const differ = new ForgeSchemaDiffer();
	const oldSchema: SchemaDefinition = {
		name: "users",
		tableName: "users",
		fields: oldFields,
	};
	const newSchema: SchemaDefinition = {
		name: "users",
		tableName: "users",
		fields: newFields,
	};
	return differ.compare({ users: oldSchema }, { users: newSchema });
}

describe("SchemaDiffer - value-based comparison (regression)", () => {
	it("should not report equal RegExp patterns as modified", () => {
		const comparison = compareFields(
			{ email: { type: "string", pattern: /^\S+@\S+$/ } },
			{ email: { type: "string", pattern: /^\S+@\S+$/ } },
		);
		expect(comparison.hasChanges).toBe(false);
	});

	it("should not report a JSON-degraded pattern ({}) as modified", () => {
		// A RegExp that went through JSON.stringify/parse becomes {}
		const degraded = JSON.parse(JSON.stringify({ p: /^\S+@\S+$/ })).p;
		const comparison = compareFields(
			{ email: { type: "string", pattern: degraded } },
			{ email: { type: "string", pattern: /^\S+@\S+$/ } },
		);
		expect(comparison.hasChanges).toBe(false);
	});

	it("should report genuinely different patterns as modified", () => {
		const comparison = compareFields(
			{ email: { type: "string", pattern: /^a$/ } },
			{ email: { type: "string", pattern: /^b$/ } },
		);
		expect(comparison.hasChanges).toBe(true);
	});

	it("should not report structurally equal array items as modified", () => {
		const comparison = compareFields(
			{ tags: { type: "array", items: { type: "string", maxLength: 10 } } },
			{ tags: { type: "array", items: { type: "string", maxLength: 10 } } },
		);
		expect(comparison.hasChanges).toBe(false);
	});

	it("should not report structurally equal object defaults as modified", () => {
		const comparison = compareFields(
			{ meta: { type: "json", default: { a: 1 } } },
			{ meta: { type: "json", default: { a: 1 } } },
		);
		expect(comparison.hasChanges).toBe(false);
	});

	it("should never report function defaults as modified", () => {
		const comparison = compareFields(
			// DB side: function default was dropped by JSON serialization
			{ createdBy: { type: "string" } },
			{ createdBy: { type: "string", default: () => "system" } },
		);
		expect(comparison.hasChanges).toBe(false);
	});

	it("should treat required: undefined and required: false as equal", () => {
		const comparison = compareFields(
			{ bio: { type: "string", required: false } },
			{ bio: { type: "string" } },
		);
		expect(comparison.hasChanges).toBe(false);
	});

	it("should treat unique: undefined and unique: false as equal", () => {
		const comparison = compareFields(
			{ bio: { type: "string", unique: false } },
			{ bio: { type: "string" } },
		);
		expect(comparison.hasChanges).toBe(false);
	});
});
