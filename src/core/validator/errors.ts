/**
 * Validation Error Classes
 *
 * Custom error classes and utilities for validation errors.
 * Provides detailed error information for debugging.
 */

import type { ValidationError, ValidationErrorCode } from './types';

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
  }
): ValidationError {
  return {
    field,
    code,
    message,
    value: options?.value,
    expected: options?.expected
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
  }
): string {
  switch (code) {
    case 'REQUIRED':
      return `Field '${field}' is required`;

    case 'TYPE_MISMATCH':
      return `Field '${field}' has incorrect type. Expected ${options?.expected}, got ${options?.actual}`;

    case 'MIN_LENGTH':
      return `Field '${field}' must be at least ${options?.min} characters long`;

    case 'MAX_LENGTH':
      return `Field '${field}' must be at most ${options?.max} characters long`;

    case 'MIN_VALUE':
      return `Field '${field}' must be at least ${options?.min}`;

    case 'MAX_VALUE':
      return `Field '${field}' must be at most ${options?.max}`;

    case 'MIN_ITEMS':
      return `Field '${field}' must have at least ${options?.min} items`;

    case 'MAX_ITEMS':
      return `Field '${field}' must have at most ${options?.max} items`;

    case 'PATTERN':
      return `Field '${field}' does not match required pattern${
        options?.pattern ? `: ${options.pattern}` : ''
      }`;

    case 'UNIQUE':
      return `Field '${field}' must be unique`;

    case 'INVALID_ENUM':
      return `Field '${field}' must be one of: ${options?.expected}`;

    case 'INVALID_FORMAT':
      return `Field '${field}' has invalid format`;

    case 'INVALID_DATE':
      return `Field '${field}' is not a valid date`;

    case 'CUSTOM':
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
  errors: readonly ValidationError[]
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
  errors: readonly ValidationError[]
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
  code: ValidationErrorCode
): readonly ValidationError[] {
  return errors.filter((error) => error.code === code);
}

/**
 * Filter errors by field
 */
export function filterErrorsByField(
  errors: readonly ValidationError[],
  field: string
): readonly ValidationError[] {
  return errors.filter((error) => error.field === field);
}

/**
 * Check if errors contain specific code
 */
export function hasErrorCode(
  errors: readonly ValidationError[],
  code: ValidationErrorCode
): boolean {
  return errors.some((error) => error.code === code);
}

/**
 * Check if errors contain specific field
 */
export function hasErrorForField(
  errors: readonly ValidationError[],
  field: string
): boolean {
  return errors.some((error) => error.field === field);
}

/**
 * Format errors as human-readable string
 */
export function formatErrors(errors: readonly ValidationError[]): string {
  if (errors.length === 0) {
    return 'No validation errors';
  }

  const messages = errors.map(
    (error) => `  - ${error.field}: ${error.message} (${error.code})`
  );

  return `Validation failed with ${errors.length} error(s):\n${messages.join(
    '\n'
  )}`;
}

/**
 * Format errors as JSON
 */
export function formatErrorsAsJSON(
  errors: readonly ValidationError[]
): string {
  return JSON.stringify(errors, null, 2);
}

/**
 * Convert errors to plain object (for API responses)
 */
export function errorsToPlainObject(
  errors: readonly ValidationError[]
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
