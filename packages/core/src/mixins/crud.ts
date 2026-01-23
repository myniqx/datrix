/**
 * CRUD Operations Mixin
 *
 * Provides database CRUD (Create, Read, Update, Delete) operations.
 * This class encapsulates all data manipulation logic.
 */

import { DatabaseAdapter } from "forja-types/adapter";
import {
  SchemaRegistry,
  SchemaDefinition,
  ForjaEntry,
} from "forja-types/core/schema";
import {
  QueryObject,
  WhereClause,
  SelectClause,
  PopulateClause,
} from "forja-types/core/query-builder";
import { QueryAction } from "forja-types/plugin";
import { Dispatcher } from "../dispatcher";
import { IRawCrud } from "forja-types/forja";
import { ParsedQuery } from "forja-types";
import {
  throwQueryExecutionError,
  throwSchemaNotFoundError,
} from "./error-helper";
import {
  normalizeRelations,
  separateRelations,
  validateData,
  processPopulate,
  processRelation,
} from "./crud-helpers";

/**
 * CRUD Operations Class
 *
 * Handles all database CRUD operations with type-safe query building.
 * Implements IRawCrud interface.
 */
export class CrudOperations implements IRawCrud {
  constructor(
    private readonly schemas: SchemaRegistry,
    private readonly getAdapter: () => DatabaseAdapter,
    private readonly getDispatcher: (() => Dispatcher) | null = null,
  ) {}

  /** Dependencies for helper functions */
  private get populateDeps() {
    return {
      getSchema: (model: string) => this.getSchema(model),
      processSelect: (model: string, select?: SelectClause) =>
        this.processSelect(model, select),
    };
  }

  /**
   * Execute a query with optional plugin hooks
   *
   * If getDispatcher is null (raw mode), executes directly without hooks.
   * Otherwise, runs through the full plugin lifecycle (onBeforeQuery, onAfterQuery).
   *
   * @param action - Query action type
   * @param model - Model name
   * @param table - Table name
   * @param query - Query object
   * @param handler - Function that executes the actual database query
   * @returns Query result
   */
  private async execute<T>(
    action: QueryAction,
    model: string,
    table: string,
    query: QueryObject,
    handler: (q: QueryObject) => Promise<T>,
  ): Promise<T> {
    if (!this.getDispatcher) {
      return handler(query);
    }
    return this.getDispatcher().executeQuery(
      action,
      model,
      table,
      query,
      handler,
    );
  }

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
  async findOne<T extends ForjaEntry = ForjaEntry>(
    model: string,
    where: WhereClause,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<T | null> {
    const { tableName } = this.getSchema(model);
    const query: QueryObject = {
      type: "select",
      table: tableName!,
      where,
      select: this.processSelect(model, options?.select),
      populate: processPopulate(model, options?.populate, this.populateDeps),
      limit: 1,
    };

    return this.execute<T | null>(
      "findOne",
      model,
      tableName!,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<T>(q);
        if (!result.success) {
          throwQueryExecutionError("findOne", model, q, result.error);
        }
        return result.data.rows[0] ?? null;
      },
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
  async findById<T extends ForjaEntry = ForjaEntry>(
    model: string,
    id: string | number,
    options?: Pick<ParsedQuery, "select" | "populate">,
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
  async findMany<T extends ForjaEntry = ForjaEntry>(
    model: string,
    options?: Pick<
      ParsedQuery,
      "where" | "select" | "populate" | "orderBy" | "limit" | "offset"
    >,
  ): Promise<T[]> {
    const { tableName } = this.getSchema(model);
    const query: QueryObject = {
      type: "select",
      table: tableName!,
      where: options?.where,
      select: this.processSelect(model, options?.select),
      populate: processPopulate(model, options?.populate, this.populateDeps),
      orderBy: options?.orderBy,
      limit: options?.limit,
      offset: options?.offset,
    };

    return this.execute<T[]>("findMany", model, tableName!, query, async (q) => {
      const result = await this.getAdapter().executeQuery<T>(q);
      if (!result.success) {
        throwQueryExecutionError("findMany", model, q, result.error);
      }
      return result.data.rows as T[];
    });
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
    const { tableName } = this.getSchema(model);
    const query: QueryObject = {
      type: "count",
      table: tableName!,
      where,
    };

    return this.execute<number>("count", model, tableName!, query, async (q) => {
      const result = await this.getAdapter().executeQuery<{ count: number }>(q);
      if (!result.success) {
        throwQueryExecutionError("count", model, q, result.error);
      }
      return result.data.rows[0]?.count ?? 0;
    });
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
  async create<T extends ForjaEntry = ForjaEntry>(
    model: string,
    data: Record<string, unknown>,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<T> {
    const schema = this.getSchema(model);

    // 1. Normalize shortcuts (id -> RelationInput)
    const normalizedData = normalizeRelations(data, schema);

    // 2. Validate EVERYTHING (scalars + relations)
    // This solves the "required relation" problem because Validator now sees RelationInput
    const validatedData = validateData<T, false>(normalizedData, schema, {
      partial: false,
      isCreate: true,
      isRawMode: this.getDispatcher === null,
    });

    // 3. Separate scalars from async relations
    // Inlines local FKs (belongsTo) into scalars
    const { scalars, relations } = separateRelations(
      validatedData as Record<string, unknown>,
      schema,
    );

    // INSERT query - now contains local FKs
    const query: QueryObject = {
      type: "insert",
      table: schema.tableName!,
      data: scalars,
    };

    const insertedId = await this.execute<number | string>(
      "create",
      model,
      schema.tableName!,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<T>(q);
        if (!result.success) {
          throwQueryExecutionError("create", model, q, result.error);
        }
        // Get insertedId from result (standardized across adapters)
        return result.data.metadata?.insertId ?? result.data.rows?.[0]?.id!;
      },
    );

    // Process relations (connect/disconnect/set)
    const internalUpdate = this.internalUpdate.bind(this);
    for (const [fieldName, relationData] of Object.entries(relations)) {
      await processRelation(
        model,
        insertedId,
        fieldName,
        relationData,
        schema,
        internalUpdate,
      );
    }

    // Fetch created record with options applied (process select and populate)
    const fetchOptions =
      options ?
        {
          select: this.processSelect(model, options.select),
          populate: processPopulate(model, options.populate, this.populateDeps),
        }
        : undefined;

    return (await this.findById<T>(model, insertedId, fetchOptions))!;
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
  async update<T extends ForjaEntry = ForjaEntry>(
    model: string,
    id: string | number,
    data: Record<string, unknown>,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<T> {
    const schema = this.getSchema(model);

    // 1. Normalize shortcuts
    const normalizedData = normalizeRelations(data, schema);

    // 2. Validate everything (partial)
    const validatedData = validateData<T, true>(normalizedData, schema, {
      partial: true,
      isCreate: false,
      isRawMode: this.getDispatcher === null,
    });

    // 3. Separate and inline
    const { scalars, relations } = separateRelations(
      validatedData as Record<string, unknown>,
      schema,
    );

    // UPDATE query (only if there are scalar fields to update)
    if (Object.keys(scalars).length > 0) {
      const query: QueryObject = {
        type: "update",
        table: schema.tableName!,
        where: { id },
        data: scalars,
      };

      await this.execute<void>(
        "update",
        model,
        schema.tableName!,
        query,
        async (q) => {
          const result = await this.getAdapter().executeQuery<T>(q);
          if (!result.success) {
            throwQueryExecutionError("update", model, q, result.error);
          }
        },
      );
    }

    // Process relations (connect/disconnect/set)
    const internalUpdate = this.internalUpdate.bind(this);
    for (const [fieldName, relationData] of Object.entries(relations)) {
      await processRelation(model, id, fieldName, relationData, schema, internalUpdate);
    }

    // Fetch updated record with options applied (process select and populate)
    const fetchOptions =
      options ?
        {
          select: this.processSelect(model, options.select),
          populate: processPopulate(model, options.populate, this.populateDeps),
        }
        : undefined;

    return (await this.findById<T>(model, id, fetchOptions))!;
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
    data: Record<string, unknown>,
  ): Promise<number> {
    const schema = this.getSchema(model);

    // Validate data against schema (partial validation, timestamps added inside)
    const finalData = validateData<ForjaEntry, true>(data, schema, {
      partial: true,
      isCreate: false,
      isRawMode: this.getDispatcher === null,
    });

    const query: QueryObject = {
      type: "update",
      table: schema.tableName!,
      where,
      data: finalData,
    };

    return this.execute<number>(
      "updateMany",
      model,
      schema.tableName!,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<{ count: number }>(q);
        if (!result.success) {
          throwQueryExecutionError("updateMany", model, q, result.error);
        }
        return result.data.metadata.rowCount ?? 0;
      },
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
  async delete(
    model: string,
    id: string | number,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<boolean> {
    const { tableName } = this.getSchema(model);

    // If options provided, fetch record before deleting
    // (to return it with select/populate applied)
    if (options) {
      await this.findById(model, id, options);
    }

    // DELETE query
    const query: QueryObject = {
      type: "delete",
      table: tableName!,
      where: { id },
    };

    return this.execute<boolean>(
      "delete",
      model,
      tableName!,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<unknown>(q);
        if (!result.success) {
          throwQueryExecutionError("delete", model, q, result.error);
        }
        return (result.data.metadata.rowCount ?? 0) > 0;
      },
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
    const { tableName } = this.getSchema(model);
    const query: QueryObject = {
      type: "delete",
      table: tableName!,
      where,
    };

    return this.execute<number>(
      "deleteMany",
      model,
      tableName!,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<unknown>(q);
        if (!result.success) {
          throwQueryExecutionError("deleteMany", model, q, result.error);
        }
        return result.data.metadata.rowCount ?? 0;
      },
    );
  }

  /**
   * Get schema and table name (internal helper)
   * Reduces code duplication across all CRUD methods
   */
  private getSchema(model: string): SchemaDefinition {
    const schema = this.schemas.get(model);
    if (!schema) {
      throwSchemaNotFoundError(model);
    }
    return schema;
  }

  /**
   * Ensure reserved fields are included in select
   * Reserved fields (id, createdAt, updatedAt) must always be present
   *
   * @param select - User-provided select array or "*"
   * @returns Select with reserved fields guaranteed
   */
  /**
   * Process select clause using SchemaRegistry
   * - Resolves "*" to clean field list (excludes hidden & relation fields)
   * - Adds reserved fields to user-provided arrays
   *
   * @param model - Model name
   * @param select - User-provided select clause
   * @returns Processed select clause
   */
  private processSelect(model: string, select?: SelectClause): SelectClause {
    return this.schemas.getSelectFieldsFor(model, select);
  }

  /**
   * Internal update that bypasses dispatcher
   * Used for relation processing to avoid triggering hooks
   *
   * @param model - Model name
   * @param where - Where clause (supports both single and multi-record updates)
   * @param data - Data to update
   * @returns Number of affected rows
   *
   * @example
   * ```ts
   * // Single record
   * await this.internalUpdate('Post', { id: 5 }, { categoryId: 3 });
   *
   * // Multiple records by ID
   * await this.internalUpdate('Post', { id: { $in: [1, 2, 3] } }, { authorId: 5 });
   *
   * // Multiple records by foreign key
   * await this.internalUpdate('Post', { authorId: 5 }, { authorId: null });
   * ```
   */
  private async internalUpdate(
    model: string,
    where: WhereClause,
    data: Record<string, unknown>,
  ): Promise<number> {
    const { tableName } = this.getSchema(model);
    const query: QueryObject = {
      type: "update",
      table: tableName!,
      where,
      data,
    };

    const result = await this.getAdapter().executeQuery(query);
    if (!result.success) {
      throwQueryExecutionError("update", model, query, result.error);
    }
    return result.data.metadata?.rowCount ?? 0;
  }
}
