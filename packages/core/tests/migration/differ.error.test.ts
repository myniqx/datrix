/**
 * Schema Differ Tests (Error Path)
 *
 * Tests error handling for schema comparison
 */

import { describe, it, expect } from "vitest";
import { ForgeSchemaDiffer } from "../../src/migration/differ";
import { SchemaDefinition } from "../../../types/src/core/schema";
import { expectFailureError } from "../../../types/src/test/helpers";

describe("SchemaDiffer - Error Path", () => {
	const differ = new ForgeSchemaDiffer();

	describe("Invalid schema definitions", () => {
		it("should reject invalid schema without name", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				invalid: { notASchema: true },
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBe("DIFF_ERROR");
			expect(error.message).toContain("Invalid schema definition");
		});

		it("should reject schema without fields property", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				users: {
					name: "users",
					// missing fields
				},
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBe("DIFF_ERROR");
			expect(error.message).toContain("Invalid schema definition");
		});

		it("should reject schema with invalid name type", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				users: {
					name: 123,
					fields: {},
				},
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBe("DIFF_ERROR");
			expect(error.message).toContain("Invalid schema definition");
		});

		it("should reject schema with non-object fields", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				users: {
					name: "users",
					fields: "notAnObject",
				},
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBe("DIFF_ERROR");
			expect(error.message).toContain("Invalid schema definition");
		});
	});

	describe("Invalid field definitions", () => {
		it("should reject null field definitions", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				users: {
					name: "users",
					fields: {
						bad: null,
					},
				},
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});

		it("should reject undefined field definitions", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				users: {
					name: "users",
					fields: {
						bad: undefined,
					},
				},
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});

		it("should reject field definition without type", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				users: {
					name: "users",
					fields: {
						bad: { required: true },
					},
				},
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});

		it("should reject field definition with invalid type value", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				users: {
					name: "users",
					fields: {
						bad: { type: 123 },
					},
				},
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});
	});

	describe("Invalid index definitions", () => {
		it("should reject index without fields array", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				users: {
					name: "users",
					fields: {
						email: { type: "string" },
					},
					indexes: [{ unique: true }],
				},
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});

		it("should reject index with empty fields array", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				users: {
					name: "users",
					fields: {
						email: { type: "string" },
					},
					indexes: [{ fields: [], unique: true }],
				},
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});

		it("should reject index with non-string fields", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				users: {
					name: "users",
					fields: {
						email: { type: "string" },
					},
					indexes: [{ fields: [123, 456], unique: true }],
				},
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});

		it("should reject index with invalid type property", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				users: {
					name: "users",
					fields: {
						email: { type: "string" },
					},
					indexes: [{ fields: ["email"], type: "invalid" }],
				},
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});
	});

	describe("Malformed input", () => {
		it("should handle null oldSchemas", () => {
			const oldSchemas = null as unknown as Record<string, SchemaDefinition>;
			const newSchemas: Record<string, SchemaDefinition> = {};

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});

		it("should handle null newSchemas", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = null as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});

		it("should handle undefined oldSchemas", () => {
			const oldSchemas = undefined as unknown as Record<
				string,
				SchemaDefinition
			>;
			const newSchemas: Record<string, SchemaDefinition> = {};

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});

		it("should handle undefined newSchemas", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = undefined as unknown as Record<
				string,
				SchemaDefinition
			>;

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});

		it("should handle non-object oldSchemas", () => {
			const oldSchemas = "not an object" as unknown as Record<
				string,
				SchemaDefinition
			>;
			const newSchemas: Record<string, SchemaDefinition> = {};

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});

		it("should handle non-object newSchemas", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = "not an object" as unknown as Record<
				string,
				SchemaDefinition
			>;

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});

		it("should handle array instead of object", () => {
			const oldSchemas = [] as unknown as Record<string, SchemaDefinition>;
			const newSchemas: Record<string, SchemaDefinition> = {};

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});
	});

	describe("Field reference errors", () => {
		it("should reject index referencing non-existent field", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						email: { type: "string" },
					},
					indexes: [{ fields: ["nonExistentField"], unique: true }],
				},
			};

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});

		it("should reject composite index with some non-existent fields", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						email: { type: "string" },
					},
					indexes: [{ fields: ["email", "nonExistent"], unique: true }],
				},
			};

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});
	});

	describe("Circular schema references", () => {
		it("should handle circular schema references", () => {
			const circularSchema: any = {
				name: "users",
				fields: {
					id: { type: "number" },
				},
			};
			circularSchema.self = circularSchema;

			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				users: circularSchema,
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});

		it("should handle deeply nested circular references", () => {
			const circularField: any = { type: "object" };
			circularField.properties = { nested: circularField };

			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				users: {
					name: "users",
					fields: {
						data: circularField,
					},
				},
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

			expect(error.code).toBeDefined();
		});
	});

	describe("Consistent error structure", () => {
		it("should return consistent error format", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas = {
				invalid: { notASchema: true },
			} as unknown as Record<string, SchemaDefinition>;

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

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

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));

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

			expectFailureError(differ.compare(oldSchemas, newSchemas));
			expectFailureError(differ.compare(oldSchemas, newSchemas));
			expectFailureError(differ.compare(oldSchemas, newSchemas));

			const error = expectFailureError(differ.compare(oldSchemas, newSchemas));
			expect(error.code).toBe("DIFF_ERROR");
		});
	});
});
