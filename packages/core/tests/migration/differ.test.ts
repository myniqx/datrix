/**
 * Schema Differ Tests (Happy Path)
 *
 * Tests successful schema comparison and difference detection
 */

import { describe, it, expect } from "vitest";
import { ForgeSchemaDiffer } from "../../src/migration/differ";
import { SchemaDefinition } from "../../src/types/core";
import { parserTestData } from "../test/fixtures";
import { expectSuccessData } from "../test/helpers";

describe("SchemaDiffer - Happy Path", () => {
	const differ = new ForgeSchemaDiffer();
	const schemas = parserTestData.migrationSchemas;

	describe("No changes", () => {
		it("should return no changes for identical schemas", () => {
			const schemasObj = { users: schemas.usersBasic };

			const comparison = expectSuccessData(() =>
				differ.compare(schemasObj, schemasObj),
			);

			expect(comparison.hasChanges).toBe(false);
			expect(comparison.differences).toHaveLength(0);
		});

		it("should handle empty schema collections", () => {
			const comparison = expectSuccessData(() => differ.compare({}, {}));

			expect(comparison.hasChanges).toBe(false);
			expect(comparison.differences).toHaveLength(0);
		});
	});

	describe("Table detection", () => {
		it("should detect newly added tables", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas: Record<string, SchemaDefinition> = {
				users: schemas.usersBasic,
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			expect(comparison.differences).toHaveLength(1);

			const diff = comparison.differences[0]!;
			expect(diff.type).toBe("tableAdded");
			if (diff.type === "tableAdded") {
				expect(diff.schema.name).toBe("users");
			}
		});

		it("should detect removed tables", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				users: schemas.usersBasic,
			};
			const newSchemas: Record<string, SchemaDefinition> = {};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			expect(comparison.differences).toHaveLength(1);

			const diff = comparison.differences[0];
			expect(diff.type).toBe("tableRemoved");
			if (diff.type === "tableRemoved") {
				expect(diff.tableName).toBe("users");
			}
		});

		it("should detect multiple table changes", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				users: schemas.usersBasic,
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				posts: schemas.postsBasic,
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			expect(comparison.differences).toHaveLength(2);

			const types = comparison.differences.map((d) => d.type);
			expect(types).toContain("tableAdded");
			expect(types).toContain("tableRemoved");
		});

		it("should handle adding table with no fields", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {};
			const newSchemas: Record<string, SchemaDefinition> = {
				empty: schemas.emptySchema,
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			const tableAdded = comparison.differences.find(
				(d) => d.type === "tableAdded",
			);
			expect(tableAdded).toBeDefined();
			if (tableAdded && tableAdded.type === "tableAdded") {
				expect(tableAdded.schema.name).toBe("empty");
				expect(Object.keys(tableAdded.schema.fields)).toHaveLength(0);
			}
		});

		it("should handle removing table with no fields", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				empty: schemas.emptySchema,
			};
			const newSchemas: Record<string, SchemaDefinition> = {};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			const tableRemoved = comparison.differences.find(
				(d) => d.type === "tableRemoved",
			);
			expect(tableRemoved).toBeDefined();
			if (tableRemoved && tableRemoved.type === "tableRemoved") {
				expect(tableRemoved.tableName).toBe("empty");
			}
		});
	});

	describe("Field detection", () => {
		it("should detect newly added fields", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				users: schemas.usersBasic,
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				users: schemas.usersWithEmail,
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);

			const fieldDiff = comparison.differences.find(
				(d) => d.type === "fieldAdded",
			);
			expect(fieldDiff).toBeDefined();
			if (fieldDiff && fieldDiff.type === "fieldAdded") {
				expect(fieldDiff.tableName).toBe("users");
				expect(fieldDiff.fieldName).toBe("email");
				expect(fieldDiff.definition.type).toBe("string");
			}
		});

		it("should detect removed fields", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				users: schemas.usersWithEmail,
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				users: schemas.usersBasic,
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			const fieldDiff = comparison.differences.find(
				(d) => d.type === "fieldRemoved",
			);
			expect(fieldDiff).toBeDefined();
			if (fieldDiff && fieldDiff.type === "fieldRemoved") {
				expect(fieldDiff.tableName).toBe("users");
				expect(fieldDiff.fieldName).toBe("email");
			}
		});

		it("should detect modified fields", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				users: schemas.usersAgeOptional,
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				users: schemas.usersAgeRequired,
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			const fieldDiff = comparison.differences.find(
				(d) => d.type === "fieldModified",
			);
			expect(fieldDiff).toBeDefined();
			if (fieldDiff && fieldDiff.type === "fieldModified") {
				expect(fieldDiff.tableName).toBe("users");
				expect(fieldDiff.fieldName).toBe("age");
				expect(fieldDiff.oldDefinition.required).toBe(false);
				expect(fieldDiff.newDefinition.required).toBe(true);
			}
		});

		it("should detect multiple field changes in same table", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						id: { type: "number", required: true },
						name: { type: "string", required: true },
						age: { type: "number" },
					},
				},
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						id: { type: "number", required: true },
						email: { type: "string", required: true },
						age: { type: "number", min: 18 },
					},
				},
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);

			const types = comparison.differences.map((d) => d.type);
			expect(types).toContain("fieldAdded");
			expect(types).toContain("fieldRemoved");
			expect(types).toContain("fieldModified");
		});
	});

	describe("Field modification detection", () => {
		it("should detect type changes", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						status: { type: "string" },
					},
				},
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						status: { type: "boolean" },
					},
				},
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			const fieldDiff = comparison.differences.find(
				(d) => d.type === "fieldModified",
			);
			expect(fieldDiff).toBeDefined();
			if (fieldDiff && fieldDiff.type === "fieldModified") {
				expect(fieldDiff.oldDefinition.type).toBe("string");
				expect(fieldDiff.newDefinition.type).toBe("boolean");
			}
		});

		it("should detect string constraint changes", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				users: schemas.usersWithConstraints,
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				users: schemas.usersWithDifferentConstraints,
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			const fieldDiff = comparison.differences.find(
				(d) => d.type === "fieldModified",
			);
			expect(fieldDiff).toBeDefined();
			if (fieldDiff && fieldDiff.type === "fieldModified") {
				expect(fieldDiff.fieldName).toBe("username");
				expect(fieldDiff.oldDefinition).toMatchObject({
					type: "string",
					minLength: 3,
					maxLength: 20,
				});
				expect(fieldDiff.newDefinition).toMatchObject({
					type: "string",
					minLength: 5,
					maxLength: 50,
				});
			}
		});

		it("should detect number constraint changes", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				products: {
					name: "products",
					fields: {
						price: { type: "number", min: 0, max: 1000 },
					},
				},
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				products: {
					name: "products",
					fields: {
						price: { type: "number", min: 10, max: 5000, integer: true },
					},
				},
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			const fieldDiff = comparison.differences.find(
				(d) => d.type === "fieldModified",
			);
			expect(fieldDiff).toBeDefined();
			if (fieldDiff && fieldDiff.type === "fieldModified") {
				const oldDef = fieldDiff.oldDefinition;
				const newDef = fieldDiff.newDefinition;

				if (oldDef.type === "number" && newDef.type === "number") {
					expect(oldDef.min).toBe(0);
					expect(oldDef.max).toBe(1000);
					expect(oldDef.integer).toBeUndefined();

					expect(newDef.min).toBe(10);
					expect(newDef.max).toBe(5000);
					expect(newDef.integer).toBe(true);
				}
			}
		});

		it("should detect enum values changes", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						role: { type: "enum", values: ["user", "admin"] as const },
					},
				},
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						role: {
							type: "enum",
							values: ["user", "admin", "moderator"] as const,
						},
					},
				},
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			const fieldDiff = comparison.differences.find(
				(d) => d.type === "fieldModified",
			);
			expect(fieldDiff).toBeDefined();
			if (fieldDiff && fieldDiff.type === "fieldModified") {
				const oldDef = fieldDiff.oldDefinition;
				const newDef = fieldDiff.newDefinition;

				if (oldDef.type === "enum" && newDef.type === "enum") {
					expect(oldDef.values).toEqual(["user", "admin"]);
					expect(newDef.values).toEqual(["user", "admin", "moderator"]);
				}
			}
		});

		it("should detect array item type changes", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				posts: {
					name: "posts",
					fields: {
						tags: {
							type: "array",
							items: { type: "string", minLength: 2 },
						},
					},
				},
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				posts: {
					name: "posts",
					fields: {
						tags: {
							type: "array",
							items: { type: "string", minLength: 5, maxLength: 20 },
						},
					},
				},
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			const fieldDiff = comparison.differences.find(
				(d) => d.type === "fieldModified",
			);
			expect(fieldDiff).toBeDefined();
			if (fieldDiff && fieldDiff.type === "fieldModified") {
				const oldDef = fieldDiff.oldDefinition;
				const newDef = fieldDiff.newDefinition;

				if (oldDef.type === "array" && newDef.type === "array") {
					if (
						oldDef.items.type === "string" &&
						newDef.items.type === "string"
					) {
						expect(oldDef.items.minLength).toBe(2);
						expect(newDef.items.minLength).toBe(5);
						expect(newDef.items.maxLength).toBe(20);
					}
				}
			}
		});

		it("should detect array constraint changes", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				posts: {
					name: "posts",
					fields: {
						tags: {
							type: "array",
							items: { type: "string" },
							minItems: 1,
						},
					},
				},
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				posts: {
					name: "posts",
					fields: {
						tags: {
							type: "array",
							items: { type: "string" },
							minItems: 2,
							maxItems: 10,
							unique: true,
						},
					},
				},
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			const fieldDiff = comparison.differences.find(
				(d) => d.type === "fieldModified",
			);
			expect(fieldDiff).toBeDefined();
			if (fieldDiff && fieldDiff.type === "fieldModified") {
				const oldDef = fieldDiff.oldDefinition;
				const newDef = fieldDiff.newDefinition;

				if (oldDef.type === "array" && newDef.type === "array") {
					expect(oldDef.minItems).toBe(1);
					expect(oldDef.maxItems).toBeUndefined();
					expect(oldDef.unique).toBeUndefined();

					expect(newDef.minItems).toBe(2);
					expect(newDef.maxItems).toBe(10);
					expect(newDef.unique).toBe(true);
				}
			}
		});

		it("should detect relation field changes", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				posts: {
					name: "posts",
					fields: {
						author: {
							type: "relation",
							model: "User",
							kind: "belongsTo",
							foreignKey: "userId",
						},
					},
				},
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				posts: {
					name: "posts",
					fields: {
						author: {
							type: "relation",
							model: "Account",
							kind: "belongsTo",
							foreignKey: "accountId",
						},
					},
				},
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			const fieldDiff = comparison.differences.find(
				(d) => d.type === "fieldModified",
			);
			expect(fieldDiff).toBeDefined();
			if (fieldDiff && fieldDiff.type === "fieldModified") {
				const oldDef = fieldDiff.oldDefinition;
				const newDef = fieldDiff.newDefinition;

				if (oldDef.type === "relation" && newDef.type === "relation") {
					expect(oldDef.model).toBe("User");
					expect(oldDef.foreignKey).toBe("userId");

					expect(newDef.model).toBe("Account");
					expect(newDef.foreignKey).toBe("accountId");
				}
			}
		});

		it("should detect default value changes", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						status: { type: "string", default: "pending" },
					},
				},
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						status: { type: "string", default: "active" },
					},
				},
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			const fieldDiff = comparison.differences.find(
				(d) => d.type === "fieldModified",
			);
			expect(fieldDiff).toBeDefined();
			if (fieldDiff && fieldDiff.type === "fieldModified") {
				expect(fieldDiff.oldDefinition.default).toBe("pending");
				expect(fieldDiff.newDefinition.default).toBe("active");
			}
		});

		it("should detect unique constraint addition", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						email: { type: "string", required: true },
					},
				},
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						email: { type: "string", required: true, unique: true },
					},
				},
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);

			const fieldDiff = comparison.differences.find(
				(d) => d.type === "fieldModified",
			);
			const indexDiff = comparison.differences.find(
				(d) => d.type === "indexAdded",
			);

			// At least one should be detected
			expect(fieldDiff !== undefined || indexDiff !== undefined).toBe(true);

			if (fieldDiff && fieldDiff.type === "fieldModified") {
				expect(fieldDiff.oldDefinition.unique).toBeUndefined();
				expect(fieldDiff.newDefinition.unique).toBe(true);
			}

			if (indexDiff && indexDiff.type === "indexAdded") {
				expect(indexDiff.tableName).toBe("users");
				expect(indexDiff.index.unique).toBe(true);
			}
		});
	});

	describe("Index detection", () => {
		it("should detect newly added indexes", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				users: schemas.usersBasic,
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				users: schemas.usersWithIndex,
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			const indexDiff = comparison.differences.find(
				(d) => d.type === "indexAdded",
			);
			expect(indexDiff).toBeDefined();
			if (indexDiff && indexDiff.type === "indexAdded") {
				expect(indexDiff.tableName).toBe("users");
				expect(indexDiff.index.fields).toEqual(["email"]);
				expect(indexDiff.index.unique).toBe(true);
			}
		});

		it("should detect removed indexes", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						email: { type: "string", required: true },
					},
					indexes: [{ fields: ["email"], unique: true, name: "email_idx" }],
				},
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						email: { type: "string", required: true },
					},
				},
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			const indexDiff = comparison.differences.find(
				(d) => d.type === "indexRemoved",
			);
			expect(indexDiff).toBeDefined();
			if (indexDiff && indexDiff.type === "indexRemoved") {
				expect(indexDiff.tableName).toBe("users");
				expect(indexDiff.indexName).toBe("email_idx");
			}
		});

		it("should detect multiple indexes added to same table", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						email: { type: "string" },
						username: { type: "string" },
					},
				},
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						email: { type: "string" },
						username: { type: "string" },
					},
					indexes: [
						{ fields: ["email"], unique: true, name: "email_idx" },
						{ fields: ["username"], unique: true, name: "username_idx" },
						{ fields: ["email", "username"], name: "composite_idx" },
					],
				},
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			const indexAdded = comparison.differences.filter(
				(d) => d.type === "indexAdded",
			);
			expect(indexAdded).toHaveLength(3);

			const emailIdx = indexAdded.find(
				(d) => d.type === "indexAdded" && d.index.name === "email_idx",
			);
			expect(emailIdx).toBeDefined();
			if (emailIdx && emailIdx.type === "indexAdded") {
				expect(emailIdx.index.fields).toEqual(["email"]);
				expect(emailIdx.index.unique).toBe(true);
			}

			const compositeIdx = indexAdded.find(
				(d) => d.type === "indexAdded" && d.index.name === "composite_idx",
			);
			expect(compositeIdx).toBeDefined();
			if (compositeIdx && compositeIdx.type === "indexAdded") {
				expect(compositeIdx.index.fields).toEqual(["email", "username"]);
				expect(compositeIdx.index.unique).toBeUndefined();
			}
		});

		it("should handle index without name", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						email: { type: "string" },
					},
				},
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						email: { type: "string" },
					},
					indexes: [{ fields: ["email"], unique: true }],
				},
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);
			const indexAdded = comparison.differences.find(
				(d) => d.type === "indexAdded",
			);
			expect(indexAdded).toBeDefined();
		});
	});

	describe("Complex scenarios", () => {
		it("should detect all changes in complex scenario", () => {
			const oldSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						id: { type: "number", required: true },
						username: { type: "string", minLength: 3 },
						email: { type: "string", required: true },
					},
				},
				posts: schemas.postsBasic,
			};
			const newSchemas: Record<string, SchemaDefinition> = {
				users: {
					name: "users",
					fields: {
						id: { type: "number", required: true },
						username: { type: "string", minLength: 5 },
						displayName: { type: "string" },
					},
				},
				comments: schemas.commentsBasic,
			};

			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(comparison.hasChanges).toBe(true);

			const types = comparison.differences.map((d) => d.type);

			// Tables
			expect(types.filter((t) => t === "tableAdded")).toHaveLength(1);
			expect(types.filter((t) => t === "tableRemoved")).toHaveLength(1);

			// Fields
			expect(types.filter((t) => t === "fieldAdded")).toHaveLength(1);
			expect(types.filter((t) => t === "fieldRemoved")).toHaveLength(1);
			expect(types.filter((t) => t === "fieldModified")).toHaveLength(1);

			// Verify specific changes
			const tableAdded = comparison.differences.find(
				(d) => d.type === "tableAdded" && d.schema.name === "comments",
			);
			expect(tableAdded).toBeDefined();

			const tableRemoved = comparison.differences.find(
				(d) => d.type === "tableRemoved" && d.tableName === "posts",
			);
			expect(tableRemoved).toBeDefined();

			const fieldAdded = comparison.differences.find(
				(d) =>
					d.type === "fieldAdded" &&
					d.tableName === "users" &&
					d.fieldName === "displayName",
			);
			expect(fieldAdded).toBeDefined();

			const fieldRemoved = comparison.differences.find(
				(d) =>
					d.type === "fieldRemoved" &&
					d.tableName === "users" &&
					d.fieldName === "email",
			);
			expect(fieldRemoved).toBeDefined();

			const fieldModified = comparison.differences.find(
				(d) =>
					d.type === "fieldModified" &&
					d.tableName === "users" &&
					d.fieldName === "username",
			);
			expect(fieldModified).toBeDefined();
			if (fieldModified && fieldModified.type === "fieldModified") {
				if (
					fieldModified.oldDefinition.type === "string" &&
					fieldModified.newDefinition.type === "string"
				) {
					expect(fieldModified.oldDefinition.minLength).toBe(3);
					expect(fieldModified.newDefinition.minLength).toBe(5);
				}
			}
		});
	});

	describe("isFieldModified", () => {
		it("should detect type changes", () => {
			const oldField = { type: "string" as const };
			const newField = { type: "number" as const };

			const modified = differ.isFieldModified(oldField, newField);
			expect(modified).toBe(true);
		});

		it("should detect required changes", () => {
			const oldField = { type: "string" as const, required: false };
			const newField = { type: "string" as const, required: true };

			const modified = differ.isFieldModified(oldField, newField);
			expect(modified).toBe(true);
		});

		it("should detect constraint changes", () => {
			const oldField = { type: "string" as const, minLength: 3 };
			const newField = { type: "string" as const, minLength: 5 };

			const modified = differ.isFieldModified(oldField, newField);
			expect(modified).toBe(true);
		});

		it("should return false for identical fields", () => {
			const field = { type: "string" as const, required: true, minLength: 3 };

			const modified = differ.isFieldModified(field, field);
			expect(modified).toBe(false);
		});
	});

	describe("Performance", () => {
		it("should handle very large schemas without performance issues", () => {
			const fields: Record<string, any> = {};
			for (let i = 0; i < 100; i++) {
				fields[`field${i}`] = { type: "string", required: i % 2 === 0 };
			}

			const oldSchemas: Record<string, SchemaDefinition> = {
				large: { name: "large", fields },
			};

			const newFields: Record<string, any> = {};
			for (let i = 0; i < 100; i++) {
				if (i < 50) {
					newFields[`field${i}`] = {
						type: "string",
						required: !fields[`field${i}`].required,
					};
				} else {
					newFields[`field${i}`] = fields[`field${i}`];
				}
			}

			const newSchemas: Record<string, SchemaDefinition> = {
				large: { name: "large", fields: newFields },
			};

			const startTime = Date.now();
			const comparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);
			const duration = Date.now() - startTime;

			expect(comparison.hasChanges).toBe(true);
			expect(duration).toBeLessThan(100);

			const modified = comparison.differences.filter(
				(d) => d.type === "fieldModified",
			);
			expect(modified).toHaveLength(50);
		});
	});

	describe("Determinism", () => {
		it("should return same result for identical input", () => {
			const oldSchemas = { users: schemas.usersBasic };
			const newSchemas = { users: schemas.usersWithEmail };

			const firstComparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);
			const secondComparison = expectSuccessData(() =>
				differ.compare(oldSchemas, newSchemas),
			);

			expect(firstComparison).toEqual(secondComparison);
		});
	});

	describe("Input Immutability", () => {
		it("should not mutate input objects", () => {
			const oldSchemas = { users: schemas.usersBasic };
			const newSchemas = { users: schemas.usersWithEmail };
			const oldSchemasBackup = JSON.parse(JSON.stringify(oldSchemas));
			const newSchemasBackup = JSON.parse(JSON.stringify(newSchemas));

			expectSuccessData(() => differ.compare(oldSchemas, newSchemas));

			expect(oldSchemas).toEqual(oldSchemasBackup);
			expect(newSchemas).toEqual(newSchemasBackup);
		});
	});
});
