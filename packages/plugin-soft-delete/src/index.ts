/**
 * Soft Delete Plugin
 *
 * Provides soft delete functionality for data operations.
 * NO `any` types, NO type assertions, NEVER throw exceptions.
 */

import type { SoftDeleteOptions } from './types';
import { SoftDeleteError, isSoftDeleteOptions } from './types';
import {
  SoftDeleteInterceptor,
  createSoftDeleteInterceptor,
} from './interceptor';
import { SchemaRegistry } from "forja-types/core/schema";
import { ForjaPlugin, PluginContext, PluginError } from 'forja-types/plugin';
import { Result } from 'forja-types/utils';
import { SchemaDefinition } from 'forja-types/core/schema';
import { QueryObject } from 'forja-types/core/query-builder';

/**
 * Soft delete plugin implementation
 */
export class SoftDeletePlugin implements ForjaPlugin<SoftDeleteOptions> {
  readonly name = 'soft-delete' as const;
  readonly version = '0.1.0';
  readonly options: SoftDeleteOptions;

  private interceptor: SoftDeleteInterceptor | null = null;

  constructor(options: SoftDeleteOptions = {}) {
    this.options = options;
  }

  /**
   * Initialize the plugin
   */
  async init(_context: PluginContext): Promise<Result<void, PluginError>> {
    // Validate options
    if (!isSoftDeleteOptions(this.options)) {
      return {
        success: false,
        error: new SoftDeleteError('Invalid plugin options', {
          options: this.options,
        }),
      };
    }

    // Create interceptor
    this.interceptor = createSoftDeleteInterceptor(this.options);

    return { success: true, data: undefined };
  }

  /**
   * Destroy the plugin
   */
  async destroy(): Promise<Result<void, PluginError>> {
    this.interceptor = null;

    return { success: true, data: undefined };
  }

  /**
   * Hook called when schemas are loaded
   */
  async onSchemaLoad(schemas: SchemaRegistry): Promise<void> {
    // Add deletedAt field to all schemas (except excluded models)
    if (this.interceptor === null) {
      return;
    }

    const field = this.interceptor.getField();
    const type = this.interceptor.getType();

    // Add deletedAt field to each schema
    const allSchemas = schemas.getAll();
    for (const schema of allSchemas) {
      // Skip excluded models
      if (this.interceptor.isExcluded(schema.name)) {
        continue;
      }

      // Check if field already exists
      if (field in schema.fields) {
        continue;
      }

      // Add field to schema
      const updatedSchema: SchemaDefinition = {
        ...schema,
        fields: {
          ...schema.fields,
          [field]: {
            type: type === 'timestamp' ? 'date' : 'boolean',
            required: false,
            default: type === 'timestamp' ? null : false,
          },
        },
      };

      // Re-register updated schema
      schemas.register(updatedSchema);
    }
  }

  /**
   * Hook called before query execution
   */
  async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
    if (this.interceptor === null) {
      return query;
    }

    return this.interceptor.interceptQuery(query);
  }

  /**
   * Soft delete a record (convert DELETE to UPDATE)
   */
  softDelete(
    tableName: string,
    where?: QueryObject['where']
  ): QueryObject {
    const query: QueryObject = {
      type: 'delete',
      table: tableName,
      ...(where !== undefined && { where }),
    };

    if (this.interceptor === null) {
      return query;
    }

    return this.interceptor.interceptQuery(query);
  }

  /**
   * Hard delete a record (bypass soft delete)
   */
  hardDelete(
    tableName: string,
    where?: QueryObject['where']
  ): QueryObject {
    const query: QueryObject = {
      type: 'delete',
      table: tableName,
      ...(where !== undefined && { where }),
    };

    if (this.interceptor === null) {
      return query;
    }

    return this.interceptor.hardDelete(query);
  }

  /**
   * Find deleted records
   */
  findDeleted(
    tableName: string,
    where?: QueryObject['where']
  ): QueryObject {
    const query: QueryObject = {
      type: 'select',
      table: tableName,
      ...(where !== undefined && { where }),
    };

    if (this.interceptor === null) {
      return query;
    }

    return this.interceptor.findDeleted(query);
  }

  /**
   * Find all records including deleted
   */
  findWithDeleted(
    tableName: string,
    where?: QueryObject['where']
  ): QueryObject {
    const query: QueryObject = {
      type: 'select',
      table: tableName,
      ...(where !== undefined && { where }),
    };

    if (this.interceptor === null) {
      return query;
    }

    return this.interceptor.findWithDeleted(query);
  }

  /**
   * Restore a soft-deleted record
   */
  restore(tableName: string, id: string): QueryObject {
    if (this.interceptor === null) {
      return {
        type: 'update',
        table: tableName,
        where: { id },
        data: {},
      };
    }

    return this.interceptor.restore(tableName, id);
  }

  /**
   * Add excluded model
   */
  addExcludedModel(modelName: string): void {
    if (this.interceptor !== null) {
      this.interceptor.addExcludedModel(modelName);
    }
  }

  /**
   * Remove excluded model
   */
  removeExcludedModel(modelName: string): void {
    if (this.interceptor !== null) {
      this.interceptor.removeExcludedModel(modelName);
    }
  }

  /**
   * Get excluded models
   */
  getExcludedModels(): readonly string[] {
    if (this.interceptor === null) {
      return [];
    }

    return this.interceptor.getExcludedModels();
  }

  /**
   * Get field name
   */
  getField(): string {
    return this.interceptor?.getField() ?? 'deletedAt';
  }

  /**
   * Get field type
   */
  getType(): 'timestamp' | 'boolean' {
    return this.interceptor?.getType() ?? 'timestamp';
  }
}

/**
 * Create a new soft delete plugin instance
 */
export function createSoftDeletePlugin(
  options: SoftDeleteOptions = {}
): SoftDeletePlugin {
  return new SoftDeletePlugin(options);
}

/**
 * Re-export types
 */
export type {
  SoftDeleteOptions,
  SoftDeleteQueryOptions,
  SoftDeleteMode,
  SoftDeleteInterceptorInterface,
} from './types';

export { SoftDeleteError, isSoftDeleteOptions } from './types';
export { SoftDeleteInterceptor, createSoftDeleteInterceptor } from './interceptor';
