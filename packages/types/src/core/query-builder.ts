/**
 * Query Builder Type Definitions
 *
 * This file defines types for Forja's database-agnostic query builder.
 * Query builder produces QueryObject instances that adapters translate to SQL/NoSQL.
 */

import { Result } from "../utils";
import { ForjaEntry, ForjaRecord, SchemaDefinition, Relation } from "./schema";

/**
 * Primitive values that can be used in queries
 * (includes Date, excludes undefined)
 */
export type QueryPrimitive = string | number | boolean | null | Date;

/**
 * Scalar value types (for type-safe WHERE conditions)
 */
export type ScalarValue = string | number | boolean | Date;

/**
 * Query operation types
 */
export type QueryType = "select" | "insert" | "update" | "delete" | "count";

/**
 * Type-safe comparison operators
 *
 * Operators are type-aware based on the field type:
 * - String fields: All string operators ($like, $regex, etc.)
 * - Number/Date fields: Comparison operators ($gt, $gte, etc.)
 * - All fields: Equality and existence operators
 *
 * @template T - The field value type
 *
 * @example
 * ```ts
 * // String field
 * const nameOp: ComparisonOperators<string> = { $like: 'John%' };  // ✅
 * const nameOp2: ComparisonOperators<string> = { $gt: 5 };         // ❌ Type error
 *
 * // Number field
 * const ageOp: ComparisonOperators<number> = { $gte: 18 };         // ✅
 * const ageOp2: ComparisonOperators<number> = { $like: 'x' };      // ❌ Type error
 * ```
 */
export type ComparisonOperators<T = QueryPrimitive> = {
  readonly $eq?: T;
  readonly $ne?: T;
  readonly $gt?: T extends number | Date ? T : never;
  readonly $gte?: T extends number | Date ? T : never;
  readonly $lt?: T extends number | Date ? T : never;
  readonly $lte?: T extends number | Date ? T : never;
  readonly $in?: readonly T[];
  readonly $nin?: readonly T[];
  readonly $like?: T extends string ? string : never;
  readonly $ilike?: T extends string ? string : never;
  readonly $regex?: T extends string ? RegExp : never;
  readonly $exists?: boolean;
  readonly $null?: boolean;
};

/**
 * Type-safe logical operators
 *
 * Logical operators ($and, $or, $not) are now type-aware and preserve
 * the type information through nested conditions.
 *
 * @template T - The entity type (extends ForjaEntry)
 *
 * @example
 * ```ts
 * const condition: LogicalOperators<Post> = {
 *   $and: [
 *     { title: { $like: 'Hello%' } },
 *     { author: { name: { $eq: 'John' } } }
 *   ]
 * };
 * ```
 */
export type LogicalOperators<T extends ForjaEntry = ForjaEntry> = {
  readonly $and?: readonly WhereClause<T>[];
  readonly $or?: readonly WhereClause<T>[];
  readonly $not?: WhereClause<T>;
};

/**
 * Type-safe WHERE clause with nested relation support
 *
 * **Design Philosophy:**
 * - Default type: `ForjaEntry & Record<string, unknown>` (flexible but safe)
 * - Custom type: Full type safety with autocomplete
 * - Relation fields: Automatically supports nested WHERE conditions
 * - Foreign keys: Not exposed (internal implementation detail)
 *
 * **Type Inference:**
 * - Scalar fields → Direct value or ComparisonOperators
 * - Relation fields (branded as Relation<T>) → Nested WhereClause<T>
 * - Unknown fields → Fallback to `unknown` for flexibility
 *
 * @template T - The entity type (default: ForjaRecord)
 *
 * @example
 * ```ts
 * // 1. Without type (flexible, works with any field)
 * const where: WhereClause = {
 *   id: 5,
 *   anyField: 'value'
 * };
 *
 * // 2. With type (type-safe, autocomplete enabled)
 * type Post = {
 *   id: number;
 *   title: string;
 *   price: number;
 *   author: Relation<User>;
 * };
 *
 * const where: WhereClause<Post> = {
 *   title: { $like: 'Hello%' },        // ✅ String operators
 *   price: { $gte: 10 },               // ✅ Number operators
 *   author: {                          // ✅ Nested relation WHERE
 *     name: { $eq: 'John' },
 *     verified: { $eq: true }
 *   }
 * };
 *
 * // 3. Complex nested queries
 * const complexWhere: WhereClause<Post> = {
 *   $and: [
 *     { price: { $gt: 10 } },
 *     {
 *       author: {
 *         company: {                   // ✅ Deep nesting
 *           country: {
 *             name: { $eq: 'Turkey' }
 *           }
 *         }
 *       }
 *     }
 *   ]
 * };
 *
 * // ❌ Type errors (when using typed version)
 * const invalid: WhereClause<Post> = {
 *   title: { $gt: 5 },                 // ❌ $gt not valid for strings
 *   price: { $like: 'x' },             // ❌ $like not valid for numbers
 *   author: 5                          // ❌ Must use nested WHERE, not direct ID
 * };
 * ```
 */
export type WhereClause<T extends ForjaEntry = ForjaRecord> = {
  [K in keyof T]?: // Relation fields → Nested WhereClause
  T[K] extends Relation<infer R> ? WhereClause<R>
  : // Scalar fields → Value or operators
  T[K] extends ScalarValue ? T[K] | ComparisonOperators<T[K]>
  : // Unknown/complex types → Flexible fallback
  unknown;
} & LogicalOperators<T>;

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
  readonly where?: WhereClause<T> | undefined;
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
 *
 * Generic type TSchema allows for type-safe query building when schema type is known.
 * If TSchema extends ForjaEntry, WHERE conditions will be fully type-checked.
 *
 * @template TSchema - Entity type for type-safe queries (default: Record<string, unknown>)
 *
 * @example
 * ```ts
 * // Type-safe builder
 * const builder: QueryBuilder<Post> = createQueryBuilder('posts');
 * builder.where({ title: { $like: 'Hello%' } });  // ✅ Type-checked
 *
 * // Generic builder (backward compatible)
 * const builder2: QueryBuilder = createQueryBuilder('users');
 * builder2.where({ anyField: 'value' });  // ✅ Works but no type checking
 * ```
 */
export interface QueryBuilder<TSchema extends ForjaEntry = ForjaRecord> {
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
   * Add WHERE conditions (type-safe when TSchema is provided)
   */
  where(conditions: WhereClause<TSchema>): QueryBuilder<TSchema>;

  /**
   * Add AND condition (type-safe when TSchema is provided)
   */
  andWhere(conditions: WhereClause<TSchema>): QueryBuilder<TSchema>;

  /**
   * Add OR condition (type-safe when TSchema is provided)
   */
  orWhere(conditions: WhereClause<TSchema>): QueryBuilder<TSchema>;

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
   * Set having clause (type-safe when TSchema is provided)
   */
  having(conditions: WhereClause<TSchema>): QueryBuilder<TSchema>;

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
 *
 * Generic type support for type-safe condition building.
 *
 * @template T - Entity type for type-safe queries
 */
export interface WhereBuilder<T extends ForjaEntry = ForjaRecord> {
  /**
   * Build WHERE clause
   */
  build(conditions: WhereClause<T>): WhereClause<T>;

  /**
   * Combine conditions with AND
   */
  and(conditions: readonly WhereClause<T>[]): WhereClause<T>;

  /**
   * Combine conditions with OR
   */
  or(conditions: readonly WhereClause<T>[]): WhereClause<T>;

  /**
   * Negate condition
   */
  not(condition: WhereClause<T>): WhereClause<T>;

  /**
   * Validate WHERE clause
   */
  validate(where: WhereClause<T>): Result<WhereClause<T>, QueryBuilderError>;
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
