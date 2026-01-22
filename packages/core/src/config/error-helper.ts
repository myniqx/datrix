/**
 * Config Error Helpers
 *
 * Centralized error creation for config validation.
 * Provides consistent error formatting across all config validators.
 */

import {
  ForjaConfigError,
  ForjaConfigValidationError,
  type ConfigErrorCode,
} from "forja-types/errors";

/**
 * Throw config not found error
 *
 * @param configPath - Path to config file
 *
 * @example
 * ```ts
 * throwConfigNotFound('./forja.config.ts');
 * ```
 */
export function throwConfigNotFound(configPath: string): never {
  throw new ForjaConfigError(`Config file not found: ${configPath}`, {
    code: "CONFIG_NOT_FOUND",
    context: { configPath },
    suggestion: `Create a config file at ${configPath} or specify a different path`,
  });
}

/**
 * Throw config invalid type error
 *
 * @param field - Config field name
 * @param expected - Expected type
 * @param received - Received value
 *
 * @example
 * ```ts
 * throwConfigInvalidType('adapter', 'DatabaseAdapter', null);
 * ```
 */
export function throwConfigInvalidType(
  field: string,
  expected: string,
  received: unknown,
): never {
  const receivedType = received === null ? "null" : typeof received;

  throw new ForjaConfigError(
    `Config.${field} has incorrect type. Expected ${expected}, got ${receivedType}`,
    {
      code: "CONFIG_INVALID_TYPE",
      field,
      context: { receivedType, expectedType: expected },
      suggestion: `Ensure Config.${field} is of type ${expected}`,
      expected,
      received,
    },
  );
}

/**
 * Throw config required field error
 *
 * @param field - Config field name
 *
 * @example
 * ```ts
 * throwConfigRequired('adapter');
 * ```
 */
export function throwConfigRequired(field: string): never {
  throw new ForjaConfigError(`Config must have "${field}" property`, {
    code: "CONFIG_REQUIRED_FIELD",
    field,
    suggestion: `Add the "${field}" property to your config`,
    expected: `Config.${field}`,
  });
}

/**
 * Throw config invalid value error
 *
 * @param field - Config field name
 * @param message - Error message
 * @param received - Received value
 * @param validOptions - Valid options (optional)
 *
 * @example
 * ```ts
 * throwConfigInvalidValue('plugins[0]', 'must be a ForjaPlugin instance', obj);
 * ```
 */
export function throwConfigInvalidValue(
  field: string,
  message: string,
  received: unknown,
  validOptions?: readonly string[],
): never {
  throw new ForjaConfigError(`Config.${field} ${message}`, {
    code: "CONFIG_INVALID_VALUE",
    field,
    context: validOptions ? { validOptions } : undefined,
    suggestion: validOptions
      ? `Use one of: ${validOptions.join(", ")}`
      : `Fix the value for Config.${field}`,
    received,
  });
}

/**
 * Throw config empty value error
 *
 * @param field - Config field name
 *
 * @example
 * ```ts
 * throwConfigEmpty('schemas');
 * ```
 */
export function throwConfigEmpty(field: string): never {
  throw new ForjaConfigError(`Config.${field} cannot be empty`, {
    code: "CONFIG_EMPTY_VALUE",
    field,
    suggestion: `Provide at least one item in Config.${field}`,
  });
}

/**
 * Throw config array item error
 *
 * @param field - Config field name (e.g., "schemas")
 * @param index - Array index
 * @param message - Error message
 * @param received - Received value
 *
 * @example
 * ```ts
 * throwConfigArrayItem('schemas', 0, 'must have a "name" property', obj);
 * ```
 */
export function throwConfigArrayItem(
  field: string,
  index: number,
  message: string,
  received?: unknown,
): never {
  const fullField = `${field}[${index}]`;

  throw new ForjaConfigError(`Config.${fullField} ${message}`, {
    code: "CONFIG_INVALID_VALUE",
    field: fullField,
    context: { index },
    suggestion: `Fix the item at index ${index} in Config.${field}`,
    received,
  });
}

/**
 * Throw multiple config validation errors
 *
 * @param errors - Array of error messages
 * @param suggestion - Optional user guidance
 *
 * @example
 * ```ts
 * throwConfigMultiple([
 *   'adapter is required',
 *   'schemas must be an array'
 * ]);
 * ```
 */
export function throwConfigMultiple(
  errors: readonly string[],
  suggestion?: string,
): never {
  throw new ForjaConfigValidationError(errors, suggestion);
}

/**
 * Throw config field type error (specialized for object/array checks)
 *
 * @param field - Config field name
 * @param expectedType - Expected type (object, array, string, etc.)
 * @param received - Received value
 *
 * @example
 * ```ts
 * throwConfigFieldType('migration', 'object', 'string');
 * ```
 */
export function throwConfigFieldType(
  field: string,
  expectedType: "object" | "array" | "string" | "boolean" | "number",
  received: unknown,
): never {
  const receivedType = Array.isArray(received)
    ? "array"
    : received === null
      ? "null"
      : typeof received;

  throw new ForjaConfigError(`Config.${field} must be ${expectedType}`, {
    code: "CONFIG_INVALID_TYPE",
    field,
    context: { receivedType, expectedType },
    suggestion: `Ensure Config.${field} is ${expectedType}`,
    expected: expectedType,
    received,
  });
}

/**
 * Throw config boolean field error
 *
 * @param field - Config field name (e.g., "migration.auto")
 * @param received - Received value
 *
 * @example
 * ```ts
 * throwConfigBooleanField('migration.auto', 'yes');
 * ```
 */
export function throwConfigBooleanField(field: string, received: unknown): never {
  throwConfigFieldType(field, "boolean", received);
}

/**
 * Throw config string field error
 *
 * @param field - Config field name (e.g., "migration.directory")
 * @param received - Received value
 *
 * @example
 * ```ts
 * throwConfigStringField('migration.directory', 123);
 * ```
 */
export function throwConfigStringField(field: string, received: unknown): never {
  throwConfigFieldType(field, "string", received);
}
