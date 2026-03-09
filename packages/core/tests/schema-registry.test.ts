/**
 * Core - Schema Registry Tests - Happy Path
 *
 * Tests the SchemaRegistry implementation:
 * - Registration and retrieval
 * - Pluralization (table name generation)
 * - Locking mechanism
 * - Relation tracking
 * - JSON Import/Export
 */

import { SchemaRegistry } from "../src";
import { SchemaDefinition } from "../../types/src/core/schema";
import { describe, it, expect, beforeEach } from "vitest";

describe("Core - Schema Registry - Happy Path", () => {
	let schemaRegistry: SchemaRegistry;

	beforeEach(() => {
		schemaRegistry = new SchemaRegistry({
			strict: true,
			allowOverwrite: false,
			validateRelations: true,
		});
	});

	describe("Registration", () => {
		it("should register a valid schema", () => {
			const userSchema: SchemaDefinition = {
				name: "User",
				fields: {
					email: { type: "string", required: true, unique: true },
				},
			};

			const registeredSchema = schemaRegistry.register(userSchema);

			expect(registeredSchema).toBeDefined();
			expect(schemaRegistry.has("User")).toBe(true);
			expect(registeredSchema.name).toBe("User");
			expect(registeredSchema.tableName).toBe("users");
		});

		it("should allow overwrite if configured", () => {
			const overwriteAllowedRegistry = new SchemaRegistry({
				allowOverwrite: true,
				strict: false,
				validateRelations: false,
			});
			const firstUserSchema: any = {
				name: "User",
				fields: { a: { type: "string" } },
			};
			const secondUserSchema: any = {
				name: "User",
				fields: { b: { type: "string" } },
			};

			overwriteAllowedRegistry.register(firstUserSchema);
			const overwrittenSchema =
				overwriteAllowedRegistry.register(secondUserSchema);

			const { tableName, ...rest } = overwrittenSchema;
			expect(rest.fields.b).toBeDefined();
			expect(rest.fields.a).toBeUndefined();
		});
	});

	describe("Pluralization", () => {
		it("should generate correct pluralized table names", () => {
			const pluralizationTests = [
				{ name: "User", expected: "users" },
				{ name: "Category", expected: "categories" },
				{ name: "Bus", expected: "buses" },
				{ name: "Person", expected: "people" },
				{ name: "Leaf", expected: "leaves" },
				{ name: "Hero", expected: "heroes" },
				{ name: "Status", expected: "statuses" },
			];

			for (const { name, expected } of pluralizationTests) {
				schemaRegistry.register({ name, fields: { sid: { type: "string" } } });
				const schema = schemaRegistry.get(name);
				expect(schema?.tableName).toBe(expected);
			}
		});

		it("should respect custom table names", () => {
			const customTableSchema: SchemaDefinition = {
				name: "Custom",
				tableName: "my_table",
				fields: { sid: { type: "string" } },
			};

			schemaRegistry.register(customTableSchema);

			const schema = schemaRegistry.get("Custom");
			expect(schema?.tableName).toBe("my_table");
		});
	});

	describe("Locking", () => {
		it("should allow modifications after unlocking", () => {
			schemaRegistry.lock();
			schemaRegistry.unlock();

			expect(schemaRegistry.isLocked()).toBe(false);

			const testSchema: SchemaDefinition = {
				name: "Test",
				fields: { sid: { type: "string" } },
			};
			const registeredSchema = schemaRegistry.register(testSchema);
			expect(registeredSchema).toBeDefined();
		});
	});

	describe("Relations", () => {
		it("should track related and referencing schemas", () => {
			const userSchema: SchemaDefinition = {
				name: "User",
				fields: { sid: { type: "string" } },
			};
			const postSchema: SchemaDefinition = {
				name: "Post",
				fields: {
					author: { type: "relation", model: "User", kind: "belongsTo" },
				},
			};

			schemaRegistry.registerMany([userSchema, postSchema]);

			const relatedSchemas = schemaRegistry.getRelatedSchemas("Post");
			const referencingSchemas = schemaRegistry.getReferencingSchemas("User");
			const schemasWithRelations = schemaRegistry.getSchemasWithRelations();

			expect(relatedSchemas).toContain("User");
			expect(referencingSchemas).toContain("Post");
			expect(schemasWithRelations).toHaveLength(1);
		});
	});

	describe("JSON Import/Export", () => {
		it("should export and import schemas correctly", () => {
			const userSchema: SchemaDefinition = {
				name: "User",
				fields: { sid: { type: "string" } },
			};
			schemaRegistry.register(userSchema);

			const exportedJson = schemaRegistry.toJSON();
			const { tableName, ...rest } = exportedJson["User"];
			// toJSON strips auto-injected fields (id, createdAt, updatedAt)
			expect(rest).toEqual(userSchema);

			const newSchemaRegistry = new SchemaRegistry();
			newSchemaRegistry.fromJSON(exportedJson);
			expect(newSchemaRegistry.has("User")).toBe(true);
		});
	});
});
