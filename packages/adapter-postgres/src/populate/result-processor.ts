/**
 * PostgreSQL Result Processor
 *
 * Processes query results from populate operations.
 * Handles JSON parsing and nested structure creation.
 */

import type { PopulateClause } from "forja-types/core/query-builder";
import type { SchemaRegistry } from "forja-core/schema";
import type { RelationField } from "forja-types/core/schema";
import { throwResultProcessingError } from "../error-helper";

/**
 * Result Processor Class
 *
 * Processes flat SQL results into nested structures with populated relations.
 */
export class ResultProcessor {
  constructor(private schemaRegistry: SchemaRegistry) {}

  /**
   * Process JSON aggregation results
   *
   * PostgreSQL json_agg() and row_to_json() return JSON strings.
   * This method parses them and handles nested populate.
   *
   * @param rows - Raw rows from database
   * @param populate - Populate clause
   * @returns Processed rows with parsed JSON relations
   */
  processJsonAggregation<T extends Record<string, unknown>>(
    rows: T[],
    populate: PopulateClause,
  ): readonly T[] {
    if (rows.length === 0) {
      return rows;
    }

    try {
      return rows.map((row) => this.processRow(row, populate));
    } catch (error) {
      throwResultProcessingError(
        "JSON aggregation parsing",
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Process a single row
   */
  private processRow<T extends Record<string, unknown>>(
    row: T,
    populate: PopulateClause,
  ): T {
    const processed = { ...row };

    for (const [relationName, options] of Object.entries(populate)) {
      const value = processed[relationName];

      // Skip if relation field doesn't exist or is already processed
      if (value === undefined) {
        continue;
      }

      // Parse JSON if it's a string
      if (typeof value === "string") {
        try {
          processed[relationName] = JSON.parse(value) as unknown;
        } catch {
          // Not JSON, leave as is
        }
      }

      // Handle nested populate recursively
      if (typeof options === "object" && options !== null && options.populate) {
        const relationValue = processed[relationName];

        if (Array.isArray(relationValue)) {
          // hasMany or manyToMany: process each item
          processed[relationName] = relationValue.map((item) =>
            this.processRow(item as Record<string, unknown>, options.populate!),
          ) as unknown;
        } else if (relationValue !== null && typeof relationValue === "object") {
          // belongsTo or hasOne: process single item
          processed[relationName] = this.processRow(
            relationValue as Record<string, unknown>,
            options.populate!,
          ) as unknown;
        }
      }

      // Clean up null values
      if (processed[relationName] === null) {
        // For arrays (hasMany/manyToMany), null should be empty array
        const relValue = row[relationName];
        if (Array.isArray(relValue) || this.isArrayRelation(relationName, row)) {
          processed[relationName] = [] as unknown;
        }
      }
    }

    return processed;
  }

  /**
   * Process flat JOIN results (fallback strategy)
   *
   * When using basic JOINs without aggregation, results come as flat rows.
   * This method groups them by primary key and nests relations.
   *
   * Example input (flat):
   * ```
   * [
   *   { post_id: 1, title: "A", comment_id: 1, text: "C1" },
   *   { post_id: 1, title: "A", comment_id: 2, text: "C2" },
   *   { post_id: 2, title: "B", comment_id: 3, text: "C3" }
   * ]
   * ```
   *
   * Example output (nested):
   * ```
   * [
   *   {
   *     id: 1,
   *     title: "A",
   *     comments: [
   *       { id: 1, text: "C1" },
   *       { id: 2, text: "C2" }
   *     ]
   *   },
   *   {
   *     id: 2,
   *     title: "B",
   *     comments: [{ id: 3, text: "C3" }]
   *   }
   * ]
   * ```
   */
  processFlatJoinResults<T extends Record<string, unknown>>(
    rows: Record<string, unknown>[],
    tableName: string,
    populate: PopulateClause,
    primaryKey = "id",
  ): readonly T[] {
    if (rows.length === 0) {
      return [] as readonly T[];
    }

    try {
      // Group rows by primary key
      const grouped = new Map<unknown, T>();

      for (const row of rows) {
        const pk = row[primaryKey];

        if (!grouped.has(pk)) {
          // First time seeing this primary key
          grouped.set(pk, this.extractMainRecord(row, tableName) as T);
        }

        const record = grouped.get(pk)!;

        // Attach relations
        this.attachRelations(record, row, tableName, populate);
      }

      return Array.from(grouped.values());
    } catch (error) {
      throwResultProcessingError(
        "flat JOIN result grouping",
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Extract main record fields from flat row
   */
  private extractMainRecord(
    row: Record<string, unknown>,
    tableName: string,
  ): Record<string, unknown> {
    // Get schema to know which fields belong to main table
    const modelName = this.schemaRegistry.findModelByTableName(tableName);
    if (!modelName) {
      // Fallback: extract fields without relation prefixes
      const mainRecord: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (!key.includes("_")) {
          mainRecord[key] = value;
        }
      }
      return mainRecord;
    }

    const schema = this.schemaRegistry.get(modelName);
    if (!schema) {
      return {};
    }

    // Extract only main table fields
    const mainRecord: Record<string, unknown> = {};
    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
      if (fieldDef.type !== "relation" && fieldName in row) {
        mainRecord[fieldName] = row[fieldName];
      }
    }

    return mainRecord;
  }

  /**
   * Attach relation data from flat row to main record
   */
  private attachRelations(
    record: Record<string, unknown>,
    row: Record<string, unknown>,
    tableName: string,
    populate: PopulateClause,
  ): void {
    const modelName = this.schemaRegistry.findModelByTableName(tableName);
    if (!modelName) {
      return;
    }

    const schema = this.schemaRegistry.get(modelName);
    if (!schema) {
      return;
    }

    for (const [relationName, _options] of Object.entries(populate)) {
      const relationField = schema.fields[relationName] as RelationField | undefined;
      if (!relationField || relationField.type !== "relation") {
        continue;
      }

      // Extract relation fields from flat row
      const relationData = this.extractRelationData(row, relationName);

      if (!relationData || Object.keys(relationData).length === 0) {
        continue;
      }

      const kind = relationField.kind;

      if (kind === "belongsTo" || kind === "hasOne") {
        // Single object
        record[relationName] = relationData;
      } else {
        // Array: hasMany or manyToMany
        if (!record[relationName]) {
          record[relationName] = [];
        }

        const arr = record[relationName] as Record<string, unknown>[];

        // Check if this relation record already exists (by id)
        const existingIndex = arr.findIndex(
          (item) => item["id"] === relationData["id"],
        );

        if (existingIndex === -1) {
          arr.push(relationData);
        }
      }
    }
  }

  /**
   * Extract relation fields from flat row
   *
   * Assumes relation fields are prefixed with `relationName_`
   */
  private extractRelationData(
    row: Record<string, unknown>,
    relationName: string,
  ): Record<string, unknown> | null {
    const prefix = `${relationName}_`;
    const relationData: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith(prefix)) {
        const fieldName = key.substring(prefix.length);
        relationData[fieldName] = value;
      }
    }

    // If all values are null, return null (no relation)
    const hasNonNullValue = Object.values(relationData).some(
      (v) => v !== null && v !== undefined,
    );

    return hasNonNullValue ? relationData : null;
  }

  /**
   * Check if relation is array type (hasMany or manyToMany)
   */
  private isArrayRelation(
    relationName: string,
    row: Record<string, unknown>,
  ): boolean {
    // Try to infer from schema
    // This is a fallback heuristic
    const value = row[relationName];

    // If it's already an array, return true
    if (Array.isArray(value)) {
      return true;
    }

    // Otherwise, assume it's not an array
    return false;
  }

  /**
   * Process LATERAL join results
   *
   * LATERAL joins return JSON in a specific column (e.g., `relation_data.data`)
   */
  processLateralResults<T extends Record<string, unknown>>(
    rows: T[],
    populate: PopulateClause,
  ): readonly T[] {
    if (rows.length === 0) {
      return rows;
    }

    try {
      return rows.map((row) => {
        const processed = { ...row };

        for (const relationName of Object.keys(populate)) {
          // LATERAL results come from `${relationName}_data.data`
          const lateralKey = `${relationName}_data`;

          if (lateralKey in processed) {
            const lateralData = processed[lateralKey] as
              | Record<string, unknown>
              | undefined;

            if (lateralData && "data" in lateralData) {
              processed[relationName] = lateralData["data"] as unknown;
            }

            // Clean up the lateral key
            delete processed[lateralKey];
          }
        }

        return processed;
      });
    } catch (error) {
      throwResultProcessingError(
        "LATERAL result processing",
        error instanceof Error ? error : undefined,
      );
    }
  }
}
