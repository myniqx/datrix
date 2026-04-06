/**
 * Schema Differ Tests (Error Path)
 *
 * Tests error handling for malformed inputs to the schema differ.
 *
 * NOTE: The differ's job is to compare two valid schemas and detect differences.
 * Schema validity (field types, index integrity, circular refs, etc.) is enforced
 * by Datrix's type system at definition time — the differ does NOT re-validate schemas.
 * These tests only cover genuine runtime risks: null/undefined/non-object inputs.
 */

import { describe, it, expect } from "vitest";
import { ForgeSchemaDiffer } from "../../src/migration/differ";
import { SchemaDefinition } from "../../src/types";
import { expectFailureError } from "../test/helpers";

describe("SchemaDiffer - Error Path", () => {
	const differ = new ForgeSchemaDiffer();

	describe("Malformed input", () => {
		it("should handle null oldSchemas", () => {
			const oldSchemas = null as unknown as Record<string, SchemaDefinition>;
			const newSchemas: Record<string, SchemaDefinition> = {};

			const error = expectFailureError(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(error.code).toBeDefined();
		});

		it("should handle null newSchemas", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = null as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(error.code).toBeDefined();
		});

		it("should handle undefined oldSchemas", () => {
			const oldSchemas = undefined as unknown as Record<
				string,
				SchemaDefinition
			>;
			const newSchemas: Record<string, SchemaDefinition> = {};

			const error = expectFailureError(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(error.code).toBeDefined();
		});

		it("should handle undefined newSchemas", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = undefined as unknown as Record<
				string,
				SchemaDefinition
			>;

			const error = expectFailureError(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(error.code).toBeDefined();
		});

		it("should handle non-object oldSchemas", () => {
			const oldSchemas = "not an object" as unknown as Record<
				string,
				SchemaDefinition
			>;
			const newSchemas: Record<string, SchemaDefinition> = {};

			const error = expectFailureError(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(error.code).toBeDefined();
		});

		it("should handle non-object newSchemas", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = "not an object" as unknown as Record<
				string,
				SchemaDefinition
			>;

			const error = expectFailureError(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(error.code).toBeDefined();
		});

		it("should handle array instead of object", () => {
			const oldSchemas = [] as unknown as Record<string, SchemaDefinition>;
			const newSchemas: Record<string, SchemaDefinition> = {};

			const error = expectFailureError(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(error.code).toBeDefined();
		});
	});

	describe("Invalid schema definitions", () => {
		it("should reject schema missing name", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				invalid: { notASchema: true },
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(error.code).toBe("DIFF_ERROR");
			expect(error.message).toContain("Invalid schema definition");
		});

		it("should reject schema missing fields property", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				users: { name: "users" },
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(error.code).toBe("DIFF_ERROR");
			expect(error.message).toContain("Invalid schema definition");
		});

		it("should reject schema with non-string name", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				users: { name: 123, fields: {} },
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(error.code).toBe("DIFF_ERROR");
			expect(error.message).toContain("Invalid schema definition");
		});

		it("should reject schema with non-object fields", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				users: { name: "users", fields: "notAnObject" },
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(error.code).toBe("DIFF_ERROR");
			expect(error.message).toContain("Invalid schema definition");
		});
	});

	describe("Consistent error structure", () => {
		it("should return consistent error format", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				invalid: { notASchema: true },
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(error).toHaveProperty("code");
			expect(error).toHaveProperty("message");
			expect(typeof error.code).toBe("string");
			expect(typeof error.message).toBe("string");
			expect(error.message.length).toBeGreaterThan(0);
		});

		it("should provide helpful error messages", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				invalid: { notASchema: true },
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(error.message).toContain("Invalid");
			expect(error.message).toContain("schema");
		});
	});

	describe("State isolation", () => {
		it("should not affect subsequent calls after error", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				invalid: { notASchema: true },
			} as unknown as Record<string, SchemaDefinition>;

			expectFailureError(() => differ.compare(oldSchemas, newSchemas));
			expectFailureError(() => differ.compare(oldSchemas, newSchemas));
			expectFailureError(() => differ.compare(oldSchemas, newSchemas));

			const error = expectFailureError(() =>
				differ.compare(oldSchemas, newSchemas),
			);
			expect(error.code).toBe("DIFF_ERROR");
		});
	});
});
