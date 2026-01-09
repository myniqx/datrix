/**
 * Schema Validator Implementation (~150 LOC)
 *
 * Validates entire objects against schema definitions.
 * Orchestrates field-level validation for all fields.
 */

import type { SchemaDefinition, FieldDefinition } from 'forja-types/core/schema';
import type { SchemaValidationResult, ValidatorOptions } from 'forja-types/core/validator';
import { validateField } from './field-validator';
import {
  createValidationError,
  ValidationErrorCollection
} from './errors';

/**
 * Create a non-required version of a field definition for partial validation
 */
function makeFieldOptional(field: FieldDefinition): FieldDefinition {
  // Create a properly typed partial field that maintains all properties
  // except required which is explicitly set to false
  return {
    ...field,
    required: false
  } as FieldDefinition;
}

/**
 * Default validator options
 */
const DEFAULT_OPTIONS: Required<ValidatorOptions> = {
  strict: true,
  coerce: false,
  stripUnknown: false,
  abortEarly: false
};

/**
 * Validate data against schema
 */
export function validateSchema<T = Record<string, unknown>>(
  data: unknown,
  schema: SchemaDefinition,
  options?: ValidatorOptions
): SchemaValidationResult<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let errors = new ValidationErrorCollection();

  // Check if data is an object
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      success: false,
      error: [
        createValidationError(
          schema.name,
          'TYPE_MISMATCH',
          `Expected object, got ${typeof data}`
        )
      ]
    };
  }

  const inputData = data as Record<string, unknown>;
  const validatedData: Record<string, unknown> = {};

  // Validate each field in schema
  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    const value = inputData[fieldName];

    // Validate field
    const result = validateField(value, fieldDef, fieldName);

    if (!result.success) {
      errors = errors.addMany(result.error);

      // Abort early if option is set
      if (opts.abortEarly) {
        return { success: false, error: [...errors.getAll()] };
      }
    } else {
      validatedData[fieldName] = result.data;
    }
  }

  // Check for unknown fields (strict mode)
  if (opts.strict) {
    for (const key of Object.keys(inputData)) {
      if (!(key in schema.fields)) {
        errors = errors.add(
          createValidationError(
            key,
            'UNKNOWN',
            `Unknown field '${key}' in schema '${schema.name}'`
          )
        );

        // Abort early if option is set
        if (opts.abortEarly) {
          return { success: false, error: [...errors.getAll()] };
        }
      }
    }
  } else if (opts.stripUnknown) {
    // Just ignore unknown fields
  } else {
    // Include unknown fields in validated data
    for (const [key, value] of Object.entries(inputData)) {
      if (!(key in schema.fields)) {
        validatedData[key] = value;
      }
    }
  }

  // Return result
  if (errors.hasErrors()) {
    return { success: false, error: [...errors.getAll()] };
  }

  return { success: true, data: validatedData as T };
}

/**
 * Validate partial data (for updates)
 */
export function validatePartial<T = Record<string, unknown>>(
  data: unknown,
  schema: SchemaDefinition,
  options?: ValidatorOptions
): SchemaValidationResult<Partial<T>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let errors = new ValidationErrorCollection();

  // Check if data is an object
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      success: false,
      error: [
        createValidationError(
          schema.name,
          'TYPE_MISMATCH',
          `Expected object, got ${typeof data}`
        )
      ]
    };
  }

  const inputData = data as Record<string, unknown>;
  const validatedData: Record<string, unknown> = {};

  // Only validate fields that are present in input
  for (const [fieldName, value] of Object.entries(inputData)) {
    const fieldDef = schema.fields[fieldName];

    // Check if field exists in schema
    if (!fieldDef) {
      if (opts.strict) {
        errors = errors.add(
          createValidationError(
            fieldName,
            'UNKNOWN',
            `Unknown field '${fieldName}' in schema '${schema.name}'`
          )
        );

        if (opts.abortEarly) {
          return { success: false, error: [...errors.getAll()] };
        }
      } else if (!opts.stripUnknown) {
        validatedData[fieldName] = value;
      }
      continue;
    }

    // Create non-required version of field for partial validation
    const partialFieldDef = makeFieldOptional(fieldDef);

    // Validate field
    const result = validateField(value, partialFieldDef, fieldName);

    if (!result.success) {
      errors = errors.addMany(result.error);

      if (opts.abortEarly) {
        return { success: false, error: [...errors.getAll()] };
      }
    } else {
      validatedData[fieldName] = result.data;
    }
  }

  // Return result
  if (errors.hasErrors()) {
    return { success: false, error: [...errors.getAll()] };
  }

  return { success: true, data: validatedData as Partial<T> };
}

/**
 * Validate array of data
 */
export function validateMany<T = Record<string, unknown>>(
  dataArray: unknown,
  schema: SchemaDefinition,
  options?: ValidatorOptions
): SchemaValidationResult<readonly T[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let errors = new ValidationErrorCollection();

  // Check if data is an array
  if (!Array.isArray(dataArray)) {
    return {
      success: false,
      error: [
        createValidationError(
          schema.name,
          'TYPE_MISMATCH',
          `Expected array, got ${typeof dataArray}`
        )
      ]
    };
  }

  const validatedArray: T[] = [];

  // Validate each item
  for (let i = 0; i < dataArray.length; i++) {
    const item = dataArray[i];
    const result = validateSchema<T>(item, schema, opts);

    if (!result.success) {
      // Add context to errors
      const itemErrors = result.error.map((err) =>
        createValidationError(
          `[${i}].${err.field}`,
          err.code,
          err.message,
          { value: err.value, expected: err.expected }
        )
      );
      errors = errors.addMany(itemErrors);

      if (opts.abortEarly) {
        return { success: false, error: [...errors.getAll()] };
      }
    } else {
      validatedArray.push(result.data);
    }
  }

  // Return result
  if (errors.hasErrors()) {
    return { success: false, error: [...errors.getAll()] };
  }

  return { success: true, data: validatedArray };
}

/**
 * Check if data matches schema (returns boolean)
 */
export function isValid(
  data: unknown,
  schema: SchemaDefinition,
  options?: ValidatorOptions
): boolean {
  const result = validateSchema(data, schema, options);
  return result.success;
}

/**
 * Validate and throw on error
 */
export function validateOrThrow<T = Record<string, unknown>>(
  data: unknown,
  schema: SchemaDefinition,
  options?: ValidatorOptions
): T {
  const result = validateSchema<T>(data, schema, options);

  if (!result.success) {
    const errorMessages = result.error.map((e) => e.message).join(', ');
    throw new Error(`Validation failed: ${errorMessages}`);
  }

  return result.data;
}

/**
 * Type guard for schema validation
 */
export function assertSchema<T>(
  data: unknown,
  schema: SchemaDefinition,
  options?: ValidatorOptions
): asserts data is T {
  const result = validateSchema(data, schema, options);

  if (!result.success) {
    const errorMessages = result.error.map((e) => e.message).join(', ');
    throw new Error(`Validation assertion failed: ${errorMessages}`);
  }
}
