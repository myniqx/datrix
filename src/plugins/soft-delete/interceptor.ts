/**
 * Soft Delete Interceptor
 *
 * Intercepts queries to implement soft delete functionality.
 * NO `any` types, NO type assertions, NEVER throw exceptions.
 */

import type { QueryObject, WhereClause } from '@adapters/base/types';
import type {
  SoftDeleteOptions,
  SoftDeleteQueryOptions,
  SoftDeleteInterceptorInterface,
} from './types';
import { getDeletedValue, getNotDeletedValue } from './types';

/**
 * Soft delete interceptor implementation
 */
export class SoftDeleteInterceptor implements SoftDeleteInterceptorInterface {
  private readonly field: string;
  private readonly type: 'timestamp' | 'boolean';
  private readonly excludedModels: Set<string>;

  constructor(options: SoftDeleteOptions = {}) {
    this.field = options.field ?? 'deletedAt';
    this.type = options.type ?? 'timestamp';
    this.excludedModels = new Set(options.excludedModels ?? []);
  }

  /**
   * Intercept query to apply soft delete logic
   */
  interceptQuery(
    query: QueryObject,
    options: SoftDeleteQueryOptions = {}
  ): QueryObject {
    // Skip if model is excluded
    if (this.excludedModels.has(query.table)) {
      return query;
    }

    // Skip if bypass is enabled
    if (options.bypassSoftDelete === true) {
      return query;
    }

    // Handle different query types
    switch (query.type) {
      case 'select':
        return this.interceptSelect(query, options);
      case 'delete':
        return this.interceptDelete(query);
      case 'update':
      case 'insert':
      case 'count':
        return query;
      default:
        return query;
    }
  }

  /**
   * Intercept SELECT queries to filter out deleted records
   */
  private interceptSelect(
    query: QueryObject,
    options: SoftDeleteQueryOptions
  ): QueryObject {
    const mode = options.mode ?? 'default';

    // If including all records, don't modify query
    if (mode === 'include-deleted') {
      return query;
    }

    // Add deleted filter
    const deletedFilter = this.getDeletedFilter(mode);

    // Merge with existing where clause
    const where = this.mergeWhereClause(query.where, deletedFilter);

    return {
      ...query,
      where,
    };
  }

  /**
   * Intercept DELETE queries to convert to UPDATE with deletedAt
   */
  private interceptDelete(query: QueryObject): QueryObject {
    // Convert DELETE to UPDATE with deletedAt field
    return {
      type: 'update',
      table: query.table,
      ...(query.where !== undefined && { where: query.where }),
      data: {
        [this.field]: getDeletedValue(this.type),
      },
    };
  }

  /**
   * Get deleted filter based on mode
   */
  private getDeletedFilter(mode: 'default' | 'only-deleted'): WhereClause {
    if (mode === 'only-deleted') {
      // Only show deleted records
      return this.type === 'timestamp'
        ? { [this.field]: { $ne: null } }
        : { [this.field]: true };
    }

    // Default: only show non-deleted records
    return { [this.field]: getNotDeletedValue(this.type) };
  }

  /**
   * Merge where clauses
   */
  private mergeWhereClause(
    existingWhere: WhereClause | undefined,
    newWhere: WhereClause
  ): WhereClause {
    if (!existingWhere) {
      return newWhere;
    }

    // Check if deletedAt is already in the query
    if (this.field in existingWhere) {
      // User explicitly queried deletedAt, don't override
      return existingWhere;
    }

    // Merge using $and
    return {
      $and: [existingWhere, newWhere],
    };
  }

  /**
   * Perform hard delete (bypass soft delete)
   */
  hardDelete(query: QueryObject): QueryObject {
    // Return query as-is (don't convert to UPDATE)
    return query;
  }

  /**
   * Find only deleted records
   */
  findDeleted(query: QueryObject): QueryObject {
    if (query.type !== 'select') {
      return query;
    }

    return this.interceptSelect(query, { mode: 'only-deleted' });
  }

  /**
   * Find all records including deleted
   */
  findWithDeleted(query: QueryObject): QueryObject {
    if (query.type !== 'select') {
      return query;
    }

    return this.interceptSelect(query, { mode: 'include-deleted' });
  }

  /**
   * Restore a soft-deleted record
   */
  restore(tableName: string, id: string): QueryObject {
    return {
      type: 'update',
      table: tableName,
      where: { id },
      data: {
        [this.field]: getNotDeletedValue(this.type),
      },
    };
  }

  /**
   * Get field name
   */
  getField(): string {
    return this.field;
  }

  /**
   * Get field type
   */
  getType(): 'timestamp' | 'boolean' {
    return this.type;
  }

  /**
   * Check if model is excluded
   */
  isExcluded(modelName: string): boolean {
    return this.excludedModels.has(modelName);
  }

  /**
   * Add excluded model
   */
  addExcludedModel(modelName: string): void {
    this.excludedModels.add(modelName);
  }

  /**
   * Remove excluded model
   */
  removeExcludedModel(modelName: string): void {
    this.excludedModels.delete(modelName);
  }

  /**
   * Get all excluded models
   */
  getExcludedModels(): readonly string[] {
    return Array.from(this.excludedModels);
  }
}

/**
 * Create a new soft delete interceptor
 */
export function createSoftDeleteInterceptor(
  options: SoftDeleteOptions = {}
): SoftDeleteInterceptor {
  return new SoftDeleteInterceptor(options);
}
