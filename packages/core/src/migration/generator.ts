/**
 * Migration Generator Implementation (~250 LOC)
 *
 * Generates migration operations and TypeScript migration files from schema differences.
 */

import {
	Migration,
	MigrationGenerator,
	MigrationMetadata,
	MigrationOperation,
	MigrationSystemError,
	SchemaDiff,
} from "@forja/types/core/migration";

/**
 * Migration generator implementation
 */
export class ForgeMigrationGenerator implements MigrationGenerator {
	/**
	 * Escape string for use in template literals
	 */
	private escapeString(str: string): string {
		return str
			.replace(/\\/g, "\\\\")
			.replace(/'/g, "\\'")
			.replace(/"/g, '\\"')
			.replace(/`/g, "\\`")
			.replace(/\$/g, "\\$")
			.replace(/\n/g, "\\n")
			.replace(/\r/g, "\\r")
			.replace(/\t/g, "\\t");
	}

	/**
	 * Generate complete migration from differences
	 */
	generate(
		differences: readonly SchemaDiff[],
		metadata: Omit<MigrationMetadata, "timestamp">,
	): Migration {
		try {
			const operationsResult = this.generateOperations(differences);

			const migration: Migration = {
				metadata: {
					...metadata,
					timestamp: Date.now(),
				},
				operations: operationsResult,
			};

			return migration;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new MigrationSystemError(
				`Failed to generate migration: ${message}`,
				"GENERATION_ERROR",
				error,
			);
		}
	}

	/**
	 * Generate operations from differences
	 */
	generateOperations(
		differences: readonly SchemaDiff[],
	): readonly MigrationOperation[] {
		try {
			const operations: MigrationOperation[] = [];

			for (const diff of differences) {
				const op = this.generateOperation(diff);
				operations.push(op);
			}

			return operations;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new MigrationSystemError(
				`Failed to generate operations: ${message}`,
				"GENERATION_ERROR",
				error,
			);
		}
	}

	/**
	 * Generate operation for a single difference
	 */
	private generateOperation(diff: SchemaDiff): MigrationOperation {
		switch (diff.type) {
			case "tableAdded":
				return {
					type: "createTable",
					schema: diff.schema,
				};

			case "tableRemoved":
				return {
					type: "dropTable",
					tableName: diff.tableName,
				};

			case "tableRenamed":
				return {
					type: "renameTable",
					from: diff.from,
					to: diff.to,
				};

			case "fieldAdded": {
				// Relation fields have no direct DB column — differ produces
				// separate diffs for the actual FK column (e.g. tagId).
				// But we still need to update _forja meta schema.
				if (diff.definition.type === "relation") {
					return {
						type: "alterTable",
						tableName: diff.tableName,
						operations: [
							{
								type: "addMetaField",
								field: diff.fieldName,
								definition: diff.definition,
							},
						],
					};
				}

				return {
					type: "alterTable",
					tableName: diff.tableName,
					operations: [
						{
							type: "addColumn",
							column: diff.fieldName,
							definition: diff.definition,
						},
					],
				};
			}

			case "fieldRemoved": {
				// Relation fields have no direct DB column
				// But we still need to update _forja meta schema.
				if (diff.definition.type === "relation") {
					return {
						type: "alterTable",
						tableName: diff.tableName,
						operations: [
							{
								type: "dropMetaField",
								field: diff.fieldName,
							},
						],
					};
				}

				return {
					type: "alterTable",
					tableName: diff.tableName,
					operations: [
						{
							type: "dropColumn",
							column: diff.fieldName,
						},
					],
				};
			}

			case "fieldModified": {
				const operations = [];

				// Relation FK rename: foreignKey changed → rename the actual DB column
				if (
					diff.oldDefinition.type === "relation" &&
					diff.newDefinition.type === "relation" &&
					diff.oldDefinition.foreignKey !== diff.newDefinition.foreignKey
				) {
					const oldFK =
						diff.oldDefinition.foreignKey ?? `${diff.oldDefinition.model}Id`;
					const newFK =
						diff.newDefinition.foreignKey ?? `${diff.newDefinition.model}Id`;
					if (oldFK !== newFK) {
						operations.push({
							type: "renameColumn" as const,
							from: oldFK,
							to: newFK,
						});
					}
				}

				// Relation field modified — update _forja meta schema
				if (
					diff.oldDefinition.type === "relation" ||
					diff.newDefinition.type === "relation"
				) {
					operations.push({
						type: "modifyMetaField" as const,
						field: diff.fieldName,
						newDefinition: diff.newDefinition,
					});
				}

				// If no special operation was generated, fall back to modifyColumn
				if (operations.length === 0) {
					operations.push({
						type: "modifyColumn" as const,
						column: diff.fieldName,
						newDefinition: diff.newDefinition,
					});
				}

				return {
					type: "alterTable",
					tableName: diff.tableName,
					operations,
				};
			}

			case "fieldRenamed":
				return {
					type: "alterTable",
					tableName: diff.tableName,
					operations: [
						{
							type: "renameColumn",
							from: diff.from,
							to: diff.to,
						},
					],
				};

			case "indexAdded":
				return {
					type: "createIndex",
					tableName: diff.tableName,
					index: diff.index,
				};

			case "indexRemoved":
				return {
					type: "dropIndex",
					tableName: diff.tableName,
					indexName: diff.indexName,
				};
		}
	}

	/**
	 * Generate TypeScript migration file content
	 */
	generateFile(migration: Migration): string {
		const { metadata, operations } = migration;

		const operationsCode = this.generateOperationsCode(operations, 2);

		// Escape metadata strings to prevent injection
		const escapedName = this.escapeString(metadata.name);
		const escapedVersion = this.escapeString(metadata.version);
		const escapedDescription = metadata.description
			? this.escapeString(metadata.description)
			: undefined;
		const escapedAuthor = metadata.author
			? this.escapeString(metadata.author)
			: undefined;

		return `/**
 * Migration: ${escapedName}
 * Version: ${escapedVersion}
 * Created: ${new Date(metadata.timestamp).toISOString()}
 ${escapedDescription ? `* Description: ${escapedDescription}` : ""}
 ${escapedAuthor ? `* Author: ${escapedAuthor}` : ""}
 */

import type { Migration } from '@forja/types/core/migration';

export const migration: Migration = {
  metadata: {
    name: '${escapedName}',
    version: '${escapedVersion}',
    timestamp: ${metadata.timestamp},
    ${escapedDescription ? `description: '${escapedDescription}',` : ""}
    ${escapedAuthor ? `author: '${escapedAuthor}',` : ""}
  },

  operations: [
${operationsCode}
  ]
};

export default migration;
`;
	}

	/**
	 * Generate TypeScript code for operations array
	 */
	private generateOperationsCode(
		operations: readonly MigrationOperation[],
		indent: number,
	): string {
		const indentStr = "  ".repeat(indent);

		return operations
			.map((op) => {
				switch (op.type) {
					case "createTable":
						return `${indentStr}{
${indentStr}  type: 'createTable',
${indentStr}  schema: ${JSON.stringify(op.schema, null, 2).replace(/\n/g, `\n${indentStr}  `)}
${indentStr}}`;

					case "dropTable":
						return `${indentStr}{
${indentStr}  type: 'dropTable',
${indentStr}  tableName: '${op.tableName}'
${indentStr}}`;

					case "alterTable":
						return `${indentStr}{
${indentStr}  type: 'alterTable',
${indentStr}  tableName: '${op.tableName}',
${indentStr}  operations: ${JSON.stringify(op.operations, null, 2).replace(/\n/g, `\n${indentStr}  `)}
${indentStr}}`;

					case "createIndex":
						return `${indentStr}{
${indentStr}  type: 'createIndex',
${indentStr}  tableName: '${op.tableName}',
${indentStr}  index: ${JSON.stringify(op.index, null, 2).replace(/\n/g, `\n${indentStr}  `)}
${indentStr}}`;

					case "dropIndex":
						return `${indentStr}{
${indentStr}  type: 'dropIndex',
${indentStr}  tableName: '${op.tableName}',
${indentStr}  indexName: '${op.indexName}'
${indentStr}}`;

					case "renameTable":
						return `${indentStr}{
${indentStr}  type: 'renameTable',
${indentStr}  from: '${op.from}',
${indentStr}  to: '${op.to}'
${indentStr}}`;

					case "raw":
						return `${indentStr}{
${indentStr}  type: 'raw',
${indentStr}  sql: \`${op.sql}\`,
${indentStr}  params: ${JSON.stringify(op.params ?? [])}
${indentStr}}`;

					case "dataTransfer":
						return `${indentStr}{
${indentStr}  type: 'dataTransfer',
${indentStr}  description: '${op.description}'
${indentStr}}`;
				}
			})
			.join(",\n");
	}
}

/**
 * Create migration generator instance
 */
export function createMigrationGenerator(): MigrationGenerator {
	return new ForgeMigrationGenerator();
}
