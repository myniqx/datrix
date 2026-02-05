/**
 * CRUD Operation Error
 *
 * Specialized error for database CRUD operation failures.
 * Extends ForjaError with CRUD-specific fields.
 */

import { ForjaError, type SerializedForjaError } from "../forja-error";

/**
 * CRUD operation types
 */
export type CrudOperation =
	| "findOne"
	| "findById"
	| "findMany"
	| "count"
	| "create"
	| "update"
	| "updateMany"
	| "delete"
	| "deleteMany";

/**
 * CRUD error codes
 */
export type CrudErrorCode =
	| "QUERY_EXECUTION_FAILED"
	| "SCHEMA_NOT_FOUND"
	| "RECORD_NOT_FOUND"
	| "INVALID_POPULATE_VALUE"
	| "RESERVED_FIELD_WRITE"
	| "NOT_IMPLEMENTED"
	| "QUERY_FAILED";

/**
 * CRUD error context
 */
export interface CrudErrorContext {
	readonly model?: string;
	readonly query?: Record<string, unknown>;
	readonly recordId?: string | number;
	readonly where?: Record<string, unknown>;
	readonly adapterError?: string;
	readonly [key: string]: unknown;
}

/**
 * Options for creating ForjaCrudError
 */
export interface ForjaCrudErrorOptions {
	readonly code: CrudErrorCode;
	readonly operation: CrudOperation;
	readonly model: string;
	readonly context?: CrudErrorContext | undefined;
	readonly cause?: Error | undefined;
	readonly suggestion?: string | undefined;
	readonly expected?: string | undefined;
	readonly received?: unknown | undefined;
}

/**
 * Serialized CRUD error for API responses
 */
export interface SerializedForjaCrudError extends SerializedForjaError {
	readonly operation: CrudOperation;
	readonly model: string;
}

/**
 * Forja CRUD Error Class
 *
 * Specialized ForjaError for CRUD operation failures.
 * Includes operation type and model name for better debugging.
 */
export class ForjaCrudError extends ForjaError<CrudErrorContext> {
	override readonly operation: CrudOperation;
	readonly model: string;

	constructor(message: string, options: ForjaCrudErrorOptions) {
		super(message, {
			code: options.code,
			operation: `crud:${options.operation}`,
			context: options.context,
			cause: options.cause,
			suggestion: options.suggestion,
			expected: options.expected,
			received: options.received,
		});

		this.operation = options.operation;
		this.model = options.model;
	}

	/**
	 * Override toJSON to include CRUD-specific fields
	 */
	override toJSON(): SerializedForjaCrudError {
		return {
			...super.toJSON(),
			operation: this.operation,
			model: this.model,
		};
	}

	/**
	 * Override toDetailedMessage to include CRUD-specific info
	 */
	override toDetailedMessage(): string {
		const baseMessage = super.toDetailedMessage();
		const crudInfo = [
			`  Operation: ${this.operation}`,
			`  Model: ${this.model}`,
		];

		const lines = baseMessage.split("\n");
		lines.splice(1, 0, ...crudInfo);

		return lines.join("\n");
	}
}
