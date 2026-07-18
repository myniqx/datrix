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

import { SchemaRegistry } from "../src/schema";
import { SchemaDefinition } from "../src/types/core/schema";
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

	describe("Relation FK processing", () => {
		it("should keep the FK field on self-referential hasMany relations", () => {
			const categorySchema: SchemaDefinition = {
				name: "Category",
				fields: {
					title: { type: "string" },
					children: { type: "relation", model: "Category", kind: "hasMany" },
				},
			};

			schemaRegistry.register(categorySchema);
			schemaRegistry.finalizeRegistry();

			const schema = schemaRegistry.get("Category");
			const fkField = schema?.fields["CategoryId"] as any;
			expect(fkField).toBeDefined();
			expect(fkField.type).toBe("number");
			expect(fkField.references.table).toBe("categories");
		});

		it("should mark hasOne FK as unique", () => {
			const userSchema: SchemaDefinition = {
				name: "User",
				fields: {
					profile: { type: "relation", model: "Profile", kind: "hasOne" },
				},
			};
			const profileSchema: SchemaDefinition = {
				name: "Profile",
				fields: { bio: { type: "string" } },
			};

			schemaRegistry.registerMany([userSchema, profileSchema]);
			schemaRegistry.finalizeRegistry();

			const fkField = schemaRegistry.get("Profile")?.fields["UserId"] as any;
			expect(fkField).toBeDefined();
			expect(fkField.unique).toBe(true);

			// hasMany FK stays non-unique
			const catSchema: SchemaDefinition = {
				name: "Author",
				fields: {
					posts: { type: "relation", model: "Post", kind: "hasMany" },
				},
			};
			const postSchema: SchemaDefinition = {
				name: "Post",
				fields: { title: { type: "string" } },
			};
			schemaRegistry.registerMany([catSchema, postSchema]);
			schemaRegistry.finalizeRegistry();

			const hasManyFk = schemaRegistry.get("Post")?.fields["AuthorId"] as any;
			expect(hasManyFk.unique).toBeUndefined();
		});

		it("should use custom tableName in junction FK references", () => {
			const userSchema: SchemaDefinition = {
				name: "User",
				tableName: "app_users",
				fields: {
					tags: { type: "relation", model: "Tag", kind: "manyToMany" },
				},
			};
			const tagSchema: SchemaDefinition = {
				name: "Tag",
				fields: { label: { type: "string" } },
			};

			schemaRegistry.registerMany([userSchema, tagSchema]);
			schemaRegistry.finalizeRegistry();

			const junction = schemaRegistry.get("Tag_User");
			expect(junction).toBeDefined();
			const sourceFk = junction?.fields["UserId"] as any;
			const targetFk = junction?.fields["TagId"] as any;
			expect(sourceFk.references.table).toBe("app_users");
			expect(targetFk.references.table).toBe("tags");
		});
	});

	describe("Table name lookup", () => {
		it("should resolve models and junction tables by table name", () => {
			const userSchema: SchemaDefinition = {
				name: "User",
				tableName: "app_users",
				fields: {
					tags: { type: "relation", model: "Tag", kind: "manyToMany" },
				},
			};
			const tagSchema: SchemaDefinition = {
				name: "Tag",
				fields: { label: { type: "string" } },
			};

			schemaRegistry.registerMany([userSchema, tagSchema]);
			schemaRegistry.finalizeRegistry();

			expect(schemaRegistry.findModelByTableName("app_users")).toBe("User");
			expect(schemaRegistry.findModelByTableName("tags")).toBe("Tag");
			expect(schemaRegistry.findModelByTableName("Tag_User")).toBe("Tag_User");
			expect(schemaRegistry.findModelByTableName("missing")).toBeNull();

			// Index is invalidated when a new schema is registered
			schemaRegistry.register({
				name: "Extra",
				fields: { sid: { type: "string" } },
			});
			expect(schemaRegistry.findModelByTableName("extras")).toBe("Extra");
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

		it("should round-trip manyToMany schemas without changing junction tables", () => {
			const userSchema: SchemaDefinition = {
				name: "User",
				fields: {
					tags: { type: "relation", model: "Tag", kind: "manyToMany" },
				},
			};
			const tagSchema: SchemaDefinition = {
				name: "Tag",
				fields: { label: { type: "string" } },
			};

			schemaRegistry.registerMany([userSchema, tagSchema]);
			schemaRegistry.finalizeRegistry();

			const exportedJson = schemaRegistry.toJSON();
			// Junction schemas are derivable — they are not exported
			expect(exportedJson["Tag_User"]).toBeUndefined();

			const newSchemaRegistry = new SchemaRegistry();
			newSchemaRegistry.fromJSON(exportedJson);
			newSchemaRegistry.finalizeRegistry();

			// Junction is recreated identically, without timestamps
			const junction = newSchemaRegistry.get("Tag_User");
			expect(junction).toBeDefined();
			expect(junction?.fields["createdAt"]).toBeUndefined();
			expect(junction?.fields["updatedAt"]).toBeUndefined();
			expect(junction?.fields).toEqual(
				schemaRegistry.get("Tag_User")?.fields,
			);
		});
	});
});
