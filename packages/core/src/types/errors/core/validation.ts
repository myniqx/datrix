/**
 * Forja Validation Error
 *
 * Specialized error for data validation failures.
 * Extends ForjaError with structured validation error details.
 */

import {
	ForjaError,
	type ForjaErrorOptions,
	type SerializedForjaError,
} from "../forja-error";
import type { ValidationError } from "../../core/validator";

/**
 * Options for creating ForjaValidationError
 */
export interface ForjaValidationErrorOptions extends Partial<ForjaErrorOptions> {
	readonly model: string;
	readonly errors: readonly ValidationError[];
}

/**
 * Serialized validation error for API responses
 */
export interface SerializedForjaValidationError extends SerializedForjaError {
	readonly model: string;
	readonly errors: readonly ValidationError[];
}

/**
 * Forja Validation Error Class
 *
 * Specialized ForjaError for schema validation failures.
 * Includes the model name and a list of specific validation errors.
 */
export class ForjaValidationError extends ForjaError {
	readonly model: string;
	readonly errors: readonly ValidationError[];

	constructor(message: string, options: ForjaValidationErrorOptions) {
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
	override toJSON(): SerializedForjaValidationError {
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
