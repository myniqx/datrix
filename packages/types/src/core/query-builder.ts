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
  readonly $and?: WhereClause<T>[];
  readonly $or?: WhereClause<T>[];
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
  [K in keyof T]?: T[K] extends Relation<infer R> ? WhereClause<R> // Relation fields → Nested WhereClause
  : // Scalar fields → Value or operators
  T[K] extends ScalarValue ? T[K] | ComparisonOperators<T[K]>
  : // Unknown/complex types → Flexible fallback
  unknown;
} & LogicalOperators<T>;

/**
 * SELECT clause (fields to select)
 */
export type SelectClause<T extends ForjaEntry> = (keyof T[]) | "*";

/**
 * Populate clause (relations to include)
 */
export type PopulateOptions<T extends ForjaEntry> = {
  readonly select?: SelectClause<T> | undefined;
  readonly where?: WhereClause<T> | undefined;
  readonly populate?: PopulateClause<T> | undefined; // Nested populate
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly orderBy?: OrderBy | undefined;
};

/**
 * Populate clause type
 */
export type PopulateClause<T extends ForjaEntry = ForjaRecord> =
  | false
  | {
    readonly [relation: string]: PopulateOptions<T> | "*" | true;
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
 * Query object (database-agnostic representation)
 */
export interface QueryObject<T extends ForjaEntry = ForjaRecord> {
  readonly type: QueryType;
  readonly table: string;
  readonly select?: SelectClause<T> | undefined;
  readonly where?: WhereClause<T> | undefined;
  readonly populate?: PopulateClause<T> | undefined;
  readonly orderBy?: OrderBy | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly data?: Partial<T>; // For INSERT/UPDATE
  readonly returning?: SelectClause<T>; // Fields to return after INSERT/UPDATE/DELETE
  readonly distinct?: boolean; // SELECT DISTINCT
  readonly groupBy?: readonly string[]; // GROUP BY fields
  readonly having?: WhereClause<T>; // HAVING clause
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
export interface QueryBuilder<TSchema extends ForjaEntry> {
  /**
   * Set query type
   */
  type(type: QueryType): QueryBuilder<TSchema>;

  /**
   * Select fields
   */
  select(fields: SelectClause<TSchema>): QueryBuilder<TSchema>;

  /**
   * Add WHERE conditions (type-safe when TSchema is provided)
   * Multiple .where() calls are merged with $and logic
   */
  where(conditions: WhereClause<TSchema>): QueryBuilder<TSchema>;

  /**
   * Add populate (relations)
   */
  populate(relations: PopulateClause<TSchema>): QueryBuilder<TSchema>;

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
  returning(fields: SelectClause<T>): QueryBuilder<TSchema>;

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
  build(): QueryObject<TSchema>; // Result<QueryObject, Error>;

  /**
   * Clone the builder
   */
  clone(): QueryBuilder<TSchema>;
}
