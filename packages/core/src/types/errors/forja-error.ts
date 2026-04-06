/**
 * Base Forja Error Class
 *
 * All Forja errors extend this class OR use it directly.
 * Provides standard error structure across the framework.
 *
 * ## Usage Guidelines
 *
 * ### Option 1: Direct Usage (Simple Errors)
 * ```typescript
 * throw new ForjaError('Connection failed', {
 *   code: 'CONNECTION_FAILED',
 *   operation: 'database:connect',
 *   context: { host: 'localhost', port: 5432 }
 * });
 * ```
 *
 * ### Option 2: Extend for Specialized Errors (Complex Errors)
 * ```typescript
 * class ParserError extends ForjaError {
 *   readonly parser: ParserType;
 *   readonly location: ErrorLocation;
 *   // ... additional fields
 * }
 * ```
 *
 * ## When to Extend?
 *
 * **Extend when you need:**
 * - Additional fields (e.g., `location`, `field`, `parser`)
 * - Custom serialization logic
 * - Domain-specific error codes
 * - Client-facing errors with user guidance
 *
 * **Use directly when:**
 * - Simple internal errors
 * - Errors without special context needs
 * - Adapter/plugin errors (unless you need special fields)
 *
 * ## Client-Facing vs Internal Errors
 *
 * **Client-Facing** (API, Parser, Validation):
 * - Include: `suggestion`, `expected`, `received`
 * - User-friendly messages
 * - Detailed context
 *
 * **Internal** (Database, Plugin, Core):
 * - Skip: `suggestion`, `expected`, `received` (undefined)
 * - Technical messages
 * - Minimal context (just enough for debugging)
 *
 * @example
 * // Internal error (database adapter)
 * throw new ForjaError('Query execution failed', {
 *   code: 'QUERY_FAILED',
 *   operation: 'executeQuery',
 *   context: { query: queryObject },
 *   cause: originalError
 * });
 *
 * @example
 * // Client-facing error (validation)
 * throw new ForjaError('Field is required', {
 *   code: 'REQUIRED',
 *   operation: 'validate:field',
 *   context: { field: 'email' },
 *   suggestion: 'Provide a value for the email field',
 *   expected: 'non-empty string',
 *   received: undefined
 * });
 */
export class ForjaError<
	TContext extends Record<string, unknown> = Record<string, unknown>,
> extends Error {
	/** Error code for programmatic handling */
	readonly code: string;

	/** When this error occurred */
	readonly timestamp: Date;

	/** Operation that caused the error (e.g., 'parseQuery', 'validateField') */
	readonly operation?: string | undefined;

	/** Additional error context (error-specific details) */
	readonly context?: TContext | undefined;

	/** Underlying error (for error chaining) */
	override readonly cause?: Error | undefined;

	// Client-facing fields (optional)

	/** User guidance - how to fix this error */
	readonly suggestion?: string | undefined;

	/** Expected value/format */
	readonly expected?: string | undefined;

	/** Actual received value */
	readonly received?: unknown;

	/** Documentation link (optional, can be added later) */
	readonly documentation?: string | undefined;

	constructor(message: string, options: ForjaErrorOptions<TContext>) {
		super(message, { cause: options.cause });

		this.name = this.constructor.name;
		this.code = options.code;
		this.timestamp = new Date();
		this.operation = options.operation;
		this.context = options.context;
		this.cause = options.cause;

		// Client-facing fields
		this.suggestion = options.suggestion;
		this.expected = options.expected;
		this.received = options.received;
		this.documentation = options.documentation;

		// Maintain proper stack trace
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, this.constructor);
		}
	}

	/**
	 * Serialize error for JSON responses
	 * Automatically excludes undefined fields
	 */
	toJSON(): SerializedForjaError {
		const json: SerializedForjaError = {
			type: this.name,
			message: this.message,
			code: this.code,
			timestamp: this.timestamp.toISOString(),
		};

		// Add optional fields only if defined
		if (this.operation) json.operation = this.operation;
		if (this.context) json.context = this.context;
		if (this.suggestion) json.suggestion = this.suggestion;
		if (this.expected) json.expected = this.expected;
		if (this.received !== undefined) json.received = this.received;
		if (this.documentation) json.documentation = this.documentation;

		if (this.cause) {
			json.cause = {
				message: this.cause.message,
				name: this.cause.name,
			};
		}

		return json;
	}

	/**
	 * Get detailed error message (for logging)
	 */
	toDetailedMessage(): string {
		const parts = [
			`[${this.name}] ${this.message}`,
			`  Code: ${this.code}`,
			`  Timestamp: ${this.timestamp.toISOString()}`,
		];

		if (this.operation) {
			parts.push(`  Operation: ${this.operation}`);
		}

		if (this.received !== undefined) {
			parts.push(`  Received: ${JSON.stringify(this.received)}`);
		}

		if (this.expected) {
			parts.push(`  Expected: ${this.expected}`);
		}

		if (this.suggestion) {
			parts.push(`  Suggestion: ${this.suggestion}`);
		}

		if (this.documentation) {
			parts.push(`  Documentation: ${this.documentation}`);
		}

		if (this.cause) {
			parts.push(`  Caused by: ${this.cause.message}`);
		}

		return parts.join("\n");
	}

	/**
	 * Type guard - check if error is a ForjaError
	 */
	static isForjaError(error: unknown): error is ForjaError {
		return error instanceof ForjaError;
	}
}

/**
 * Options for creating ForjaError
 */
export interface ForjaErrorOptions<
	TContext extends Record<string, unknown> = Record<string, unknown>,
> {
	/**
	 * Error code (machine-readable)
	 * Each error type can define its own code constants
	 */
	readonly code: string;

	/**
	 * Operation that caused the error
	 * Examples: 'parseQuery', 'validateField', 'executeQuery'
	 */
	readonly operation?: string | undefined;

	/**
	 * Additional error context
	 * Include relevant details for debugging
	 */
	readonly context?: TContext | undefined;

	/**
	 * Underlying error (for error chaining)
	 * Use when wrapping lower-level errors
	 */
	readonly cause?: Error | undefined;

	// Client-facing fields (optional)

	/**
	 * User guidance - how to fix this error
	 * Only for client-facing errors
	 */
	readonly suggestion?: string | undefined;

	/**
	 * Expected value/format
	 * Only for client-facing errors
	 */
	readonly expected?: string | undefined;

	/**
	 * Actual received value
	 * Only for client-facing errors
	 */
	readonly received?: unknown | undefined;

	/**
	 * Documentation link
	 * Can be added later
	 */
	readonly documentation?: string | undefined;
}

/**
 * Serialized error for JSON responses
 * Only includes defined fields
 */
export interface SerializedForjaError {
	readonly type: string;
	readonly message: string;
	readonly code: string;
	readonly timestamp: string;
	operation?: string;
	context?: Record<string, unknown>;
	suggestion?: string;
	expected?: string;
	received?: unknown;
	documentation?: string;
	cause?: {
		readonly message: string;
		readonly name: string;
	};
}
