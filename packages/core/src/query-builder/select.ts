/**
 * SELECT/Fields Builder (~60 LOC)
 *
 * Utilities for building and validating SELECT clauses.
 * Handles field selection, validation, and normalization.
 */

import { SelectClause } from "forja-types/core/query-builder";
import type { SchemaDefinition } from "forja-types/core/schema";
import { throwInvalidField, throwInvalidValue } from "./error-helper";

/**
 * Parse select clause from various formats
 * @throws {ForjaQueryBuilderError} If input format is invalid
 */
export function parseSelectClause(input: unknown): SelectClause {
  // Handle null/undefined -> select all
  if (input === null || input === undefined) {
    return "*";
  }

  // Handle string
  if (typeof input === "string") {
    if (input === "*") {
      return "*";
    }
    // Single field
    return [input];
  }

  // Handle array
  if (Array.isArray(input)) {
    // Validate all items are strings
    for (const item of input) {
      if (typeof item !== "string") {
        throwInvalidValue("select", "field", item, "string");
      }
    }
    return input as readonly string[];
  }

  throwInvalidValue("select", "input", input, "string, array, or '*'");
}

/**
 * Normalize select clause (remove duplicates, preserve order)
 */
export function normalizeSelectClause(select: SelectClause): SelectClause {
  if (select === "*") {
    return "*";
  }

  // Remove duplicates using Set (preserves insertion order per ES6+)
  return Array.from(new Set(select));
}

/**
 * Validate select fields against schema
 * @throws {ForjaQueryBuilderError} If any field doesn't exist in schema
 */
export function validateSelectFields(
  select: SelectClause,
  schema: SchemaDefinition,
): void {
  // '*' is always valid
  if (select === "*") {
    return;
  }

  const availableFields = Object.keys(schema.fields);

  // Check each field exists in schema
  for (const field of select) {
    if (!availableFields.includes(field)) {
      throwInvalidField("select", field, availableFields);
    }
  }
}

/**
 * Merge multiple select clauses
 */
export function mergeSelectClauses(
  ...selects: readonly SelectClause[]
): SelectClause {
  // If any is '*', return '*'
  if (selects.some((s) => s === "*")) {
    return "*";
  }

  // Merge all arrays
  const allFields: string[] = [];
  for (const select of selects) {
    if (select !== "*") {
      allFields.push(...select);
    }
  }

  // Remove duplicates and sort
  return normalizeSelectClause(allFields);
}

/**
 * Convert select clause to field list
 * If '*', return all schema fields (preserves schema definition order)
 */
export function expandSelectClause(
  select: SelectClause,
  schema: SchemaDefinition,
): readonly string[] {
  if (select === "*") {
    return Object.keys(schema.fields);
  }
  return select;
}

/**
 * Check if field is selected
 */
export function isFieldSelected(field: string, select: SelectClause): boolean {
  if (select === "*") {
    return true;
  }
  return select.includes(field);
}

/**
 * Create select clause from fields
 */
export function createSelectClause(
  fields: readonly string[] | "*",
): SelectClause {
  return fields === "*" ? "*" : [...fields];
}

/**
 * Exclude fields from select clause
 */
export function excludeFields(
  select: SelectClause,
  schema: SchemaDefinition,
  excludeList: readonly string[],
): SelectClause {
  if (select === "*") {
    // Get all fields except excluded ones (preserves schema definition order)
    const allFields = Object.keys(schema.fields);
    return allFields.filter((f) => !excludeList.includes(f));
  }

  // Filter out excluded fields (preserves original order)
  return select.filter((f) => !excludeList.includes(f));
}
