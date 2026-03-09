/**
 * Forja Adapter Error
 *
 * Single unified error class for all database adapters.
 * Replaces ForjaPostgresAdapterError, ForjaMySQLAdapterError, ForjaJsonAdapterError.
 */

import { ForjaError, type SerializedForjaError } from "../forja-error";

// ============================================================================
// Adapter Name
// ============================================================================

export type AdapterName = "postgres" | "mysql" | "mongodb" | "json";

// ============================================================================
// Adapter Operation
// ============================================================================

export type AdapterOperation =
	// Common
	| "connect"
	| "disconnect"
	| "query"
	| "transaction"
	| "populate"
	| "join"
	| "aggregation"
	| "migration"
	| "introspection"
	// JSON-specific
	| "lock"
	| "read"
	| "write"
	| "validate";

// ============================================================================
// Adapter Error Codes
// ============================================================================

export type AdapterErrorCode =
	// --- Common ---
	| "ADAPTER_CONNECTION_ERROR"
	| "ADAPTER_QUERY_ERROR"
	| "ADAPTER_TRANSACTION_ERROR"
	| "ADAPTER_MIGRATION_ERROR"
	| "ADAPTER_INTROSPECTION_ERROR"
	| "ADAPTER_AGGREGATION_ERROR"
	| "ADAPTER_POPULATE_ERROR"
	| "ADAPTER_JOIN_ERROR"
	| "ADAPTER_LATERAL_JOIN_ERROR"
	| "ADAPTER_JSON_AGGREGATION_ERROR"
	| "ADAPTER_RESULT_PROCESSING_ERROR"
	| "ADAPTER_INVALID_POPULATE_OPTIONS"
	| "ADAPTER_MODEL_NOT_FOUND"
	| "ADAPTER_SCHEMA_NOT_FOUND"
	| "ADAPTER_RELATION_NOT_FOUND"
	| "ADAPTER_INVALID_RELATION"
	| "ADAPTER_TARGET_MODEL_NOT_FOUND"
	| "ADAPTER_JUNCTION_TABLE_NOT_FOUND"
	| "ADAPTER_MAX_DEPTH_EXCEEDED"
	// --- JSON-specific ---
	| "ADAPTER_LOCK_TIMEOUT"
	| "ADAPTER_LOCK_ERROR"
	| "ADAPTER_FILE_READ_ERROR"
	| "ADAPTER_FILE_WRITE_ERROR"
	| "ADAPTER_FILE_NOT_FOUND"
	| "ADAPTER_INVALID_DATA"
	| "ADAPTER_QUERY_MISSING_DATA"
	| "ADAPTER_INVALID_WHERE_FIELD"
	| "ADAPTER_INVALID_RELATION_WHERE"
	| "ADAPTER_UNIQUE_CONSTRAINT"
	| "ADAPTER_FOREIGN_KEY_CONSTRAINT";

// ============================================================================
// Error Context
// ============================================================================

export interface AdapterErrorContext {
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
	readonly relationPath?: string;
	readonly file?: string;
	readonly lockTimeout?: number;
	readonly [key: string]: unknown;
}

// ============================================================================
// Error Options
// ============================================================================

export interface ForjaAdapterErrorOptions {
	readonly adapter: AdapterName;
	readonly code: AdapterErrorCode;
	readonly operation?: AdapterOperation | undefined;
	readonly context?: AdapterErrorContext | undefined;
	readonly cause?: Error | undefined;
	readonly suggestion?: string | undefined;
	readonly expected?: string | undefined;
	readonly received?: unknown | undefined;
}

// ============================================================================
// Serialized Error
// ============================================================================

export interface SerializedForjaAdapterError extends SerializedForjaError {
	readonly adapter: AdapterName;
	readonly adapterOperation?: AdapterOperation;
}

// ============================================================================
// Error Class
// ============================================================================

/**
 * Forja Adapter Error Class
 *
 * Unified error class for all database adapters (postgres, mysql, json).
 * Use helper functions from adapter-helpers.ts instead of instantiating directly.
 *
 * @example
 * ```ts
 * throw new ForjaAdapterError('Model not found', {
 *   adapter: 'postgres',
 *   code: 'ADAPTER_MODEL_NOT_FOUND',
 *   operation: 'populate',
 *   context: { table: 'users' },
 *   suggestion: 'Ensure model is registered in schema registry',
 * });
 * ```
 */
export class ForjaAdapterError extends ForjaError<AdapterErrorContext> {
	readonly adapter: AdapterName;
	readonly adapterOperation?: AdapterOperation | undefined;

	constructor(message: string, options: ForjaAdapterErrorOptions) {
		const operationString = options.operation
			? `adapter:${options.adapter}:${options.operation}`
			: `adapter:${options.adapter}`;

		super(message, {
			code: options.code,
			operation: operationString,
			context: options.context,
			cause: options.cause,
			suggestion: options.suggestion,
			expected: options.expected,
			received: options.received,
		});

		this.adapter = options.adapter;
		this.adapterOperation = options.operation;
	}

	override toJSON(): SerializedForjaAdapterError {
		const json = super.toJSON();

		if (this.adapterOperation) {
			return {
				...json,
				adapter: this.adapter,
				adapterOperation: this.adapterOperation,
			};
		}

		return { ...json, adapter: this.adapter };
	}

	override toDetailedMessage(): string {
		const baseMessage = super.toDetailedMessage();
		const parts = baseMessage.split("\n");

		const extraLines: string[] = [`  Adapter: ${this.adapter}`];

		if (this.adapterOperation) {
			extraLines.push(`  Adapter Operation: ${this.adapterOperation}`);
		}

		parts.splice(3, 0, ...extraLines);
		return parts.join("\n");
	}
}
