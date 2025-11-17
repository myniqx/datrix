/**
 * WHERE Clause Builder (~180 LOC)
 *
 * Utilities for building and validating WHERE clauses.
 * Handles comparison operators, logical operators, and nested conditions.
 */

import type { WhereClause, ComparisonOperators, Primitive } from './types';
import type { SchemaDefinition, FieldType } from '@core/schema/types';
import type { Result } from '@utils/types';

/**
 * Where builder error
 */
export class WhereBuilderError extends Error {
  constructor(
    message: string,
    public readonly details?: {
      field?: string;
      operator?: string;
      value?: unknown;
    }
  ) {
    super(message);
    this.name = 'WhereBuilderError';
  }
}

/**
 * Check if value is a comparison operator object
 */
export function isComparisonOperators(
  value: unknown
): value is ComparisonOperators {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const operators = [
    '$eq',
    '$ne',
    '$gt',
    '$gte',
    '$lt',
    '$lte',
    '$in',
    '$nin',
    '$like',
    '$ilike',
    '$regex',
    '$exists',
    '$null'
  ];

  return Object.keys(value).some((key) => operators.includes(key));
}

/**
 * Check if value is a logical operator
 */
export function isLogicalOperator(key: string): boolean {
  return ['$and', '$or', '$not'].includes(key);
}

/**
 * Validate comparison operator value
 */
export function validateComparisonOperator(
  field: string,
  operator: string,
  value: unknown,
  _fieldType: FieldType
): Result<void, WhereBuilderError> {
  switch (operator) {
    case '$eq':
    case '$ne':
      // Any primitive is valid
      if (
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean' &&
        value !== null &&
        !(value instanceof Date)
      ) {
        return {
          success: false,
          error: new WhereBuilderError(
            `Invalid value for ${operator}: expected primitive value`,
            { field, operator, value }
          )
        };
      }
      break;

    case '$gt':
    case '$gte':
    case '$lt':
    case '$lte':
      // Only numbers and dates
      if (typeof value !== 'number' && !(value instanceof Date)) {
        return {
          success: false,
          error: new WhereBuilderError(
            `Invalid value for ${operator}: expected number or Date`,
            { field, operator, value }
          )
        };
      }
      break;

    case '$in':
    case '$nin':
      // Array of primitives
      if (!Array.isArray(value)) {
        return {
          success: false,
          error: new WhereBuilderError(
            `Invalid value for ${operator}: expected array`,
            { field, operator, value }
          )
        };
      }
      break;

    case '$like':
    case '$ilike':
      // String only
      if (typeof value !== 'string') {
        return {
          success: false,
          error: new WhereBuilderError(
            `Invalid value for ${operator}: expected string`,
            { field, operator, value }
          )
        };
      }
      break;

    case '$regex':
      // RegExp or string
      if (!(value instanceof RegExp) && typeof value !== 'string') {
        return {
          success: false,
          error: new WhereBuilderError(
            `Invalid value for ${operator}: expected RegExp or string`,
            { field, operator, value }
          )
        };
      }
      break;

    case '$exists':
    case '$null':
      // Boolean only
      if (typeof value !== 'boolean') {
        return {
          success: false,
          error: new WhereBuilderError(
            `Invalid value for ${operator}: expected boolean`,
            { field, operator, value }
          )
        };
      }
      break;

    default:
      return {
        success: false,
        error: new WhereBuilderError(`Unknown operator: ${operator}`, {
          field,
          operator
        })
      };
  }

  return { success: true, data: undefined };
}

/**
 * Validate where clause against schema
 */
export function validateWhereClause(
  where: WhereClause,
  schema: SchemaDefinition
): Result<void, WhereBuilderError> {
  const availableFields = Object.keys(schema.fields);

  for (const [key, value] of Object.entries(where)) {
    // Handle logical operators
    if (isLogicalOperator(key)) {
      if (key === '$and' || key === '$or') {
        if (!Array.isArray(value)) {
          return {
            success: false,
            error: new WhereBuilderError(
              `${key} operator requires an array of conditions`,
              { operator: key, value }
            )
          };
        }

        // Recursively validate each condition
        for (const condition of value as readonly WhereClause[]) {
          const result = validateWhereClause(condition, schema);
          if (!result.success) {
            return result;
          }
        }
      } else if (key === '$not') {
        // Recursively validate nested condition
        const result = validateWhereClause(value as WhereClause, schema);
        if (!result.success) {
          return result;
        }
      }
      continue;
    }

    // Check field exists in schema
    if (!availableFields.includes(key)) {
      return {
        success: false,
        error: new WhereBuilderError(
          `Field '${key}' does not exist in schema '${schema.name}'`,
          { field: key }
        )
      };
    }

    const fieldDef = schema.fields[key];
    if (!fieldDef) continue;

    // Handle comparison operators
    if (isComparisonOperators(value)) {
      const ops = value as ComparisonOperators;
      for (const [operator, opValue] of Object.entries(ops)) {
        const result = validateComparisonOperator(
          key,
          operator,
          opValue,
          fieldDef.type
        );
        if (!result.success) {
          return result;
        }
      }
    }
    // Simple equality check
    else {
      // Validate primitive value
      if (
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean' &&
        value !== null &&
        !(value instanceof Date)
      ) {
        return {
          success: false,
          error: new WhereBuilderError(
            `Invalid value for field '${key}': expected primitive value`,
            { field: key, value }
          )
        };
      }
    }
  }

  return { success: true, data: undefined };
}

/**
 * Merge multiple where clauses with AND logic
 */
export function mergeWhereClauses(
  ...clauses: readonly (WhereClause | undefined)[]
): WhereClause | undefined {
  const validClauses = clauses.filter(
    (c): c is WhereClause => c !== undefined && Object.keys(c).length > 0
  );

  if (validClauses.length === 0) {
    return undefined;
  }

  if (validClauses.length === 1) {
    return validClauses[0];
  }

  return { $and: validClauses };
}

/**
 * Create simple equality condition
 */
export function createEqualityCondition(
  field: string,
  value: Primitive
): WhereClause {
  return { [field]: value };
}

/**
 * Create comparison condition
 */
export function createComparisonCondition(
  field: string,
  operator: keyof ComparisonOperators,
  value: unknown
): WhereClause {
  return { [field]: { [operator]: value } as ComparisonOperators };
}

/**
 * Create IN condition
 */
export function createInCondition(
  field: string,
  values: readonly Primitive[]
): WhereClause {
  return { [field]: { $in: values } };
}

/**
 * Create LIKE condition
 */
export function createLikeCondition(
  field: string,
  pattern: string,
  caseSensitive = true
): WhereClause {
  return {
    [field]: { [caseSensitive ? '$like' : '$ilike']: pattern }
  };
}

/**
 * Create AND condition
 */
export function createAndCondition(
  ...conditions: readonly WhereClause[]
): WhereClause {
  return { $and: conditions };
}

/**
 * Create OR condition
 */
export function createOrCondition(
  ...conditions: readonly WhereClause[]
): WhereClause {
  return { $or: conditions };
}

/**
 * Create NOT condition
 */
export function createNotCondition(condition: WhereClause): WhereClause {
  return { $not: condition } as WhereClause;
}

/**
 * Check if where clause is empty
 */
export function isEmptyWhereClause(where: WhereClause | undefined): boolean {
  return where === undefined || Object.keys(where).length === 0;
}
