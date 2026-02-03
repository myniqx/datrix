/**
 * Query Builder Base Implementation (~150 LOC)
 *
 * Fluent API for building database-agnostic queries.
 * Produces QueryObject instances that adapters translate to SQL/NoSQL.
 */

import type {
  QueryBuilder,
  QueryObject,
  QueryType,
  SelectClause,
  WhereClause,
  PopulateClause,
  OrderByItem,
  OrderDirection,
} from "forja-types/core/query-builder";

import { normalizeWhere } from "./where";
import { normalizePopulateArray } from "./populate";
import { normalizeSelect } from "./select";
import {
  throwSchemaNotFound,
  throwInvalidQueryType,
  throwMissingTable,
} from "./error-helper";
import type {
  ForjaEntry,
  SchemaRegistry as ISchemaRegistry,
  SchemaDefinition,
} from "forja-types/core/schema";

/**
 * Deep clone an object (safe for JSON-serializable data)
 */
function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T;
  }

  if (obj instanceof RegExp) {
    return new RegExp(obj.source, obj.flags) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as T;
  }

  const cloned: Record<string, unknown> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }

  return cloned as T;
}

/**
 * Mutable query state for building
 */
interface MutableQueryState<T extends ForjaEntry> {
  type?: QueryType;
  table?: string;
  select?: SelectClause<T>[];
  where?: WhereClause<T>[];
  populate?: (PopulateClause<T> | "*" | readonly string[])[];
  orderBy?: OrderByItem[];
  limit?: number;
  offset?: number;
  data?: Partial<T>;
  distinct?: boolean;
  groupBy?: string[];
  having?: WhereClause<T>;
}

/**
 * Query builder implementation
 */
export class ForjaQueryBuilder<
  TSchema extends ForjaEntry,
> implements QueryBuilder<TSchema> {
  private query: MutableQueryState<TSchema>;
  private readonly _modelName: string;
  private readonly _schema: SchemaDefinition;
  private readonly _registry: ISchemaRegistry;

  /**
   * Constructor for the query builder
   *
   * @param modelName - Model name (e.g., 'User', 'Post')
   * @param schemaRegistry - Schema registry for normalization and relation resolution
   *
   * This enables full normalization support:
   * - SELECT: "*" → expanded to field list, reserved fields added
   * - WHERE: relation shortcuts normalized (category: 2 → categoryId: { $eq: 2 })
   * - POPULATE: wildcards, dot notation, nested processing, relation traversal
   *
   * @throws {Error} If schema not found in registry
   *
   * @example
   * ```ts
   * const builder = new ForjaQueryBuilder('User', schemaRegistry);
   * builder.select('*').where({ role: 'admin' });
   * ```
   */
  constructor(modelName: string, schemaRegistry: ISchemaRegistry, type: QueryType = "select") {
    this._modelName = modelName;
    this._registry = schemaRegistry;

    // Get schema from registry
    const schema = schemaRegistry.get(modelName)!;
    if (!schema) {
      throwSchemaNotFound(modelName);
    }

    this._schema = schema;
    this.query = {
      table: schema.tableName!,
      type,
    }
  }

  /**
   * Select fields
   */
  select(fields: SelectClause<TSchema>): this {
    if (this.query.select === undefined) {
      this.query.select = [fields];
    } else {
      this.query.select.push(fields);
    }
    return this;
  }

  /**
   * Add WHERE conditions
   */
  where(conditions: WhereClause<TSchema>): this {
    if (this.query.where === undefined) {
      this.query.where = [conditions];
    }
    else {
      this.query.where.push(conditions);
    }
    return this;
  }


  /**
   * Populate relations
   *
   * Supports multiple formats:
   * - .populate('*') - all relations
   * - .populate(['author', 'category']) - array
   * - .populate({ author: true }) - object
   *
   * Multiple calls are accumulated and merged in build()
   */
  populate(relations: PopulateClause<TSchema> | "*" | readonly string[]): this {
    if (this.query.populate === undefined) {
      this.query.populate = [relations];
    } else {
      this.query.populate.push(relations);
    }
    return this;
  }

  /**
   * Order by field
   */
  orderBy(field: string, direction: OrderDirection = "asc"): this {
    const orderByItem: OrderByItem = { field, direction };
    this.query.orderBy = [...(this.query.orderBy || []), orderByItem];
    return this;
  }

  /**
   * Set limit
   */
  limit(count: number): this {
    this.query.limit = count;
    return this;
  }

  /**
   * Set offset
   */
  offset(count: number): this {
    this.query.offset = count;
    return this;
  }

  /**
   * Set data for INSERT/UPDATE
   */
  data(values: Partial<TSchema>): this {
    this.query.data = values;
    return this;
  }

  /**
   * Set DISTINCT
   */
  distinct(enabled = true): this {
    this.query.distinct = enabled;
    return this;
  }

  /**
   * Group by fields
   */
  groupBy(fields: readonly string[]): this {
    this.query.groupBy = [...(this.query.groupBy || []), ...fields];
    return this;
  }

  /**
   * Having clause (for GROUP BY)
   */
  having(conditions: WhereClause<TSchema>): this {
    this.query.having = conditions;
    return this;
  }

  /**
   * Build final QueryObject
   * @throws {ForjaQueryBuilderError} If query is invalid
   */
  build(): QueryObject<TSchema> {
    // Validate required fields
    if (!this.query.type) {
      throwInvalidQueryType(this.query.type);
    }

    if (!this.query.table) {
      throwMissingTable();
    }

    // Normalize select: merge, validate, add reserved fields
    const normalizedSelect = normalizeSelect(
      this.query.select,
      this._schema,
      this._modelName,
      this._registry,
    );

    // Normalize where: merge, validate (including nested), normalize relation shortcuts
    const normalizedWhere = normalizeWhere(
      this.query.where,
      this._schema,
      this._registry,
    );

    // Normalize populate: merge, validate, expand wildcards
    const normalizedPopulate = normalizePopulateArray(
      this.query.populate,
      this._modelName,
      this._registry,
    );

    const query: QueryObject<TSchema> = {
      type: this.query.type,
      table: this.query.table,
      select: normalizedSelect,
      ...(normalizedWhere !== undefined && { where: normalizedWhere }),
      ...(normalizedPopulate !== undefined && { populate: normalizedPopulate }),
      ...(this.query.orderBy !== undefined && {
        orderBy: this.query.orderBy as readonly OrderByItem[],
      }),
      ...(this.query.limit !== undefined && { limit: this.query.limit }),
      ...(this.query.offset !== undefined && { offset: this.query.offset }),
      ...(this.query.data !== undefined && { data: this.query.data }),
      ...(this.query.distinct !== undefined && { distinct: this.query.distinct }),
      ...(this.query.groupBy !== undefined && {
        groupBy: this.query.groupBy as readonly string[],
      }),
      ...(this.query.having !== undefined && { having: this.query.having }),
    };

    return query;
  }

  /**
   * Clone builder (for reusability)
   */
  clone(): QueryBuilder<TSchema> {
    const cloned = new ForjaQueryBuilder<TSchema>(this._modelName, this._registry);

    // Deep clone the query state to avoid shared references
    cloned.query = {
      ...this.query,
      // Deep clone nested objects
      ...(this.query.where !== undefined && {
        where: deepClone(this.query.where),
      }),
      ...(this.query.populate !== undefined && {
        populate: deepClone(this.query.populate),
      }),
      ...(this.query.data !== undefined && { data: deepClone(this.query.data) }),
      ...(this.query.orderBy !== undefined && {
        orderBy: deepClone(this.query.orderBy),
      }),
      ...(this.query.groupBy !== undefined && {
        groupBy: deepClone(this.query.groupBy),
      }),
      ...(this.query.having !== undefined && {
        having: deepClone(this.query.having),
      }),
    };

    return cloned;
  }

  /**
   * Reset builder to initial state
   */
  reset(): this {
    this.query = {};
    return this;
  }
}

/**
 * Create a new query builder
 *
 * @param modelName - Model name (e.g., 'User', 'Post')
 * @param schemaRegistry - Schema registry
 * @returns Query builder instance
 *
 * @example
 * ```ts
 * const builder = createQueryBuilder<User>('User', registry);
 * ```
 */
export function createQueryBuilder<TSchema extends ForjaEntry>(
  modelName: string,
  schemaRegistry: ISchemaRegistry,
  type: QueryType = "select",
): ForjaQueryBuilder<TSchema> {
  return new ForjaQueryBuilder<TSchema>(modelName, schemaRegistry, type);
}

/**
 * Create SELECT query builder
 *
 * @param modelName - Model name (e.g., 'User', 'Post')
 * @param schemaRegistry - Schema registry
 * @returns Query builder instance with type=select
 *
 * @example
 * ```ts
 * const query = selectFrom<User>('User', registry)
 *   .select(['id', 'name'])
 *   .where({ role: 'admin' })
 *   .build();
 * ```
 */
export function selectFrom<TSchema extends ForjaEntry>(
  modelName: string,
  schemaRegistry: ISchemaRegistry,
): ForjaQueryBuilder<TSchema> {
  return new ForjaQueryBuilder<TSchema>(modelName, schemaRegistry, "select");
}

/**
 * Create INSERT query builder
 *
 * @param modelName - Model name (e.g., 'User', 'Post')
 * @param data - Data to insert
 * @param schemaRegistry - Schema registry
 * @returns Query builder instance with type=insert
 *
 * @example
 * ```ts
 * const query = insertInto<User>('User', { name: 'John' }, registry).build();
 * ```
 */
export function insertInto<TSchema extends ForjaEntry>(
  modelName: string,
  data: Partial<TSchema>,
  schemaRegistry: ISchemaRegistry,
): ForjaQueryBuilder<TSchema> {
  return new ForjaQueryBuilder<TSchema>(modelName, schemaRegistry, "insert")
    .data(data);
}

/**
 * Create UPDATE query builder
 *
 * @param modelName - Model name (e.g., 'User', 'Post')
 * @param data - Data to update
 * @param schemaRegistry - Schema registry
 * @returns Query builder instance with type=update
 *
 * @example
 * ```ts
 * const query = updateTable<User>('User', { name: 'Jane' }, registry)
 *   .where({ id: 1 })
 *   .build();
 * ```
 */
export function updateTable<TSchema extends ForjaEntry>(
  modelName: string,
  data: Partial<TSchema>,
  schemaRegistry: ISchemaRegistry,
): ForjaQueryBuilder<TSchema> {
  return new ForjaQueryBuilder<TSchema>(modelName, schemaRegistry, "update")
    .data(data);
}

/**
 * Create DELETE query builder
 *
 * @param modelName - Model name (e.g., 'User', 'Post')
 * @param schemaRegistry - Schema registry
 * @returns Query builder instance with type=delete
 *
 * @example
 * ```ts
 * const query = deleteFrom<User>('User', registry)
 *   .where({ id: 1 })
 *   .build();
 * ```
 */
export function deleteFrom<TSchema extends ForjaEntry>(
  modelName: string,
  schemaRegistry: ISchemaRegistry,
): ForjaQueryBuilder<TSchema> {
  return new ForjaQueryBuilder<TSchema>(modelName, schemaRegistry, "delete");
}

/**
 * Create COUNT query builder
 *
 * @param modelName - Model name (e.g., 'User', 'Post')
 * @param schemaRegistry - Schema registry
 * @returns Query builder instance with type=count
 *
 * @example
 * ```ts
 * const query = countFrom<User>('User', registry)
 *   .where({ role: 'admin' })
 *   .build();
 * ```
 */
export function countFrom<TSchema extends ForjaEntry>(
  modelName: string,
  schemaRegistry: ISchemaRegistry,
): ForjaQueryBuilder<TSchema> {
  return new ForjaQueryBuilder<TSchema>(modelName, schemaRegistry, "count");
}
