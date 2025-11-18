/**
 * Where Parser
 *
 * Parses Strapi-style where syntax into WhereClause.
 * Examples:
 *   ?where[status]=active
 *   ?where[price][$gt]=100
 *   ?where[name][$contains]=john
 */

import type { WhereClause } from '@core/query-builder/types';
import type { RawQueryParams, WhereOperator } from './types';
import { ParserError, isWhereOperator } from './types';
import type { Result } from '@utils/types';

/**
 * Parse where parameter
 *
 * @param params - Raw query parameters
 * @returns Result with WhereClause or ParserError
 */
export function parseWhere(params: RawQueryParams): Result<WhereClause | undefined, ParserError> {
  const whereClause: WhereClause = {};

  // Find all where[...] parameters
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith('where[')) {
      continue;
    }

    // Parse the where parameter
    const parseResult = parseWhereParameter(key, value);
    if (!parseResult.success) {
      return parseResult;
    }

    // Merge into where clause
    mergeIntoWhereClause(whereClause, parseResult.data);
  }

  // If no where parameters found, return undefined
  if (Object.keys(whereClause).length === 0) {
    return { success: true, data: undefined };
  }

  return { success: true, data: whereClause };
}

/**
 * Parse result for a single where parameter
 */
interface WhereParseResult {
  readonly field: string;
  readonly operator?: WhereOperator;
  readonly value: unknown;
}

/**
 * Parse a single where parameter
 * Examples:
 *   where[status] -> { field: 'status', value: 'active' }
 *   where[price][$gt] -> { field: 'price', operator: '$gt', value: 100 }
 */
function parseWhereParameter(
  key: string,
  value: string | readonly string[] | undefined
): Result<WhereParseResult, ParserError> {
  // Extract field and operator from key
  // Examples:
  //   "where[status]" -> field: "status", operator: undefined
  //   "where[price][$gt]" -> field: "price", operator: "$gt"
  //   "where[$or][0][status]" -> complex, handle separately

  const match = key.match(/^where\[([^\]]+)\](?:\[([^\]]+)\])?$/);
  if (!match) {
    return {
      success: false,
      error: new ParserError(`Invalid where parameter format: ${key}`, {
        code: 'INVALID_SYNTAX',
        field: key
      })
    };
  }

  const field = match[1];
  const operatorOrValue = match[2];

  if (!field) {
    return {
      success: false,
      error: new ParserError('Missing field name in where parameter', {
        code: 'INVALID_SYNTAX',
        field: key
      })
    };
  }

  // Check if this is an operator
  if (operatorOrValue && isWhereOperator(operatorOrValue)) {
    // This is an operator: where[field][$op]
    const parsedValue = parseValue(value);
    return {
      success: true,
      data: {
        field,
        operator: operatorOrValue,
        value: parsedValue
      }
    };
  }

  // This is a simple equality: where[field]
  const parsedValue = parseValue(value);
  return {
    success: true,
    data: {
      field,
      value: parsedValue
    }
  };
}

/**
 * Merge parsed where data into where clause
 */
function mergeIntoWhereClause(
  whereClause: WhereClause,
  data: WhereParseResult
): void {
  const { field, operator, value } = data;

  if (operator === undefined) {
    // Simple equality - value should be a primitive
    if (isPrimitive(value)) {
      (whereClause as Record<string, unknown>)[field] = value;
    }
  } else {
    // Operator-based condition
    const existing = whereClause[field];

    if (existing !== undefined && typeof existing === 'object' && !Array.isArray(existing)) {
      // Merge with existing operators
      (whereClause as Record<string, unknown>)[field] = {
        ...existing,
        [operator]: value
      };
    } else {
      // Create new operator object
      (whereClause as Record<string, unknown>)[field] = {
        [operator]: value
      };
    }
  }
}

/**
 * Type guard for primitive values
 */
function isPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  );
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
