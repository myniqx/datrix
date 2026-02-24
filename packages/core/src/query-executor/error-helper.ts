/**
 * Query Executor Error Helpers
 *
 * Centralized error creation for query executor operations.
 */

import { ForjaEntry, QueryObject } from "forja-types";
import {
	CrudErrorCode,
	CrudErrorContext,
	CrudOperation,
	ForjaCrudError,
	ForjaError,
} from "forja-types/errors";

/**
 * Options for throwing CRUD errors
 */
export interface ThrowCrudErrorOptions {
	readonly operation: CrudOperation;
	readonly model: string;
	readonly code: CrudErrorCode;
	readonly message?: string;
	readonly cause?: Error;
	readonly context?: CrudErrorContext;
	readonly suggestion?: string;
	readonly expected?: string;
	readonly received?: unknown;
}

/**
 * Throws a standardized CRUD error
 *
 * @param options - Error options
 * @throws ForjaCrudError
 *
 * @example
 * ```ts
 * throwCrudError({
 *   operation: 'findOne',
 *   model: 'User',
 *   code: 'QUERY_EXECUTION_FAILED',
 *   cause: dbError,
 *   context: { query }
 * });
 * ```
 */
export function throwCrudError(options: ThrowCrudErrorOptions): never {
	const {
		operation,
		model,
		code,
		message,
		cause,
		context,
		suggestion,
		expected,
		received,
	} = options;

	const defaultMessage = generateDefaultMessage(operation, model, code);

	throw new ForjaCrudError(message ?? defaultMessage, {
		code,
		operation,
		model,
		context: enhanceContext(context, cause),
		cause,
		suggestion,
		expected,
		received,
	});
}

/**
 * Enhance context with adapter error details if available
 */
function enhanceContext(
	context: CrudErrorContext | undefined,
	cause: Error | undefined,
): CrudErrorContext | undefined {
	if (!cause) {
		return context;
	}

	return {
		...context,
		adapterError: cause.message,
	};
}

/**
 * Generate a default error message based on operation and code
 */
function generateDefaultMessage(
	operation: CrudOperation,
	model: string,
	code: CrudErrorCode,
): string {
	switch (code) {
		case "QUERY_EXECUTION_FAILED":
			return `Failed to execute ${operation} query for ${model}`;
		case "SCHEMA_NOT_FOUND":
			return `Schema '${model}' not found`;
		case "RECORD_NOT_FOUND":
			return `${model} record not found`;
		case "INVALID_POPULATE_VALUE":
			return `Invalid populate value for ${model}`;
		case "RESERVED_FIELD_WRITE":
			return `Cannot write to reserved field in ${model}`;
		case "NOT_IMPLEMENTED":
			return `${operation} not implemented for ${model}`;
		case "QUERY_FAILED":
			return `Query failed for ${model}`;
		default:
			return `CRUD operation failed for ${model}`;
	}
}

/**
 * Throw unsupported query type error
 *
 * @param queryType - The unsupported query type
 *
 * @example
 * ```ts
 * throwUnsupportedQueryType('invalid');
 * // Error: Unsupported query type: invalid
 * ```
 */
export function throwUnsupportedQueryType(queryType: unknown): never {
	throw new ForjaError(`Unsupported query type: ${queryType}`, {
		code: "UNSUPPORTED_QUERY_TYPE",
		context: { queryType },
		suggestion: "Use one of: select, insert, update, delete, count",
		expected: "select | insert | update | delete | count",
		received: queryType,
	});
}

/**
 * Helper for query execution errors
 * Most common use case in CRUD operations
 */
export function throwQueryExecutionError<T extends ForjaEntry>(
	operation: CrudOperation,
	model: string,
	query: QueryObject<T>,
	cause: Error,
): never {
	throwCrudError({
		operation,
		model,
		code: "QUERY_EXECUTION_FAILED",
		cause,
		context: {
			query: query as unknown as Record<string, unknown>,
		},
	});
}

/**
 * Helper for schema not found errors
 */
export function throwSchemaNotFoundError(model: string): never {
	throwCrudError({
		operation: "findOne",
		model,
		code: "SCHEMA_NOT_FOUND",
		suggestion: `Make sure the schema '${model}' is registered in your Forja instance`,
	});
}

/**
 * Helper for reserved field write errors
 */
export function throwReservedFieldError(field: string, model: string): never {
	throwCrudError({
		operation: "create",
		model,
		code: "RESERVED_FIELD_WRITE",
		message: `Cannot set reserved field '${field}'`,
		suggestion: `Use forja.raw.create() or forja.raw.update() for manual control of '${field}'`,
	});
}

/**
 * Helper for record not found errors (single id operations)
 *
 * @param operation - The CRUD operation (update or delete)
 * @param model - Model name
 * @param id - The record ID that was not found
 *
 * @example
 * ```ts
 * throwRecordNotFound('update', 'User', 123);
 * // Error: User record with id 123 not found
 * ```
 */
export function throwRecordNotFound(
	operation: "update" | "delete",
	model: string,
	id: number,
): never {
	throwCrudError({
		operation,
		model,
		code: "RECORD_NOT_FOUND",
		message: `${model} record with id ${id} not found`,
		context: { recordId: id },
		suggestion: `Verify that the ${model} with id ${id} exists before attempting to ${operation}`,
	});
}

/**
 * Helper for relation target not found errors
 *
 * Thrown when connect/set references IDs that don't exist in the target table.
 *
 * @param parentModel - Parent model name (e.g., "Post")
 * @param relationField - Relation field name (e.g., "tags")
 * @param targetModel - Target model name (e.g., "Tag")
 * @param missingIds - Array of IDs that were not found
 *
 * @example
 * ```ts
 * throwRelationTargetNotFound('Post', 'tags', 'Tag', [999, 1000]);
 * // Error: Cannot connect Post.tags: Tag records with ids [999, 1000] not found
 * ```
 */
export function throwRelationTargetNotFound(
	parentModel: string,
	relationField: string,
	targetModel: string,
	missingIds: readonly number[],
): never {
	const idsStr =
		missingIds.length === 1
			? `id ${missingIds[0]}`
			: `ids [${missingIds.join(", ")}]`;

	throwCrudError({
		operation: "update",
		model: parentModel,
		code: "RECORD_NOT_FOUND",
		message: `Cannot connect ${parentModel}.${relationField}: ${targetModel} records with ${idsStr} not found`,
		context: {
			relationField,
			targetModel,
			missingIds: [...missingIds],
		},
		suggestion: `Verify that all ${targetModel} IDs exist before connecting them to ${parentModel}.${relationField}`,
	});
}
