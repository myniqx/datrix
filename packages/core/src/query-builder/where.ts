/**
 * WHERE Clause Builder (~180 LOC)
 *
 * Utilities for building and validating WHERE clauses.
 * Handles comparison operators, logical operators, and nested conditions.
 */

import type { ComparisonOperators, QueryPrimitive, WhereClause } from "forja-types/core/query-builder";
import type { FieldType, SchemaDefinition } from "forja-types/core/schema";
import type { Result } from "forja-types/utils";
import {
  throwInvalidOperator,
  throwInvalidValue,
  throwMaxDepthExceeded,
  throwInvalidField,
} from "./error-helper";
import { ForjaQueryBuilderError } from "forja-types/errors";

/**
 * Maximum nesting depth for WHERE clauses to prevent stack overflow
 */
const MAX_WHERE_DEPTH = 10;

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
    '$contains',
    '$icontains',
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
 * @throws {ForjaQueryBuilderError} If operator or value is invalid
 */
export function validateComparisonOperator(
  field: string,
  operator: string,
  value: unknown,
  _fieldType: FieldType
): void {
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
        throwInvalidValue('where', field, value, 'primitive value');
      }
      break;

    case '$gt':
    case '$gte':
    case '$lt':
    case '$lte':
      // Only numbers and dates
      if (typeof value !== 'number' && !(value instanceof Date)) {
        throwInvalidValue('where', field, value, 'number or Date');
      }
      break;

    case '$in':
    case '$nin':
      // Array of primitives
      if (!Array.isArray(value)) {
        throwInvalidValue('where', field, value, 'array');
      }
      break;

    case '$like':
    case '$ilike':
    case '$contains':
    case '$icontains':
      // String only
      if (typeof value !== 'string') {
        throwInvalidValue('where', field, value, 'string');
      }
      break;

    case '$regex':
      // RegExp or string
      if (!(value instanceof RegExp) && typeof value !== 'string') {
        throwInvalidValue('where', field, value, 'RegExp or string');
      }
      break;

    case '$exists':
    case '$null':
      // Boolean only
      if (typeof value !== 'boolean') {
        throwInvalidValue('where', field, value, 'boolean');
      }
      break;

    default:
      throwInvalidOperator(field, operator, [
        '$eq', '$ne', '$gt', '$gte', '$lt', '$lte',
        '$in', '$nin', '$like', '$ilike', '$contains',
        '$icontains', '$regex', '$exists', '$null'
      ]);
  }
}

/**
 * Validate where clause against schema
 * @throws {ForjaQueryBuilderError} If where clause is invalid
 */
export function validateWhereClause(
  where: WhereClause,
  schema: SchemaDefinition,
  depth = 0
): void {
  // Check depth limit
  if (depth > MAX_WHERE_DEPTH) {
    throwMaxDepthExceeded('where', depth, MAX_WHERE_DEPTH);
  }

  const availableFields = Object.keys(schema.fields);

  for (const [key, value] of Object.entries(where)) {
    // Handle logical operators
    if (isLogicalOperator(key)) {
      if (key === '$and' || key === '$or') {
        if (!Array.isArray(value)) {
          throwInvalidValue('where', key, value, 'array of conditions');
        }

        // Recursively validate each condition
        for (const condition of value as readonly WhereClause[]) {
          validateWhereClause(condition, schema, depth + 1);
        }
      } else if (key === '$not') {
        // Recursively validate nested condition
        validateWhereClause(value as WhereClause, schema, depth + 1);
      }
      continue;
    }

    // Check field exists in schema
    if (!availableFields.includes(key)) {
      throwInvalidField('where', key, availableFields);
    }

    const fieldDef = schema.fields[key];
    if (!fieldDef) continue;

    // Handle comparison operators
    if (isComparisonOperators(value)) {
      const ops = value as ComparisonOperators;
      for (const [operator, opValue] of Object.entries(ops)) {
        validateComparisonOperator(key, operator, opValue, fieldDef.type);
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
        throwInvalidValue('where', key, value, 'primitive value');
      }
    }
  }
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
  value: QueryPrimitive
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
  values: readonly QueryPrimitive[]
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
