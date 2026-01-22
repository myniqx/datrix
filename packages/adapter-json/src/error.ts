/**
 * JSON Adapter Error
 *
 * Specialized error for JSON file adapter operations.
 * Extends ForjaError with adapter-specific fields.
 */

import { ForjaError, type SerializedForjaError } from "forja-types/errors";

/**
 * JSON adapter operation types
 */
export type JsonAdapterOperation =
  | "connect"
  | "disconnect"
  | "query"
  | "transaction"
  | "lock"
  | "populate"
  | "read"
  | "write"
  | "validate";

/**
 * JSON adapter error codes
 */
export type JsonAdapterErrorCode =
  | "ADAPTER_LOCK_TIMEOUT"
  | "ADAPTER_LOCK_ERROR"
  | "ADAPTER_FILE_READ_ERROR"
  | "ADAPTER_FILE_WRITE_ERROR"
  | "ADAPTER_FILE_NOT_FOUND"
  | "ADAPTER_INVALID_DATA"
  | "ADAPTER_QUERY_MISSING_DATA"
  | "ADAPTER_UNIQUE_CONSTRAINT"
  | "ADAPTER_MODEL_NOT_FOUND"
  | "ADAPTER_SCHEMA_NOT_FOUND"
  | "ADAPTER_RELATION_NOT_FOUND"
  | "ADAPTER_INVALID_RELATION"
  | "ADAPTER_TARGET_MODEL_NOT_FOUND"
  | "ADAPTER_TRANSACTION_ERROR"
  | "ADAPTER_CONNECTION_ERROR";

/**
 * JSON adapter error context
 */
export interface JsonAdapterErrorContext {
  readonly operation?: JsonAdapterOperation;
  readonly table?: string;
  readonly file?: string;
  readonly field?: string;
  readonly value?: unknown;
  readonly relationName?: string;
  readonly modelName?: string;
  readonly lockTimeout?: number;
  readonly query?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

/**
 * Options for creating ForjaJsonAdapterError
 */
export interface ForjaJsonAdapterErrorOptions {
  readonly code: JsonAdapterErrorCode;
  readonly operation?: JsonAdapterOperation;
  readonly context?: JsonAdapterErrorContext;
  readonly cause?: Error;
  readonly suggestion?: string;
  readonly expected?: string;
  readonly received?: unknown;
}

/**
 * Serialized JSON adapter error for API responses
 */
export interface SerializedForjaJsonAdapterError extends SerializedForjaError {
  readonly adapterOperation?: JsonAdapterOperation;
}

/**
 * Forja JSON Adapter Error Class
 *
 * Specialized ForjaError for JSON file adapter failures.
 * Includes operation type for better debugging.
 *
 * @example
 * ```ts
 * throw new ForjaJsonAdapterError('Could not acquire lock', {
 *   code: 'ADAPTER_LOCK_TIMEOUT',
 *   operation: 'lock',
 *   context: { lockTimeout: 5000 },
 *   suggestion: 'Increase lockTimeout in adapter config'
 * });
 * ```
 */
export class ForjaJsonAdapterError extends ForjaError<JsonAdapterErrorContext> {
  readonly adapterOperation?: JsonAdapterOperation;

  constructor(message: string, options: ForjaJsonAdapterErrorOptions) {
    super(message, {
      code: options.code,
      operation: options.operation
        ? `adapter:json:${options.operation}`
        : "adapter:json",
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
  override toJSON(): SerializedForjaJsonAdapterError {
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
