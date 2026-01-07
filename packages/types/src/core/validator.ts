/**
 * Validator Type Definitions
 *
 * This file defines types for Forja's custom validation engine (~300 LOC total).
 * Zero external dependencies - all validation logic is custom-built.
 */

import type { Result } from '../utils';
import { FieldDefinition } from './schema';

/**
 * Validation error codes
 */
export type ValidationErrorCode =
  | 'REQUIRED'
  | 'TYPE_MISMATCH'
  | 'MIN_LENGTH'
  | 'MAX_LENGTH'
  | 'MIN_VALUE'
  | 'MAX_VALUE'
  | 'MIN_ITEMS'
  | 'MAX_ITEMS'
  | 'PATTERN'
  | 'UNIQUE'
  | 'INVALID_ENUM'
  | 'INVALID_FORMAT'
  | 'INVALID_DATE'
  | 'CUSTOM'
  | 'UNKNOWN';

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
export type FieldValidationResult<T = unknown> = Result<T, ValidationError[]>;

/**
 * Validation result for an entire schema
 */
export type SchemaValidationResult<T = Record<string, unknown>> = Result<
  T,
  ValidationError[]
>;

/**
 * Field validator function type
 */
export type FieldValidator = <T = unknown>(
  value: unknown,
  field: FieldDefinition,
  fieldName: string
) => FieldValidationResult<T>;

/**
 * Schema validator function type
 */
export type SchemaValidator = <T = Record<string, unknown>>(
  data: unknown,
  schema: {
    readonly fields: Record<string, FieldDefinition>;
  }
) => SchemaValidationResult<T>;

/**
 * Custom validator function (user-defined)
 */
export type CustomValidator<T = unknown> = (
  value: T
) => true | string; // Returns true or error message

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

/**
 * Type guards for field types
 */
export interface TypeGuards {
  isString(value: unknown): value is string;
  isNumber(value: unknown): value is number;
  isBoolean(value: unknown): value is boolean;
  isDate(value: unknown): value is Date;
  isArray(value: unknown): value is readonly unknown[];
  isObject(value: unknown): value is Record<string, unknown>;
  isNull(value: unknown): value is null;
  isUndefined(value: unknown): value is undefined;
  isNullOrUndefined(value: unknown): value is null | undefined;
}

/**
 * Validation helpers
 */
export interface ValidationHelpers {
  /**
   * Create a validation error
   */
  createError(
    field: string,
    code: ValidationErrorCode,
    message: string,
    options?: {
      value?: unknown;
      expected?: unknown;
    }
  ): ValidationError;

  /**
   * Format error message
   */
  formatMessage(
    code: ValidationErrorCode,
    field: string,
    options?: {
      min?: number;
      max?: number;
      expected?: unknown;
      actual?: unknown;
    }
  ): string;

  /**
   * Combine validation errors
   */
  combineErrors(
    errors: readonly ValidationError[]
  ): readonly ValidationError[];
}

/**
 * String validation constraints
 */
export interface StringConstraints {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: RegExp;
  readonly trim?: boolean;
  readonly lowercase?: boolean;
  readonly uppercase?: boolean;
  readonly email?: boolean;
  readonly url?: boolean;
  readonly uuid?: boolean;
}

/**
 * Number validation constraints
 */
export interface NumberConstraints {
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
  readonly positive?: boolean;
  readonly negative?: boolean;
  readonly multipleOf?: number;
}

/**
 * Array validation constraints
 */
export interface ArrayConstraints {
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly unique?: boolean;
}

/**
 * Date validation constraints
 */
export interface DateConstraints {
  readonly min?: Date;
  readonly max?: Date;
  readonly future?: boolean; // Must be in the future
  readonly past?: boolean; // Must be in the past
}

/**
 * Validation statistics
 */
export interface ValidationStats {
  readonly totalFields: number;
  readonly validatedFields: number;
  readonly errorCount: number;
  readonly duration: number; // milliseconds
}

/**
 * Validation result with stats
 */
export interface DetailedValidationResult<T = Record<string, unknown>> {
  readonly success: boolean;
  readonly data?: T;
  readonly errors: readonly ValidationError[];
  readonly stats: ValidationStats;
}
