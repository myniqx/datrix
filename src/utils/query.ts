/**
 * Query Utilities
 *
 * Provides runtime validation for QueryObject structure.
 */

import type { QueryObject } from '@adapters/base/types';
import type { Result } from './types';

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
  'meta'
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
export function validateQueryObject(query: unknown): Result<QueryObject, Error> {
  if (typeof query !== 'object' || query === null) {
    return {
      success: false,
      error: new Error('Query must be an object')
    };
  }

  const queryKeys = Object.keys(query);
  const invalidKeys: string[] = [];

  for (const key of queryKeys) {
    if (!VALID_QUERY_KEYS.has(key)) {
      const suggestion = FORBIDDEN_KEYS_MAPPING[key];
      if (suggestion) {
        invalidKeys.push(`'${key}' (did you mean '${suggestion}'?)`);
      } else {
        invalidKeys.push(`'${key}'`);
      }
    }
  }

  if (invalidKeys.length > 0) {
    return {
      success: false,
      error: new Error(`Invalid keys found in QueryObject: ${invalidKeys.join(', ')}`)
    };
  }

  // Basic structure check for required fields
  const q = query as Partial<QueryObject>;
  if (!q.type) {
    return { success: false, error: new Error('QueryObject is missing required field: type') };
  }
  if (!q.table) {
    return { success: false, error: new Error('QueryObject is missing required field: table') };
  }

  return {
    success: true,
    data: query as QueryObject
  };
}
