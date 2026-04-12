/**
 * Validator Type Definitions
 *
 * This file defines types for Datrix's custom validation engine (~300 LOC total).
 * Zero external dependencies - all validation logic is custom-built.
 */

import { FieldDefinition } from "./schema";

/**
 * Validation error codes
 */
export type ValidationErrorCode =
	| "REQUIRED"
	| "TYPE_MISMATCH"
	| "MIN_LENGTH"
	| "MAX_LENGTH"
	| "MIN_VALUE"
	| "MAX_VALUE"
	| "MIN_ITEMS"
	| "MAX_ITEMS"
	| "PATTERN"
	| "UNIQUE"
	| "INVALID_ENUM"
	| "INVALID_FORMAT"
	| "INVALID_DATE"
	| "CUSTOM"
	| "UNKNOWN";

/**
 * Validation error detail
 */
export interface ValidationError {
	readonly field: string;
	readonly message: string;
	readonly code: ValidationErrorCode;
	readonly value?: unknown;
	readonly expected?: unknown;
}

/**
 * Validation result for a single field
 */
export type FieldValidationResult<T = unknown> =
	| {
			success: true;
			data: T;
	  }
	| {
			success: false;
			error: ValidationError[];
	  };

/**
 * Field validator function type
 */
export type FieldValidator = <T = unknown>(
	value: unknown,
	field: FieldDefinition,
	fieldName: string,
) => FieldValidationResult<T>;

/**
 * Custom validator function (user-defined)
 */
export type CustomValidator<T = unknown> = (value: T) => true | string; // Returns true or error message

/**
 * Validation context (for advanced validations)
 */
export interface ValidationContext {
	readonly fieldName: string;
	readonly fieldDefinition: FieldDefinition;
	readonly parentData?: Record<string, unknown>;
	readonly path: readonly string[]; // Field path for nested objects
}

/**
 * Validator options
 */
export interface ValidatorOptions {
	readonly strict?: boolean; // Fail on unknown fields
	readonly coerce?: boolean; // Try to coerce types (e.g., "123" -> 123)
	readonly stripUnknown?: boolean; // Remove unknown fields
	readonly abortEarly?: boolean; // Stop on first error
}
