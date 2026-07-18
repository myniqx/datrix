/**
 * MySQL Populate Types
 *
 * Type definitions for populate functionality.
 */

import type { QuerySelect } from "@datrix/core";

/**
 * Populate strategy selection
 */
export type PopulateStrategy =
	| "json-aggregation" // Subquery-based aggregation (default)
	| "batched-queries"; // Batch queries for complex options, deep nesting or high cardinality

/**
 * JOIN clause information
 */
export interface JoinClause {
	readonly type: "LEFT JOIN" | "INNER JOIN";
	readonly table: string;
	readonly alias: string;
	readonly condition: string;
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
 * Populate options analysis result
 */
export interface PopulateOptionsAnalysis {
	readonly hasComplexOptions: boolean;
	readonly maxDepth: number;
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
	readonly fields: QuerySelect;
	readonly sql: string;
}
