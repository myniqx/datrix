/**
 * MySQL Adapter Error
 *
 * Specialized error for MySQL database adapter operations.
 * Extends ForjaError with adapter-specific fields.
 */

import { ForjaError, type SerializedForjaError } from "forja-types/errors";

/**
 * MySQL adapter operation types
 */
export type MySQLAdapterOperation =
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
 * MySQL adapter error codes
 */
export type MySQLAdapterErrorCode =
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
 * MySQL adapter error context
 */
export interface MySQLAdapterErrorContext {
	readonly operation?: MySQLAdapterOperation;
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
 * Options for creating ForjaMySQLAdapterError
 */
export interface ForjaMySQLAdapterErrorOptions {
	readonly code: MySQLAdapterErrorCode;
	readonly operation?: MySQLAdapterOperation | undefined;
	readonly context?: MySQLAdapterErrorContext | undefined;
	readonly cause?: Error | undefined;
	readonly suggestion?: string | undefined;
	readonly expected?: string | undefined;
	readonly received?: unknown | undefined;
}

/**
 * Serialized MySQL adapter error for API responses
 */
export interface SerializedForjaMySQLAdapterError extends SerializedForjaError {
	readonly adapterOperation?: MySQLAdapterOperation;
}

/**
 * Forja MySQL Adapter Error Class
 *
 * Specialized ForjaError for MySQL database adapter failures.
 * Includes operation type for better debugging.
 *
 * @example
 * ```ts
 * throw new ForjaMySQLAdapterError('Failed to populate relation', {
 *   code: 'ADAPTER_POPULATE_ERROR',
 *   operation: 'populate',
 *   context: { relationName: 'author', model: 'Post' },
 *   suggestion: 'Ensure the relation is properly defined in schema'
 * });
 * ```
 */
export class ForjaMySQLAdapterError extends ForjaError<MySQLAdapterErrorContext> {
	readonly adapterOperation?: MySQLAdapterOperation | undefined;

	constructor(message: string, options: ForjaMySQLAdapterErrorOptions) {
		super(message, {
			code: options.code,
			operation: options.operation
				? `adapter:mysql:${options.operation}`
				: "adapter:mysql",
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
	override toJSON(): SerializedForjaMySQLAdapterError {
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
