/**
 * Datrix Validation Error
 *
 * Specialized error for data validation failures.
 * Extends DatrixError with structured validation error details.
 */

import {
	DatrixError,
	type DatrixErrorOptions,
	type SerializedDatrixError,
} from "../datrix-error";
import type { ValidationError } from "../../core/validator";

/**
 * Options for creating DatrixValidationError
 */
export interface DatrixValidationErrorOptions extends Partial<DatrixErrorOptions> {
	readonly model: string;
	readonly errors: readonly ValidationError[];
}

/**
 * Serialized validation error for API responses
 */
export interface SerializedDatrixValidationError extends SerializedDatrixError {
	readonly model: string;
	readonly errors: readonly ValidationError[];
}

/**
 * Datrix Validation Error Class
 *
 * Specialized DatrixError for schema validation failures.
 * Includes the model name and a list of specific validation errors.
 */
export class DatrixValidationError extends DatrixError {
	readonly model: string;
	readonly errors: readonly ValidationError[];

	constructor(message: string, options: DatrixValidationErrorOptions) {
		super(message, {
			code: options.code || "VALIDATION_FAILED",
			operation: options.operation || "validation",
			context: {
				model: options.model,
				errors: options.errors,
				...options.context,
			},
			...(options.suggestion && { suggestion: options.suggestion }),
			...(options.expected && { expected: options.expected }),
			...(options.received !== undefined && { received: options.received }),
		});

		this.model = options.model;
		this.errors = options.errors;
	}

	/**
	 * Override toJSON to include validation-specific fields
	 */
	override toJSON(): SerializedDatrixValidationError {
		return {
			...super.toJSON(),
			model: this.model,
			errors: this.errors,
		};
	}

	/**
	 * Override toDetailedMessage to include field-specific errors
	 */
	override toDetailedMessage(): string {
		const baseMessage = super.toDetailedMessage();
		const errorDetails = this.errors.map(
			(err) => `  - ${err.field}: ${err.message} (${err.code})`,
		);

		return `${baseMessage}\n\nValidation Details:\n${errorDetails.join("\n")}`;
	}
}
