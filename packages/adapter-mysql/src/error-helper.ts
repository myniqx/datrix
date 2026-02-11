/**
 * MySQL Adapter Error Helper Functions
 *
 * Centralized error throwing functions for MySQL adapter.
 * Provides consistent error messages and suggestions.
 */

import { ForjaMySQLAdapterError } from "./error";
import type { PopulateStrategy } from "./populate/types";
import type { QuerySelectObject } from "forja-types/core/query-builder";
import type { ForjaEntry } from "forja-types/core/schema";

// ============================================================================
// SQL Truncation Utility
// ============================================================================

/**
 * Truncate SQL for error context
 * Development: full SQL for debugging
 * Production: truncated to 500 chars
 */
export function truncateSqlForError(sql: string): string {
	if (process.env["NODE_ENV"] === "development") {
		return sql;
	}
	return sql.length > 500 ? sql.substring(0, 500) + "..." : sql;
}

// ============================================================================
// Populate/Relation Errors
// ============================================================================

/**
 * Throw model not found error
 *
 * @param table - Table name
 */
export function throwModelNotFound(table: string): never {
	throw new ForjaMySQLAdapterError(`Model not found for table: ${table}`, {
		code: "ADAPTER_MODEL_NOT_FOUND",
		operation: "populate",
		context: { table },
		suggestion: "Ensure model is registered in schema registry",
		expected: "registered model",
	});
}

/**
 * Throw schema not found error
 *
 * @param modelName - Model name
 */
export function throwSchemaNotFound(modelName: string): never {
	throw new ForjaMySQLAdapterError(
		`Schema not found for model: ${modelName}`,
		{
			code: "ADAPTER_SCHEMA_NOT_FOUND",
			operation: "populate",
			context: { model: modelName },
			suggestion: "Ensure schema is registered in schema registry",
			expected: "registered schema",
		},
	);
}

/**
 * Throw relation field not found error
 *
 * @param relationName - Relation field name
 * @param schemaName - Schema name
 */
export function throwRelationNotFound(
	relationName: string,
	schemaName: string,
): never {
	throw new ForjaMySQLAdapterError(
		`Relation field '${relationName}' not found in schema '${schemaName}'`,
		{
			code: "ADAPTER_RELATION_NOT_FOUND",
			operation: "populate",
			context: { relationName, model: schemaName },
			suggestion: `Add '${relationName}' relation to schema '${schemaName}' or check field name`,
			expected: `relation field '${relationName}'`,
		},
	);
}

/**
 * Throw invalid relation type error
 *
 * @param relationName - Relation field name
 * @param fieldType - Actual field type
 * @param schemaName - Schema name
 */
export function throwInvalidRelationType(
	relationName: string,
	fieldType: string,
	schemaName: string,
): never {
	throw new ForjaMySQLAdapterError(
		`Field '${relationName}' (type: ${fieldType}) is not a relation field in schema '${schemaName}'`,
		{
			code: "ADAPTER_INVALID_RELATION",
			operation: "populate",
			context: { relationName, field: fieldType, model: schemaName },
			suggestion: `Change field type to 'relation' for '${relationName}'`,
			expected: "type: 'relation'",
			received: fieldType,
		},
	);
}

/**
 * Throw target model not found error
 *
 * @param targetModel - Target model name
 * @param relationName - Relation field name
 * @param schemaName - Source schema name
 */
export function throwTargetModelNotFound(
	targetModel: string,
	relationName: string,
	schemaName: string,
): never {
	throw new ForjaMySQLAdapterError(
		`Target model '${targetModel}' not found for relation '${relationName}' in schema '${schemaName}'`,
		{
			code: "ADAPTER_TARGET_MODEL_NOT_FOUND",
			operation: "populate",
			context: { targetModel, relationName, model: schemaName },
			suggestion: `Ensure model '${targetModel}' is registered in schema registry`,
			expected: `registered model '${targetModel}'`,
		},
	);
}

/**
 * Throw junction table not found error
 *
 * @param junctionTable - Junction table name
 * @param relationName - Relation field name
 * @param schemaName - Source schema name
 */
export function throwJunctionTableNotFound(
	junctionTable: string,
	relationName: string,
	schemaName: string,
): never {
	throw new ForjaMySQLAdapterError(
		`Junction table '${junctionTable}' not found for manyToMany relation '${relationName}' in schema '${schemaName}'`,
		{
			code: "ADAPTER_JUNCTION_TABLE_NOT_FOUND",
			operation: "populate",
			context: { junctionTable, relationName, model: schemaName },
			suggestion: `Create junction table '${junctionTable}' or check 'through' property in relation definition`,
			expected: `table '${junctionTable}' to exist`,
		},
	);
}

/**
 * Throw max populate depth exceeded error
 *
 * @param currentDepth - Current depth
 * @param maxDepth - Maximum allowed depth
 * @param relationPath - Relation path (e.g., "author.profile.user")
 */
export function throwMaxDepthExceeded(
	currentDepth: number,
	maxDepth: number,
	relationPath: string,
): never {
	throw new ForjaMySQLAdapterError(
		`Populate depth exceeds maximum of ${maxDepth} at path: ${relationPath}`,
		{
			code: "ADAPTER_MAX_DEPTH_EXCEEDED",
			operation: "populate",
			context: { depth: currentDepth, maxDepth, relationPath },
			suggestion: `Reduce nesting level or increase MAX_POPULATE_DEPTH (current: ${maxDepth})`,
			expected: `depth <= ${maxDepth}`,
			received: `depth: ${currentDepth}`,
		},
	);
}

// ============================================================================
// JOIN Building Errors
// ============================================================================

/**
 * Throw JOIN generation error
 *
 * @param relationName - Relation field name
 * @param relationKind - Relation kind (belongsTo, hasMany, etc.)
 * @param cause - Original error
 */
export function throwJoinBuildError(
	relationName: string,
	relationKind: string,
	cause?: Error,
): never {
	throw new ForjaMySQLAdapterError(
		`Failed to generate JOIN for relation '${relationName}' (kind: ${relationKind})`,
		{
			code: "ADAPTER_JOIN_ERROR",
			operation: "join",
			context: { relationName, relationKind },
			cause,
			suggestion: "Check relation configuration and foreign key definitions",
			expected: `valid ${relationKind} relation`,
		},
	);
}

/**
 * Throw LATERAL JOIN error
 *
 * @param relationName - Relation field name
 * @param cause - Original error
 */
export function throwLateralJoinError(
	relationName: string,
	cause?: Error,
): never {
	throw new ForjaMySQLAdapterError(
		`Failed to generate LATERAL JOIN for relation '${relationName}'`,
		{
			code: "ADAPTER_LATERAL_JOIN_ERROR",
			operation: "join",
			context: { relationName },
			cause,
			suggestion:
				"Ensure MySQL version >= 8.0.14 and check populate options syntax",
			expected: "valid LATERAL JOIN syntax",
		},
	);
}

// ============================================================================
// Aggregation Errors
// ============================================================================

/**
 * Throw JSON aggregation error
 *
 * @param relationName - Relation field name
 * @param cause - Original error
 */
export function throwJsonAggregationError(
	relationName: string,
	cause?: Error,
): never {
	throw new ForjaMySQLAdapterError(
		`Failed to generate JSON aggregation for relation '${relationName}'`,
		{
			code: "ADAPTER_JSON_AGGREGATION_ERROR",
			operation: "aggregation",
			context: { relationName },
			cause,
			suggestion: "Check field selection and aggregation syntax",
			expected: "valid JSON_ARRAYAGG() or JSON_OBJECT() syntax",
		},
	);
}

// ============================================================================
// Result Processing Errors
// ============================================================================

/**
 * Throw result processing error
 *
 * @param operation - Processing operation (grouping, nesting, etc.)
 * @param cause - Original error
 */
export function throwResultProcessingError(
	operation: string,
	cause?: Error,
): never {
	throw new ForjaMySQLAdapterError(
		`Failed to process query results: ${operation}`,
		{
			code: "ADAPTER_RESULT_PROCESSING_ERROR",
			operation: "populate",
			context: { processingOperation: operation },
			cause,
			suggestion: "Check result structure and populate configuration",
			expected: "valid result structure",
		},
	);
}

// ============================================================================
// Query Errors
// ============================================================================

/**
 * Throw populate query execution error
 *
 * @param query - Query object
 * @param sql - Generated SQL
 * @param cause - Original database error
 * @param strategy - Populate strategy used
 * @param params - Query parameters (optional)
 */
export function throwPopulateQueryError<T extends ForjaEntry>(
	query: QuerySelectObject<T>,
	sql: string,
	cause: Error,
	strategy?: PopulateStrategy,
	params?: readonly unknown[],
): never {
	throw new ForjaMySQLAdapterError(
		`Populate query execution failed for table '${query.table}'${strategy ? ` using ${strategy} strategy` : ""}`,
		{
			code: "ADAPTER_POPULATE_ERROR",
			operation: "populate",
			context: {
				table: query.table,
				query: { type: query.type, populate: query.populate },
				sql: truncateSqlForError(sql),
				params: params ?? [],
				strategy: strategy,
			},
			cause,
			suggestion:
				"Check SQL syntax, relation definitions, and database connection",
			expected: "successful query execution",
		},
	);
}

/**
 * Throw invalid populate options error
 *
 * @param relationName - Relation field name
 * @param optionName - Invalid option name
 * @param optionValue - Invalid option value
 */
export function throwInvalidPopulateOptions(
	relationName: string,
	optionName: string,
	optionValue: unknown,
): never {
	throw new ForjaMySQLAdapterError(
		`Invalid populate option '${optionName}' for relation '${relationName}'`,
		{
			code: "ADAPTER_INVALID_POPULATE_OPTIONS",
			operation: "populate",
			context: { relationName, optionName, optionValue },
			suggestion: `Check populate options syntax. Valid options: select, where, orderBy, limit, offset, populate`,
			expected: "valid populate option",
			received: `${optionName}: ${JSON.stringify(optionValue)}`,
		},
	);
}
