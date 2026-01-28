/**
 * PostgreSQL Adapter Error
 *
 * Specialized error for PostgreSQL database adapter operations.
 * Extends ForjaError with adapter-specific fields.
 */

import { ForjaError, type SerializedForjaError } from "forja-types/errors";

/**
 * PostgreSQL adapter operation types
 */
export type PostgresAdapterOperation =
  | "connect"
  | "disconnect"
  | "query"
  | "transaction"
  | "populate"
  | "join"
  | "aggregation"
  | "migration"
  | "introspection";

/**
 * PostgreSQL adapter error codes
 */
export type PostgresAdapterErrorCode =
  | "ADAPTER_CONNECTION_ERROR"
  | "ADAPTER_QUERY_ERROR"
  | "ADAPTER_TRANSACTION_ERROR"
  | "ADAPTER_POPULATE_ERROR"
  | "ADAPTER_JOIN_ERROR"
  | "ADAPTER_AGGREGATION_ERROR"
  | "ADAPTER_MIGRATION_ERROR"
  | "ADAPTER_INTROSPECTION_ERROR"
  | "ADAPTER_MODEL_NOT_FOUND"
  | "ADAPTER_SCHEMA_NOT_FOUND"
  | "ADAPTER_RELATION_NOT_FOUND"
  | "ADAPTER_INVALID_RELATION"
  | "ADAPTER_TARGET_MODEL_NOT_FOUND"
  | "ADAPTER_JUNCTION_TABLE_NOT_FOUND"
  | "ADAPTER_MAX_DEPTH_EXCEEDED"
  | "ADAPTER_INVALID_POPULATE_OPTIONS"
  | "ADAPTER_LATERAL_JOIN_ERROR"
  | "ADAPTER_JSON_AGGREGATION_ERROR"
  | "ADAPTER_RESULT_PROCESSING_ERROR";

/**
 * PostgreSQL adapter error context
 */
export interface PostgresAdapterErrorContext {
  readonly operation?: PostgresAdapterOperation;
  readonly table?: string;
  readonly model?: string;
  readonly field?: string;
  readonly relationName?: string;
  readonly targetModel?: string;
  readonly junctionTable?: string;
  readonly query?: Record<string, unknown>;
  readonly sql?: string;
  readonly params?: readonly unknown[];
  readonly depth?: number;
  readonly maxDepth?: number;
  readonly populateOptions?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

/**
 * Options for creating ForjaPostgresAdapterError
 */
export interface ForjaPostgresAdapterErrorOptions {
  readonly code: PostgresAdapterErrorCode;
  readonly operation?: PostgresAdapterOperation | undefined;
  readonly context?: PostgresAdapterErrorContext | undefined;
  readonly cause?: Error | undefined;
  readonly suggestion?: string | undefined;
  readonly expected?: string | undefined;
  readonly received?: unknown | undefined;
}

/**
 * Serialized PostgreSQL adapter error for API responses
 */
export interface SerializedForjaPostgresAdapterError
  extends SerializedForjaError {
  readonly adapterOperation?: PostgresAdapterOperation;
}

/**
 * Forja PostgreSQL Adapter Error Class
 *
 * Specialized ForjaError for PostgreSQL database adapter failures.
 * Includes operation type for better debugging.
 *
 * @example
 * ```ts
 * throw new ForjaPostgresAdapterError('Failed to populate relation', {
 *   code: 'ADAPTER_POPULATE_ERROR',
 *   operation: 'populate',
 *   context: { relationName: 'author', model: 'Post' },
 *   suggestion: 'Ensure the relation is properly defined in schema'
 * });
 * ```
 */
export class ForjaPostgresAdapterError extends ForjaError<PostgresAdapterErrorContext> {
  readonly adapterOperation?: PostgresAdapterOperation | undefined;

  constructor(message: string, options: ForjaPostgresAdapterErrorOptions) {
    super(message, {
      code: options.code,
      operation:
        options.operation ?
          `adapter:postgres:${options.operation}`
        : "adapter:postgres",
      context: options.context,
      cause: options.cause,
      suggestion: options.suggestion,
      expected: options.expected,
      received: options.received,
    });

    this.adapterOperation = options.operation;
  }

  /**
   * Override toJSON to include adapter-specific fields
   */
  override toJSON(): SerializedForjaPostgresAdapterError {
    const json = super.toJSON();

    if (this.adapterOperation) {
      return {
        ...json,
        adapterOperation: this.adapterOperation,
      };
    }

    return json;
  }

  /**
   * Override toDetailedMessage to include adapter-specific fields
   */
  override toDetailedMessage(): string {
    const baseMessage = super.toDetailedMessage();

    if (this.adapterOperation) {
      const parts = baseMessage.split("\n");
      parts.splice(3, 0, `  Adapter Operation: ${this.adapterOperation}`);
      return parts.join("\n");
    }

    return baseMessage;
  }
}
