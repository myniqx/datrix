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
  RelationField,
  ForjaRecord,
} from "forja-types/core/schema";
import {
  QueryObject,
  WhereClause,
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
  processRelation,
} from "./crud-helpers";
import { QueryNormalizer } from "../query-builder";

/**
 * CRUD Operations Class
 *
 * Handles all database CRUD operations with type-safe query building.
 * Implements IRawCrud interface.
 */
export class CrudOperations implements IRawCrud {
  private readonly normalizer: QueryNormalizer;

  constructor(
    private readonly schemas: SchemaRegistry,
    private readonly getAdapter: () => DatabaseAdapter,
    private readonly getDispatcher: (() => Dispatcher) | null = null,
  ) {
    this.normalizer = new QueryNormalizer(schemas);
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
  private async execute<T extends ForjaEntry, R = T>(
    action: QueryAction,
    model: string,
    table: string,
    query: QueryObject<T>,
    handler: (q: QueryObject<T>) => Promise<R>,
  ): Promise<R> {
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
   * **NEW:** Now supports type-safe nested relation WHERE queries!
   *
   * @param model - Model name (e.g., 'User')
   * @param where - Filter criteria (now supports nested relations)
   * @param options - Query options (select, populate)
   * @returns Record or null if not found
   *
   * @example
   * ```ts
   * // Basic WHERE
   * const user = await crud.findOne('User', { email: 'test@example.com' });
   *
   * // Nested relation WHERE
   * const post = await crud.findOne('Post', {
   *   title: { $like: 'Hello%' },
   *   author: {  // ✅ NEW: Nested WHERE on relations!
   *     verified: { $eq: true },
   *     company: {
   *       country: { name: { $eq: 'Turkey' } }
   *     }
   *   }
   * });
   *
   * // With type safety
   * type Post = { id: number; title: string; author: Relation<User>; };
   * const typedPost = await crud.findOne<Post>('Post', {
   *   author: { name: { $like: 'John%' } }  // ✅ Type-checked
   * });
   * ```
   */
  async findOne<T extends ForjaEntry = ForjaEntry>(
    model: string,
    where: WhereClause<T>,
    options?: Pick<ParsedQuery<T>, "select" | "populate">,
  ): Promise<T | null> {
    const schema = this.getSchema(model);
    const query: QueryObject<T> = {
      type: "select",
      table: schema.tableName!,
      where: this.normalizer.normalizeWhere(where, schema),
      select: this.normalizer.normalizeSelect(options?.select, model),
      populate: this.normalizer.normalizePopulate(options?.populate, model),
      limit: this.normalizer.normalizeLimit(1),
    };

    return this.execute<T>(
      "findOne",
      model,
      schema.tableName!,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<T>(q);
        if (!result.success) {
          throwQueryExecutionError("findOne", model, q, result.error);
        }
        return result.data.rows[0]!;
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
  async findById<T extends ForjaEntry = ForjaRecord>(
    model: string,
    id: number,
    options?: Pick<ParsedQuery<T>, "select" | "populate">,
  ): Promise<T | null> {
    return this.findOne<T>(model, { id }, options);
  }

  /**
   * Find multiple records
   *
   * **NEW:** Now supports type-safe nested relation WHERE queries!
   *
   * @param model - Model name
   * @param options - Query options (with nested relation WHERE support)
   * @returns Array of records
   *
   * @example
   * ```ts
   * // Basic query
   * const users = await crud.findMany('User', {
   *   where: { role: 'admin' },
   *   limit: 10,
   *   orderBy: [{ field: 'createdAt', direction: 'desc' }]
   * });
   *
   * // With nested relation WHERE
   * const posts = await crud.findMany('Post', {
   *   where: {
   *     $and: [
   *       { published: true },
   *       { author: { verified: { $eq: true } } }  // ✅ Nested relation
   *     ]
   *   }
   * });
   * ```
   */
  async findMany<T extends ForjaEntry = ForjaRecord>(
    model: string,
    options?: Pick<
      ParsedQuery<T>,
      "where" | "select" | "populate" | "orderBy" | "limit" | "offset"
    >,
  ): Promise<T[]> {
    const schema = this.getSchema(model);
    const query: QueryObject<T> = {
      type: "select",
      table: schema.tableName!,
      where: this.normalizer.normalizeWhere(options?.where, schema),
      select: this.normalizer.normalizeSelect(options?.select, model),
      populate: this.normalizer.normalizePopulate(options?.populate, model),
      orderBy: this.normalizer.normalizeOrderBy(options?.orderBy),
      limit: this.normalizer.normalizeLimit(options?.limit),
      offset: this.normalizer.normalizeOffset(options?.offset),
    };

    return this.execute<T, T[]>("findMany", model, schema.tableName!, query, async (q) => {
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
   * **NEW:** Now supports type-safe nested relation WHERE queries!
   *
   * @param model - Model name
   * @param where - Filter criteria (supports nested relations)
   * @returns Number of matching records
   *
   * @example
   * ```ts
   * const totalUsers = await crud.count('User');
   * const adminCount = await crud.count('User', { role: 'admin' });
   *
   * // With nested relation WHERE
   * const verifiedPosts = await crud.count('Post', {
   *   author: { verified: { $eq: true } }
   * });
   * ```
   */
  async count<T extends ForjaEntry = ForjaRecord>(
    model: string,
    where?: WhereClause<T>,
  ): Promise<number> {
    const schema = this.getSchema(model);
    const query: QueryObject<T> = {
      type: "count",
      table: schema.tableName!,
      where: this.normalizer.normalizeWhere(where, schema),
    };

    return this.execute<T, number>("count", model, schema.tableName!, query, async (q) => {
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
  async create<T extends ForjaEntry = ForjaRecord>(
    model: string,
    data: Record<string, unknown>,
    options?: Pick<ParsedQuery<T>, "select" | "populate">,
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
    const { scalars, relations } = separateRelations(validatedData, schema);

    // INSERT query - now contains local FKs
    const query: QueryObject<T> = {
      type: "insert",
      table: schema.tableName!,
      data: scalars,
    };

    const insertedId = await this.execute<T, number>(
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
    const internalInsert = this.internalInsert.bind(this);
    const internalDelete = this.internalDelete.bind(this);
    for (const [fieldName, relationData] of Object.entries(relations)) {
      await processRelation(
        model,
        insertedId,
        fieldName,
        relationData,
        schema,
        internalUpdate,
        internalInsert,
        internalDelete,
      );
    }

    // Fetch created record with options applied
    return (await this.findById<T>(model, insertedId, options))!;
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
  async update<T extends ForjaEntry = ForjaRecord>(
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
    const { scalars, relations } = separateRelations(validatedData, schema);

    // UPDATE query (only if there are scalar fields to update)
    if (Object.keys(scalars).length > 0) {
      const query: QueryObject<T> = {
        type: "update",
        table: schema.tableName!,
        where: { id },
        data: scalars,
      };

      await this.execute<T, void>(
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
    const internalInsert = this.internalInsert.bind(this);
    const internalDelete = this.internalDelete.bind(this);
    for (const [fieldName, relationData] of Object.entries(relations)) {
      await processRelation(
        model,
        id,
        fieldName,
        relationData,
        schema,
        internalUpdate,
        internalInsert,
        internalDelete,
      );
    }

    // Fetch updated record with options applied
    return (await this.findById<T>(model, id, options))!;
  }

  /**
   * Update multiple records
   *
   * **NEW:** Now supports type-safe nested relation WHERE queries!
   *
   * @param model - Model name
   * @param where - Filter criteria (supports nested relations)
   * @param data - Updated data
   * @returns Number of updated records
   *
   * @example
   * ```ts
   * // Basic WHERE
   * const count = await crud.updateMany('User',
   *   { role: 'user' },
   *   { verified: true }
   * );
   *
   * // With nested relation WHERE
   * const count2 = await crud.updateMany('Post',
   *   { author: { verified: { $eq: true } } },  // ✅ NEW: Nested relation
   *   { featured: true }
   * );
   * ```
   */
  async updateMany<T extends ForjaEntry = ForjaRecord>(
    model: string,
    where: WhereClause<T>,
    data: Partial<T>,
  ): Promise<number> {
    const schema = this.getSchema(model);

    // Validate data against schema (partial validation, timestamps added inside)
    const finalData = validateData<T, true>(data, schema, {
      partial: true,
      isCreate: false,
      isRawMode: this.getDispatcher === null,
    });

    const query: QueryObject<T> = {
      type: "update",
      table: schema.tableName!,
      where: this.normalizer.normalizeWhere(where, schema),
      data: finalData,
    };

    return this.execute<T, number>(
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
  async delete<T extends ForjaEntry = ForjaRecord>(
    model: string,
    id: number,
    options?: Pick<ParsedQuery<T>, "select" | "populate">,
  ): Promise<boolean> {
    const schema = this.getSchema(model);

    // CASCADE DELETE: Clean up junction tables for manyToMany relations
    const m2mRelations = Object.entries(schema.fields).filter(
      ([_, field]) =>
        field.type === "relation" && (field as RelationField).kind === "manyToMany",
    );

    for (const [_, field] of m2mRelations) {
      const relation = field as RelationField;
      await this.internalDelete(relation.through!, { [`${model}Id`]: id });
    }

    // If options provided, fetch record before deleting
    // (to return it with select/populate applied)
    if (options) {
      await this.findById(model, id, options);
    }

    // DELETE query
    const query: QueryObject<T> = {
      type: "delete",
      table: schema.tableName!,
      where: { id },
    };

    return this.execute<T, boolean>(
      "delete",
      model,
      schema.tableName!,
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
   * **NEW:** Now supports type-safe nested relation WHERE queries!
   *
   * @param model - Model name
   * @param where - Filter criteria (supports nested relations)
   * @returns Number of deleted records
   *
   * @example
   * ```ts
   * // Basic WHERE
   * const count = await crud.deleteMany('User', { verified: false });
   *
   * // With nested relation WHERE
   * const count2 = await crud.deleteMany('Post', {
   *   author: { id: { $eq: userId } }  // ✅ NEW: Use relation WHERE instead of authorId
   * });
   * ```
   */
  async deleteMany<T extends ForjaEntry = ForjaRecord>(
    model: string,
    where: WhereClause<T>,
  ): Promise<number> {
    const schema = this.getSchema(model);

    // Find IDs to delete (needed for junction table cascade)
    const m2mRelations = Object.entries(schema.fields).filter(
      ([_, field]) =>
        field.type === "relation" && (field as RelationField).kind === "manyToMany",
    );

    // Only fetch IDs if we have manyToMany relations
    let idsToDelete: (string | number)[] = [];
    if (m2mRelations.length > 0) {
      const toDelete = await this.findMany<T>(model, {
        where,
        select: ["id"],
      });
      idsToDelete = toDelete.map((r) => r.id);

      if (idsToDelete.length === 0) {
        return 0; // Nothing to delete
      }

      // CASCADE DELETE: Clean up junction tables
      for (const [_, field] of m2mRelations) {
        const relation = field as RelationField;
        await this.internalDelete(relation.through!, {
          [`${model}Id`]: { $in: idsToDelete },
        });
      }
    }

    const query: QueryObject<T> = {
      type: "delete",
      table: schema.tableName!,
      where: this.normalizer.normalizeWhere(where, schema),
    };

    return this.execute<T, number>(
      "deleteMany",
      model,
      schema.tableName!,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<ForjaEntry>(q);
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
   * Internal insert that bypasses dispatcher
   * Used for relation processing (junction tables) to avoid triggering hooks
   *
   * @param model - Model name
   * @param data - Data to insert
   * @returns Inserted record ID
   *
   * @example
   * ```ts
   * // Insert junction record
   * await this.internalInsert('Post_Tag', { postId: 1, tagId: 5 });
   * ```
   */
  private async internalInsert(
    model: string,
    data: Record<string, unknown>,
  ): Promise<number | string> {
    const { tableName } = this.getSchema(model);
    const query: QueryObject = {
      type: "insert",
      table: tableName!,
      data,
    };

    const result = await this.getAdapter().executeQuery<ForjaEntry>(query);
    if (!result.success) {
      throwQueryExecutionError("insert", model, query, result.error);
    }
    return result.data.metadata?.insertId ?? result.data.rows?.[0]?.id!;
  }

  /**
   * Internal delete that bypasses dispatcher
   * Used for relation processing (junction tables) to avoid triggering hooks
   *
   * @param model - Model name
   * @param where - Where clause
   * @returns Number of deleted rows
   *
   * @example
   * ```ts
   * // Delete junction records
   * await this.internalDelete('Post_Tag', { postId: 1, tagId: { $in: [1, 2, 3] } });
   * ```
   */
  private async internalDelete(
    model: string,
    where: WhereClause,
  ): Promise<number> {
    const { tableName } = this.getSchema(model);
    const query: QueryObject = {
      type: "delete",
      table: tableName!,
      where,
    };

    const result = await this.getAdapter().executeQuery(query);
    if (!result.success) {
      throwQueryExecutionError("delete", model, query, result.error);
    }
    return result.data.metadata?.rowCount ?? 0;
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
