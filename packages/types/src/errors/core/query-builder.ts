/**
 * Query Builder Error
 *
 * Specialized error for query builder failures.
 * Covers all query builder components: builder, where, select, populate, pagination.
 */

import { ForjaError, type SerializedForjaError } from "../forja-error";

/**
 * Query builder component types
 */
export type QueryBuilderComponent =
  | "builder"
  | "where"
  | "select"
  | "populate"
  | "pagination";

/**
 * Query builder error codes
 */
export type QueryBuilderErrorCode =
  | "INVALID_QUERY_TYPE"
  | "MISSING_TABLE"
  | "INVALID_FIELD"
  | "INVALID_OPERATOR"
  | "INVALID_VALUE"
  | "MAX_DEPTH_EXCEEDED"
  | "EMPTY_CLAUSE"
  | "DUPLICATE_FIELD"
  | "COERCION_FAILED"
  | "RELATION_IN_SELECT"
  | "SCHEMA_NOT_FOUND"
  | "UNKNOWN_FIELD";

/**
 * Query builder error context
 */
export interface QueryBuilderErrorContext {
  readonly field?: string;
  readonly operator?: string;
  readonly value?: unknown;
  readonly availableFields?: readonly string[];
  readonly validOperators?: readonly string[];
  readonly depth?: number;
  readonly maxDepth?: number;
  readonly [key: string]: unknown;
}

/**
 * Options for creating ForjaQueryBuilderError
 */
export interface ForjaQueryBuilderErrorOptions {
  readonly code: QueryBuilderErrorCode;
  readonly component: QueryBuilderComponent;
  readonly field?: string | undefined;
  readonly context?: QueryBuilderErrorContext | undefined;
  readonly cause?: Error | undefined;
  readonly suggestion?: string | undefined;
  readonly expected?: string | undefined;
  readonly received?: unknown | undefined;
}

/**
 * Serialized query builder error
 */
export interface SerializedForjaQueryBuilderError extends SerializedForjaError {
  readonly component: QueryBuilderComponent;
  readonly field?: string;
}

/**
 * Forja Query Builder Error Class
 *
 * Specialized ForjaError for query builder failures.
 * Includes component type to identify which part of query building failed.
 */
export class ForjaQueryBuilderError extends ForjaError<QueryBuilderErrorContext> {
  readonly component: QueryBuilderComponent;
  readonly field?: string | undefined;

  constructor(
    message: string,
    options?: ForjaQueryBuilderErrorOptions | string,
  ) {
    // Backward compatibility: if options is string, it's the old 'code' parameter
    const normalizedOptions: ForjaQueryBuilderErrorOptions =
      typeof options === "string" || options === undefined ?
        {
          code: (options as QueryBuilderErrorCode) || "INVALID_VALUE",
          component: "builder",
        }
        : options;

    super(message, {
      code: normalizedOptions.code,
      operation: `query-builder:${normalizedOptions.component}`,
      context: normalizedOptions.context,
      cause: normalizedOptions.cause,
      suggestion: normalizedOptions.suggestion,
      expected: normalizedOptions.expected,
      received: normalizedOptions.received,
    });

    this.component = normalizedOptions.component;
    this.field = normalizedOptions.field;
  }

  /**
   * Override toJSON to include query builder-specific fields
   */
  override toJSON(): SerializedForjaQueryBuilderError {
    return {
      ...super.toJSON(),
      component: this.component,
      ...(this.field && { field: this.field }),
    };
  }

  /**
   * Override toDetailedMessage to include query builder-specific info
   */
  override toDetailedMessage(): string {
    const baseMessage = super.toDetailedMessage();
    const builderInfo = [`  Component: ${this.component}`];

    if (this.field) {
      builderInfo.push(`  Field: ${this.field}`);
    }

    const lines = baseMessage.split("\n");
    lines.splice(1, 0, ...builderInfo);

    return lines.join("\n");
  }
}
