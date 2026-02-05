/**
 * CRUD Error Helper
 *
 * Centralized error creation for CRUD operations.
 * Provides consistent error formatting across all CRUD methods.
 */

import {
  ForjaCrudError,
  type CrudOperation,
  type CrudErrorCode,
  type CrudErrorContext,
} from "forja-types/errors";
import type { QueryObject } from "forja-types/core/query-builder";
import { ForjaEntry } from "forja-types";

/**
 * Options for throwing CRUD errors
 */
export interface ThrowCrudErrorOptions {
  readonly operation: CrudOperation | "insert";
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
 * Helper for query execution errors
 * Most common use case in CRUD operations
 */
export function throwQueryExecutionError<T extends ForjaEntry>(
  operation: CrudOperation | "insert",
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
 * Helper for invalid populate errors
 */
export function throwInvalidPopulateError(
  model: string,
  field: string,
  received: unknown,
): never {
  throwCrudError({
    operation: "findOne",
    model,
    code: "INVALID_POPULATE_VALUE",
    message: `Invalid populate value for ${model}.${field}`,
    received,
    expected: "boolean | object | '*'",
    suggestion: "Use true, '*', or { select, populate } for populate values",
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
 * Helper for not implemented errors
 */
export function throwNotImplementedError(
  operation: CrudOperation,
  model: string,
  feature: string,
): never {
  throwCrudError({
    operation,
    model,
    code: "NOT_IMPLEMENTED",
    message: `${feature} not yet implemented`,
    suggestion: "This feature is planned for a future release",
  });
}

/**
 * Helper for non-relation field in populate error
 */
export function throwNonRelationFieldInPopulateError(
  model: string,
  field: string,
  fieldType: string,
): never {
  throwCrudError({
    operation: "findOne",
    model,
    code: "INVALID_POPULATE_VALUE",
    message: `Cannot populate non-relation field '${field}' in ${model}`,
    received: fieldType,
    expected: "relation field",
    suggestion: `'${field}' is a ${fieldType} field. Only relation fields can be populated. Available relations: check your schema definition.`,
  });
}

/**
 * Helper for relation field in select error
 */
export function throwRelationFieldInSelectError(
  model: string,
  field: string,
): never {
  throwCrudError({
    operation: "findOne",
    model,
    code: "INVALID_POPULATE_VALUE",
    message: `Cannot select relation field '${field}' directly in ${model}`,
    received: field,
    expected: "scalar field",
    suggestion: `Use populate to load '${field}' relation. Example: { populate: { ${field}: true } }`,
  });
}
