/**
 * Query Builder Type Definitions
 *
 * This file defines types for Forja's database-agnostic query builder.
 * Query builder produces QueryObject instances that adapters translate to SQL/NoSQL.
 */

import { Result } from "../utils";
import { ForjaEntry, SchemaDefinition } from "./schema";

/**
 * Primitive values that can be used in queries
 * (includes Date, excludes undefined)
 */
export type QueryPrimitive = string | number | boolean | null | Date;

/**
 * Query operation types
 */
export type QueryType = "select" | "insert" | "update" | "delete" | "count";

/**
 * Comparison operators
 */
export interface ComparisonOperators {
  readonly $eq?: QueryPrimitive;
  readonly $ne?: QueryPrimitive;
  readonly $gt?: number | Date;
  readonly $gte?: number | Date;
  readonly $lt?: number | Date;
  readonly $lte?: number | Date;
  readonly $in?: readonly QueryPrimitive[];
  readonly $nin?: readonly QueryPrimitive[];
  readonly $like?: string;
  readonly $ilike?: string; // Case-insensitive LIKE
  readonly $regex?: RegExp;
  readonly $exists?: boolean; // Field exists
  readonly $null?: boolean; // Is null
}

/**
 * Logical operators
 */
export interface LogicalOperators {
  readonly $and?: readonly WhereClause[];
  readonly $or?: readonly WhereClause[];
  readonly $not?: WhereClause;
}

/**
 * WHERE clause type
 */
export type WhereClause = {
  readonly [field: string]:
  | QueryPrimitive
  | ComparisonOperators
  | readonly WhereClause[];
} & Partial<LogicalOperators>;

/**
 * SELECT clause (fields to select)
 */
export type SelectClause = readonly string[] | "*";

/**
 * Populate clause (relations to include)
 */
export type PopulateOptions = {
  readonly select?: SelectClause;
  readonly where?: WhereClause;
  readonly populate?: PopulateClause; // Nested populate
  readonly limit?: number;
  readonly offset?: number;
  readonly orderBy?: OrderBy;
};

/**
 * Populate clause type
 */
export type PopulateClause =
  | false
  | {
    readonly [relation: string]: PopulateOptions | "*";
  };

/**
 * Order direction
 */
export type OrderDirection = "asc" | "desc";

/**
 * Order by item
 */
export type OrderByItem = {
  readonly field: string;
  readonly direction: OrderDirection;
  readonly nulls?: "first" | "last"; // NULL ordering
};

export type OrderBy = readonly OrderByItem[];

/**
 * Relation metadata injected by QueryBuilder for adapters
 *
 * This metadata is automatically generated when populate() is used
 * and provides adapters with the information needed to generate JOIN clauses.
 *
 * @see QueryBuilder.build() - Where this metadata is generated
 * @see DatabaseAdapter.executeQuery() - Where adapters consume this metadata
 *
 * @example
 * ```typescript
 * // When you call:
 * builder.populate({ author: { select: ['name'] } })
 *
 * // QueryBuilder injects:
 * meta: {
 *   relations: {
 *     author: {
 *       model: 'User',
 *       foreignKey: 'authorId',
 *       kind: 'belongsTo',
 *       targetTable: 'users'
 *     }
 *   }
 * }
 * ```
 */
export interface RelationMetadata {
  readonly model: string; // Target model name (e.g., 'User')
  readonly foreignKey: string; // Foreign key field name (e.g., 'authorId')
  readonly kind: "hasOne" | "hasMany" | "belongsTo" | "manyToMany";
  readonly targetTable: string; // Target table name (e.g., 'users')
}

/**
 * Query metadata for internal communication between QueryBuilder and Adapters/Plugins
 *
 * This metadata is NOT part of the public QueryBuilder API.
 * It is automatically injected during build() and consumed by adapters.
 *
 * @see RelationMetadata - Metadata structure for relations
 */
export interface QueryMetadata {
  /**
   * Relation metadata for populate/JOIN operations
   * Automatically injected by QueryBuilder when populate is used
   *
   * @see packages/core/src/query-builder/builder.ts - Injection point
   * @see packages/adapter-postgres/src/query-translator.ts - Usage example
   */
  readonly relations?: Record<string, RelationMetadata>;

  /**
   * Extensible metadata for plugins
   * Plugins can add their own metadata here for inter-plugin communication
   */
  readonly [key: string]: unknown;
}

/**
 * Query object (database-agnostic representation)
 */
export interface QueryObject<T extends ForjaEntry = ForjaEntry> {
  readonly type: QueryType;
  readonly table: string;
  readonly select?: SelectClause | undefined;
  readonly where?: WhereClause | undefined;
  readonly populate?: PopulateClause | undefined;
  readonly orderBy?: OrderBy | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly data?: Partial<T>; // For INSERT/UPDATE
  readonly returning?: SelectClause; // Fields to return after INSERT/UPDATE/DELETE
  readonly distinct?: boolean; // SELECT DISTINCT
  readonly groupBy?: readonly string[]; // GROUP BY fields
  readonly having?: WhereClause; // HAVING clause
  readonly meta?: QueryMetadata; // For internal adapter/plugin communication
}

/**
 * Query builder interface
 */
export interface QueryBuilder<TSchema = Record<string, unknown>> {
  /**
   * Set query type
   */
  type(type: QueryType): QueryBuilder<TSchema>;

  /**
   * Set table name
   */
  table(name: string): QueryBuilder<TSchema>;

  /**
   * Select fields
   */
  select(fields: SelectClause): QueryBuilder<TSchema>;

  /**
   * Add WHERE conditions
   */
  where(conditions: WhereClause): QueryBuilder<TSchema>;

  /**
   * Add AND condition
   */
  andWhere(conditions: WhereClause): QueryBuilder<TSchema>;

  /**
   * Add OR condition
   */
  orWhere(conditions: WhereClause): QueryBuilder<TSchema>;

  /**
   * Add populate (relations)
   */
  populate(relations: PopulateClause): QueryBuilder<TSchema>;

  /**
   * Add order by
   */
  orderBy(field: string, direction?: OrderDirection): QueryBuilder<TSchema>;

  /**
   * Set limit
   */
  limit(limit: number): QueryBuilder<TSchema>;

  /**
   * Set offset
   */
  offset(offset: number): QueryBuilder<TSchema>;

  /**
   * Set data for INSERT/UPDATE
   */
  data(data: Record<string, unknown>): QueryBuilder<TSchema>;

  /**
   * Set returning fields
   */
  returning(fields: SelectClause): QueryBuilder<TSchema>;

  /**
   * Set distinct
   */
  distinct(distinct?: boolean): QueryBuilder<TSchema>;

  /**
   * Set group by
   */
  groupBy(fields: readonly string[]): QueryBuilder<TSchema>;

  /**
   * Set having clause
   */
  having(conditions: WhereClause): QueryBuilder<TSchema>;

  /**
   * Build final query object
   * Returns Result to avoid throwing exceptions
   */
  build(): QueryObject; // Result<QueryObject, Error>;

  /**
   * Clone the builder
   */
  clone(): QueryBuilder<TSchema>;
}

/**
 * Query builder factory
 */
export type QueryBuilderFactory = <TSchema = Record<string, unknown>>(
  table: string,
  schema?: SchemaDefinition,
) => QueryBuilder<TSchema>;

/**
 * WHERE builder for complex conditions
 */
export interface WhereBuilder {
  /**
   * Build WHERE clause
   */
  build(conditions: WhereClause): WhereClause;

  /**
   * Combine conditions with AND
   */
  and(conditions: readonly WhereClause[]): WhereClause;

  /**
   * Combine conditions with OR
   */
  or(conditions: readonly WhereClause[]): WhereClause;

  /**
   * Negate condition
   */
  not(condition: WhereClause): WhereClause;

  /**
   * Validate WHERE clause
   */
  validate(where: WhereClause): Result<WhereClause, QueryBuilderError>;
}

/**
 * SELECT builder for field selection
 */
export interface SelectBuilder {
  /**
   * Build SELECT clause
   */
  build(fields: SelectClause): SelectClause;

  /**
   * Validate SELECT clause
   */
  validate(
    select: SelectClause,
    schema?: SchemaDefinition,
  ): Result<SelectClause, QueryBuilderError>;

  /**
   * Check if field exists in schema
   */
  hasField(field: string, schema: SchemaDefinition): boolean;
}

/**
 * POPULATE builder for relations
 */
export interface PopulateBuilder {
  /**
   * Build POPULATE clause
   */
  build(populate: PopulateClause): PopulateClause;

  /**
   * Validate POPULATE clause
   */
  validate(
    populate: PopulateClause,
    schema: SchemaDefinition,
  ): Result<PopulateClause, QueryBuilderError>;

  /**
   * Resolve nested populates
   */
  resolveNested(populate: PopulateClause, depth: number): readonly string[];
}

/**
 * Pagination builder
 */
export interface PaginationBuilder {
  /**
   * Build pagination (limit/offset)
   */
  build(
    page: number,
    pageSize: number,
  ): {
    readonly limit: number;
    readonly offset: number;
  };

  /**
   * Validate pagination parameters
   */
  validate(
    limit?: number,
    offset?: number,
  ): Result<
    { readonly limit: number; readonly offset: number },
    QueryBuilderError
  >;
}

/**
 * Query builder error
 */
export class QueryBuilderError extends Error {
  readonly code: string;
  readonly field: string | undefined;
  readonly details: unknown | undefined;

  constructor(
    message: string,
    options?: {
      code?: string;
      field?: string;
      details?: unknown;
    },
  ) {
    super(message);
    this.name = "QueryBuilderError";
    this.code = options?.code ?? "UNKNOWN";
    this.field = options?.field;
    this.details = options?.details;
  }
}

/**
 * Query optimization hints
 */
export interface QueryHints {
  readonly useIndex?: string; // Index name to use
  readonly forceIndex?: string; // Force specific index
  readonly ignoreIndex?: string; // Ignore specific index
  readonly maxExecutionTime?: number; // Max query execution time (ms)
}

/**
 * Query with hints
 */
export interface QueryWithHints extends QueryObject {
  readonly hints?: QueryHints;
}

/**
 * Query builder context
 */
export interface QueryBuilderContext {
  readonly schema?: SchemaDefinition;
  readonly table: string;
  readonly strict?: boolean; // Validate against schema
  readonly maxDepth?: number; // Max populate depth
}

/**
 * Type-safe query builder (infers types from schema)
 */
export type TypedQueryBuilder<T> = {
  select<K extends keyof T>(
    fields: readonly K[] | "*",
  ): TypedQueryBuilder<Pick<T, K>>;
  where(conditions: Partial<WhereConditions<T>>): TypedQueryBuilder<T>;
  orderBy<K extends keyof T>(
    field: K,
    direction?: OrderDirection,
  ): TypedQueryBuilder<T>;
  limit(limit: number): TypedQueryBuilder<T>;
  offset(offset: number): TypedQueryBuilder<T>;
  build(): QueryObject;
};

/**
 * Type-safe WHERE conditions
 */
export type WhereConditions<T> = {
  readonly [K in keyof T]?:
  | T[K]
  | (T[K] extends number | Date ? ComparisonOperators : never)
  | (T[K] extends string ? { readonly $like?: string } : never);
};

/**
 * Helper functions for type-safe metadata access
 */

/**
 * Get relation metadata for a specific relation
 *
 * @param query - Query object containing metadata
 * @param relationName - Name of the relation to retrieve
 * @returns Relation metadata or undefined if not found
 *
 * @example
 * ```typescript
 * const authorMeta = getRelationMetadata(query, 'author');
 * if (authorMeta) {
 *   console.log(authorMeta.foreignKey); // 'authorId'
 *   console.log(authorMeta.targetTable); // 'users'
 * }
 * ```
 */
export function getRelationMetadata(
  query: QueryObject,
  relationName: string,
): RelationMetadata | undefined {
  return query.meta?.relations?.[relationName];
}

/**
 * Get all relation metadata from query
 *
 * @param query - Query object containing metadata
 * @returns Record of all relation metadata or undefined
 *
 * @example
 * ```typescript
 * const relations = getAllRelationMetadata(query);
 * if (relations) {
 *   for (const [name, meta] of Object.entries(relations)) {
 *     console.log(`${name}: ${meta.targetTable}`);
 *   }
 * }
 * ```
 */
export function getAllRelationMetadata(
  query: QueryObject,
): Record<string, RelationMetadata> | undefined {
  return query.meta?.relations;
}

/**
 * Check if query has any relation metadata
 *
 * @param query - Query object to check
 * @returns True if query has at least one relation in metadata
 *
 * @example
 * ```typescript
 * if (hasRelationMetadata(query)) {
 *   // Generate JOINs
 * }
 * ```
 */
export function hasRelationMetadata(query: QueryObject): boolean {
  const relations = query.meta?.relations;
  return !!relations && Object.keys(relations).length > 0;
}

/**
 * Get custom metadata value from query
 *
 * Useful for plugins that inject their own metadata
 *
 * @param query - Query object containing metadata
 * @param key - Metadata key
 * @returns Metadata value or undefined
 *
 * @example
 * ```typescript
 * // A plugin might inject custom metadata
 * const softDeleteEnabled = getMetadataValue(query, 'softDelete');
 * ```
 */
export function getMetadataValue<T = unknown>(
  query: QueryObject,
  key: string,
): T | undefined {
  return query.meta?.[key] as T | undefined;
}

/**
 * Check if query has any metadata
 *
 * @param query - Query object to check
 * @returns True if query has metadata object
 */
export function hasMetadata(query: QueryObject): boolean {
  return !!query.meta && Object.keys(query.meta).length > 0;
}
