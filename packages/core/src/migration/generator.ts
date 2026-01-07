/**
 * Migration Generator Implementation (~250 LOC)
 *
 * Generates migration operations and TypeScript migration files from schema differences.
 */

import { Migration, MigrationGenerator, MigrationMetadata, MigrationOperation, MigrationSystemError, SchemaDiff } from "forja-types/core/migration";
import { Result } from "forja-types/utils";


/**
 * Migration generator implementation
 */
export class ForgeMigrationGenerator implements MigrationGenerator {
  /**
   * Escape string for use in template literals
   */
  private escapeString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  /**
   * Generate complete migration from differences
   */
  generate(
    differences: readonly SchemaDiff[],
    metadata: Omit<MigrationMetadata, 'timestamp'>
  ): Result<Migration, MigrationSystemError> {
    try {
      const operationsResult = this.generateOperations(differences);

      if (!operationsResult.success) {
        return operationsResult;
      }

      const { up, down } = operationsResult.data;

      const migration: Migration = {
        metadata: {
          ...metadata,
          timestamp: Date.now()
        },
        up,
        down
      };

      return { success: true, data: migration };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationSystemError(
          `Failed to generate migration: ${message}`,
          'GENERATION_ERROR',
          error
        )
      };
    }
  }

  /**
   * Generate up and down operations from differences
   */
  generateOperations(
    differences: readonly SchemaDiff[]
  ): Result<{
    readonly up: readonly MigrationOperation[];
    readonly down: readonly MigrationOperation[];
  }, MigrationSystemError> {
    try {
      const up: MigrationOperation[] = [];
      const down: MigrationOperation[] = [];

      for (const diff of differences) {
        const ops = this.generateOperationPair(diff);
        up.push(ops.up);
        down.push(ops.down);
      }

      return {
        success: true,
        data: { up, down }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationSystemError(
          `Failed to generate operations: ${message}`,
          'GENERATION_ERROR',
          error
        )
      };
    }
  }

  /**
   * Generate up/down operation pair for a single difference
   */
  private generateOperationPair(diff: SchemaDiff): {
    up: MigrationOperation;
    down: MigrationOperation;
  } {
    switch (diff.type) {
      case 'tableAdded':
        return {
          up: {
            type: 'createTable',
            schema: diff.schema
          },
          down: {
            type: 'dropTable',
            tableName: diff.schema.name
          }
        };

      case 'tableRemoved':
        // Note: We don't have the schema for down migration
        // This is a limitation - ideally store schema before removal
        return {
          up: {
            type: 'dropTable',
            tableName: diff.tableName
          },
          down: {
            type: 'raw',
            sql: `-- TODO: Add CREATE TABLE statement for ${diff.tableName}`,
            params: []
          }
        };

      case 'tableRenamed':
        return {
          up: {
            type: 'renameTable',
            from: diff.from,
            to: diff.to
          },
          down: {
            type: 'renameTable',
            from: diff.to,
            to: diff.from
          }
        };

      case 'fieldAdded':
        return {
          up: {
            type: 'alterTable',
            tableName: diff.tableName,
            operations: [
              {
                type: 'addColumn',
                column: diff.fieldName,
                definition: diff.definition
              }
            ]
          },
          down: {
            type: 'alterTable',
            tableName: diff.tableName,
            operations: [
              {
                type: 'dropColumn',
                column: diff.fieldName
              }
            ]
          }
        };

      case 'fieldRemoved':
        return {
          up: {
            type: 'alterTable',
            tableName: diff.tableName,
            operations: [
              {
                type: 'dropColumn',
                column: diff.fieldName
              }
            ]
          },
          down: {
            type: 'raw',
            sql: `-- TODO: Add column ${diff.fieldName} to ${diff.tableName}`,
            params: []
          }
        };

      case 'fieldModified':
        return {
          up: {
            type: 'alterTable',
            tableName: diff.tableName,
            operations: [
              {
                type: 'modifyColumn',
                column: diff.fieldName,
                newDefinition: diff.newDefinition
              }
            ]
          },
          down: {
            type: 'alterTable',
            tableName: diff.tableName,
            operations: [
              {
                type: 'modifyColumn',
                column: diff.fieldName,
                newDefinition: diff.oldDefinition
              }
            ]
          }
        };

      case 'fieldRenamed':
        return {
          up: {
            type: 'alterTable',
            tableName: diff.tableName,
            operations: [
              {
                type: 'renameColumn',
                from: diff.from,
                to: diff.to
              }
            ]
          },
          down: {
            type: 'alterTable',
            tableName: diff.tableName,
            operations: [
              {
                type: 'renameColumn',
                from: diff.to,
                to: diff.from
              }
            ]
          }
        };

      case 'indexAdded':
        return {
          up: {
            type: 'createIndex',
            tableName: diff.tableName,
            index: diff.index
          },
          down: {
            type: 'dropIndex',
            tableName: diff.tableName,
            indexName:
              diff.index.name ?? `idx_${diff.tableName}_${diff.index.fields.join('_')}`
          }
        };

      case 'indexRemoved':
        return {
          up: {
            type: 'dropIndex',
            tableName: diff.tableName,
            indexName: diff.indexName
          },
          down: {
            type: 'raw',
            sql: `-- TODO: Add CREATE INDEX statement for ${diff.indexName}`,
            params: []
          }
        };
    }
  }

  /**
   * Generate TypeScript migration file content
   */
  generateFile(migration: Migration): string {
    const { metadata, up, down } = migration;

    const upCode = this.generateOperationsCode(up, 2);
    const downCode = this.generateOperationsCode(down, 2);

    // Escape metadata strings to prevent injection
    const escapedName = this.escapeString(metadata.name);
    const escapedVersion = this.escapeString(metadata.version);
    const escapedDescription = metadata.description ? this.escapeString(metadata.description) : undefined;
    const escapedAuthor = metadata.author ? this.escapeString(metadata.author) : undefined;

    return `/**
 * Migration: ${escapedName}
 * Version: ${escapedVersion}
 * Created: ${new Date(metadata.timestamp).toISOString()}
 ${escapedDescription ? `* Description: ${escapedDescription}` : ''}
 ${escapedAuthor ? `* Author: ${escapedAuthor}` : ''}
 */

import type { Migration, MigrationOperation } from '@core/migration/types';

export const migration: Migration = {
  metadata: {
    name: '${escapedName}',
    version: '${escapedVersion}',
    timestamp: ${metadata.timestamp},
    ${escapedDescription ? `description: '${escapedDescription}',` : ''}
    ${escapedAuthor ? `author: '${escapedAuthor}',` : ''}
  },

  up: [
${upCode}
  ],

  down: [
${downCode}
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
    indent: number
  ): string {
    const indentStr = '  '.repeat(indent);

    return operations
      .map((op) => {
        switch (op.type) {
          case 'createTable':
            return `${indentStr}{
${indentStr}  type: 'createTable',
${indentStr}  schema: ${JSON.stringify(op.schema, null, 2).replace(/\n/g, `\n${indentStr}  `)}
${indentStr}}`;

          case 'dropTable':
            return `${indentStr}{
${indentStr}  type: 'dropTable',
${indentStr}  tableName: '${op.tableName}'
${indentStr}}`;

          case 'alterTable':
            return `${indentStr}{
${indentStr}  type: 'alterTable',
${indentStr}  tableName: '${op.tableName}',
${indentStr}  operations: ${JSON.stringify(op.operations, null, 2).replace(/\n/g, `\n${indentStr}  `)}
${indentStr}}`;

          case 'createIndex':
            return `${indentStr}{
${indentStr}  type: 'createIndex',
${indentStr}  tableName: '${op.tableName}',
${indentStr}  index: ${JSON.stringify(op.index, null, 2).replace(/\n/g, `\n${indentStr}  `)}
${indentStr}}`;

          case 'dropIndex':
            return `${indentStr}{
${indentStr}  type: 'dropIndex',
${indentStr}  tableName: '${op.tableName}',
${indentStr}  indexName: '${op.indexName}'
${indentStr}}`;

          case 'renameTable':
            return `${indentStr}{
${indentStr}  type: 'renameTable',
${indentStr}  from: '${op.from}',
${indentStr}  to: '${op.to}'
${indentStr}}`;

          case 'raw':
            return `${indentStr}{
${indentStr}  type: 'raw',
${indentStr}  sql: \`${op.sql}\`,
${indentStr}  params: ${JSON.stringify(op.params ?? [])}
${indentStr}}`;
        }
      })
      .join(',\n');
  }
}

/**
 * Create migration generator instance
 */
export function createMigrationGenerator(): MigrationGenerator {
  return new ForgeMigrationGenerator();
}
