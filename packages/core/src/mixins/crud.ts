/**
 * CRUD Operations Mixin
 *
 * Provides database CRUD (Create, Read, Update, Delete) operations.
 * This class encapsulates all data manipulation logic.
 */

import { DatabaseAdapter } from "forja-types/adapter";
import {
  SchemaRegistry,
  ForjaEntry,
  ForjaRecord,
} from "forja-types/core/schema";
import {
  WhereClause,
} from "forja-types/core/query-builder";
import { Dispatcher } from "../dispatcher";
import { IRawCrud } from "forja-types/forja";
import { ParsedQuery } from "forja-types";
import { selectFrom, countFrom, insertInto, updateTable, deleteFrom } from "../query-builder";
import { QueryExecutor } from "../query-executor/executor";

/**
 * CRUD Operations Class
 *
 * Handles all database CRUD operations with type-safe query building.
 * Uses QueryExecutor for INSERT/UPDATE operations with relation processing.
 * Implements IRawCrud interface.
 */
export class CrudOperations implements IRawCrud {
  private readonly executor: QueryExecutor;

  constructor(
    private readonly schemas: SchemaRegistry,
    private readonly getAdapter: () => DatabaseAdapter,
    private readonly getDispatcher: (() => Dispatcher) | null = null,
  ) {
    // QueryExecutor handles validation, timestamps, and recursive relations
    this.executor = new QueryExecutor(
      schemas,
      getAdapter,
      getDispatcher || (() => ({} as Dispatcher)), // Dummy dispatcher if null
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

    const builder = selectFrom<T>(model, this.schemas)
      .where(where)
      .limit(1);

    if (options?.select) {
      builder.select(options.select);
    }
    if (options?.populate) {
      builder.populate(options.populate);
    }

    const query = builder.build();

    const results = await this.executor.execute<T, T[]>(query, {
      noDispatcher: this.getDispatcher === null,
    });

    return results[0] || null;
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
    const builder = selectFrom<T>(model, this.schemas);

    if (options?.where) {
      builder.where(options.where);
    }
    if (options?.select) {
      builder.select(options.select);
    }
    if (options?.populate) {
      builder.populate(options.populate);
    }
    if (options?.orderBy) {
      for (const order of options.orderBy) {
        builder.orderBy(order.field, order.direction);
      }
    }
    if (options?.limit !== undefined) {
      builder.limit(options.limit);
    }
    if (options?.offset !== undefined) {
      builder.offset(options.offset);
    }

    const query = builder.build();

    const results = await this.executor.execute<T, T[]>(query, {
      noDispatcher: this.getDispatcher === null,
    });

    return results;
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
    const builder = countFrom<T>(model, this.schemas);

    if (where) {
      builder.where(where);
    }

    const query = builder.build();

    const result = await this.executor.execute<T, number>(query, {
      noDispatcher: this.getDispatcher === null,
    });

    return result;
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
    data: Partial<T>,
    options?: Pick<ParsedQuery<T>, "select" | "populate">,
  ): Promise<T> {
    const builder = insertInto(model, data, this.schemas);

    if (options?.select) {
      builder.select(options.select);
    }
    if (options?.populate) {
      builder.populate(options.populate);
    }

    const query = builder.build();

    const result = await this.executor.execute<T, T>(query, {
      noDispatcher: this.getDispatcher === null,
      noReturning: false,
    });

    return result;
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
    data: Partial<T>,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<T> {
    const builder = updateTable(model, data, this.schemas).where({ id });

    if (options?.select) {
      builder.select(options.select);
    }
    if (options?.populate) {
      builder.populate(options.populate);
    }

    const query = builder.build();
    const result = await this.executor.execute<T, T>(query, {
      noDispatcher: this.getDispatcher === null,
      noReturning: false,
    });

    return result;
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
    noReturning = false
  ): Promise<number> {
    const builder = updateTable(model, data, this.schemas)
      .where(where);
    const query = builder.build();

    const result = await this.executor.execute<T, number>(query, {
      noDispatcher: this.getDispatcher === null,
      noReturning,
    });

    return result as number;
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
    const queryBuilder = deleteFrom<T>(model, this.schemas)
      .where({ id });

    if (options?.select) {
      queryBuilder.select(options.select);
    }
    if (options?.populate) {
      queryBuilder.populate(options.populate);
    }

    const query = queryBuilder.build();

    // Execute via QueryExecutor (handles CASCADE DELETE automatically)
    const result = await this.executor.execute<T, boolean>(query, {
      noDispatcher: this.getDispatcher === null,
      noReturning: !options,
    });

    return typeof result === 'boolean' ? result : true;
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
    const query = deleteFrom<T>(model, this.schemas)
      .where(where)
      .build();

    // Execute via QueryExecutor (handles CASCADE DELETE automatically)
    const result = await this.executor.execute<T, number>(query, {
      noDispatcher: this.getDispatcher === null,
      noReturning: true,
    });

    return result as number;
  }

}
