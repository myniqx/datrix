/**
 * WHERE Clause Builder
 *
 * All WHERE-related operations: merging, validation, normalization.
 * Handles comparison operators, logical operators, nested conditions, and relation shortcuts.
 */

import type {
  ComparisonOperators,
  WhereClause,
} from "forja-types/core/query-builder";
import type { FieldType, SchemaDefinition, RelationField, SchemaRegistry, ForjaEntry } from "forja-types/core/schema";
import {
  throwInvalidOperator,
  throwInvalidValue,
  throwMaxDepthExceeded,
  throwInvalidField,
} from "./error-helper";

/**
 * Maximum nesting depth for WHERE clauses to prevent stack overflow
 */
const MAX_WHERE_DEPTH = 10;

/**
 * Check if value is a comparison operator object
 */
export function isComparisonOperators(
  value: unknown,
): value is ComparisonOperators {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const operators = [
    "$eq",
    "$ne",
    "$gt",
    "$gte",
    "$lt",
    "$lte",
    "$in",
    "$nin",
    "$like",
    "$ilike",
    "$contains",
    "$icontains",
    "$regex",
    "$exists",
    "$null",
  ];

  return Object.keys(value).some((key) => operators.includes(key));
}

/**
 * Check if value is a logical operator
 */
export function isLogicalOperator(key: string): boolean {
  return ["$and", "$or", "$not"].includes(key);
}

/**
 * Validate comparison operator value
 * @throws {ForjaQueryBuilderError} If operator or value is invalid
 */
export function validateComparisonOperator(
  field: string,
  operator: string,
  value: unknown,
  _fieldType: FieldType,
): void {
  switch (operator) {
    case "$eq":
    case "$ne":
      // Any primitive is valid
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean" &&
        value !== null &&
        !(value instanceof Date)
      ) {
        throwInvalidValue("where", field, value, "primitive value");
      }
      break;

    case "$gt":
    case "$gte":
    case "$lt":
    case "$lte":
      // Only numbers and dates
      if (typeof value !== "number" && !(value instanceof Date)) {
        throwInvalidValue("where", field, value, "number or Date");
      }
      break;

    case "$in":
    case "$nin":
      // Array of primitives
      if (!Array.isArray(value)) {
        throwInvalidValue("where", field, value, "array");
      }
      break;

    case "$like":
    case "$ilike":
    case "$contains":
    case "$icontains":
      // String only
      if (typeof value !== "string") {
        throwInvalidValue("where", field, value, "string");
      }
      break;

    case "$regex":
      // RegExp or string
      if (!(value instanceof RegExp) && typeof value !== "string") {
        throwInvalidValue("where", field, value, "RegExp or string");
      }
      break;

    case "$exists":
    case "$null":
      // Boolean only
      if (typeof value !== "boolean") {
        throwInvalidValue("where", field, value, "boolean");
      }
      break;

    default:
      throwInvalidOperator(field, operator, [
        "$eq",
        "$ne",
        "$gt",
        "$gte",
        "$lt",
        "$lte",
        "$in",
        "$nin",
        "$like",
        "$ilike",
        "$contains",
        "$icontains",
        "$regex",
        "$exists",
        "$null",
      ]);
  }
}

/**
 * Validate where clause against schema
 * @param where - WHERE clause to validate
 * @param schema - Schema definition
 * @param schemaRegistry - Schema registry for nested relation validation
 * @param depth - Current nesting depth
 * @throws {ForjaQueryBuilderError} If where clause is invalid
 */
export function validateWhereClause(
  where: WhereClause,
  schema: SchemaDefinition,
  schemaRegistry?: { get(name: string): SchemaDefinition | undefined },
  depth = 0,
): void {
  // Check depth limit
  if (depth > MAX_WHERE_DEPTH) {
    throwMaxDepthExceeded("where", depth, MAX_WHERE_DEPTH);
  }

  const availableFields = Object.keys(schema.fields);

  for (const [key, value] of Object.entries(where)) {
    // Handle logical operators
    if (isLogicalOperator(key)) {
      if (key === "$and" || key === "$or") {
        if (!Array.isArray(value)) {
          throwInvalidValue("where", key, value, "array of conditions");
        }

        // Recursively validate each condition
        for (const condition of value as readonly WhereClause[]) {
          validateWhereClause(condition, schema, schemaRegistry, depth + 1);
        }
      } else if (key === "$not") {
        // Recursively validate nested condition
        validateWhereClause(value as WhereClause, schema, schemaRegistry, depth + 1);
      }
      continue;
    }

    // Check field exists in schema
    if (!availableFields.includes(key)) {
      throwInvalidField("where", key, availableFields);
    }

    const fieldDef = schema.fields[key];
    if (!fieldDef) continue;

    // Handle relation fields with nested WHERE
    if (fieldDef.type === "relation" && typeof value === "object" && value !== null && !(value instanceof Date)) {
      const relationField = fieldDef as RelationField;

      // Check if it's a primitive value (shortcut)
      if (typeof value === "string" || typeof value === "number") {
        // Primitive shortcut - will be normalized later
        continue;
      }

      // Nested WHERE for relation - validate against target schema
      if (schemaRegistry) {
        const targetSchema = schemaRegistry.get(relationField.model);
        if (targetSchema) {
          // Recursively validate nested WHERE against target schema
          validateWhereClause(value as WhereClause, targetSchema, schemaRegistry, depth + 1);
        }
      }
      continue;
    }

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
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean" &&
        value !== null &&
        !(value instanceof Date)
      ) {
        throwInvalidValue("where", key, value, "primitive value");
      }
    }
  }
}


/**
 * Normalize and validate WHERE arrays
 *
 * Complete WHERE processing pipeline:
 * 1. Merge multiple .where() calls with $and
 * 2. Validate fields and operators (BEFORE normalization)
 *    - Including nested relation WHERE validation
 * 3. Normalize relation shortcuts (category: 2 → categoryId: { $eq: 2 })
 * 4. Recursively process logical operators ($and, $or, $not)
 *
 * @param wheres - Array of where clauses from multiple .where() calls
 * @param schema - Schema definition for validation and normalization
 * @param registry - Schema registry for nested relation validation
 * @returns Normalized and validated WHERE clause
 *
 * @example
 * ```ts
 * // Multiple where calls
 * normalizeWhere([{ age: { $gte: 18 } }, { role: 'admin' }], schema, registry)
 * // → { $and: [{ age: { $gte: 18 } }, { role: 'admin' }] }
 *
 * // Relation shortcut normalization
 * normalizeWhere([{ category: 2 }], productSchema, registry)
 * // → { categoryId: { $eq: 2 } }
 *
 * // Nested relation WHERE validation
 * normalizeWhere([{ category: { invalidField: 'value' } }], productSchema, registry)
 * // → throws ForjaQueryBuilderError (invalidField doesn't exist in Category schema)
 *
 * // Validation errors caught first
 * normalizeWhere([{ invalidField: 'value' }], schema, registry)
 * // → throws ForjaQueryBuilderError (BEFORE normalization)
 * ```
 */
export function normalizeWhere<T extends ForjaEntry>(
  wheres: WhereClause<T>[] | undefined,
  schema: SchemaDefinition,
  registry: SchemaRegistry,
): WhereClause<T> | undefined {
  if (!wheres || wheres.length === 0) {
    return undefined;
  }

  // 1. Merge multiple where clauses with $and
  let mergedWhere: WhereClause<T>;
  if (wheres.length === 1) {
    mergedWhere = wheres[0]!;
  } else {
    mergedWhere = { $and: wheres } as WhereClause<T>;
  }

  // 2. Validate BEFORE normalization (catches errors early)
  //    Including nested relation WHERE validation
  validateWhereClause(mergedWhere, schema, registry);

  // 3. Normalize relation shortcuts and logical operators
  return normalizeWhereClause(mergedWhere, schema, registry);
}

/**
 * Normalize WHERE clause recursively
 *
 * Internal function that handles:
 * - Relation shortcuts: { category: 2 } → { categoryId: { $eq: 2 } }
 * - Nested relation WHERE: Recursively normalize target schema
 * - Logical operators: Recursively process $and, $or, $not
 * - Regular fields: Keep as-is
 *
 * @param where - WHERE clause to normalize
 * @param schema - Schema definition
 * @param registry - Schema registry for nested relation schemas
 * @returns Normalized WHERE clause
 */
function normalizeWhereClause<T extends ForjaEntry>(
  where: WhereClause<T>,
  schema: SchemaDefinition,
  registry: SchemaRegistry,
): WhereClause<T> {
  const normalized: WhereClause<T> = {};

  for (const [key, value] of Object.entries(where)) {
    // Handle logical operators recursively
    if (key === "$and" || key === "$or") {
      normalized[key] = (value as WhereClause<T>[]).map((clause) =>
        normalizeWhereClause(clause, schema, registry),
      );
      continue;
    }

    if (key === "$not") {
      normalized[key] = normalizeWhereClause(value as WhereClause<T>, schema, registry);
      continue;
    }

    // Check if this is a relation field
    const field = schema.fields[key];
    if (field?.type === "relation") {
      const relationField = field as RelationField;
      const kind = relationField.kind;

      // Only normalize primitive values for belongsTo/hasOne
      // (hasMany/manyToMany with primitive values are semantic errors - validation catches)
      if (
        (kind === "belongsTo" || kind === "hasOne") &&
        (typeof value === "string" || typeof value === "number")
      ) {
        // Convert relation shortcut to FK filter
        // { category: 2 } → { categoryId: { $eq: 2 } }
        const foreignKey = relationField.foreignKey!;
        normalized[foreignKey] = { $eq: value };
        continue;
      }

      // For object values (nested WHERE), recursively normalize with target schema
      if (typeof value === "object" && value !== null && !(value instanceof Date)) {
        const targetSchema = registry.get(relationField.model);
        if (targetSchema) {
          // Recursively normalize nested WHERE clause
          normalized[key] = normalizeWhereClause(value as WhereClause, targetSchema, registry);
          continue;
        }
      }

      // Fallback: keep as-is
      normalized[key] = value;
    } else {
      // Regular field - keep as-is
      normalized[key] = value;
    }
  }

  return normalized;
}
