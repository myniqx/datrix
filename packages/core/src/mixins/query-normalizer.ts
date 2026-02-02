/**
 * Query Normalizer
 *
 * Centralizes all query normalization logic:
 * - WHERE clause normalization (relation shortcuts)
 * - SELECT clause normalization (reserved fields)
 * - POPULATE clause normalization (nested processing)
 * - Future: ORDER BY, LIMIT, OFFSET normalization
 */

import {
  SchemaRegistry,
  SchemaDefinition,
  RelationField,
  ForjaEntry,
} from "forja-types/core/schema";
import {
  WhereClause,
  SelectClause,
  PopulateClause,
  OrderBy,
} from "forja-types/core/query-builder";
import {
  throwInvalidPopulateError,
  throwNonRelationFieldInPopulateError,
  throwSchemaNotFoundError,
  throwCrudError,
} from "./error-helper";

/**
 * Query Normalizer Class
 *
 * Provides consistent normalization for all query parameters
 * before sending to database adapters.
 */
export class QueryNormalizer {
  constructor(private readonly schemas: SchemaRegistry) { }

  /**
   * Normalize WHERE clause
   *
   * Converts relation shortcuts to proper FK filters:
   * - { category: 2 } → { categoryId: { $eq: 2 } } (belongsTo/hasOne only)
   * - { category: { name: "Books" } } → kept as nested WHERE
   * - Recursively processes $and, $or, $not operators
   *
   * @param where - Raw WHERE clause from user
   * @param schema - Schema definition for current model
   * @returns Normalized WHERE clause
   *
   * @example
   * ```ts
   * normalizeWhere({ category: 2 }, productSchema)
   * // Returns: { categoryId: { $eq: 2 } }
   *
   * normalizeWhere({ category: { name: "Books" } }, productSchema)
   * // Returns: { category: { name: "Books" } } (nested WHERE, kept as-is)
   * ```
   */
  normalizeWhere<T extends ForjaEntry = ForjaEntry>(
    where: WhereClause<T> | undefined,
    schema: SchemaDefinition,
  ): WhereClause<T> | undefined {
    if (!where) return undefined;

    const normalized: WhereClause<T> = {};

    for (const [key, value] of Object.entries(where)) {
      // Handle logical operators recursively
      if (key === "$and" || key === "$or") {
        normalized[key] = (value as WhereClause<T>[]).map((clause) =>
          this.normalizeWhere(clause, schema)!,
        );
        continue;
      }

      if (key === "$not") {
        normalized[key] = this.normalizeWhere(value as WhereClause<T>, schema)!;
        continue;
      }

      // Check if this is a relation field
      const field = schema.fields[key];
      if (field?.type === "relation") {
        const relationField = field as RelationField;
        const kind = relationField.kind;

        // Only normalize primitive values for belongsTo/hasOne
        // (hasMany/manyToMany with primitive values are semantic errors - let adapter handle)
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

        // For object values (nested WHERE), keep as-is
        normalized[key] = value;
      } else {
        // Regular field - keep as-is
        normalized[key] = value;
      }
    }

    return normalized;
  }

  /**
   * Normalize SELECT clause
   *
   * Uses SchemaRegistry to:
   * - Convert "*" to actual field list
   * - Add reserved fields (id, createdAt, updatedAt)
   * - Exclude hidden/relation fields
   *
   * @param select - Raw SELECT clause from user
   * @param model - Model name
   * @returns Normalized SELECT clause
   */
  normalizeSelect(
    select: SelectClause | undefined,
    model: string,
  ): SelectClause {
    return this.schemas.getSelectFieldsFor(model, select);
  }

  /**
   * Normalize POPULATE clause
   *
   * Supports multiple input formats:
   * - populate: '*' → populate all first-level relations
   * - populate: ['category', 'author.company'] → dot notation array
   * - populate: { author: true, category: { select: [...] } } → object notation
   * - Recursively processes nested populate
   * - Validates that only relation fields are populated
   *
   * @param populate - Raw POPULATE clause from user
   * @param model - Model name
   * @returns Normalized POPULATE clause
   *
   * @example
   * ```ts
   * // Wildcard - all relations
   * normalizePopulate('*', 'Post')
   * // Returns: { author: { select: [...] }, category: { select: [...] } }
   *
   * // Dot notation array
   * normalizePopulate(['category', 'author.company'], 'Post')
   * // Returns: {
   * //   category: { select: [...] },
   * //   author: { populate: { company: { select: [...] } } }
   * // }
   *
   * // Object notation
   * normalizePopulate({ author: true }, 'Post')
   * // Returns: { author: { select: ['id', 'name', 'email', ...] } }
   * ```
   */
  normalizePopulate<T extends ForjaEntry = ForjaEntry>(
    populate: PopulateClause<T> | "*" | readonly string[] | undefined,
    model: string,
  ): PopulateClause<T> | undefined {
    if (!populate) {
      return populate;
    }

    const schema = this.schemas.get(model);
    if (!schema) {
      throwSchemaNotFoundError(model);
    }

    // Handle wildcard '*' - populate all first-level relations
    if (populate === "*") {
      const allRelations: Record<string, object> = {};
      for (const [fieldName, field] of Object.entries(schema.fields)) {
        if (field.type === "relation") {
          const relationField = field as RelationField;
          allRelations[fieldName] = {
            select: this.normalizeSelect("*", relationField.model),
          };
        }
      }
      return allRelations as PopulateClause<T>;
    }

    // Handle array format - dot notation ['category', 'author.company']
    if (Array.isArray(populate)) {
      return this.normalizePopulateArray(populate, schema, model) as PopulateClause<T>;
    }

    // Handle object format - existing logic
    const result: Record<string, object> = {};

    for (const [relationName, value] of Object.entries(populate)) {
      const field = schema.fields[relationName];

      // Field doesn't exist - throw error (typo detection)
      if (!field) {
        const availableRelations = Object.entries(schema.fields)
          .filter(([_, f]) => f.type === "relation")
          .map(([name]) => name);

        throwCrudError({
          operation: "findOne",
          model,
          code: "INVALID_POPULATE_VALUE",
          message: `Field '${relationName}' does not exist in ${model}`,
          received: relationName,
          expected: `One of: ${availableRelations.join(", ")}`,
          suggestion: availableRelations.length > 0
            ? `Available relations: ${availableRelations.join(", ")}`
            : `No relations available in ${model}. Did you mean to use select instead?`,
        });
      }

      // Field exists but is not a relation - throw error
      if (field.type !== "relation") {
        throwNonRelationFieldInPopulateError(model, relationName, field.type);
      }

      const relationField = field as RelationField;
      const targetModel = relationField.model;

      if (typeof value === "boolean") {
        // populate[category]=true → convert to { select: [...] }
        result[relationName] = {
          select: this.normalizeSelect("*", targetModel),
        };
      } else if (typeof value === "object") {
        // populate[category]={ select: [...], populate: {...} }
        result[relationName] = {
          ...value,
          // Process select for this level
          select: this.normalizeSelect(value.select, targetModel),
          // Recursively process nested populate
          populate:
            value.populate ?
              this.normalizePopulate(value.populate, targetModel)
              : value.populate,
        };
      } else if (value === "*") {
        // populate[category]=* → convert to { select: [...] }
        result[relationName] = {
          select: this.normalizeSelect("*", targetModel),
        };
      } else {
        // Invalid value
        throwInvalidPopulateError(model, relationName, value);
      }
    }

    return result as PopulateClause<T>;
  }

  /**
   * Normalize array-based populate with dot notation
   *
   * Converts ['category', 'author.company', 'author.posts'] to:
   * {
   *   category: { select: [...] },
   *   author: {
   *     select: [...],
   *     populate: {
   *       company: { select: [...] },
   *       posts: { select: [...] }
   *     }
   *   }
   * }
   *
   * @param paths - Array of relation paths (dot notation)
   * @param schema - Current schema
   * @param model - Model name for error messages
   * @returns Normalized populate object
   */
  private normalizePopulateArray(
    paths: readonly string[],
    schema: SchemaDefinition,
    model: string,
  ): Record<string, any> {
    const result: Record<string, any> = {};

    for (const path of paths) {
      const parts = path.split(".");
      const firstPart = parts[0];

      // Validate that first part is a relation field
      const field = schema.fields[firstPart];

      // Field doesn't exist
      if (!field) {
        const availableRelations = Object.entries(schema.fields)
          .filter(([_, f]) => f.type === "relation")
          .map(([name]) => name);

        throwCrudError({
          operation: "findOne",
          model,
          code: "INVALID_POPULATE_VALUE",
          message: `Field '${firstPart}' does not exist in ${model}`,
          received: path,
          expected: `One of: ${availableRelations.join(", ")}`,
          suggestion: `Available relations: ${availableRelations.join(", ")}. Check for typos in: '${path}'`,
        });
      }

      // Field exists but is not a relation
      if (field.type !== "relation") {
        throwNonRelationFieldInPopulateError(model, firstPart, field.type);
      }

      const relationField = field as RelationField;
      const targetModel = relationField.model;

      if (parts.length === 1) {
        // Simple path: 'category' → { category: { select: [...] } }
        result[firstPart] = {
          select: this.normalizeSelect("*", targetModel),
        };
      } else {
        // Nested path: 'author.company' → { author: { populate: { company: { select: [...] } } } }
        const nestedPath = parts.slice(1).join(".");

        if (!result[firstPart]) {
          result[firstPart] = {
            select: this.normalizeSelect("*", targetModel),
            populate: {},
          };
        }

        if (!result[firstPart].populate) {
          result[firstPart].populate = {};
        }

        // Recursively normalize the nested path
        const targetSchema = this.schemas.get(targetModel);
        if (targetSchema) {
          const nested = this.normalizePopulateArray([nestedPath], targetSchema);
          // Merge nested populate
          Object.assign(result[firstPart].populate, nested);
        }
      }
    }

    return result;
  }

  /**
   * Normalize ORDER BY clause
   *
   * Future: Could normalize relation field sorts to FK sorts
   * For now: Pass-through
   *
   * @param orderBy - Raw ORDER BY clause
   * @returns Normalized ORDER BY clause
   */
  normalizeOrderBy(
    orderBy: OrderBy | undefined,
  ): OrderBy | undefined {
    return orderBy;
  }

  /**
   * Normalize LIMIT
   *
   * Future: Could apply max limits, default limits
   * For now: Pass-through
   *
   * @param limit - Raw LIMIT value
   * @returns Normalized LIMIT value
   */
  normalizeLimit(limit: number | undefined): number | undefined {
    return limit;
  }

  /**
   * Normalize OFFSET
   *
   * Future: Could validate max offset
   * For now: Pass-through
   *
   * @param offset - Raw OFFSET value
   * @returns Normalized OFFSET value
   */
  normalizeOffset(offset: number | undefined): number | undefined {
    return offset;
  }
}
