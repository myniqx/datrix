/**
 * Forja Adapter Error Helpers
 *
 * Shared throw helpers for all database adapters.
 * Every helper accepts an object with at minimum { adapter }.
 */

import type { QueryObject } from "../../core/query-builder";
import type { ForjaEntry } from "../../core/schema";
import { ForjaAdapterError, type AdapterName } from "./adapter-error";

// ============================================================================
// SQL Truncation Utility
// ============================================================================

export function truncateSqlForError(sql: string): string {
	if (process.env["NODE_ENV"] === "development") {
		return sql;
	}
	return sql.length > 500 ? sql.substring(0, 500) + "..." : sql;
}

// ============================================================================
// Connection Errors
// ============================================================================

export function throwNotConnected(params: { adapter: AdapterName }): never {
	throw new ForjaAdapterError("Not connected to database", {
		adapter: params.adapter,
		code: "ADAPTER_CONNECTION_ERROR",
		operation: "connect",
		suggestion: "Call adapter.connect() before executing queries",
	});
}

export function throwConnectionError(params: {
	adapter: AdapterName;
	message: string;
	operation?: "connect" | "disconnect";
	cause?: Error | undefined;
}): never {
	throw new ForjaAdapterError(params.message, {
		adapter: params.adapter,
		code: "ADAPTER_CONNECTION_ERROR",
		operation: params.operation ?? "connect",
		cause: params.cause,
	});
}

// ============================================================================
// Migration Errors
// ============================================================================

export function throwMigrationError(params: {
	adapter: AdapterName;
	message: string;
	table?: string | undefined;
	cause?: Error | undefined;
	suggestion?: string | undefined;
}): never {
	throw new ForjaAdapterError(params.message, {
		adapter: params.adapter,
		code: "ADAPTER_MIGRATION_ERROR",
		operation: "migration",
		context: params.table ? { table: params.table } : undefined,
		cause: params.cause,
		suggestion: params.suggestion,
	});
}

// ============================================================================
// Introspection Errors
// ============================================================================

export function throwIntrospectionError(params: {
	adapter: AdapterName;
	message: string;
	table?: string | undefined;
	cause?: Error | undefined;
}): never {
	throw new ForjaAdapterError(params.message, {
		adapter: params.adapter,
		code: "ADAPTER_INTROSPECTION_ERROR",
		operation: "introspection",
		context: params.table ? { table: params.table } : undefined,
		cause: params.cause,
	});
}

// ============================================================================
// Query Errors
// ============================================================================

export function throwQueryError(params: {
	adapter: AdapterName;
	message: string;
	query?: QueryObject | undefined;
	sql?: string | undefined;
	cause?: Error | undefined;
	suggestion?: string | undefined;
	expected?: string | undefined;
	received?: unknown;
}): never {
	throw new ForjaAdapterError(params.message, {
		adapter: params.adapter,
		code: "ADAPTER_QUERY_ERROR",
		operation: "query",
		context: {
			...(params.query && {
				query: { type: params.query.type, table: params.query.table },
			}),
			...(params.sql && { sql: truncateSqlForError(params.sql) }),
		},
		cause: params.cause,
		suggestion: params.suggestion,
		expected: params.expected,
		received: params.received,
	});
}

export function throwQueryMissingData(params: {
	adapter: AdapterName;
	queryType: string;
	table: string;
}): never {
	throw new ForjaAdapterError(
		`${params.queryType} query missing data for table: ${params.table}`,
		{
			adapter: params.adapter,
			code: "ADAPTER_QUERY_MISSING_DATA",
			operation: "query",
			context: { table: params.table, queryType: params.queryType },
			suggestion: `Provide data field in ${params.queryType} query`,
			expected: "query.data object",
		},
	);
}

// ============================================================================
// Transaction Errors
// ============================================================================

export function throwTransactionError(params: {
	adapter: AdapterName;
	message: string;
	cause?: Error | undefined;
}): never {
	throw new ForjaAdapterError(params.message, {
		adapter: params.adapter,
		code: "ADAPTER_TRANSACTION_ERROR",
		operation: "transaction",
		cause: params.cause,
	});
}

export function throwTransactionAlreadyCommitted(params: {
	adapter: AdapterName;
}): never {
	throw new ForjaAdapterError("Transaction already committed", {
		adapter: params.adapter,
		code: "ADAPTER_TRANSACTION_ERROR",
		operation: "transaction",
		suggestion: "Start a new transaction instead of reusing a committed one",
	});
}

export function throwTransactionAlreadyRolledBack(params: {
	adapter: AdapterName;
}): never {
	throw new ForjaAdapterError("Transaction already rolled back", {
		adapter: params.adapter,
		code: "ADAPTER_TRANSACTION_ERROR",
		operation: "transaction",
		suggestion: "Start a new transaction instead of reusing a rolled back one",
	});
}

export function throwTransactionSavepointNotSupported(params: {
	adapter: AdapterName;
}): never {
	throw new ForjaAdapterError(
		`Savepoints are not supported by the ${params.adapter} adapter`,
		{
			adapter: params.adapter,
			code: "ADAPTER_TRANSACTION_ERROR",
			operation: "transaction",
			suggestion: "Use nested transactions or restructure your logic",
		},
	);
}

export function throwRawQueryNotSupported(params: {
	adapter: AdapterName;
}): never {
	throw new ForjaAdapterError(
		`Raw SQL queries are not supported by the ${params.adapter} adapter`,
		{
			adapter: params.adapter,
			code: "ADAPTER_QUERY_ERROR",
			operation: "query",
			suggestion: "Use the query builder API instead of raw SQL",
		},
	);
}

// ============================================================================
// Populate / Relation Errors
// ============================================================================

export function throwModelNotFound(params: {
	adapter: AdapterName;
	table: string;
}): never {
	throw new ForjaAdapterError(`Model not found for table: ${params.table}`, {
		adapter: params.adapter,
		code: "ADAPTER_MODEL_NOT_FOUND",
		operation: "populate",
		context: { table: params.table },
		suggestion: "Ensure model is registered in schema registry",
		expected: "registered model",
	});
}

export function throwSchemaNotFound(params: {
	adapter: AdapterName;
	modelName: string;
}): never {
	throw new ForjaAdapterError(
		`Schema not found for model: ${params.modelName}`,
		{
			adapter: params.adapter,
			code: "ADAPTER_SCHEMA_NOT_FOUND",
			operation: "populate",
			context: { model: params.modelName },
			suggestion: "Ensure schema is registered in schema registry",
			expected: "registered schema",
		},
	);
}

export function throwRelationNotFound(params: {
	adapter: AdapterName;
	relationName: string;
	schemaName: string;
}): never {
	throw new ForjaAdapterError(
		`Relation field '${params.relationName}' not found in schema '${params.schemaName}'`,
		{
			adapter: params.adapter,
			code: "ADAPTER_RELATION_NOT_FOUND",
			operation: "populate",
			context: { relationName: params.relationName, model: params.schemaName },
			suggestion: `Add '${params.relationName}' relation to schema '${params.schemaName}' or check field name`,
			expected: `relation field '${params.relationName}'`,
		},
	);
}

export function throwInvalidRelationType(params: {
	adapter: AdapterName;
	relationName: string;
	fieldType: string;
	schemaName: string;
}): never {
	throw new ForjaAdapterError(
		`Field '${params.relationName}' (type: ${params.fieldType}) is not a relation field in schema '${params.schemaName}'`,
		{
			adapter: params.adapter,
			code: "ADAPTER_INVALID_RELATION",
			operation: "populate",
			context: {
				relationName: params.relationName,
				field: params.fieldType,
				model: params.schemaName,
			},
			suggestion: `Change field type to 'relation' for '${params.relationName}'`,
			expected: "type: 'relation'",
			received: params.fieldType,
		},
	);
}

export function throwTargetModelNotFound(params: {
	adapter: AdapterName;
	targetModel: string;
	relationName: string;
	schemaName: string;
}): never {
	throw new ForjaAdapterError(
		`Target model '${params.targetModel}' not found for relation '${params.relationName}' in schema '${params.schemaName}'`,
		{
			adapter: params.adapter,
			code: "ADAPTER_TARGET_MODEL_NOT_FOUND",
			operation: "populate",
			context: {
				targetModel: params.targetModel,
				relationName: params.relationName,
				model: params.schemaName,
			},
			suggestion: `Ensure model '${params.targetModel}' is registered in schema registry`,
			expected: `registered model '${params.targetModel}'`,
		},
	);
}

export function throwJunctionTableNotFound(params: {
	adapter: AdapterName;
	junctionTable: string;
	relationName: string;
	schemaName: string;
}): never {
	throw new ForjaAdapterError(
		`Junction table '${params.junctionTable}' not found for manyToMany relation '${params.relationName}' in schema '${params.schemaName}'`,
		{
			adapter: params.adapter,
			code: "ADAPTER_JUNCTION_TABLE_NOT_FOUND",
			operation: "populate",
			context: {
				junctionTable: params.junctionTable,
				relationName: params.relationName,
				model: params.schemaName,
			},
			suggestion: `Create junction table '${params.junctionTable}' or check 'through' property in relation definition`,
			expected: `table '${params.junctionTable}' to exist`,
		},
	);
}

export function throwMaxDepthExceeded(params: {
	adapter: AdapterName;
	currentDepth: number;
	maxDepth: number;
	relationPath: string;
}): never {
	throw new ForjaAdapterError(
		`Populate depth exceeds maximum of ${params.maxDepth} at path: ${params.relationPath}`,
		{
			adapter: params.adapter,
			code: "ADAPTER_MAX_DEPTH_EXCEEDED",
			operation: "populate",
			context: {
				depth: params.currentDepth,
				maxDepth: params.maxDepth,
				relationPath: params.relationPath,
			},
			suggestion: `Reduce nesting level or increase MAX_POPULATE_DEPTH (current: ${params.maxDepth})`,
			expected: `depth <= ${params.maxDepth}`,
			received: `depth: ${params.currentDepth}`,
		},
	);
}

export function throwPopulateQueryError<T extends ForjaEntry>(params: {
	adapter: AdapterName;
	query: QueryObject<T>;
	sql: string;
	cause: Error;
	strategy?: string | undefined;
	queryParams?: readonly unknown[] | undefined;
}): never {
	const strategyLabel = params.strategy
		? ` using ${params.strategy} strategy`
		: "";
	throw new ForjaAdapterError(
		`Populate query execution failed for table '${params.query.table}'${strategyLabel}`,
		{
			adapter: params.adapter,
			code: "ADAPTER_POPULATE_ERROR",
			operation: "populate",
			context: {
				table: params.query.table,
				query: { type: params.query.type },
				sql: truncateSqlForError(params.sql),
				params: params.queryParams ?? [],
				strategy: params.strategy,
			},
			cause: params.cause,
			suggestion:
				"Check SQL syntax, relation definitions, and database connection",
			expected: "successful query execution",
		},
	);
}

export function throwInvalidPopulateOptions(params: {
	adapter: AdapterName;
	relationName: string;
	optionName: string;
	optionValue: unknown;
}): never {
	throw new ForjaAdapterError(
		`Invalid populate option '${params.optionName}' for relation '${params.relationName}'`,
		{
			adapter: params.adapter,
			code: "ADAPTER_INVALID_POPULATE_OPTIONS",
			operation: "populate",
			context: {
				relationName: params.relationName,
				optionName: params.optionName,
				optionValue: params.optionValue,
			},
			suggestion:
				"Check populate options syntax. Valid options: select, where, orderBy, limit, offset, populate",
			expected: "valid populate option",
			received: `${params.optionName}: ${JSON.stringify(params.optionValue)}`,
		},
	);
}

// ============================================================================
// JOIN Errors
// ============================================================================

export function throwJoinBuildError(params: {
	adapter: AdapterName;
	relationName: string;
	relationKind: string;
	cause?: Error | undefined;
}): never {
	throw new ForjaAdapterError(
		`Failed to generate JOIN for relation '${params.relationName}' (kind: ${params.relationKind})`,
		{
			adapter: params.adapter,
			code: "ADAPTER_JOIN_ERROR",
			operation: "join",
			context: {
				relationName: params.relationName,
				relationKind: params.relationKind,
			},
			cause: params.cause,
			suggestion: "Check relation configuration and foreign key definitions",
			expected: `valid ${params.relationKind} relation`,
		},
	);
}

export function throwLateralJoinError(params: {
	adapter: AdapterName;
	relationName: string;
	cause?: Error | undefined;
}): never {
	throw new ForjaAdapterError(
		`Failed to generate LATERAL JOIN for relation '${params.relationName}'`,
		{
			adapter: params.adapter,
			code: "ADAPTER_LATERAL_JOIN_ERROR",
			operation: "join",
			context: { relationName: params.relationName },
			cause: params.cause,
			suggestion:
				"Check populate options syntax and database version compatibility",
			expected: "valid LATERAL JOIN syntax",
		},
	);
}

// ============================================================================
// Aggregation Errors
// ============================================================================

export function throwJsonAggregationError(params: {
	adapter: AdapterName;
	relationName: string;
	cause?: Error | undefined;
}): never {
	throw new ForjaAdapterError(
		`Failed to generate JSON aggregation for relation '${params.relationName}'`,
		{
			adapter: params.adapter,
			code: "ADAPTER_JSON_AGGREGATION_ERROR",
			operation: "aggregation",
			context: { relationName: params.relationName },
			cause: params.cause,
			suggestion: "Check field selection and aggregation syntax",
			expected: "valid JSON aggregation syntax",
		},
	);
}

export function throwResultProcessingError(params: {
	adapter: AdapterName;
	operation: string;
	cause?: Error | undefined;
}): never {
	throw new ForjaAdapterError(
		`Failed to process query results: ${params.operation}`,
		{
			adapter: params.adapter,
			code: "ADAPTER_RESULT_PROCESSING_ERROR",
			operation: "populate",
			context: { processingOperation: params.operation },
			cause: params.cause,
			suggestion: "Check result structure and populate configuration",
			expected: "valid result structure",
		},
	);
}

// ============================================================================
// JSON Adapter — Lock Errors
// ============================================================================

export function throwLockTimeout(params: {
	adapter: AdapterName;
	lockTimeout: number;
}): never {
	throw new ForjaAdapterError(
		`Could not acquire lock within ${params.lockTimeout}ms`,
		{
			adapter: params.adapter,
			code: "ADAPTER_LOCK_TIMEOUT",
			operation: "lock",
			context: { lockTimeout: params.lockTimeout },
			suggestion:
				"Increase lockTimeout in adapter config or check for deadlocks",
			expected: "lock acquired within timeout",
		},
	);
}

export function throwLockError(params: {
	adapter: AdapterName;
	cause?: Error | undefined;
}): never {
	throw new ForjaAdapterError("Failed to acquire lock", {
		adapter: params.adapter,
		code: "ADAPTER_LOCK_ERROR",
		operation: "lock",
		cause: params.cause,
		suggestion: "Check file system permissions and lock file path",
	});
}

// ============================================================================
// JSON Adapter — File I/O Errors
// ============================================================================

export function throwFileReadError(params: {
	adapter: AdapterName;
	file: string;
	cause?: Error | undefined;
}): never {
	throw new ForjaAdapterError(`Failed to read file: ${params.file}`, {
		adapter: params.adapter,
		code: "ADAPTER_FILE_READ_ERROR",
		operation: "read",
		context: { file: params.file },
		cause: params.cause,
		suggestion: "Check file exists and has correct permissions",
	});
}

export function throwFileWriteError(params: {
	adapter: AdapterName;
	file: string;
	cause?: Error | undefined;
}): never {
	throw new ForjaAdapterError(`Failed to write file: ${params.file}`, {
		adapter: params.adapter,
		code: "ADAPTER_FILE_WRITE_ERROR",
		operation: "write",
		context: { file: params.file },
		cause: params.cause,
		suggestion: "Check directory exists and has write permissions",
	});
}

export function throwFileNotFound(params: {
	adapter: AdapterName;
	file: string;
}): never {
	throw new ForjaAdapterError(`File not found: ${params.file}`, {
		adapter: params.adapter,
		code: "ADAPTER_FILE_NOT_FOUND",
		operation: "read",
		context: { file: params.file },
		suggestion: "Ensure the file exists or run migrations to create it",
	});
}

// ============================================================================
// JSON Adapter — Constraint Errors
// ============================================================================

export function throwUniqueConstraintField(params: {
	adapter: AdapterName;
	field: string;
	value: unknown;
	table: string;
}): never {
	throw new ForjaAdapterError(
		`Duplicate value '${params.value}' for unique field '${params.field}'`,
		{
			adapter: params.adapter,
			code: "ADAPTER_UNIQUE_CONSTRAINT",
			operation: "query",
			context: {
				field: params.field,
				value: params.value,
				table: params.table,
			},
			suggestion: `Ensure '${params.field}' value is unique in table '${params.table}'`,
			expected: "unique value",
			received: params.value,
		},
	);
}

export function throwUniqueConstraintIndex(params: {
	adapter: AdapterName;
	fields: readonly string[];
	table: string;
}): never {
	throw new ForjaAdapterError(
		`Duplicate value for unique index [${params.fields.join(", ")}]`,
		{
			adapter: params.adapter,
			code: "ADAPTER_UNIQUE_CONSTRAINT",
			operation: "query",
			context: { fields: params.fields.join(", "), table: params.table },
			suggestion: `Ensure combination of [${params.fields.join(", ")}] is unique in table '${params.table}'`,
			expected: "unique combination",
		},
	);
}

export function throwForeignKeyConstraint(params: {
	adapter: AdapterName;
	foreignKey: string;
	value: unknown;
	targetModel: string;
	table: string;
}): never {
	throw new ForjaAdapterError(
		`Foreign key constraint failed: ${params.targetModel} with id '${params.value}' does not exist`,
		{
			adapter: params.adapter,
			code: "ADAPTER_FOREIGN_KEY_CONSTRAINT",
			operation: "query",
			context: {
				foreignKey: params.foreignKey,
				value: params.value,
				targetModel: params.targetModel,
				table: params.table,
			},
			suggestion: `Ensure ${params.targetModel} with id '${params.value}' exists before referencing it`,
			expected: `existing ${params.targetModel} id`,
			received: params.value,
		},
	);
}

// ============================================================================
// JSON Adapter — WHERE Errors
// ============================================================================

export function throwInvalidWhereField(params: {
	adapter: AdapterName;
	field: string;
	schemaName: string;
	availableFields: readonly string[];
}): never {
	throw new ForjaAdapterError(
		`Invalid WHERE clause: Field '${params.field}' does not exist in schema '${params.schemaName}'`,
		{
			adapter: params.adapter,
			code: "ADAPTER_INVALID_WHERE_FIELD",
			operation: "query",
			context: {
				field: params.field,
				schemaName: params.schemaName,
				availableFields: params.availableFields.join(", "),
			},
			suggestion: `Use one of the available fields: ${params.availableFields.join(", ")}`,
			expected: `valid field name from schema '${params.schemaName}'`,
			received: params.field,
		},
	);
}

export function throwInvalidRelationWhereSyntax(params: {
	adapter: AdapterName;
	relationName: string;
	schemaName: string;
	foreignKey: string;
}): never {
	throw new ForjaAdapterError(
		`Invalid WHERE clause: Cannot use comparison operators directly on relation field '${params.relationName}'`,
		{
			adapter: params.adapter,
			code: "ADAPTER_INVALID_RELATION_WHERE",
			operation: "query",
			context: {
				relationName: params.relationName,
				schemaName: params.schemaName,
				foreignKey: params.foreignKey,
			},
			suggestion:
				`Use nested WHERE syntax: { ${params.relationName}: { <field>: { $eq: <value> } } }\n` +
				`Or filter by foreign key directly: { ${params.foreignKey}: { $eq: <value> } }`,
			expected:
				"nested WHERE object with field names (e.g., { id: { $eq: 1 } })",
			received: "comparison operators (e.g., { $eq: 1 })",
		},
	);
}
