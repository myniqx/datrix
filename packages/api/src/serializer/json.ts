/**
 * JSON Serializer
 *
 * Serializes database results to JSON format.
 * Handles field selection, data transformation, and response formatting.
 */

import type { FieldDefinition } from 'forja-types/core/schema';
import type {
  SerializerOptions,
  SerializedData,
  SerializedCollection,
  SerializationMeta
} from 'forja-types/api/serializer';
import { SerializerError } from 'forja-types/api/serializer';
import { serializeRelations } from './relations';

/**
 * Serialize a single record
 *
 * @param data - Raw database record
 * @param options - Serialization options
 * @returns Serialized record or error
 */
export function serializeRecord<T extends Record<string, unknown> = Record<string, unknown>>(
  data: unknown,
  options: SerializerOptions
): { success: true; data: SerializedData<T> } | { success: false; error: SerializerError } {
  // Validate input
  if (!isRecord(data)) {
    return {
      success: false,
      error: new SerializerError('Data must be an object', { code: 'INVALID_DATA' })
    };
  }

  try {
    const result: Record<string, unknown> = {};

    // Determine which fields to include
    const fieldsToInclude = getFieldsToInclude(options);

    // Serialize each field
    for (const [fieldName, fieldValue] of Object.entries(data)) {
      // Skip if field not in selection
      if (fieldsToInclude !== '*' && !fieldsToInclude.includes(fieldName)) {
        continue;
      }

      // Get field definition
      const fieldDef = options.schema.fields[fieldName];

      // Serialize field value
      result[fieldName] = serializeFieldValue(fieldValue, fieldDef);
    }

    // Handle relations if populate is specified
    if (options.populate) {
      const relationsResult = serializeRelations(data, {
        schema: options.schema,
        populate: options.populate
      });

      if (!relationsResult.success) {
        return relationsResult;
      }

      // Merge relations into result
      Object.assign(result, relationsResult.data);
    }

    // Since T extends Record<string, unknown> and result is Record<string, unknown>,
    // we know result is compatible with T at runtime
    return {
      success: true,
      data: result
    } as { success: true; data: T };
  } catch (error) {
    return {
      success: false,
      error: new SerializerError(error instanceof Error ? error.message : 'Serialization failed', {
        code: 'INVALID_DATA'
      })
    };
  }
}

/**
 * Serialize a collection of records
 *
 * @param data - Array of raw database records
 * @param options - Serialization options
 * @param meta - Optional metadata (pagination, etc.)
 * @returns Serialized collection or error
 */
export function serializeCollection<T extends Record<string, unknown> = Record<string, unknown>>(
  data: readonly unknown[],
  options: SerializerOptions,
  meta?: SerializationMeta
): { success: true; data: SerializedCollection<T> } | { success: false; error: SerializerError } {
  // Validate input
  if (!Array.isArray(data)) {
    return {
      success: false,
      error: new SerializerError('Data must be an array', { code: 'INVALID_DATA' })
    };
  }

  const serialized: T[] = [];

  // Serialize each record
  for (const record of data) {
    const result = serializeRecord<T>(record, options);

    if (!result.success) {
      return result;
    }

    serialized.push(result.data);
  }

  return {
    success: true,
    data: {
      data: serialized,
      ...(meta && { meta })
    }
  };
}

/**
 * Serialize field value based on field definition
 */
function serializeFieldValue(value: unknown, fieldDef: FieldDefinition | undefined): unknown {
  // Null/undefined handling
  if (value === null || value === undefined) {
    return value;
  }

  // If no field definition, return as-is
  if (!fieldDef) {
    return value;
  }

  // Serialize based on field type
  switch (fieldDef.type) {
    case 'date':
      return serializeDate(value);

    case 'json':
      return serializeJson(value);

    case 'array':
      return serializeArray(value, fieldDef);

    case 'relation':
      // Relations are handled separately
      return value;

    case 'file':
      return serializeFile(value);

    default:
      return value;
  }
}

/**
 * Serialize Date value
 */
function serializeDate(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return null;
}

/**
 * Serialize JSON value
 */
function serializeJson(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  // If already parsed, return as-is
  if (typeof value === 'object') {
    return value;
  }

  // If string, try to parse
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

/**
 * Serialize array value
 */
function serializeArray(value: unknown, fieldDef: FieldDefinition): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  if (fieldDef.type !== 'array') {
    return value;
  }

  // Serialize each item
  return value.map((item) => serializeFieldValue(item, fieldDef.items));
}

/**
 * Serialize file value
 */
function serializeFile(value: unknown): unknown {
  // Files are typically stored as URLs/paths
  // Could be enhanced to include metadata (size, mime type, etc.)
  return value;
}

/**
 * Get fields to include based on select clause
 */
function getFieldsToInclude(options: SerializerOptions): readonly string[] | '*' {
  if (!options.select || options.select === '*') {
    return '*';
  }

  return options.select;
}

/**
 * Type guard for Record
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Serialize data (auto-detect single vs collection)
 */
export function serialize<T extends Record<string, unknown> = Record<string, unknown>>(
  data: unknown,
  options: SerializerOptions,
  meta?: SerializationMeta
): { success: true; data: SerializedData<T> | SerializedCollection<T> } | { success: false; error: SerializerError } {
  if (Array.isArray(data)) {
    return serializeCollection<T>(data, options, meta);
  }

  return serializeRecord<T>(data, options);
}
