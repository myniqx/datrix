/**
 * Validation Error Classes
 *
 * Custom error classes and utilities for validation errors.
 * Provides detailed error information for debugging.
 */

import { ValidationError, ValidationErrorCode } from "../types/core/validator";
import { DatrixValidationError } from "../types/errors/core/validation";

/**
 * Create a validation error
 */
export function createValidationError(
	field: string,
	code: ValidationErrorCode,
	message: string,
	options?: {
		value?: unknown;
		expected?: unknown;
	},
): ValidationError {
	return {
		field,
		code,
		message,
		value: options?.value,
		expected: options?.expected,
	};
}

/**
 * Format error message with context
 */
export function formatErrorMessage(
	code: ValidationErrorCode,
	field: string,
	options?: {
		min?: number;
		max?: number;
		expected?: unknown;
		actual?: unknown;
		pattern?: RegExp;
	},
): string {
	switch (code) {
		case "REQUIRED":
			return `Field '${field}' is required`;

		case "TYPE_MISMATCH":
			return `Field '${field}' has incorrect type. Expected ${options?.expected}, got ${options?.actual}`;

		case "MIN_LENGTH":
			return `Field '${field}' must be at least ${options?.min} characters long`;

		case "MAX_LENGTH":
			return `Field '${field}' must be at most ${options?.max} characters long`;

		case "MIN_VALUE":
			return `Field '${field}' must be at least ${options?.min}`;

		case "MAX_VALUE":
			return `Field '${field}' must be at most ${options?.max}`;

		case "MIN_ITEMS":
			return `Field '${field}' must have at least ${options?.min} items`;

		case "MAX_ITEMS":
			return `Field '${field}' must have at most ${options?.max} items`;

		case "PATTERN":
			return `Field '${field}' does not match required pattern${options?.pattern ? `: ${options.pattern}` : ""
				}`;

		case "UNIQUE":
			return `Field '${field}' must be unique`;

		case "INVALID_ENUM":
			return `Field '${field}' must be one of: ${options?.expected}`;

		case "INVALID_FORMAT":
			return `Field '${field}' has invalid format`;

		case "INVALID_DATE":
			return `Field '${field}' is not a valid date`;

		case "CUSTOM":
			return `Field '${field}' validation failed`;

		default:
			return `Field '${field}' validation failed`;
	}
}

/**
 * Combine multiple validation errors
 */
export function combineErrors(
	...errorArrays: readonly (readonly ValidationError[])[]
): readonly ValidationError[] {
	const combined: ValidationError[] = [];

	for (const errors of errorArrays) {
		combined.push(...errors);
	}

	return combined;
}

/**
 * Group errors by field
 */
export function groupErrorsByField(
	errors: readonly ValidationError[],
): Record<string, readonly ValidationError[]> {
	const grouped: Record<string, ValidationError[]> = {};

	for (const error of errors) {
		if (!grouped[error.field]) {
			grouped[error.field] = [];
		}
		grouped[error.field]!.push(error);
	}

	return grouped;
}

/**
 * Get first error for each field
 */
export function getFirstErrorPerField(
	errors: readonly ValidationError[],
): Record<string, ValidationError> {
	const firstErrors: Record<string, ValidationError> = {};

	for (const error of errors) {
		if (!firstErrors[error.field]) {
			firstErrors[error.field] = error;
		}
	}

	return firstErrors;
}

/**
 * Filter errors by code
 */
export function filterErrorsByCode(
	errors: readonly ValidationError[],
	code: ValidationErrorCode,
): readonly ValidationError[] {
	return errors.filter((error) => error.code === code);
}

/**
 * Filter errors by field
 */
export function filterErrorsByField(
	errors: readonly ValidationError[],
	field: string,
): readonly ValidationError[] {
	return errors.filter((error) => error.field === field);
}

/**
 * Check if errors contain specific code
 */
export function hasErrorCode(
	errors: readonly ValidationError[],
	code: ValidationErrorCode,
): boolean {
	return errors.some((error) => error.code === code);
}

/**
 * Check if errors contain specific field
 */
export function hasErrorForField(
	errors: readonly ValidationError[],
	field: string,
): boolean {
	return errors.some((error) => error.field === field);
}

/**
 * Format errors as human-readable string
 */
export function formatErrors(errors: readonly ValidationError[]): string {
	if (errors.length === 0) {
		return "No validation errors";
	}

	const messages = errors.map(
		(error) => `  - ${error.field}: ${error.message} (${error.code})`,
	);

	return `Validation failed with ${errors.length} error(s):\n${messages.join(
		"\n",
	)}`;
}

/**
 * Format errors as JSON
 */
export function formatErrorsAsJSON(errors: readonly ValidationError[]): string {
	return JSON.stringify(errors, null, 2);
}

/**
 * Convert errors to plain object (for API responses)
 */
export function errorsToPlainObject(
	errors: readonly ValidationError[],
): Record<string, string[]> {
	const plain: Record<string, string[]> = {};

	for (const error of errors) {
		if (!plain[error.field]) {
			plain[error.field] = [];
		}
		plain[error.field]!.push(error.message);
	}

	return plain;
}

/**
 * Validation error collection class (immutable)
 */
export class ValidationErrorCollection {
	private readonly errors: readonly ValidationError[];

	constructor(errors: readonly ValidationError[] = []) {
		this.errors = Object.freeze([...errors]);
	}

	/**
	 * Add an error (returns new instance)
	 */
	add(error: ValidationError): ValidationErrorCollection {
		return new ValidationErrorCollection([...this.errors, error]);
	}

	/**
	 * Add multiple errors (returns new instance)
	 */
	addMany(errors: readonly ValidationError[]): ValidationErrorCollection {
		return new ValidationErrorCollection([...this.errors, ...errors]);
	}

	/**
	 * Get all errors
	 */
	getAll(): readonly ValidationError[] {
		return this.errors;
	}

	/**
	 * Get errors by field
	 */
	getByField(field: string): readonly ValidationError[] {
		return filterErrorsByField(this.errors, field);
	}

	/**
	 * Get errors by code
	 */
	getByCode(code: ValidationErrorCode): readonly ValidationError[] {
		return filterErrorsByCode(this.errors, code);
	}

	/**
	 * Check if has errors
	 */
	hasErrors(): boolean {
		return this.errors.length > 0;
	}

	/**
	 * Get error count
	 */
	count(): number {
		return this.errors.length;
	}

	/**
	 * Format as string
	 */
	toString(): string {
		return formatErrors(this.errors);
	}

	/**
	 * Format as JSON
	 */
	toJSON(): readonly ValidationError[] {
		return this.errors;
	}

	/**
	 * Group by field
	 */
	groupByField(): Record<string, readonly ValidationError[]> {
		return groupErrorsByField(this.errors);
	}

	/**
	 * Get first error per field
	 */
	getFirstPerField(): Record<string, ValidationError> {
		return getFirstErrorPerField(this.errors);
	}
}

/**
 * Centralized Validation Error Helpers
 *
 * Provides a clean API for throwing DatrixValidationError.
 * Similar pattern to CRUD error helpers for consistency.
 */

/**
 * Throw multiple validation errors
 *
 * @param model - Model name
 * @param errors - Array of validation errors
 * @param suggestion - Optional user guidance
 *
 * @example
 * ```ts
 * throwValidationMultiple('User', [
 *   { field: 'email', code: 'REQUIRED', message: 'Email required' },
 *   { field: 'age', code: 'MIN_VALUE', message: 'Age must be 18+' }
 * ]);
 * ```
 */
export function throwValidationMultiple(
	model: string,
	errors: readonly ValidationError[],
	suggestion?: string,
): never {
	const errorMessages = errors
		.map((e) => `${e.field}: ${e.message}`)
		.join(", ");

	throw new DatrixValidationError(
		`Validation failed for ${model}: ${errorMessages}`,
		{
			model,
			errors,
			operation: "validation:data",
			suggestion,
		},
	);
}

/**
 * Throw a single field validation error
 *
 * @param model - Model name
 * @param field - Field name
 * @param code - Error code
 * @param message - Error message
 * @param options - Additional error details
 *
 * @example
 * ```ts
 * throwValidationSingle('User', 'email', 'REQUIRED', 'Email is required');
 * ```
 */
export function throwValidationSingle(
	model: string,
	field: string,
	code: ValidationErrorCode,
	message: string,
	options?: {
		value?: unknown;
		expected?: unknown;
		suggestion?: string;
	},
): never {
	const error = createValidationError(field, code, message, {
		value: options?.value,
		expected: options?.expected,
	});

	throw new DatrixValidationError(`Validation failed for ${model}: ${message}`, {
		model,
		errors: [error],
		operation: "validation:field",
		suggestion: options?.suggestion,
	});
}

/**
 * Throw required field error
 *
 * @param model - Model name
 * @param field - Field name
 *
 * @example
 * ```ts
 * throwValidationRequired('User', 'email');
 * ```
 */
export function throwValidationRequired(model: string, field: string): never {
	const message = formatErrorMessage("REQUIRED", field);
	throwValidationSingle(model, field, "REQUIRED", message, {
		suggestion: `Provide a value for the '${field}' field`,
	});
}

/**
 * Throw type mismatch error
 *
 * @param model - Model name
 * @param field - Field name
 * @param expected - Expected type
 * @param received - Received value
 *
 * @example
 * ```ts
 * throwValidationTypeMismatch('User', 'age', 'number', 'string');
 * ```
 */
export function throwValidationTypeMismatch(
	model: string,
	field: string,
	expected: string,
	received: unknown,
): never {
	const actualType = typeof received;
	const message = formatErrorMessage("TYPE_MISMATCH", field, {
		expected,
		actual: actualType,
	});

	throwValidationSingle(model, field, "TYPE_MISMATCH", message, {
		value: received,
		expected,
		suggestion: `Ensure '${field}' is of type ${expected}`,
	});
}

/**
 * Throw pattern validation error
 *
 * @param model - Model name
 * @param field - Field name
 * @param pattern - Expected pattern
 * @param received - Received value
 *
 * @example
 * ```ts
 * throwValidationPattern('User', 'email', /^.+@.+$/, 'invalid-email');
 * ```
 */
export function throwValidationPattern(
	model: string,
	field: string,
	pattern: RegExp,
	received: unknown,
): never {
	const message = formatErrorMessage("PATTERN", field, { pattern });

	throwValidationSingle(model, field, "PATTERN", message, {
		value: received,
		expected: pattern.toString(),
		suggestion: `Ensure '${field}' matches the required pattern: ${pattern}`,
	});
}

/**
 * Throw min length validation error
 *
 * @param model - Model name
 * @param field - Field name
 * @param minLength - Minimum length
 * @param received - Received value
 *
 * @example
 * ```ts
 * throwValidationMinLength('User', 'password', 8, 'short');
 * ```
 */
export function throwValidationMinLength(
	model: string,
	field: string,
	minLength: number,
	received: unknown,
): never {
	const message = formatErrorMessage("MIN_LENGTH", field, { min: minLength });

	throwValidationSingle(model, field, "MIN_LENGTH", message, {
		value: received,
		expected: `at least ${minLength} characters`,
		suggestion: `Provide a longer value for '${field}'`,
	});
}

/**
 * Throw max length validation error
 *
 * @param model - Model name
 * @param field - Field name
 * @param maxLength - Maximum length
 * @param received - Received value
 *
 * @example
 * ```ts
 * throwValidationMaxLength('User', 'bio', 500, longText);
 * ```
 */
export function throwValidationMaxLength(
	model: string,
	field: string,
	maxLength: number,
	received: unknown,
): never {
	const message = formatErrorMessage("MAX_LENGTH", field, { max: maxLength });

	throwValidationSingle(model, field, "MAX_LENGTH", message, {
		value: received,
		expected: `at most ${maxLength} characters`,
		suggestion: `Shorten the value for '${field}'`,
	});
}

/**
 * Throw min value validation error
 *
 * @param model - Model name
 * @param field - Field name
 * @param minValue - Minimum value
 * @param received - Received value
 *
 * @example
 * ```ts
 * throwValidationMinValue('User', 'age', 18, 15);
 * ```
 */
export function throwValidationMinValue(
	model: string,
	field: string,
	minValue: number,
	received: unknown,
): never {
	const message = formatErrorMessage("MIN_VALUE", field, { min: minValue });

	throwValidationSingle(model, field, "MIN_VALUE", message, {
		value: received,
		expected: `at least ${minValue}`,
		suggestion: `Provide a value >= ${minValue} for '${field}'`,
	});
}

/**
 * Throw max value validation error
 *
 * @param model - Model name
 * @param field - Field name
 * @param maxValue - Maximum value
 * @param received - Received value
 *
 * @example
 * ```ts
 * throwValidationMaxValue('User', 'age', 120, 150);
 * ```
 */
export function throwValidationMaxValue(
	model: string,
	field: string,
	maxValue: number,
	received: unknown,
): never {
	const message = formatErrorMessage("MAX_VALUE", field, { max: maxValue });

	throwValidationSingle(model, field, "MAX_VALUE", message, {
		value: received,
		expected: `at most ${maxValue}`,
		suggestion: `Provide a value <= ${maxValue} for '${field}'`,
	});
}

/**
 * Throw invalid enum error
 *
 * @param model - Model name
 * @param field - Field name
 * @param validValues - Valid enum values
 * @param received - Received value
 *
 * @example
 * ```ts
 * throwValidationEnum('User', 'role', ['admin', 'user'], 'superuser');
 * ```
 */
export function throwValidationEnum(
	model: string,
	field: string,
	validValues: readonly string[],
	received: unknown,
): never {
	const message = formatErrorMessage("INVALID_ENUM", field, {
		expected: validValues.join(", "),
	});

	throwValidationSingle(model, field, "INVALID_ENUM", message, {
		value: received,
		expected: validValues.join(" | "),
		suggestion: `Use one of: ${validValues.join(", ")}`,
	});
}

/**
 * Throw min items validation error
 *
 * @param model - Model name
 * @param field - Field name
 * @param minItems - Minimum items
 * @param received - Received array
 *
 * @example
 * ```ts
 * throwValidationMinItems('Post', 'tags', 1, []);
 * ```
 */
export function throwValidationMinItems(
	model: string,
	field: string,
	minItems: number,
	received: unknown,
): never {
	const message = formatErrorMessage("MIN_ITEMS", field, { min: minItems });

	throwValidationSingle(model, field, "MIN_ITEMS", message, {
		value: received,
		expected: `at least ${minItems} items`,
		suggestion: `Provide at least ${minItems} items for '${field}'`,
	});
}

/**
 * Throw max items validation error
 *
 * @param model - Model name
 * @param field - Field name
 * @param maxItems - Maximum items
 * @param received - Received array
 *
 * @example
 * ```ts
 * throwValidationMaxItems('Post', 'tags', 10, largeArray);
 * ```
 */
export function throwValidationMaxItems(
	model: string,
	field: string,
	maxItems: number,
	received: unknown,
): never {
	const message = formatErrorMessage("MAX_ITEMS", field, { max: maxItems });

	throwValidationSingle(model, field, "MAX_ITEMS", message, {
		value: received,
		expected: `at most ${maxItems} items`,
		suggestion: `Reduce items in '${field}' to ${maxItems} or less`,
	});
}

/**
 * Throw invalid date error
 *
 * @param model - Model name
 * @param field - Field name
 * @param received - Received value
 *
 * @example
 * ```ts
 * throwValidationDate('Event', 'startDate', 'invalid-date');
 * ```
 */
export function throwValidationDate(
	model: string,
	field: string,
	received: unknown,
): never {
	const message = formatErrorMessage("INVALID_DATE", field);

	throwValidationSingle(model, field, "INVALID_DATE", message, {
		value: received,
		expected: "valid Date object",
		suggestion: `Provide a valid date for '${field}'`,
	});
}

/**
 * Throw custom validation error
 *
 * @param model - Model name
 * @param field - Field name
 * @param message - Custom error message
 * @param received - Received value
 *
 * @example
 * ```ts
 * throwValidationCustom('User', 'username', 'Username already taken', 'john');
 * ```
 */
export function throwValidationCustom(
	model: string,
	field: string,
	message: string,
	received?: unknown,
): never {
	throwValidationSingle(model, field, "CUSTOM", message, {
		value: received,
	});
}

/**
 * Legacy helper for backward compatibility
 * @deprecated Use throwValidationMultiple instead
 */
export const validationError = {
	throw: throwValidationMultiple,
};
