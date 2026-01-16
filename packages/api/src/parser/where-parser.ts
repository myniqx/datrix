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
import {
  isValidFieldName,
  isValidWhereOperator,
  isLogicalOperator,
  requiresArrayValue,
  requiresConditions,
  getOperatorValueType,
  MAX_WHERE_VALUE_LENGTH,
  MAX_LOGICAL_NESTING_DEPTH,
} from 'forja-types/core/constants';

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

    // Validate parts (field names and operators)
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;

      // Check if it's an operator (starts with $)
      if (part.startsWith('$')) {
        // Validate operator
        if (!isValidWhereOperator(part)) {
          return {
            success: false,
            error: new ParserError(`Invalid WHERE operator: ${part}`, {
              code: 'INVALID_OPERATOR',
              field: 'where',
              details: { operator: part }
            })
          };
        }
      } else if (/^\d+$/.test(part)) {
        // It's a numeric index - validate context
        // Index can only appear after logical operators ($or, $and)
        if (i === 0) {
          return {
            success: false,
            error: new ParserError(`Array index cannot appear at the beginning of WHERE clause`, {
              code: 'INVALID_SYNTAX',
              field: 'where',
              details: { index: part, path: key }
            })
          };
        }

        const previousPart = parts[i - 1]!;
        // Allow array index after logical operators ($or, $and, $not) and array operators ($in, $nin)
        if (!['$or', '$and', '$not', '$in', '$nin'].includes(previousPart)) {
          return {
            success: false,
            error: new ParserError(`Array index [${part}] can only follow array operators ($or, $and, $not, $in, $nin), found after: ${previousPart}`, {
              code: 'INVALID_SYNTAX',
              field: 'where',
              details: { index: part, previousPart, path: key }
            })
          };
        }
      } else {
        // It's a field name - validate it
        if (!isValidFieldName(part)) {
          return {
            success: false,
            error: new ParserError(`Invalid field name in WHERE clause: ${part}`, {
              code: 'INVALID_FIELD',
              field: 'where',
              details: { fieldName: part }
            })
          };
        }
      }
    }

    // Build the nested structure
    let current = whereClause;
    const pathParts = [...parts];
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i]!;
      const isLast = i === pathParts.length - 1;

      if (isLast) {
        // Find operator context for proper value parsing
        // Only use operator context for STRING operators (not array operators like $in, $nin)
        // Array operators' elements should be parsed normally (as numbers, strings, etc.)
        let operatorContext: string | undefined;
        const isArrayIndex = /^\d+$/.test(part);

        if (part.startsWith('$')) {
          // Current part is the operator: where[field][$op]=value
          const expectedType = getOperatorValueType(part);
          // Only set context for string operators (to prevent number coercion)
          if (expectedType === 'string') {
            operatorContext = part;
          }
        }
        // Note: For array indices (e.g., $in[0]), we don't set operatorContext
        // because array elements should be parsed as their natural types

        // Parse the value with operator context
        const parsedValue = parseValue(value, operatorContext);

        // Check if parseValue returned an error
        if (parsedValue && typeof parsedValue === 'object' && 'error' in parsedValue) {
          return {
            success: false,
            error: parsedValue.error as ParserError
          };
        }

        // Validate operator value type only when operator itself is the last part
        // (not for array indices like $in[0], $nin[1])
        if (part.startsWith('$') && !isArrayIndex) {
          const validation = validateOperatorValue(part, parsedValue);
          if (!validation.success) {
            return validation;
          }
        }

        current[part] = parsedValue;
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

  // Validate nesting depth
  const depthValidation = validateNestingDepth(finalClause);
  if (!depthValidation.success) {
    return depthValidation;
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
    // Operators that require array transformation
    const arrayOperators = ['$or', '$and', '$not', '$in', '$nin'];

    if (arrayOperators.includes(key)) {
      // Transform object with numeric keys into array
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const valueObj = value as Record<string, unknown>;
        const keys = Object.keys(valueObj);

        // Validate that all keys are numeric
        const numericKeys = keys.map(k => {
          const num = Number(k);
          if (isNaN(num) || !Number.isInteger(num) || num < 0) {
            throw new Error(`Invalid array index in ${key}: ${k} (must be non-negative integer)`);
          }
          return num;
        });

        // Sort and validate consecutive sequence starting from 0
        const sortedKeys = numericKeys.sort((a, b) => a - b);

        if (sortedKeys.length > 0 && sortedKeys[0] !== 0) {
          throw new Error(`Array indices for ${key} must start from 0, found: ${sortedKeys[0]}`);
        }

        for (let i = 0; i < sortedKeys.length; i++) {
          if (sortedKeys[i] !== i) {
            throw new Error(`Array indices for ${key} must be consecutive (0,1,2...), missing index: ${i}`);
          }
        }

        // For $in/$nin, values are primitives - don't recursively transform
        // For $or/$and, values are conditions - recursively transform
        if (['$in', '$nin'].includes(key)) {
          result[key] = sortedKeys.map(idx => valueObj[String(idx)]);
        } else {
          result[key] = sortedKeys.map(idx => transformToFinalWhere(valueObj[String(idx)]));
        }
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
 *
 * @param value - The raw value to parse
 * @param operator - Optional operator context for type-aware parsing
 */
function parseValue(
  value: string | readonly string[] | undefined,
  operator?: string
): unknown | { error: ParserError } {
  if (value === undefined) {
    return undefined;
  }

  // Handle array (for $in, $nin operators)
  if (Array.isArray(value)) {
    const parsed: unknown[] = [];
    for (const v of value) {
      if (typeof v === 'string') {
        const result = parseSingleValue(v, operator);
        // Check if result is an error
        if (result && typeof result === 'object' && 'error' in result) {
          return result; // Propagate error
        }
        parsed.push(result);
      } else {
        parsed.push(v);
      }
    }
    return parsed;
  }

  if (typeof value === 'string') {
    return parseSingleValue(value, operator);
  }

  return value;
}

/**
 * Parse a single value from string
 * Returns Result to handle validation errors
 *
 * @param value - The raw string value to parse
 * @param operator - Optional operator context for type-aware parsing
 */
function parseSingleValue(value: string, operator?: string): unknown | { error: ParserError } {
  // Check value length first - reject instead of truncate
  if (value.length > MAX_WHERE_VALUE_LENGTH) {
    return {
      error: new ParserError(
        `WHERE value exceeds maximum length of ${MAX_WHERE_VALUE_LENGTH} characters`,
        {
          code: 'INVALID_SYNTAX',
          field: 'where',
          details: { maxLength: MAX_WHERE_VALUE_LENGTH, actualLength: value.length }
        }
      )
    };
  }

  // If operator expects string, return as-is (no type coercion)
  if (operator) {
    const expectedType = getOperatorValueType(operator);
    if (expectedType === 'string') {
      return value;
    }
  }

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

  /*
  // Try to parse as number
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') {
    return num;
  }
  */

  // Return as string
  return value;
}

/**
 * Validate operator value type
 */
function validateOperatorValue(
  operator: string,
  value: unknown
): Result<void, ParserError> {
  const expectedType = getOperatorValueType(operator);

  if (!expectedType) {
    // Unknown operator (shouldn't happen, already validated)
    return { success: true, data: undefined };
  }

  // Check type-specific requirements
  if (expectedType === 'array') {
    if (!Array.isArray(value)) {
      return {
        success: false,
        error: new ParserError(
          `Operator ${operator} requires an array value`,
          {
            code: 'INVALID_SYNTAX',
            field: 'where',
            details: { operator, valueType: typeof value }
          }
        )
      };
    }

    // Check if array is empty
    if (value.length === 0) {
      return {
        success: false,
        error: new ParserError(
          `Operator ${operator} requires a non-empty array`,
          {
            code: 'INVALID_SYNTAX',
            field: 'where',
            details: { operator }
          }
        )
      };
    }
  }

  // 'any' and other types are acceptable for now
  // Schema validation in QueryBuilder will check actual field types
  return { success: true, data: undefined };
}

/**
 * Validate nesting depth for logical operators
 */
function validateNestingDepth(
  clause: WhereClause,
  depth: number = 0
): Result<void, ParserError> {
  if (depth > MAX_LOGICAL_NESTING_DEPTH) {
    return {
      success: false,
      error: new ParserError(
        `WHERE clause nesting depth exceeds maximum of ${MAX_LOGICAL_NESTING_DEPTH}`,
        {
          code: 'MAX_NESTING_EXCEEDED',
          field: 'where',
          details: { maxDepth: MAX_LOGICAL_NESTING_DEPTH, actualDepth: depth }
        }
      )
    };
  }

  // Check nested logical operators
  for (const [key, value] of Object.entries(clause)) {
    if (isLogicalOperator(key) && Array.isArray(value)) {
      // Validate that logical operators have array of conditions
      if (value.length === 0) {
        return {
          success: false,
          error: new ParserError(
            `Logical operator ${key} requires at least one condition`,
            {
              code: 'INVALID_SYNTAX',
              field: 'where',
              details: { operator: key }
            }
          )
        };
      }

      // Recursively check each condition
      for (const condition of value) {
        if (typeof condition === 'object' && condition !== null) {
          const result = validateNestingDepth(condition as WhereClause, depth + 1);
          if (!result.success) {
            return result;
          }
        }
      }
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively check nested objects
      const result = validateNestingDepth(value as WhereClause, depth);
      if (!result.success) {
        return result;
      }
    }
  }

  return { success: true, data: undefined };
}
