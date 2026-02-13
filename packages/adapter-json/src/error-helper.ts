/**
 * JSON Adapter Error Helper Functions
 *
 * Centralized error throwing functions for JSON adapter.
 * Provides consistent error messages and suggestions.
 */

import { ForjaJsonAdapterError } from "./error";

// ============================================================================
// Lock Errors
// ============================================================================

/**
 * Throw lock timeout error
 *
 * @param lockTimeout - Lock timeout in milliseconds
 */
export function throwLockTimeout(lockTimeout: number): never {
	throw new ForjaJsonAdapterError(
		`Could not acquire lock within ${lockTimeout}ms`,
		{
			code: "ADAPTER_LOCK_TIMEOUT",
			operation: "lock",
			context: { lockTimeout },
			suggestion:
				"Increase lockTimeout in adapter config or check for deadlocks",
			expected: "lock acquired within timeout",
		},
	);
}

/**
 * Throw lock error
 *
 * @param cause - Original error
 */
export function throwLockError(cause?: Error): never {
	throw new ForjaJsonAdapterError("Failed to acquire lock", {
		code: "ADAPTER_LOCK_ERROR",
		operation: "lock",
		cause,
		suggestion: "Check file system permissions and lock file path",
	});
}

// ============================================================================
// File I/O Errors
// ============================================================================

/**
 * Throw file read error
 *
 * @param file - File path
 * @param cause - Original error
 */
export function throwFileReadError(file: string, cause?: Error): never {
	throw new ForjaJsonAdapterError(`Failed to read file: ${file}`, {
		code: "ADAPTER_FILE_READ_ERROR",
		operation: "read",
		context: { file },
		cause,
		suggestion: "Check file exists and has correct permissions",
	});
}

/**
 * Throw file write error
 *
 * @param file - File path
 * @param cause - Original error
 */
export function throwFileWriteError(file: string, cause?: Error): never {
	throw new ForjaJsonAdapterError(`Failed to write file: ${file}`, {
		code: "ADAPTER_FILE_WRITE_ERROR",
		operation: "write",
		context: { file },
		cause,
		suggestion: "Check directory exists and has write permissions",
	});
}

/**
 * Throw file not found error
 *
 * @param file - File path
 */
export function throwFileNotFound(file: string): never {
	throw new ForjaJsonAdapterError(`File not found: ${file}`, {
		code: "ADAPTER_FILE_NOT_FOUND",
		operation: "read",
		context: { file },
		suggestion: "Ensure the file exists or run migrations to create it",
	});
}

// ============================================================================
// Query Errors
// ============================================================================

/**
 * Throw query missing data error
 *
 * @param queryType - Query type (insert, update)
 * @param table - Table name
 */
export function throwQueryMissingData(queryType: string, table: string): never {
	throw new ForjaJsonAdapterError(
		`${queryType} query missing data for table: ${table}`,
		{
			code: "ADAPTER_QUERY_MISSING_DATA",
			operation: "query",
			context: { table, queryType },
			suggestion: `Provide data field in ${queryType} query`,
			expected: "query.data object",
		},
	);
}

/**
 * Throw invalid field in WHERE clause error
 *
 * @param field - Invalid field name
 * @param schemaName - Schema name
 * @param availableFields - List of valid field names
 */
export function throwInvalidWhereField(
	field: string,
	schemaName: string,
	availableFields: readonly string[],
): never {
	throw new ForjaJsonAdapterError(
		`Invalid WHERE clause: Field '${field}' does not exist in schema '${schemaName}'`,
		{
			code: "ADAPTER_INVALID_WHERE_FIELD",
			operation: "query",
			context: {
				field,
				schemaName,
				availableFields: availableFields.join(", "),
			},
			suggestion: `Use one of the available fields: ${availableFields.join(", ")}`,
			expected: `Valid field name from schema '${schemaName}'`,
			received: field,
		},
	);
}

/**
 * Throw invalid relation WHERE syntax error
 *
 * @param relationName - Relation field name
 * @param schemaName - Schema name
 * @param foreignKey - Foreign key field name
 */
export function throwInvalidRelationWhereSyntax(
	relationName: string,
	schemaName: string,
	foreignKey: string,
): never {
	throw new ForjaJsonAdapterError(
		`Invalid WHERE clause: Cannot use comparison operators directly on relation field '${relationName}'`,
		{
			code: "ADAPTER_INVALID_RELATION_WHERE",
			operation: "query",
			context: { relationName, schemaName, foreignKey },
			suggestion:
				`Use nested WHERE syntax: { ${relationName}: { <field>: { $eq: <value> } } }\n` +
				`Or filter by foreign key directly: { ${foreignKey}: { $eq: <value> } }`,
			expected: `Nested WHERE object with field names (e.g., { id: { $eq: 1 } })`,
			received: "Comparison operators (e.g., { $eq: 1 })",
		},
	);
}

// ============================================================================
// Constraint Errors
// ============================================================================

/**
 * Throw unique constraint error for field
 *
 * @param field - Field name
 * @param value - Duplicate value
 * @param table - Table name
 */
export function throwUniqueConstraintField(
	field: string,
	value: unknown,
	table: string,
): never {
	throw new ForjaJsonAdapterError(
		`Duplicate value '${value}' for unique field '${field}'`,
		{
			code: "ADAPTER_UNIQUE_CONSTRAINT",
			operation: "query",
			context: { field, value, table },
			suggestion: `Ensure '${field}' value is unique in table '${table}'`,
			expected: "unique value",
			received: value,
		},
	);
}

/**
 * Throw unique constraint error for index
 *
 * @param fields - Index field names
 * @param table - Table name
 */
export function throwUniqueConstraintIndex(
	fields: readonly string[],
	table: string,
): never {
	throw new ForjaJsonAdapterError(
		`Duplicate value for unique index [${fields.join(", ")}]`,
		{
			code: "ADAPTER_UNIQUE_CONSTRAINT",
			operation: "query",
			context: { fields: fields.join(", "), table },
			suggestion: `Ensure combination of [${fields.join(", ")}] is unique in table '${table}'`,
			expected: "unique combination",
		},
	);
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
	throw new ForjaJsonAdapterError(`Model not found for table: ${table}`, {
		code: "ADAPTER_MODEL_NOT_FOUND",
		operation: "populate",
		context: { table },
		suggestion: "Ensure model is registered in schema registry",
	});
}

/**
 * Throw schema not found error
 *
 * @param modelName - Model name
 */
export function throwSchemaNotFound(modelName: string): never {
	throw new ForjaJsonAdapterError(`Schema not found for model: ${modelName}`, {
		code: "ADAPTER_SCHEMA_NOT_FOUND",
		operation: "populate",
		context: { modelName },
		suggestion: "Ensure schema is registered in schema registry",
	});
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
	throw new ForjaJsonAdapterError(
		`Relation field '${relationName}' not found in schema '${schemaName}'`,
		{
			code: "ADAPTER_RELATION_NOT_FOUND",
			operation: "populate",
			context: { relationName, schemaName },
			suggestion: `Add '${relationName}' relation to schema '${schemaName}' or check field name`,
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
	throw new ForjaJsonAdapterError(
		`Field '${relationName}' (type: ${fieldType}) is not a relation field in schema '${schemaName}'`,
		{
			code: "ADAPTER_INVALID_RELATION",
			operation: "populate",
			context: { relationName, fieldType, schemaName },
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
	throw new ForjaJsonAdapterError(
		`Target model '${targetModel}' not found for relation '${relationName}' in schema '${schemaName}'`,
		{
			code: "ADAPTER_TARGET_MODEL_NOT_FOUND",
			operation: "populate",
			context: { targetModel, relationName, schemaName },
			suggestion: `Ensure model '${targetModel}' is registered in schema registry`,
		},
	);
}

/**
 * Throw foreign key constraint error
 *
 * Thrown when trying to insert/update a record with a foreign key
 * that references a non-existent record in the target table.
 *
 * @param foreignKey - Foreign key field name (e.g., "categoryId")
 * @param value - The invalid foreign key value
 * @param targetModel - Target model name (e.g., "category")
 * @param table - Source table name
 */
export function throwForeignKeyConstraint(
	foreignKey: string,
	value: unknown,
	targetModel: string,
	table: string,
): never {
	throw new ForjaJsonAdapterError(
		`Foreign key constraint failed: ${targetModel} with id '${value}' does not exist`,
		{
			code: "ADAPTER_FOREIGN_KEY_CONSTRAINT",
			operation: "query",
			context: { foreignKey, value, targetModel, table },
			suggestion: `Ensure ${targetModel} with id '${value}' exists before referencing it`,
			expected: `existing ${targetModel} id`,
			received: value,
		},
	);
}
