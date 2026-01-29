/**
 * PostgreSQL Populate Types
 *
 * Type definitions for populate functionality.
 */

import type { SelectClause } from "forja-types/core/query-builder";

/**
 * Populate strategy selection
 */
export type PopulateStrategy =
  | "json-aggregation" // Subquery-based aggregation (default)
  | "lateral-joins" // LATERAL joins for complex options
  | "batched-queries"; // Batch queries for deep nesting or high cardinality

/**
 * JOIN clause information
 */
export interface JoinClause {
  readonly type: "LEFT JOIN" | "INNER JOIN" | "LATERAL";
  readonly table: string;
  readonly alias: string;
  readonly condition: string;
  readonly isLateral: boolean;
}

/**
 * Aggregation clause information
 */
export interface AggregationClause {
  readonly relationName: string;
  readonly relationKind: "belongsTo" | "hasOne" | "hasMany" | "manyToMany";
  readonly sql: string;
  readonly alias: string;
}

/**
 * Processed result metadata
 */
export interface ProcessedResult<T> {
  readonly rows: readonly T[];
  readonly metadata: {
    readonly strategy: PopulateStrategy;
    readonly joinCount: number;
    readonly nestedLevels: number;
  };
}

/**
 * Populate options analysis result
 */
export interface PopulateOptionsAnalysis {
  readonly hasComplexOptions: boolean;
  readonly maxDepth: number;
  readonly requiresLateral: boolean;
  readonly requiresSeparateQueries: boolean;
  readonly relationCount: number;
  readonly oneToManyCount: number;
  readonly constrainedRelationCount: number;
  readonly estimatedCost: number;
}

/**
 * Field selection for populate
 */
export interface PopulateFieldSelection {
  readonly fields: SelectClause;
  readonly sql: string;
}

/**
 * Populate context (passed through recursive calls)
 */
export interface PopulateContext {
  readonly depth: number;
  readonly relationPath: string[];
  readonly parentAlias: string;
  readonly strategy: PopulateStrategy;
}
