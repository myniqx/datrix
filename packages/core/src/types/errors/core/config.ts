/**
 * Config Error
 *
 * Specialized error for configuration validation failures.
 * Extends DatrixError with config-specific fields.
 */

import { DatrixError, type SerializedDatrixError } from "../datrix-error";

/**
 * Config error codes
 */
export type ConfigErrorCode =
	| "CONFIG_NOT_FOUND"
	| "CONFIG_INVALID_TYPE"
	| "CONFIG_REQUIRED_FIELD"
	| "CONFIG_INVALID_VALUE"
	| "CONFIG_EMPTY_VALUE"
	| "CONFIG_VALIDATION_FAILED"
	| "CONFIG_MULTIPLE_ERRORS";

/**
 * Config error context
 */
export interface ConfigErrorContext {
	readonly field?: string;
	readonly validOptions?: readonly string[];
	readonly receivedType?: string;
	readonly expectedType?: string;
	readonly index?: number;
	readonly configPath?: string;
	readonly [key: string]: unknown;
}

/**
 * Options for creating DatrixConfigError
 */
export interface DatrixConfigErrorOptions {
	readonly code: ConfigErrorCode;
	readonly field?: string | undefined;
	readonly context?: ConfigErrorContext | undefined;
	readonly cause?: Error | undefined;
	readonly suggestion?: string | undefined;
	readonly expected?: string | undefined;
	readonly received?: unknown | undefined;
}

/**
 * Serialized config error for API responses
 */
export interface SerializedDatrixConfigError extends SerializedDatrixError {
	readonly field?: string;
}

/**
 * Datrix Config Error Class
 *
 * Specialized DatrixError for configuration validation failures.
 * Includes field name for identifying which config property failed.
 */
export class DatrixConfigError extends DatrixError<ConfigErrorContext> {
	readonly field?: string | undefined;

	constructor(message: string, options: DatrixConfigErrorOptions) {
		super(message, {
			code: options.code,
			operation: "config:validate",
			context: options.context,
			cause: options.cause,
			suggestion: options.suggestion,
			expected: options.expected,
			received: options.received,
		});

		this.field = options.field;
	}

	/**
	 * Override toJSON to include config-specific fields
	 */
	override toJSON(): SerializedDatrixConfigError {
		return {
			...super.toJSON(),
			...(this.field && { field: this.field }),
		};
	}

	/**
	 * Override toDetailedMessage to include config-specific info
	 */
	override toDetailedMessage(): string {
		const baseMessage = super.toDetailedMessage();

		if (this.field) {
			const configInfo = [`  Field: ${this.field}`];
			const lines = baseMessage.split("\n");
			lines.splice(1, 0, ...configInfo);
			return lines.join("\n");
		}

		return baseMessage;
	}
}

/**
 * Multiple config validation errors
 */
export class DatrixConfigValidationError extends DatrixConfigError {
	readonly errors: readonly string[];

	constructor(errors: readonly string[], suggestion?: string) {
		const errorList = errors.map((e) => `  - ${e}`).join("\n");

		super(`Config validation failed:\n${errorList}`, {
			code: "CONFIG_VALIDATION_FAILED",
			context: { errors },
			suggestion: suggestion ?? "Fix the validation errors listed above",
		});

		this.errors = errors;
	}

	/**
	 * Override toDetailedMessage to include all errors
	 */
	override toDetailedMessage(): string {
		const baseMessage = super.toDetailedMessage();
		const errorDetails = this.errors.map((err) => `  - ${err}`);

		return `${baseMessage}\n\nValidation Errors:\n${errorDetails.join("\n")}`;
	}
}
