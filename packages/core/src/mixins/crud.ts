/**
 * CRUD Operations Mixin
 *
 * Provides database CRUD (Create, Read, Update, Delete) operations.
 * This class encapsulates all data manipulation logic.
 */

import { DatabaseAdapter } from 'forja-types/adapter';
import { SchemaRegistry } from 'forja-types/core/schema';
import {
  QueryObject,
  WhereClause,
  SelectClause,
  PopulateClause,
  OrderByItem,
} from 'forja-types/core/query-builder';
import { ForjaError } from '../forja';
import { Dispatcher } from '../dispatcher';

/**
 * CRUD Operations Class
 *
 * Handles all database CRUD operations with type-safe query building.
 */
export class CrudOperations {
  constructor(
    private readonly schemas: SchemaRegistry,
    private readonly getAdapter: () => DatabaseAdapter,
    private readonly getDispatcher: () => Dispatcher
  ) {}

  /**
   * Find one record by criteria
   *
   * @param model - Model name (e.g., 'User')
   * @param where - Filter criteria
   * @param options - Query options (select, populate)
   * @returns Record or null if not found
   *
   * @example
   * ```ts
   * const user = await crud.findOne('User', { email: 'test@example.com' });
   * const post = await crud.findOne('Post', { slug: 'hello-world' }, {
   *   populate: { author: { select: ['name', 'email'] } }
   * });
   * ```
   */
  async findOne<T = unknown>(
    model: string,
    where: WhereClause,
    options?: {
      readonly select?: SelectClause;
      readonly populate?: PopulateClause;
    }
  ): Promise<T | null> {
    const schema = this.schemas.get(model);
    if (!schema) {
      throw new ForjaError(`Schema '${model}' not found`, 'SCHEMA_NOT_FOUND');
    }

    const table = schema.tableName || `${model.toLowerCase()}s`;
    const query: QueryObject = {
      type: 'select',
      table,
      where,
      select: options?.select,
      populate: options?.populate,
      limit: 1,
    };

    return await this.getDispatcher().executeQuery<T | null>(
      'findOne',
      model,
      table,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<T>(q);
        if (!result.success) {
          throw new ForjaError(
            `Failed to find ${model}: ${result.error.message}`,
            'QUERY_FAILED'
          );
        }
        return result.data.rows[0] ?? null;
      }
    );
  }

  /**
   * Find one record by ID
   *
   * @param model - Model name
   * @param id - Record ID
   * @param options - Query options
   * @returns Record or null
   *
   * @example
   * ```ts
   * const user = await crud.findById('User', '123');
   * ```
   */
  async findById<T = unknown>(
    model: string,
    id: string | number,
    options?: {
      readonly select?: SelectClause;
      readonly populate?: PopulateClause;
    }
  ): Promise<T | null> {
    return this.findOne<T>(model, { id }, options);
  }

  /**
   * Find multiple records
   *
   * @param model - Model name
   * @param options - Query options
   * @returns Array of records
   *
   * @example
   * ```ts
   * const users = await crud.findMany('User', {
   *   where: { role: 'admin' },
   *   limit: 10,
   *   orderBy: [{ field: 'createdAt', direction: 'desc' }]
   * });
   * ```
   */
  async findMany<T = unknown>(
    model: string,
    options?: {
      readonly where?: WhereClause;
      readonly select?: SelectClause;
      readonly populate?: PopulateClause;
      readonly orderBy?: readonly OrderByItem[];
      readonly limit?: number;
      readonly offset?: number;
    }
  ): Promise<T[]> {
    const schema = this.schemas.get(model);
    if (!schema) {
      throw new ForjaError(`Schema '${model}' not found`, 'SCHEMA_NOT_FOUND');
    }

    const table = schema.tableName || `${model.toLowerCase()}s`;
    const query: QueryObject = {
      type: 'select',
      table,
      where: options?.where,
      select: options?.select,
      populate: options?.populate,
      orderBy: options?.orderBy,
      limit: options?.limit,
      offset: options?.offset,
    };

    return await this.getDispatcher().executeQuery<T[]>(
      'findMany',
      model,
      table,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<T>(q);
        if (!result.success) {
          throw new ForjaError(
            `Failed to find ${model}: ${result.error.message}`,
            'QUERY_FAILED'
          );
        }
        return result.data.rows;
      }
    );
  }

  /**
   * Count records
   *
   * @param model - Model name
   * @param where - Filter criteria
   * @returns Number of matching records
   *
   * @example
   * ```ts
   * const totalUsers = await crud.count('User');
   * const adminCount = await crud.count('User', { role: 'admin' });
   * ```
   */
  async count(model: string, where?: WhereClause): Promise<number> {
    const schema = this.schemas.get(model);
    if (!schema) {
      throw new ForjaError(`Schema '${model}' not found`, 'SCHEMA_NOT_FOUND');
    }

    const table = schema.tableName || `${model.toLowerCase()}s`;
    const query: QueryObject = {
      type: 'count',
      table,
      where,
    };

    return await this.getDispatcher().executeQuery<number>(
      'count',
      model,
      table,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<{ count: number }>(q);
        if (!result.success) {
          throw new ForjaError(
            `Failed to count ${model}: ${result.error.message}`,
            'QUERY_FAILED'
          );
        }
        return result.data.rows[0]?.count ?? 0;
      }
    );
  }

  /**
   * Create a new record
   *
   * @param model - Model name
   * @param data - Record data
   * @returns Created record
   *
   * @example
   * ```ts
   * const user = await crud.create('User', {
   *   email: 'john@example.com',
   *   name: 'John Doe',
   *   role: 'user'
   * });
   * ```
   */
  async create<T = unknown>(
    model: string,
    data: Record<string, unknown>
  ): Promise<T> {
    const schema = this.schemas.get(model);
    if (!schema) {
      throw new ForjaError(`Schema '${model}' not found`, 'SCHEMA_NOT_FOUND');
    }

    const table = schema.tableName || `${model.toLowerCase()}s`;
    const query: QueryObject = {
      type: 'insert',
      table,
      data,
      returning: '*',
    };

    return await this.getDispatcher().executeQuery<T>(
      'create',
      model,
      table,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<T>(q);
        if (!result.success) {
          throw new ForjaError(
            `Failed to create ${model}: ${result.error.message}`,
            'QUERY_FAILED'
          );
        }
        return result.data.rows[0]!;
      }
    );
  }

  /**
   * Update a record by ID
   *
   * @param model - Model name
   * @param id - Record ID
   * @param data - Updated data
   * @returns Updated record
   *
   * @example
   * ```ts
   * const user = await crud.update('User', '123', {
   *   name: 'Jane Doe'
   * });
   * ```
   */
  async update<T = unknown>(
    model: string,
    id: string | number,
    data: Record<string, unknown>
  ): Promise<T> {
    const schema = this.schemas.get(model);
    if (!schema) {
      throw new ForjaError(`Schema '${model}' not found`, 'SCHEMA_NOT_FOUND');
    }

    const table = schema.tableName || `${model.toLowerCase()}s`;
    const query: QueryObject = {
      type: 'update',
      table,
      where: { id },
      data,
      returning: '*',
    };

    return await this.getDispatcher().executeQuery<T>(
      'update',
      model,
      table,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<T>(q);
        if (!result.success) {
          throw new ForjaError(
            `Failed to update ${model}: ${result.error.message}`,
            'QUERY_FAILED'
          );
        }
        return result.data.rows[0]!;
      }
    );
  }

  /**
   * Update multiple records
   *
   * @param model - Model name
   * @param where - Filter criteria
   * @param data - Updated data
   * @returns Number of updated records
   *
   * @example
   * ```ts
   * const count = await crud.updateMany('User',
   *   { role: 'user' },
   *   { verified: true }
   * );
   * ```
   */
  async updateMany(
    model: string,
    where: WhereClause,
    data: Record<string, unknown>
  ): Promise<number> {
    const schema = this.schemas.get(model);
    if (!schema) {
      throw new ForjaError(`Schema '${model}' not found`, 'SCHEMA_NOT_FOUND');
    }

    const table = schema.tableName || `${model.toLowerCase()}s`;
    const query: QueryObject = {
      type: 'update',
      table,
      where,
      data,
    };

    return await this.getDispatcher().executeQuery<number>(
      'updateMany',
      model,
      table,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<{ count: number }>(q);
        if (!result.success) {
          throw new ForjaError(
            `Failed to update ${model}: ${result.error.message}`,
            'QUERY_FAILED'
          );
        }
        return result.data.metadata.rowCount ?? 0;
      }
    );
  }

  /**
   * Delete a record by ID
   *
   * @param model - Model name
   * @param id - Record ID
   * @returns True if deleted
   *
   * @example
   * ```ts
   * const deleted = await crud.delete('User', '123');
   * ```
   */
  async delete(model: string, id: string | number): Promise<boolean> {
    const schema = this.schemas.get(model);
    if (!schema) {
      throw new ForjaError(`Schema '${model}' not found`, 'SCHEMA_NOT_FOUND');
    }

    const table = schema.tableName || `${model.toLowerCase()}s`;
    const query: QueryObject = {
      type: 'delete',
      table,
      where: { id },
    };

    return await this.getDispatcher().executeQuery<boolean>(
      'delete',
      model,
      table,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<unknown>(q);
        if (!result.success) {
          throw new ForjaError(
            `Failed to delete ${model}: ${result.error.message}`,
            'QUERY_FAILED'
          );
        }
        return (result.data.metadata.rowCount ?? 0) > 0;
      }
    );
  }

  /**
   * Delete multiple records
   *
   * @param model - Model name
   * @param where - Filter criteria
   * @returns Number of deleted records
   *
   * @example
   * ```ts
   * const count = await crud.deleteMany('User', { verified: false });
   * ```
   */
  async deleteMany(model: string, where: WhereClause): Promise<number> {
    const schema = this.schemas.get(model);
    if (!schema) {
      throw new ForjaError(`Schema '${model}' not found`, 'SCHEMA_NOT_FOUND');
    }

    const table = schema.tableName || `${model.toLowerCase()}s`;
    const query: QueryObject = {
      type: 'delete',
      table,
      where,
    };

    return await this.getDispatcher().executeQuery<number>(
      'deleteMany',
      model,
      table,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<unknown>(q);
        if (!result.success) {
          throw new ForjaError(
            `Failed to delete ${model}: ${result.error.message}`,
            'QUERY_FAILED'
          );
        }
        return result.data.metadata.rowCount ?? 0;
      }
    );
  }
}
