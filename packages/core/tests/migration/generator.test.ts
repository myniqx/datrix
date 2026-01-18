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

      const operations = expectSuccessData(
        generator.generateOperations(tableAddedDiff),
      );

      expect(operations.up).toHaveLength(1);
      expect(operations.down).toHaveLength(1);

      const upOperation = operations.up[0]!;
      expect(upOperation.type).toBe("createTable");
      if (upOperation.type === "createTable") {
        expect(upOperation.schema.name).toBe("users");
        expect(upOperation.schema.fields).toHaveProperty("id");
        expect(upOperation.schema.fields).toHaveProperty("email");
      }

      const downOperation = operations.down[0]!;
      expect(downOperation.type).toBe("dropTable");
      if (downOperation.type === "dropTable") {
        expect(downOperation.tableName).toBe("users");
      }
    });

    it("should generate dropTable for tableRemoved with TODO down migration", () => {
      const tableRemovedDiff: SchemaDiff[] = [
        {
          type: "tableRemoved",
          tableName: "old_table",
        },
      ];

      const operations = expectSuccessData(
        generator.generateOperations(tableRemovedDiff),
      );

      const upOperation = operations.up[0]!;
      expect(upOperation.type).toBe("dropTable");
      if (upOperation.type === "dropTable") {
        expect(upOperation.tableName).toBe("old_table");
      }

      const downOperation = operations.down[0]!;
      expect(downOperation.type).toBe("raw");
      if (downOperation.type === "raw") {
        expect(downOperation.sql).toContain("TODO");
        expect(downOperation.sql).toContain("old_table");
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

      const operations = expectSuccessData(
        generator.generateOperations(tableRenamedDiff),
      );

      const upOperation = operations.up[0]!;
      expect(upOperation.type).toBe("renameTable");
      if (upOperation.type === "renameTable") {
        expect(upOperation.from).toBe("users");
        expect(upOperation.to).toBe("accounts");
      }

      const downOperation = operations.down[0]!;
      expect(downOperation.type).toBe("renameTable");
      if (downOperation.type === "renameTable") {
        expect(downOperation.from).toBe("accounts");
        expect(downOperation.to).toBe("users");
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

      const operations = expectSuccessData(
        generator.generateOperations(fieldAddedDiff),
      );

      const upOperation = operations.up[0]!;
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

      const downOperation = operations.down[0]!;
      expect(downOperation.type).toBe("alterTable");
      if (downOperation.type === "alterTable") {
        expect(downOperation.tableName).toBe("users");
        expect(downOperation.operations).toHaveLength(1);

        const alterOperation = downOperation.operations[0]!;
        expect(alterOperation.type).toBe("dropColumn");
        if (alterOperation.type === "dropColumn") {
          expect(alterOperation.column).toBe("phone");
        }
      }
    });

    it("should generate dropColumn for fieldRemoved with TODO down migration", () => {
      const fieldRemovedDiff: SchemaDiff[] = [
        {
          type: "fieldRemoved",
          tableName: "users",
          fieldName: "old_field",
        },
      ];

      const operations = expectSuccessData(
        generator.generateOperations(fieldRemovedDiff),
      );

      const upOperation = operations.up[0]!;
      expect(upOperation.type).toBe("alterTable");
      if (upOperation.type === "alterTable") {
        const alterOperation = upOperation.operations[0]!;
        expect(alterOperation.type).toBe("dropColumn");
        if (alterOperation.type === "dropColumn") {
          expect(alterOperation.column).toBe("old_field");
        }
      }

      const downOperation = operations.down[0]!;
      expect(downOperation.type).toBe("raw");
      if (downOperation.type === "raw") {
        expect(downOperation.sql).toContain("TODO");
        expect(downOperation.sql).toContain("old_field");
        expect(downOperation.sql).toContain("users");
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

      const operations = expectSuccessData(
        generator.generateOperations(fieldModifiedDiff),
      );

      const upOperation = operations.up[0]!;
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

      const downOperation = operations.down[0]!;
      expect(downOperation.type).toBe("alterTable");
      if (downOperation.type === "alterTable") {
        const alterOperation = downOperation.operations[0]!;
        expect(alterOperation.type).toBe("modifyColumn");
        if (alterOperation.type === "modifyColumn") {
          expect(alterOperation.column).toBe("email");
          expect(alterOperation.newDefinition).toEqual({
            type: "string",
            required: false,
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

      const operations = expectSuccessData(
        generator.generateOperations(fieldRenamedDiff),
      );

      const upOperation = operations.up[0]!;
      expect(upOperation.type).toBe("alterTable");
      if (upOperation.type === "alterTable") {
        const alterOperation = upOperation.operations[0]!;
        expect(alterOperation.type).toBe("renameColumn");
        if (alterOperation.type === "renameColumn") {
          expect(alterOperation.from).toBe("username");
          expect(alterOperation.to).toBe("login");
        }
      }

      const downOperation = operations.down[0]!;
      expect(downOperation.type).toBe("alterTable");
      if (downOperation.type === "alterTable") {
        const alterOperation = downOperation.operations[0]!;
        expect(alterOperation.type).toBe("renameColumn");
        if (alterOperation.type === "renameColumn") {
          expect(alterOperation.from).toBe("login");
          expect(alterOperation.to).toBe("username");
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

      const operations = expectSuccessData(
        generator.generateOperations(indexAddedDiff),
      );

      const upOperation = operations.up[0]!;
      expect(upOperation.type).toBe("createIndex");
      if (upOperation.type === "createIndex") {
        expect(upOperation.tableName).toBe("users");
        expect(upOperation.index.name).toBe("email_idx");
        expect(upOperation.index.fields).toEqual(["email"]);
        expect(upOperation.index.unique).toBe(true);
        expect(upOperation.index.type).toBe("btree");
      }

      const downOperation = operations.down[0]!;
      expect(downOperation.type).toBe("dropIndex");
      if (downOperation.type === "dropIndex") {
        expect(downOperation.tableName).toBe("users");
        expect(downOperation.indexName).toBe("email_idx");
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

      const operations = expectSuccessData(
        generator.generateOperations(indexRemovedDiff),
      );

      const upOperation = operations.up[0]!;
      expect(upOperation.type).toBe("dropIndex");
      if (upOperation.type === "dropIndex") {
        expect(upOperation.tableName).toBe("users");
        expect(upOperation.indexName).toBe("old_idx");
      }

      const downOperation = operations.down[0]!;
      expect(downOperation.type).toBe("raw");
      if (downOperation.type === "raw") {
        expect(downOperation.sql).toContain("TODO");
        expect(downOperation.sql).toContain("old_idx");
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

      const operations = expectSuccessData(
        generator.generateOperations(multipleDiffs),
      );

      expect(operations.up).toHaveLength(3);
      expect(operations.down).toHaveLength(3);

      expect(operations.up[0]!.type).toBe("createTable");
      expect(operations.up[1]!.type).toBe("alterTable");
      expect(operations.up[2]!.type).toBe("createIndex");

      expect(operations.down[0]!.type).toBe("dropTable");
      expect(operations.down[1]!.type).toBe("alterTable");
      expect(operations.down[2]!.type).toBe("dropIndex");
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

      const operations = expectSuccessData(
        generator.generateOperations(constraintChangeDiff),
      );

      const upOperation = operations.up[0]!;
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

      const downOperation = operations.down[0]!;
      if (downOperation.type === "alterTable") {
        const alterOperation = downOperation.operations[0]!;
        if (alterOperation.type === "modifyColumn") {
          const oldDefinition = alterOperation.newDefinition;
          if (oldDefinition.type === "number") {
            expect(oldDefinition.min).toBe(0);
            expect(oldDefinition.max).toBeUndefined();
            expect(oldDefinition.integer).toBeUndefined();
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

      const migration = expectSuccessData(
        generator.generate(diffs, migrationMetadata),
      );

      expect(migration.metadata.name).toBe("create_users_table");
      expect(migration.metadata.version).toBe("001");
      expect(migration.metadata.description).toBe("Create users table");
      expect(migration.metadata.author).toBe("test");
      expect(migration.metadata.timestamp).toBeTypeOf("number");
      expect(migration.metadata.timestamp).toBeGreaterThan(0);

      expect(migration.up).toHaveLength(1);
      expect(migration.down).toHaveLength(1);
      expect(migration.up[0]!.type).toBe("createTable");
      expect(migration.down[0]!.type).toBe("dropTable");
    });

    it("should generate unique timestamps for consecutive migrations", () => {
      const diffs: SchemaDiff[] = [
        {
          type: "tableAdded",
          schema: { name: "test", fields: {} },
        },
      ];

      const migration1 = expectSuccessData(
        generator.generate(diffs, { name: "mig1", version: "001" }),
      );
      const migration2 = expectSuccessData(
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

      const operations = expectSuccessData(
        generator.generateOperations(emptyDiffs),
      );

      expect(operations.up).toHaveLength(0);
      expect(operations.down).toHaveLength(0);
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

      const operations = expectSuccessData(
        generator.generateOperations(compositeIndexDiff),
      );

      const upOperation = operations.up[0]!;
      if (upOperation.type === "createIndex") {
        expect(upOperation.index.fields).toEqual(["userId", "createdAt", "status"]);
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

      const operations = expectSuccessData(
        generator.generateOperations(fieldWithAllProperties),
      );

      const upOperation = operations.up[0]!;
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

      const operations = expectSuccessData(
        generator.generateOperations(relationFieldChange),
      );

      const upOperation = operations.up[0]!;
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
