/**
 * Query Utilities
 *
 * Provides runtime validation for QueryObject structure.
 */

import { QueryObject } from "forja-types/core/query-builder";
import { Result } from "forja-types/utils";
import { ForjaError } from "forja-types/errors";


/**
 * Valid keys for a QueryObject
 */
const VALID_QUERY_KEYS = new Set([
  'type',
  'table',
  'select',
  'where',
  'populate',
  'orderBy',
  'limit',
  'offset',
  'data',
  'returning',
  'distinct',
  'groupBy',
  'having',
  'meta',
  '__meta__'
]);

/**
 * Common mistakes to watch out for
 */
const FORBIDDEN_KEYS_MAPPING: Record<string, string> = {
  'fields': 'select',
};

/**
 * Validates that a QueryObject contains only allowed keys.
 * This is a runtime check to catch errors from plugins or dynamic query construction.
 */
export function validateQueryObject(query: unknown): Result<QueryObject, ForjaError> {
  if (typeof query !== 'object' || query === null) {
    return {
      success: false,
      error: new ForjaError('Query must be an object', {
        code: 'INVALID_QUERY_TYPE',
        operation: 'query:validate',
        context: { receivedType: typeof query },
        suggestion: 'Provide a valid QueryObject',
        expected: 'object',
        received: query,
      }),
    };
  }

  const queryKeys = Object.keys(query);
  const invalidKeys: string[] = [];
  const suggestions: string[] = [];

  for (const key of queryKeys) {
    if (!VALID_QUERY_KEYS.has(key)) {
      const suggestion = FORBIDDEN_KEYS_MAPPING[key];
      if (suggestion) {
        invalidKeys.push(key);
        suggestions.push(`Use '${suggestion}' instead of '${key}'`);
      } else {
        invalidKeys.push(key);
      }
    }
  }

  if (invalidKeys.length > 0) {
    const keyList = invalidKeys.map((key) => {
      const alt = FORBIDDEN_KEYS_MAPPING[key];
      return alt ? `'${key}' (use '${alt}' instead)` : `'${key}'`;
    }).join(', ');

    return {
      success: false,
      error: new ForjaError(`Invalid keys found in QueryObject: ${keyList}`, {
        code: 'INVALID_QUERY_KEYS',
        operation: 'query:validate',
        context: {
          invalidKeys,
          validKeys: Array.from(VALID_QUERY_KEYS),
          query,
        },
        suggestion: suggestions.length > 0 ? suggestions.join('; ') : 'Remove invalid keys from QueryObject',
        expected: `Valid keys: ${Array.from(VALID_QUERY_KEYS).join(', ')}`,
      }),
    };
  }

  // Basic structure check for required fields
  const q = query as Partial<QueryObject>;
  if (!q.type) {
    return {
      success: false,
      error: new ForjaError('QueryObject is missing required field: type', {
        code: 'MISSING_QUERY_FIELD',
        operation: 'query:validate',
        context: { query },
        suggestion: "Add 'type' field to QueryObject (e.g., 'select', 'insert', 'update', 'delete')",
        expected: "type: 'select' | 'insert' | 'update' | 'delete'",
      }),
    };
  }
  if (!q.table) {
    return {
      success: false,
      error: new ForjaError('QueryObject is missing required field: table', {
        code: 'MISSING_QUERY_FIELD',
        operation: 'query:validate',
        context: { query },
        suggestion: "Add 'table' field to QueryObject with the target table name",
        expected: 'table: string',
      }),
    };
  }

  return {
    success: true,
    data: query as QueryObject,
  };
}
