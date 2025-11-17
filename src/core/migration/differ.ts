/**
 * Schema Differ Implementation (~300 LOC)
 *
 * Compares two schema versions and detects differences.
 * Produces structured diff objects for migration generation.
 */

import type { SchemaDefinition, FieldDefinition } from '@core/schema/types';
import type { Result } from '@utils/types';
import type {
  SchemaDiffer,
  SchemaComparison,
  SchemaDiff
} from './types';
import { MigrationSystemError } from './types';

/**
 * Type guard for SchemaDefinition
 */
function isSchemaDefinition(value: unknown): value is SchemaDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof (value as Record<string, unknown>)['name'] === 'string' &&
    'fields' in value &&
    typeof (value as Record<string, unknown>)['fields'] === 'object'
  );
}

/**
 * Type guard for FieldDefinition
 */
function isFieldDefinition(value: unknown): value is FieldDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as Record<string, unknown>)['type'] === 'string'
  );
}

/**
 * Type guard for valid index types
 */
function isValidIndexType(type: string): type is 'btree' | 'hash' | 'gist' | 'gin' {
  return ['btree', 'hash', 'gist', 'gin'].includes(type);
}

/**
 * Schema differ implementation
 */
export class ForgeSchemaDiffer implements SchemaDiffer {
  /**
   * Compare two schema collections
   */
  compare(
    oldSchemas: Record<string, SchemaDefinition>,
    newSchemas: Record<string, SchemaDefinition>
  ): Result<SchemaComparison, MigrationSystemError> {
    try {
      const differences: SchemaDiff[] = [];

      const oldTableNames = new Set(Object.keys(oldSchemas));
      const newTableNames = new Set(Object.keys(newSchemas));

      // Find added tables
      for (const tableName of newTableNames) {
        if (!oldTableNames.has(tableName)) {
          const schema = newSchemas[tableName];
          if (!isSchemaDefinition(schema)) {
            return {
              success: false,
              error: new MigrationSystemError(
                `Invalid schema definition for table '${tableName}'`,
                'DIFF_ERROR'
              )
            };
          }

          differences.push({
            type: 'tableAdded',
            schema
          });
        }
      }

      // Find removed tables
      for (const tableName of oldTableNames) {
        if (!newTableNames.has(tableName)) {
          differences.push({
            type: 'tableRemoved',
            tableName
          });
        }
      }

      // Find modified tables
      for (const tableName of newTableNames) {
        if (oldTableNames.has(tableName)) {
          const oldSchema = oldSchemas[tableName];
          const newSchema = newSchemas[tableName];

          if (!isSchemaDefinition(oldSchema) || !isSchemaDefinition(newSchema)) {
            return {
              success: false,
              error: new MigrationSystemError(
                `Invalid schema definition for table '${tableName}'`,
                'DIFF_ERROR'
              )
            };
          }

          const tableDiffs = this.compareTable(oldSchema, newSchema);
          differences.push(...tableDiffs);
        }
      }

      return {
        success: true,
        data: {
          differences,
          hasChanges: differences.length > 0
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationSystemError(
          `Failed to compare schemas: ${message}`,
          'DIFF_ERROR',
          error
        )
      };
    }
  }

  /**
   * Compare two versions of the same table
   */
  private compareTable(
    oldSchema: SchemaDefinition,
    newSchema: SchemaDefinition
  ): SchemaDiff[] {
    const differences: SchemaDiff[] = [];
    const tableName = newSchema.name;

    const oldFieldNames = new Set(Object.keys(oldSchema.fields));
    const newFieldNames = new Set(Object.keys(newSchema.fields));

    // Find added fields
    for (const fieldName of newFieldNames) {
      if (!oldFieldNames.has(fieldName)) {
        const definition = newSchema.fields[fieldName];
        if (!isFieldDefinition(definition)) {
          // Skip invalid field definitions
          continue;
        }

        differences.push({
          type: 'fieldAdded',
          tableName,
          fieldName,
          definition
        });
      }
    }

    // Find removed fields
    for (const fieldName of oldFieldNames) {
      if (!newFieldNames.has(fieldName)) {
        differences.push({
          type: 'fieldRemoved',
          tableName,
          fieldName
        });
      }
    }

    // Find modified fields
    for (const fieldName of newFieldNames) {
      if (oldFieldNames.has(fieldName)) {
        const oldField = oldSchema.fields[fieldName];
        const newField = newSchema.fields[fieldName];

        if (!isFieldDefinition(oldField) || !isFieldDefinition(newField)) {
          // Skip invalid field definitions
          continue;
        }

        if (this.isFieldModified(oldField, newField)) {
          differences.push({
            type: 'fieldModified',
            tableName,
            fieldName,
            oldDefinition: oldField,
            newDefinition: newField
          });
        }
      }
    }

    // Compare indexes if present
    if (oldSchema.indexes || newSchema.indexes) {
      const indexDiffs = this.compareIndexes(
        tableName,
        oldSchema.indexes ?? [],
        newSchema.indexes ?? []
      );
      differences.push(...indexDiffs);
    }

    return differences;
  }

  /**
   * Check if a field has been modified
   */
  isFieldModified(oldField: FieldDefinition, newField: FieldDefinition): boolean {
    // Check type change
    if (oldField.type !== newField.type) {
      return true;
    }

    // Check required change
    if (oldField.required !== newField.required) {
      return true;
    }

    // Check default value change
    if (oldField.default !== newField.default) {
      return true;
    }

    // Type-specific checks with proper type narrowing
    switch (oldField.type) {
      case 'string':
        // Type narrowing
        if (newField.type !== 'string') {
          return true;
        }
        if (
          oldField.maxLength !== newField.maxLength ||
          oldField.minLength !== newField.minLength ||
          oldField.pattern !== newField.pattern
        ) {
          return true;
        }
        break;

      case 'number':
        // Type narrowing
        if (newField.type !== 'number') {
          return true;
        }
        if (
          oldField.min !== newField.min ||
          oldField.max !== newField.max
        ) {
          return true;
        }
        break;

      case 'array':
        // Type narrowing
        if (newField.type !== 'array') {
          return true;
        }
        if (
          oldField.items !== newField.items ||
          oldField.minItems !== newField.minItems ||
          oldField.maxItems !== newField.maxItems ||
          oldField.unique !== newField.unique
        ) {
          return true;
        }
        break;

      case 'enum':
        // Type narrowing
        if (newField.type !== 'enum') {
          return true;
        }
        // Check if enum values changed
        if (oldField.values && newField.values) {
          const oldValues = new Set(oldField.values);
          const newValues = new Set(newField.values);

          if (oldValues.size !== newValues.size) {
            return true;
          }

          for (const value of oldValues) {
            if (!newValues.has(value)) {
              return true;
            }
          }
        }
        break;

      case 'relation':
        // Type narrowing
        if (newField.type !== 'relation') {
          return true;
        }
        if (
          oldField.model !== newField.model ||
          oldField.kind !== newField.kind ||
          oldField.foreignKey !== newField.foreignKey ||
          oldField.through !== newField.through ||
          oldField.onDelete !== newField.onDelete ||
          oldField.onUpdate !== newField.onUpdate
        ) {
          return true;
        }
        break;
    }

    return false;
  }

  /**
   * Compare indexes between two schema versions
   */
  private compareIndexes(
    tableName: string,
    oldIndexes: readonly {
      readonly name?: string;
      readonly fields: readonly string[];
      readonly unique?: boolean;
      readonly type?: string;
    }[],
    newIndexes: readonly {
      readonly name?: string;
      readonly fields: readonly string[];
      readonly unique?: boolean;
      readonly type?: string;
    }[]
  ): SchemaDiff[] {
    const differences: SchemaDiff[] = [];

    // Create index maps keyed by normalized signature
    const oldIndexMap = new Map(
      oldIndexes.map((idx) => [this.getIndexSignature(idx), idx])
    );
    const newIndexMap = new Map(
      newIndexes.map((idx) => [this.getIndexSignature(idx), idx])
    );

    // Find added indexes
    for (const [signature, index] of newIndexMap) {
      if (!oldIndexMap.has(signature)) {
        differences.push({
          type: 'indexAdded',
          tableName,
          index: {
            ...(index.name !== undefined && { name: index.name }),
            fields: index.fields,
            ...(index.unique !== undefined && { unique: index.unique }),
            ...(index.type !== undefined && isValidIndexType(index.type) && { type: index.type })
          }
        });
      }
    }

    // Find removed indexes
    for (const [signature, index] of oldIndexMap) {
      if (!newIndexMap.has(signature)) {
        const indexName = index.name ?? `idx_${tableName}_${index.fields.join('_')}`;
        differences.push({
          type: 'indexRemoved',
          tableName,
          indexName
        });
      }
    }

    return differences;
  }

  /**
   * Get index signature for comparison
   */
  private getIndexSignature(index: {
    readonly fields: readonly string[];
    readonly unique?: boolean;
    readonly type?: string;
  }): string {
    const fields = [...index.fields].sort().join(',');
    const unique = index.unique ? 'unique' : 'normal';
    const type = index.type ?? 'btree';
    return `${fields}:${unique}:${type}`;
  }
}

/**
 * Create schema differ instance
 */
export function createSchemaDiffer(): SchemaDiffer {
  return new ForgeSchemaDiffer();
}
