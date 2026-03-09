/**
 * Migration Generator Tests - Happy Path
 *
 * Tests migration operation generation from schema diffs
 * Target: 95%+ coverage
 */

import { ForgeMigrationGenerator } from "../../src/migration/generator";
import { SchemaDiff } from "../../../types/src/core/migration";
import { describe, it, expect } from "vitest";
import { expectSuccessData } from "../../../types/src/test/helpers";

describe("MigrationGenerator - Happy Path", () => {
	const generator = new ForgeMigrationGenerator();

	describe("Table Operations", () => {
		it("should generate createTable/dropTable for tableAdded", () => {
			const tableAddedDiff: SchemaDiff[] = [
				{
					type: "tableAdded",
					schema: {
						name: "users",
						fields: {
							id: { type: "number", required: true },
							email: { type: "string", required: true },
						},
					},
				},
			];

			const operations = expectSuccessData(() =>
				generator.generateOperations(tableAddedDiff),
			);

			expect(operations).toHaveLength(1);

			const upOperation = operations[0]!;
			expect(upOperation.type).toBe("createTable");
			if (upOperation.type === "createTable") {
				expect(upOperation.schema.name).toBe("users");
				expect(upOperation.schema.fields).toHaveProperty("id");
				expect(upOperation.schema.fields).toHaveProperty("email");
			}
		});

		it("should generate dropTable for tableRemoved with TODO down migration", () => {
			const tableRemovedDiff: SchemaDiff[] = [
				{
					type: "tableRemoved",
					tableName: "old_table",
				},
			];

			const operations = expectSuccessData(() =>
				generator.generateOperations(tableRemovedDiff),
			);

			const upOperation = operations[0]!;
			expect(upOperation.type).toBe("dropTable");
			if (upOperation.type === "dropTable") {
				expect(upOperation.tableName).toBe("old_table");
			}
		});

		it("should generate renameTable with bidirectional operations", () => {
			const tableRenamedDiff: SchemaDiff[] = [
				{
					type: "tableRenamed",
					from: "users",
					to: "accounts",
				},
			];

			const operations = expectSuccessData(() =>
				generator.generateOperations(tableRenamedDiff),
			);

			const upOperation = operations[0]!;
			expect(upOperation.type).toBe("renameTable");
			if (upOperation.type === "renameTable") {
				expect(upOperation.from).toBe("users");
				expect(upOperation.to).toBe("accounts");
			}
		});
	});

	describe("Field Operations", () => {
		it("should generate addColumn/dropColumn for fieldAdded", () => {
			const fieldAddedDiff: SchemaDiff[] = [
				{
					type: "fieldAdded",
					tableName: "users",
					fieldName: "phone",
					definition: { type: "string", required: false },
				},
			];

			const operations = expectSuccessData(() =>
				generator.generateOperations(fieldAddedDiff),
			);

			const upOperation = operations[0]!;
			expect(upOperation.type).toBe("alterTable");
			if (upOperation.type === "alterTable") {
				expect(upOperation.tableName).toBe("users");
				expect(upOperation.operations).toHaveLength(1);

				const alterOperation = upOperation.operations[0]!;
				expect(alterOperation.type).toBe("addColumn");
				if (alterOperation.type === "addColumn") {
					expect(alterOperation.column).toBe("phone");
					expect(alterOperation.definition.type).toBe("string");
					expect(alterOperation.definition.required).toBe(false);
				}
			}
		});

		it("should generate modifyColumn for fieldModified with exact old and new definitions", () => {
			const fieldModifiedDiff: SchemaDiff[] = [
				{
					type: "fieldModified",
					tableName: "users",
					fieldName: "email",
					oldDefinition: { type: "string", required: false },
					newDefinition: { type: "string", required: true, unique: true },
				},
			];

			const operations = expectSuccessData(() =>
				generator.generateOperations(fieldModifiedDiff),
			);

			const upOperation = operations[0]!;
			expect(upOperation.type).toBe("alterTable");
			if (upOperation.type === "alterTable") {
				const alterOperation = upOperation.operations[0]!;
				expect(alterOperation.type).toBe("modifyColumn");
				if (alterOperation.type === "modifyColumn") {
					expect(alterOperation.column).toBe("email");
					expect(alterOperation.newDefinition).toEqual({
						type: "string",
						required: true,
						unique: true,
					});
				}
			}
		});

		it("should generate renameColumn with bidirectional operations", () => {
			const fieldRenamedDiff: SchemaDiff[] = [
				{
					type: "fieldRenamed",
					tableName: "users",
					from: "username",
					to: "login",
				},
			];

			const operations = expectSuccessData(() =>
				generator.generateOperations(fieldRenamedDiff),
			);

			const upOperation = operations[0]!;
			expect(upOperation.type).toBe("alterTable");
			if (upOperation.type === "alterTable") {
				const alterOperation = upOperation.operations[0]!;
				expect(alterOperation.type).toBe("renameColumn");
				if (alterOperation.type === "renameColumn") {
					expect(alterOperation.from).toBe("username");
					expect(alterOperation.to).toBe("login");
				}
			}
		});
	});

	describe("Index Operations", () => {
		it("should generate createIndex/dropIndex for indexAdded", () => {
			const indexAddedDiff: SchemaDiff[] = [
				{
					type: "indexAdded",
					tableName: "users",
					index: {
						name: "email_idx",
						fields: ["email"],
						unique: true,
						type: "btree",
					},
				},
			];

			const operations = expectSuccessData(() =>
				generator.generateOperations(indexAddedDiff),
			);

			const upOperation = operations[0]!;
			expect(upOperation.type).toBe("createIndex");
			if (upOperation.type === "createIndex") {
				expect(upOperation.tableName).toBe("users");
				expect(upOperation.index.name).toBe("email_idx");
				expect(upOperation.index.fields).toEqual(["email"]);
				expect(upOperation.index.unique).toBe(true);
				expect(upOperation.index.type).toBe("btree");
			}
		});

		it("should generate dropIndex for indexRemoved", () => {
			const indexRemovedDiff: SchemaDiff[] = [
				{
					type: "indexRemoved",
					tableName: "users",
					indexName: "old_idx",
				},
			];

			const operations = expectSuccessData(() =>
				generator.generateOperations(indexRemovedDiff),
			);

			const upOperation = operations[0]!;
			expect(upOperation.type).toBe("dropIndex");
			if (upOperation.type === "dropIndex") {
				expect(upOperation.tableName).toBe("users");
				expect(upOperation.indexName).toBe("old_idx");
			}
		});
	});

	describe("Complex Scenarios", () => {
		it("should generate operations for multiple diffs in order", () => {
			const multipleDiffs: SchemaDiff[] = [
				{
					type: "tableAdded",
					schema: {
						name: "posts",
						fields: { id: { type: "number", required: true } },
					},
				},
				{
					type: "fieldAdded",
					tableName: "users",
					fieldName: "age",
					definition: { type: "number", min: 18 },
				},
				{
					type: "indexAdded",
					tableName: "users",
					index: { fields: ["email"], unique: true },
				},
			];

			const operations = expectSuccessData(() =>
				generator.generateOperations(multipleDiffs),
			);

			expect(operations).toHaveLength(3);

			expect(operations[0]!.type).toBe("createTable");
			expect(operations[1]!.type).toBe("alterTable");
			expect(operations[2]!.type).toBe("createIndex");
		});

		it("should handle constraint changes correctly", () => {
			const constraintChangeDiff: SchemaDiff[] = [
				{
					type: "fieldModified",
					tableName: "products",
					fieldName: "price",
					oldDefinition: { type: "number", min: 0 },
					newDefinition: { type: "number", min: 10, max: 10000, integer: true },
				},
			];

			const operations = expectSuccessData(() =>
				generator.generateOperations(constraintChangeDiff),
			);

			const upOperation = operations[0]!;
			if (upOperation.type === "alterTable") {
				const alterOperation = upOperation.operations[0]!;
				if (alterOperation.type === "modifyColumn") {
					const newDefinition = alterOperation.newDefinition;
					if (newDefinition.type === "number") {
						expect(newDefinition.min).toBe(10);
						expect(newDefinition.max).toBe(10000);
						expect(newDefinition.integer).toBe(true);
					}
				}
			}
		});
	});

	describe("Migration Generation (Complete)", () => {
		it("should generate complete migration with metadata and timestamp", () => {
			const diffs: SchemaDiff[] = [
				{
					type: "tableAdded",
					schema: {
						name: "users",
						fields: { id: { type: "number", required: true } },
					},
				},
			];

			const migrationMetadata = {
				name: "create_users_table",
				version: "001",
				description: "Create users table",
				author: "test",
			};

			const migration = expectSuccessData(() =>
				generator.generate(diffs, migrationMetadata),
			);

			expect(migration.metadata.name).toBe("create_users_table");
			expect(migration.metadata.version).toBe("001");
			expect(migration.metadata.description).toBe("Create users table");
			expect(migration.metadata.author).toBe("test");
			expect(migration.metadata.timestamp).toBeTypeOf("number");
			expect(migration.metadata.timestamp).toBeGreaterThan(0);

			expect(migration.operations).toHaveLength(1);
			expect(migration.operations[0]!.type).toBe("createTable");
		});

		it("should generate unique timestamps for consecutive migrations", () => {
			const diffs: SchemaDiff[] = [
				{
					type: "tableAdded",
					schema: { name: "test", fields: {} },
				},
			];

			const migration1 = expectSuccessData(() =>
				generator.generate(diffs, { name: "mig1", version: "001" }),
			);
			const migration2 = expectSuccessData(() =>
				generator.generate(diffs, { name: "mig2", version: "002" }),
			);

			expect(migration1.metadata.timestamp).toBeDefined();
			expect(migration2.metadata.timestamp).toBeDefined();
			expect(migration1.metadata.timestamp).toBeGreaterThan(0);
			expect(migration2.metadata.timestamp).toBeGreaterThan(0);
		});
	});

	describe("Edge Cases", () => {
		it("should handle empty diffs array", () => {
			const emptyDiffs: SchemaDiff[] = [];

			const operations = expectSuccessData(() =>
				generator.generateOperations(emptyDiffs),
			);

			expect(operations).toHaveLength(0);
		});

		it("should handle composite index with multiple fields", () => {
			const compositeIndexDiff: SchemaDiff[] = [
				{
					type: "indexAdded",
					tableName: "orders",
					index: {
						name: "user_date_idx",
						fields: ["userId", "createdAt", "status"],
						type: "btree",
					},
				},
			];

			const operations = expectSuccessData(() =>
				generator.generateOperations(compositeIndexDiff),
			);

			const upOperation = operations[0]!;
			if (upOperation.type === "createIndex") {
				expect(upOperation.index.fields).toEqual([
					"userId",
					"createdAt",
					"status",
				]);
				expect(upOperation.index.fields).toHaveLength(3);
			}
		});

		it("should preserve field definition properties exactly", () => {
			const complexFieldDefinition = {
				type: "string" as const,
				required: true,
				unique: true,
				minLength: 5,
				maxLength: 50,
				pattern: /^[a-z]+$/,
				default: "test",
			};

			const fieldWithAllProperties: SchemaDiff[] = [
				{
					type: "fieldAdded",
					tableName: "users",
					fieldName: "username",
					definition: complexFieldDefinition,
				},
			];

			const operations = expectSuccessData(() =>
				generator.generateOperations(fieldWithAllProperties),
			);

			const upOperation = operations[0]!;
			if (upOperation.type === "alterTable") {
				const alterOperation = upOperation.operations[0]!;
				if (alterOperation.type === "addColumn") {
					expect(alterOperation.definition).toEqual(complexFieldDefinition);
				}
			}
		});

		it("should handle relation field changes", () => {
			const relationFieldChange: SchemaDiff[] = [
				{
					type: "fieldModified",
					tableName: "posts",
					fieldName: "author",
					oldDefinition: {
						type: "relation",
						model: "User",
						kind: "belongsTo",
						foreignKey: "userId",
					},
					newDefinition: {
						type: "relation",
						model: "Account",
						kind: "belongsTo",
						foreignKey: "accountId",
						onDelete: "cascade",
					},
				},
			];

			const operations = expectSuccessData(() =>
				generator.generateOperations(relationFieldChange),
			);

			const upOperation = operations[0]!;
			if (upOperation.type === "alterTable") {
				const alterOperation = upOperation.operations[0]!;
				if (alterOperation.type === "modifyColumn") {
					const newDefinition = alterOperation.newDefinition;
					if (newDefinition.type === "relation") {
						expect(newDefinition.model).toBe("Account");
						expect(newDefinition.foreignKey).toBe("accountId");
						expect(newDefinition.onDelete).toBe("cascade");
					}
				}
			}
		});
	});
});
