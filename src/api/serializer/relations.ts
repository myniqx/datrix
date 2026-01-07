/**
 * Relations Serializer
 *
 * Handles serialization of relation data (populated relations).
 * Supports nested relations and circular reference detection.
 */

import type { FieldDefinition } from '@core/schema/types';
import type { PopulateOptions, SelectClause } from '@core/query-builder/types';
import type {
  RelationSerializerOptions,
  RelationSerializerResult
} from './types';
import { SerializerError } from './types';

/**
 * Default max depth for nested relations
 */
const DEFAULT_MAX_DEPTH = 5;

/**
 * Serialize relations in a record
 *
 * @param data - Raw record with relation data
 * @param options - Relation serializer options
 * @returns Serialized relations or error
 */
export function serializeRelations(
  data: Record<string, unknown>,
  options: RelationSerializerOptions
): RelationSerializerResult {
  try {
    const result: Record<string, unknown> = {};
    const visited = new Set<string>();

    // Add root record to visited to detect circularity back to root
    const rootId = (typeof data['id'] === 'string' || typeof data['id'] === 'number') ? String(data['id']) : undefined;
    if (rootId) {
      visited.add(rootId);
    }

    // Process each populate clause
    for (const [relationName, populateOptions] of Object.entries(options.populate)) {
      const fieldDef = options.schema.fields[relationName];

      // Skip if not a relation field
      if (!fieldDef || fieldDef.type !== 'relation') {
        continue;
      }

      // Get relation data
      const relationData = data[relationName];

      if (relationData === undefined || relationData === null) {
        result[relationName] = null;
        continue;
      }

      // Serialize relation
      const serialized = serializeRelation(
        relationData,
        fieldDef,
        populateOptions,
        visited,
        1,
        options.maxDepth ?? DEFAULT_MAX_DEPTH
      );

      if (!serialized.success) {
        return serialized;
      }

      result[relationName] = serialized.data;
    }

    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: new SerializerError(error instanceof Error ? error.message : 'Relation serialization failed', {
        code: 'INVALID_RELATION'
      })
    };
  }
}

/**
 * Serialize a single relation
 */
function serializeRelation(data: unknown, fieldDef: FieldDefinition, populateOptions: PopulateOptions | '*', visited: Set<string>, depth: number, maxDepth: number): { success: true; data: unknown } | { success: false; error: SerializerError } {
  // Check depth
  if (depth > maxDepth) {
    return {
      success: false,
      error: new SerializerError(`Maximum relation depth (${maxDepth}) exceeded`, {
        code: 'INVALID_RELATION'
      })
    };
  }

  // Handle wildcard populate
  if (populateOptions === '*') {
    return serializeRelationWildcard(data, fieldDef, visited, depth, maxDepth);
  }

  // Handle hasMany / manyToMany (array of records)
  if (fieldDef.type === 'relation' && (fieldDef.kind === 'hasMany' || fieldDef.kind === 'manyToMany')) {
    return serializeRelationArray(data, fieldDef, populateOptions, visited, depth, maxDepth);
  }

  // Handle hasOne / belongsTo (single record)
  return serializeRelationSingle(data, fieldDef, populateOptions, visited, depth, maxDepth);
}

/**
 * Serialize relation with wildcard populate
 */
function serializeRelationWildcard(data: unknown, _fieldDef: FieldDefinition, visited: Set<string>, _depth: number, _maxDepth: number): { success: true; data: unknown } | { success: false; error: SerializerError } {
  // For wildcard, include all fields
  if (Array.isArray(data)) {
    return {
      success: true,
      data: data.map((item) => sanitizeRecord(item, visited))
    };
  }

  if (isRecord(data)) {
    return {
      success: true,
      data: sanitizeRecord(data, visited)
    };
  }

  return { success: true, data };
}

/**
 * Serialize array of relation records
 */
function serializeRelationArray(data: unknown, _fieldDef: FieldDefinition, populateOptions: PopulateOptions, visited: Set<string>, depth: number, maxDepth: number): { success: true; data: unknown } | { success: false; error: SerializerError } {
  if (!Array.isArray(data)) {
    // If not array, return as-is (might be IDs)
    return { success: true, data };
  }

  const serialized = [];

  for (const item of data) {
    const result = serializeRelationRecord(
      item,
      populateOptions,
      visited,
      depth,
      maxDepth
    );

    if (!result.success) {
      return result;
    }

    serialized.push(result.data);
  }

  return { success: true, data: serialized };
}

/**
 * Serialize single relation record
 */
function serializeRelationSingle(data: unknown, _fieldDef: FieldDefinition, populateOptions: PopulateOptions, visited: Set<string>, depth: number, maxDepth: number): { success: true; data: unknown } | { success: false; error: SerializerError } {
  if (!isRecord(data)) {
    // If not a record, return as-is (might be ID)
    return { success: true, data };
  }

  return serializeRelationRecord(data, populateOptions, visited, depth, maxDepth);
}

/**
 * Serialize a relation record with field selection and nested populates
 */
function serializeRelationRecord(data: unknown, populateOptions: PopulateOptions, visited: Set<string>, depth: number, maxDepth: number): { success: true; data: unknown } | { success: false; error: SerializerError } {
  if (!isRecord(data)) {
    return { success: true, data };
  }

  // Check for circular reference
  const recordId = (typeof data['id'] === 'string' || typeof data['id'] === 'number') ? String(data['id']) : undefined;
  if (recordId) {
    const visitKey = recordId;
    if (visited.has(visitKey)) {
      // Return just the ID to break circular reference
      return { success: true, data: { id: recordId } };
    }
    visited.add(visitKey);
  }

  const result: Record<string, unknown> = {};

  // Determine fields to include
  const fieldsToInclude = getFieldsToInclude(populateOptions.select);

  // Include selected fields
  for (const [key, value] of Object.entries(data)) {
    if (fieldsToInclude === '*' || fieldsToInclude.includes(key)) {
      result[key] = value;
    }
  }

  // Handle nested populates
  if (populateOptions.populate) {
    for (const [nestedRelation, nestedOptions] of Object.entries(populateOptions.populate)) {
      const nestedData = data[nestedRelation];

      if (nestedData === undefined || nestedData === null) {
        result[nestedRelation] = null;
        continue;
      }

      // Recursively serialize nested relation
      const nestedResult = serializeRelation(
        nestedData,
        { type: 'relation', model: '', kind: 'hasOne' }, // Placeholder
        nestedOptions,
        visited,
        depth + 1,
        maxDepth
      );

      if (!nestedResult.success) {
        return nestedResult;
      }

      result[nestedRelation] = nestedResult.data;
    }
  }

  return { success: true, data: result };
}

/**
 * Get fields to include from select clause
 */
function getFieldsToInclude(select: SelectClause | undefined): readonly string[] | '*' {
  if (!select || select === '*') {
    return '*';
  }

  return select;
}

/**
 * Sanitize a record (remove sensitive fields, format dates, etc.)
 */
function sanitizeRecord(data: unknown, visited: Set<string>): unknown {
  if (!isRecord(data)) {
    return data;
  }

  // Check for circular reference
  const recordId = (typeof data['id'] === 'string' || typeof data['id'] === 'number') ? String(data['id']) : undefined;
  if (recordId) {
    if (visited.has(recordId)) {
      return { id: data['id'] };
    }
    visited.add(recordId);
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    // Skip internal fields
    if (key.startsWith('_')) {
      continue;
    }

    // Format dates
    if (value instanceof Date) {
      result[key] = value.toISOString();
      continue;
    }

    // Recursively sanitize nested objects
    if (isRecord(value)) {
      result[key] = sanitizeRecord(value, visited);
      continue;
    }

    // Sanitize arrays
    if (Array.isArray(value)) {
      result[key] = value.map((item) => sanitizeRecord(item, visited));
      continue;
    }

    result[key] = value;
  }

  return result;
}

/**
 * Type guard for Record
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

