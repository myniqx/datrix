/**
 * Where Parser
 *
 * Parses Strapi-style where syntax into WhereClause.
 * Examples:
 *   ?where[status]=active
 *   ?where[price][$gt]=100
 *   ?where[name][$contains]=john
 */

import type { WhereClause } from 'forja-types/core/query-builder';
import type { RawQueryParams } from 'forja-types/api/parser';
import { ParserError } from 'forja-types/api/parser';
import type { Result } from 'forja-types/utils';

/**
 * Parse where parameter
 *
 * @param params - Raw query parameters
 * @returns Result with WhereClause or ParserError
 */
export function parseWhere(params: RawQueryParams): Result<WhereClause | undefined, ParserError> {
  const whereClause: Record<string, unknown> = {};

  // Find all where[...] parameters
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith('where[')) {
      continue;
    }

    // Extract path: where[a][b][c] -> ["a", "b", "c"]
    const parts = key.slice(5).split(']').filter(p => p.startsWith('[')).map(p => p.slice(1));
    if (parts.length === 0) continue;

    // Build the nested structure
    let current = whereClause;
    const pathParts = [...parts];
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i]!;
      const isLast = i === pathParts.length - 1;

      if (isLast) {
        current[part] = parseValue(value);
      } else {
        if (current[part] === undefined) {
          current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
      }
    }
  }

  // Transform into Final WhereClause
  const finalClause = transformToFinalWhere(whereClause) as WhereClause;

  // If no where parameters found, return undefined
  if (Object.keys(finalClause).length === 0) {
    return { success: true, data: undefined };
  }

  return { success: true, data: finalClause };
}

/**
 * Post-process the object to handle logical operators which should be arrays
 */
function transformToFinalWhere(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  const typedObj = obj as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(typedObj)) {
    if (['$or', '$and'].includes(key)) {
      // Transform object with numeric keys into array
      if (typeof value === 'object' && value !== null) {
        const valueObj = value as Record<string, unknown>;
        const keys = Object.keys(valueObj).sort((a, b) => Number(a) - Number(b));
        result[key] = keys.map(k => transformToFinalWhere(valueObj[k]));
      } else {
        result[key] = transformToFinalWhere(value);
      }
    } else {
      result[key] = transformToFinalWhere(value);
    }
  }

  return result;
}

/**
 * Parse value from string/array
 * Handles: strings, numbers, booleans, null, arrays (for $in, $nin)
 */
function parseValue(value: string | readonly string[] | undefined): unknown {
  if (value === undefined) {
    return undefined;
  }

  // Handle array (for $in, $nin operators)
  if (Array.isArray(value)) {
    return value.map((v) => {
      if (typeof v === 'string') {
        return parseSingleValue(v);
      }
      return v;
    });
  }

  if (typeof value === 'string') {
    return parseSingleValue(value);
  }

  return value;
}

/**
 * Parse a single value from string
 */
function parseSingleValue(value: string): unknown {
  // Handle special values
  if (value === 'null') {
    return null;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  // Try to parse as number
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') {
    return num;
  }

  // Return as string
  return value;
}
