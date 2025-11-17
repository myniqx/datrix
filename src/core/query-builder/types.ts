/**
 * Query Builder Type Definitions
 *
 * This file defines types for Forja's database-agnostic query builder.
 * Query builder produces QueryObject instances that adapters translate to SQL/NoSQL.
 */

import type { Result } from '@utils/types';
import type { SchemaDefinition } from '@core/schema/types';

/**
 * Primitive values that can be used in queries
 */
export type Primitive = string | number | boolean | null | Date;

/**
 * Query operation types
 */
export type QueryType = 'select' | 'insert' | 'update' | 'delete' | 'count';

/**
 * Comparison operators
 */
export interface ComparisonOperators {
  readonly $eq?: Primitive;
  readonly $ne?: Primitive;
  readonly $gt?: number | Date;
  readonly $gte?: number | Date;
  readonly $lt?: number | Date;
  readonly $lte?: number | Date;
  readonly $in?: readonly Primitive[];
  readonly $nin?: readonly Primitive[];
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
    | Primitive
    | ComparisonOperators
    | readonly WhereClause[];
} & Partial<LogicalOperators>;

/**
 * SELECT clause (fields to select)
 */
export type SelectClause = readonly string[] | '*';

/**
 * Populate clause (relations to include)
 */
export interface PopulateOptions {
  readonly select?: SelectClause;
  readonly where?: WhereClause;
  readonly populate?: PopulateClause; // Nested populate
  readonly limit?: number;
  readonly offset?: number;
  readonly orderBy?: readonly OrderByItem[];
}

/**
 * Populate clause type
 */
export type PopulateClause = {
  readonly [relation: string]: PopulateOptions | '*';
};

/**
 * Order direction
 */
export type OrderDirection = 'asc' | 'desc';

/**
 * Order by item
 */
export interface OrderByItem {
  readonly field: string;
  readonly direction: OrderDirection;
  readonly nulls?: 'first' | 'last'; // NULL ordering
}

/**
 * Query object (database-agnostic representation)
 */
export interface QueryObject {
  readonly type: QueryType;
  readonly table: string;
  readonly select?: SelectClause;
  readonly where?: WhereClause;
  readonly populate?: PopulateClause;
  readonly orderBy?: readonly OrderByItem[];
  readonly limit?: number;
  readonly offset?: number;
  readonly data?: Record<string, unknown>; // For INSERT/UPDATE
  readonly returning?: SelectClause; // Fields to return after INSERT/UPDATE/DELETE
  readonly distinct?: boolean; // SELECT DISTINCT
  readonly groupBy?: readonly string[]; // GROUP BY fields
  readonly having?: WhereClause; // HAVING clause
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
   */
  build(): QueryObject;

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
  schema?: SchemaDefinition
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
    schema?: SchemaDefinition
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
    schema: SchemaDefinition
  ): Result<PopulateClause, QueryBuilderError>;

  /**
   * Resolve nested populates
   */
  resolveNested(
    populate: PopulateClause,
    depth: number
  ): readonly string[];
}

/**
 * Pagination builder
 */
export interface PaginationBuilder {
  /**
   * Build pagination (limit/offset)
   */
  build(page: number, pageSize: number): {
    readonly limit: number;
    readonly offset: number;
  };

  /**
   * Validate pagination parameters
   */
  validate(
    limit?: number,
    offset?: number
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
    }
  ) {
    super(message);
    this.name = 'QueryBuilderError';
    this.code = options?.code ?? 'UNKNOWN';
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
    fields: readonly K[] | '*'
  ): TypedQueryBuilder<Pick<T, K>>;
  where(conditions: Partial<WhereConditions<T>>): TypedQueryBuilder<T>;
  orderBy<K extends keyof T>(
    field: K,
    direction?: OrderDirection
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
