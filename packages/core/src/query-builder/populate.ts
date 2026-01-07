/**
 * JOIN/Populate Builder (~180 LOC)
 *
 * Utilities for building and validating populate (JOIN) clauses.
 * Handles relation loading, nested populates, and validation.
 */

import type { PopulateClause, PopulateOptions, SelectClause } from "forja-types/core/query-builder";
import type { RelationField, SchemaDefinition } from "forja-types/core/schema";
import type { Result } from "forja-types/utils";


/**
 * Maximum nesting depth for populate clauses to prevent stack overflow
 */
const MAX_POPULATE_DEPTH = 5;

/**
 * Populate builder error
 */
export class PopulateBuilderError extends Error {
  constructor(
    message: string,
    public readonly details?: {
      field?: string;
      relation?: string;
      availableRelations?: readonly string[];
    }
  ) {
    super(message);
    this.name = 'PopulateBuilderError';
  }
}

/**
 * Get all relation fields from schema
 */
export function getRelationFields(
  schema: SchemaDefinition
): Record<string, RelationField> {
  const relations: Record<string, RelationField> = {};

  for (const [fieldName, field] of Object.entries(schema.fields)) {
    if (field.type === 'relation') {
      relations[fieldName] = field as RelationField;
    }
  }

  return relations;
}

/**
 * Check if schema has relation field
 */
export function hasRelation(
  schema: SchemaDefinition,
  relationName: string
): boolean {
  const field = schema.fields[relationName];
  return field !== undefined && field.type === 'relation';
}

/**
 * Get relation field definition
 */
export function getRelationField(
  schema: SchemaDefinition,
  relationName: string
): Result<RelationField, PopulateBuilderError> {
  const field = schema.fields[relationName];

  if (!field) {
    return {
      success: false,
      error: new PopulateBuilderError(
        `Field '${relationName}' does not exist in schema '${schema.name}'`,
        {
          field: relationName,
          availableRelations: Object.keys(getRelationFields(schema))
        }
      )
    };
  }

  if (field.type !== 'relation') {
    return {
      success: false,
      error: new PopulateBuilderError(
        `Field '${relationName}' is not a relation field (type: ${field.type})`,
        { field: relationName }
      )
    };
  }

  return { success: true, data: field as RelationField };
}

/**
 * Parse populate clause from various formats
 */
export function parsePopulateClause(
  input: unknown
): Result<PopulateClause, PopulateBuilderError> {
  if (input === null || input === undefined) {
    return { success: true, data: {} };
  }

  // Handle string: single relation, all fields
  if (typeof input === 'string') {
    return {
      success: true,
      data: { [input]: '*' }
    };
  }

  // Handle array: multiple relations, all fields
  if (Array.isArray(input)) {
    const populate: Record<string, PopulateOptions | '*'> = {};
    for (const item of input) {
      if (typeof item !== 'string') {
        return {
          success: false,
          error: new PopulateBuilderError(
            `Invalid populate item: expected string, got ${typeof item}`
          )
        };
      }
      populate[item] = '*';
    }
    return { success: true, data: populate };
  }

  // Handle object: full populate clause
  if (typeof input === 'object') {
    return { success: true, data: input as PopulateClause };
  }

  return {
    success: false,
    error: new PopulateBuilderError(
      `Invalid populate clause type: expected string, array, or object, got ${typeof input}`
    )
  };
}

/**
 * Validate populate options
 */
export function validatePopulateOptions(
  relationName: string,
  options: PopulateOptions | '*',
  _relationField: RelationField,
  targetSchema: SchemaDefinition,
  getSchema: (name: string) => SchemaDefinition | undefined,
  depth: number
): Result<void, PopulateBuilderError> {
  // '*' is always valid
  if (options === '*') {
    return { success: true, data: undefined };
  }

  // Validate select clause if present
  if (options.select && options.select !== '*') {
    const availableFields = Object.keys(targetSchema.fields);
    for (const field of options.select) {
      if (!availableFields.includes(field)) {
        return {
          success: false,
          error: new PopulateBuilderError(
            `Field '${field}' does not exist in related schema '${targetSchema.name}'`,
            { field, relation: relationName }
          )
        };
      }
    }
  }

  // Validate nested populate if present with depth check
  if (options.populate) {
    // Check if we would exceed depth limit
    if (depth >= MAX_POPULATE_DEPTH) {
      return {
        success: false,
        error: new PopulateBuilderError(
          `Populate clause exceeds maximum nesting depth of ${MAX_POPULATE_DEPTH}`,
          { relation: relationName }
        )
      };
    }

    // Recursively validate nested populates with depth tracking
    const nestedResult = validatePopulateClause(
      options.populate,
      targetSchema,
      getSchema,
      depth + 1
    );
    if (!nestedResult.success) {
      return {
        success: false,
        error: new PopulateBuilderError(
          `Nested populate error in '${relationName}': ${nestedResult.error.message}`,
          { relation: relationName }
        )
      };
    }
  }

  return { success: true, data: undefined };
}

/**
 * Validate populate clause against schema
 */
export function validatePopulateClause(
  populate: PopulateClause,
  schema: SchemaDefinition,
  getSchema: (name: string) => SchemaDefinition | undefined,
  depth = 0
): Result<void, PopulateBuilderError> {
  // Check depth limit
  if (depth > MAX_POPULATE_DEPTH) {
    return {
      success: false,
      error: new PopulateBuilderError(
        `Populate clause exceeds maximum nesting depth of ${MAX_POPULATE_DEPTH}`
      )
    };
  }

  for (const [relationName, options] of Object.entries(populate)) {
    // Get relation field
    const relationResult = getRelationField(schema, relationName);
    if (!relationResult.success) {
      return { success: false, error: relationResult.error };
    }

    const relationField = relationResult.data;

    // Get target schema
    const targetSchema = getSchema(relationField.model);
    if (!targetSchema) {
      return {
        success: false,
        error: new PopulateBuilderError(
          `Target schema '${relationField.model}' not found for relation '${relationName}'`,
          { relation: relationName }
        )
      };
    }

    // Validate populate options with depth tracking
    const optionsResult = validatePopulateOptions(
      relationName,
      options,
      relationField,
      targetSchema,
      getSchema,
      depth
    );
    if (!optionsResult.success) {
      return { success: false, error: optionsResult.error };
    }
  }

  return { success: true, data: undefined };
}

/**
 * Create simple populate (all fields)
 */
export function createSimplePopulate(
  ...relations: readonly string[]
): PopulateClause {
  const populate: Record<string, '*'> = {};
  for (const relation of relations) {
    populate[relation] = '*';
  }
  return populate;
}

/**
 * Create populate with options
 */
export function createPopulateWithOptions(
  relation: string,
  options: PopulateOptions
): PopulateClause {
  return { [relation]: options };
}

/**
 * Create nested populate
 */
export function createNestedPopulate(
  relation: string,
  select?: SelectClause,
  nestedPopulate?: PopulateClause
): PopulateClause {
  // Build options object conditionally
  const options: PopulateOptions = {
    ...(select !== undefined && { select }),
    ...(nestedPopulate !== undefined && { populate: nestedPopulate })
  };

  return { [relation]: Object.keys(options).length > 0 ? options : '*' };
}

/**
 * Merge populate clauses
 */
export function mergePopulateClauses(
  ...clauses: readonly (PopulateClause | undefined)[]
): PopulateClause {
  const merged: Record<string, PopulateOptions | '*'> = {};

  for (const clause of clauses) {
    if (!clause) continue;

    for (const [relation, options] of Object.entries(clause)) {
      // If either is '*', use '*'
      if (options === '*' || merged[relation] === '*') {
        merged[relation] = '*';
      } else if (merged[relation]) {
        // Merge options
        const existing = merged[relation] as PopulateOptions;
        const mergedOptions: PopulateOptions = {
          ...(options.select !== undefined || existing.select !== undefined
            ? { select: options.select || existing.select }
            : {}),
          ...(options.where !== undefined || existing.where !== undefined
            ? { where: options.where || existing.where }
            : {}),
          ...(options.populate !== undefined || existing.populate !== undefined
            ? {
              populate: options.populate
                ? mergePopulateClauses(existing.populate, options.populate)
                : existing.populate
            }
            : {}),
          ...(options.limit !== undefined || existing.limit !== undefined
            ? { limit: options.limit ?? existing.limit }
            : {}),
          ...(options.offset !== undefined || existing.offset !== undefined
            ? { offset: options.offset ?? existing.offset }
            : {}),
          ...(options.orderBy !== undefined || existing.orderBy !== undefined
            ? { orderBy: options.orderBy || existing.orderBy }
            : {})
        };
        merged[relation] = mergedOptions;
      } else {
        merged[relation] = options;
      }
    }
  }

  return merged;
}

/**
 * Check if populate clause is empty
 */
export function isEmptyPopulateClause(
  populate: PopulateClause | undefined
): boolean {
  return populate === undefined || Object.keys(populate).length === 0;
}

/**
 * Get populate depth (for nested populates)
 */
export function getPopulateDepth(
  populate: PopulateClause,
  currentDepth = 0
): number {
  // Prevent unbounded recursion
  if (currentDepth > MAX_POPULATE_DEPTH) {
    return MAX_POPULATE_DEPTH;
  }

  let maxDepth = 0;

  for (const options of Object.values(populate)) {
    if (options === '*') {
      maxDepth = Math.max(maxDepth, 1);
    } else if (options.populate) {
      maxDepth = Math.max(
        maxDepth,
        1 + getPopulateDepth(options.populate, currentDepth + 1)
      );
    } else {
      maxDepth = Math.max(maxDepth, 1);
    }
  }

  return maxDepth;
}
