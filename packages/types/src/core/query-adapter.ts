/**
 * Query Adapter Types
 *
 * Strict, normalized types for database adapters.
 * These are the output of QueryNormalizer and input to DatabaseAdapter.
 *
 * Characteristics:
 * - No shortcuts or flexible formats
 * - Fully normalized and validated
 * - Ready for direct translation to SQL/NoSQL
 * - Type-safe but schema-agnostic (uses string keys)
 */

import { ForjaEntry, Relation } from "./schema";


export type QueryType = "select" | "insert" | "update" | "delete" | "count";


export type QueryPrimitive = string | number | boolean | null | Date;


export type QuerySelect<T extends ForjaEntry> = readonly (keyof T)[];

export type QueryPopulate<T extends ForjaEntry> = Record<
  keyof T,
  {
    select: QuerySelect<T>;
    populate?: QueryPopulate<T>;
  }
>;

export type LogicalOperators<T extends ForjaEntry = ForjaEntry> = {
  readonly $and?: readonly WhereQuery<T>[];
  readonly $or?: readonly WhereQuery<T>[];
  readonly $not?: WhereQuery<T>;
};

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
  readonly $contains?: T extends string ? string : never;
  readonly $icontains?: T extends string ? string : never;
  readonly $regex?: T extends string ? RegExp : never;
  readonly $exists?: boolean;
  readonly $null?: boolean;
};

export type WhereQuery<T extends ForjaEntry> = {
  [K in keyof T]?: T[K] extends Relation<infer R> ? WhereQuery<R> // Relation fields → Nested WhereClause
  : // Scalar fields → Value or operators
  T[K] extends QueryPrimitive ? T[K] | ComparisonOperators<T[K]>
  : // Unknown/complex types → Flexible fallback
  unknown;
} & LogicalOperators<T>;

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


export interface QueryObject<T extends ForjaEntry> {
  readonly type: QueryType;
  readonly table: string;
  readonly select?: QuerySelect<T> | undefined;
  readonly where?: WhereQuery<T> | undefined;
  readonly populate?: QueryPopulate<T> | undefined;
  readonly orderBy?: OrderBy | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly data?: Partial<T>; // For INSERT/UPDATE
  readonly returning?: QuerySelect<T>; // Fields to return after INSERT/UPDATE/DELETE
  readonly distinct?: boolean; // SELECT DISTINCT
  readonly groupBy?: readonly string[]; // GROUP BY fields
  readonly having?: WhereQuery<T>; // HAVING clause
}
