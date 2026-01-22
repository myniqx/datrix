import { QueryObject } from "forja-types/core/query-builder";
import type { JsonAdapter } from "./adapter";
import { Forja, ForjaError } from "forja-core";
import type { RelationField } from "forja-types/core/schema";

export class JsonPopulator {
  constructor(private adapter: JsonAdapter) { }

  async populate(
    rows: Record<string, unknown>[],
    query: QueryObject,
  ): Promise<Record<string, unknown>[]> {
    if (!query.populate || rows.length === 0) {
      return rows;
    }

    const schemaRegistry = Forja.getInstance().getSchemas();

    // Find current schema from table name
    const currentModelName = schemaRegistry.findModelByTableName(query.table);
    if (!currentModelName) {
      throw new ForjaError(
        `Model not found for table: ${query.table}`,
        "MODEL_NOT_FOUND",
      );
    }

    const currentSchema = schemaRegistry.get(currentModelName);
    if (!currentSchema) {
      throw new ForjaError(
        `Schema not found for model: ${currentModelName}`,
        "SCHEMA_NOT_FOUND",
      );
    }

    const result = [...rows];

    for (const [relationName, _options] of Object.entries(query.populate)) {
      // Get relation field from current schema
      const relationField = currentSchema.fields[relationName];
      if (!relationField) {
        throw new ForjaError(
          `Relation field '${relationName}' not found in schema '${currentSchema.name}'`,
          "RELATION_FIELD_NOT_FOUND",
        );
      }

      if (relationField.type !== "relation") {
        throw new ForjaError(
          `Field '${relationName}(type: ${relationField.type})' is not a relation field in schema '${currentSchema.name}'`,
          "INVALID_RELATION_TYPE",
        );
      }

      const relField = relationField as RelationField;
      const targetModelName = relField.model;
      const foreignKey = relField.foreignKey;
      const kind = relField.kind;

      // Get target schema
      const targetSchema = schemaRegistry.get(targetModelName);
      if (!targetSchema) {
        throw new ForjaError(
          `Target model '${targetModelName}' not found for relation '${relationName}' in schema '${currentSchema.name}'`,
          "TARGET_MODEL_NOT_FOUND",
        );
      }

      const targetTable = targetSchema.tableName ?? targetModelName.toLowerCase();

      // Load target table using adapter's cache
      const tableData = await this.adapter.getCachedTable(targetTable);
      if (!tableData) continue;

      const relatedData = tableData.data as Record<string, unknown>[];

      // NOTE: We no longer apply select here - it's handled by adapter's applySelectRecursive
      // This ensures proper handling of nested populate + select combinations

      // Map data based on relation type
      if (kind === "belongsTo") {
        // Source has FK (e.g. Post.authorId -> User.id)
        const ids = new Set(
          result
            .map((r) => r[foreignKey])
            .filter((id): id is string | number => id !== null && id !== undefined),
        );

        const relatedMap = new Map<string | number, Record<string, unknown>>();
        if (ids.size > 0) {
          for (const item of relatedData) {
            const itemId = item["id"] as string | number;
            if (ids.has(itemId)) {
              relatedMap.set(itemId, item);
            }
          }
        }

        for (const row of result) {
          const fkValue = row[foreignKey] as string | number | null | undefined;
          if (fkValue !== null && fkValue !== undefined) {
            row[relationName] = relatedMap.get(fkValue) ?? null;
          } else {
            row[relationName] = null;
          }
        }
      } else if (kind === "hasMany" || kind === "hasOne") {
        // Target has FK (e.g. User.id <- Post.authorId)
        const sourceIds = new Set(
          result
            .map((r) => r["id"])
            .filter((id): id is string | number => id !== null && id !== undefined),
        );

        // Group related items by FK
        const grouped = new Map<string | number, Record<string, unknown>[]>();
        for (const item of relatedData) {
          const fkValue = item[foreignKey] as string | number | null | undefined;
          if (fkValue !== null && fkValue !== undefined && sourceIds.has(fkValue)) {
            const group = grouped.get(fkValue) ?? [];
            group.push(item);
            grouped.set(fkValue, group);
          }
        }

        for (const row of result) {
          const rowId = row["id"] as string | number;
          const group = grouped.get(rowId) ?? [];
          if (kind === "hasOne") {
            row[relationName] = group[0] ?? null;
          } else {
            row[relationName] = group;
          }
        }
      }

      // Nested populate (recursion)
      if (typeof _options === "object" && _options.populate) {
        const nextRows: Record<string, unknown>[] = [];
        for (const row of result) {
          const val = row[relationName];
          if (!val) continue;
          if (Array.isArray(val)) {
            nextRows.push(...(val as Record<string, unknown>[]));
          } else {
            nextRows.push(val as Record<string, unknown>);
          }
        }

        if (nextRows.length > 0) {
          await this.populate(nextRows, {
            type: "select",
            table: targetTable,
            populate: _options.populate,
          });
        }
      }
    }

    return result;
  }
}
