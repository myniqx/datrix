import {
  QueryObject,
  WhereClause,
  OrderByItem,
  ComparisonOperators,
} from "forja-types/core/query-builder";
import { JsonTableFile } from "./types";

export class JsonQueryRunner {
  constructor(private table: JsonTableFile) { }

  run<T = Record<string, unknown>>(query: QueryObject): T[] {
    let result = this.table.data as T[];

    // 1. Filter
    if (query.where) {
      result = result.filter((item) => this.match(item, query.where!));
    } else if (query.orderBy && query.orderBy.length > 0) {
      // No filter but need sort - must copy to avoid mutating original
      result = [...result];
    }

    // 3. Project & Distinct
    if (query.select || query.distinct) {
      result = this.project(result, query.select, query.distinct);
    }

    // 4. Sort (mutates array in-place)
    if (query.orderBy && query.orderBy.length > 0) {
      result.sort((a, b) => this.sort(a, b, query.orderBy!));
    }

    // 5. Offset/Limit
    const offset = query.offset ?? 0;

    if (query.limit !== undefined) {
      result = result.slice(offset, offset + query.limit);
    } else if (offset > 0) {
      result = result.slice(offset);
    }

    return result;
  }

  /**
   * Run query without projection (for populate workflow)
   * Applies WHERE, ORDER BY, OFFSET, LIMIT but keeps all fields
   */
  filterAndSort<T = Record<string, unknown>>(query: QueryObject): T[] {
    let result = this.table.data as T[];

    // 1. Filter
    if (query.where) {
      result = result.filter((item) => this.match(item, query.where!));
    } else if (query.orderBy && query.orderBy.length > 0) {
      // No filter but need sort - must copy to avoid mutating original
      result = [...result];
    }

    // 2. Sort (mutates array in-place)
    if (query.orderBy && query.orderBy.length > 0) {
      result.sort((a, b) => this.sort(a, b, query.orderBy!));
    }

    // 3. Offset/Limit
    const offset = query.offset ?? 0;

    if (query.limit !== undefined) {
      result = result.slice(offset, offset + query.limit);
    } else if (offset > 0) {
      result = result.slice(offset);
    }

    return result;
  }

  // Exposed for Adapter's RETURNING clause usage
  public projectData<T>(
    data: T[],
    select?: readonly string[] | "*",
    distinct?: boolean,
  ): Partial<T>[] {
    return this.project(data, select, distinct);
  }

  private project<T>(
    data: T[],
    select?: readonly string[] | "*",
    distinct?: boolean,
  ): any[] {
    let result: any[] = data;

    // Projection
    if (select && select !== "*") {
      result = data.map((item) => {
        const projected: any = {};
        for (const field of select) {
          if (field in (item as any)) {
            projected[field] = (item as any)[field];
          }
        }
        return projected;
      });
    }

    // Distinct
    if (distinct) {
      const seen = new Set<string>();
      result = result.filter((item) => {
        const key = JSON.stringify(item); // Simple serialization for distinct check
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    return result;
  }

  private match(item: any, where: WhereClause): boolean {
    for (const [key, value] of Object.entries(where)) {
      if (key === "$and") {
        if (!(value as WhereClause[]).every((cond) => this.match(item, cond)))
          return false;
        continue;
      }
      if (key === "$or") {
        if (!(value as WhereClause[]).some((cond) => this.match(item, cond)))
          return false;
        continue;
      }
      if (key === "$not") {
        if (this.match(item, value as WhereClause)) return false;
        continue;
      }

      // Field check
      const itemValue = item[key];

      if (value === null) {
        if (itemValue !== null && itemValue !== undefined) return false;
      } else if (
        typeof value === "object" &&
        !Array.isArray(value) &&
        !(value instanceof Date)
      ) {
        // Operators
        if (!this.matchOperators(itemValue, value as ComparisonOperators, key))
          return false;
      } else {
        // Direct equality - type-aware comparison
        if (!this.compareValues(itemValue, value, key)) return false;
      }
    }
    return true;
  }

  private compareValues(
    itemValue: any,
    queryValue: any,
    fieldName: string,
  ): boolean {
    const schema = this.table.schema as any;
    const fieldDef = schema?.fields?.[fieldName];

    // No schema or field definition - use strict equality
    if (!fieldDef) {
      return itemValue === queryValue;
    }

    // Type coercion based on field type
    const fieldType = fieldDef.type;

    if (fieldType === "number") {
      const itemNum = Number(itemValue);
      const queryNum = Number(queryValue);
      return !isNaN(itemNum) && !isNaN(queryNum) && itemNum === queryNum;
    }

    if (fieldType === "string") {
      return String(itemValue) === String(queryValue);
    }

    if (fieldType === "boolean") {
      return Boolean(itemValue) === Boolean(queryValue);
    }

    // Default: strict equality
    return itemValue === queryValue;
  }

  private matchOperators(
    value: any,
    operators: ComparisonOperators,
    fieldName: string,
  ): boolean {
    for (const [op, opValue] of Object.entries(operators)) {
      switch (op) {
        case "$eq":
          if (!this.compareValues(value, opValue, fieldName)) return false;
          break;
        case "$ne":
          if (this.compareValues(value, opValue, fieldName)) return false;
          break;
        case "$gt":
          if (
            !(
              this.coerceForComparison(value, fieldName) >
              this.coerceForComparison(opValue, fieldName)
            )
          )
            return false;
          break;
        case "$gte":
          if (
            !(
              this.coerceForComparison(value, fieldName) >=
              this.coerceForComparison(opValue, fieldName)
            )
          )
            return false;
          break;
        case "$lt":
          if (
            !(
              this.coerceForComparison(value, fieldName) <
              this.coerceForComparison(opValue, fieldName)
            )
          )
            return false;
          break;
        case "$lte":
          if (
            !(
              this.coerceForComparison(value, fieldName) <=
              this.coerceForComparison(opValue, fieldName)
            )
          )
            return false;
          break;
        case "$in": {
          const coercedValue = this.coerceForComparison(value, fieldName);
          const coercedArray = (opValue as unknown[]).map((v) =>
            this.coerceForComparison(v, fieldName),
          );
          if (!coercedArray.includes(coercedValue)) return false;
          break;
        }
        case "$nin": {
          const coercedValue = this.coerceForComparison(value, fieldName);
          const coercedArray = (opValue as unknown[]).map((v) =>
            this.coerceForComparison(v, fieldName),
          );
          if (coercedArray.includes(coercedValue)) return false;
          break;
        }
        case "$exists":
          if (opValue && (value === undefined || value === null)) return false;
          if (!opValue && value !== undefined && value !== null) return false;
          break;
        case "$null":
          // Checks if value is null
          if (opValue && value !== null) return false;
          if (!opValue && value === null) return false;
          break;
        case "$like":
        case "$ilike": {
          const pattern = (opValue as string).replace(/%/g, ".*").replace(/_/g, ".");
          const flags = op === "$ilike" ? "i" : "";
          const regex = new RegExp(`^${pattern}$`, flags);
          if (!regex.test(String(value ?? ""))) return false;
          break;
        }
        case "$contains":
          if (!String(value ?? "").includes(String(opValue))) return false;
          break;
        case "$notContains":
          if (String(value ?? "").includes(String(opValue))) return false;
          break;
        case "$startsWith":
          if (!String(value ?? "").startsWith(String(opValue))) return false;
          break;
        case "$endsWith":
          if (!String(value ?? "").endsWith(String(opValue))) return false;
          break;
        case "$notNull":
          if (opValue && value === null) return false;
          if (!opValue && value !== null) return false;
          break;
      }
    }
    return true;
  }

  private coerceForComparison(value: any, fieldName: string): any {
    const schema = this.table.schema as any;
    const fieldDef = schema?.fields?.[fieldName];

    if (!fieldDef) return value;

    const fieldType = fieldDef.type;

    if (fieldType === "number") {
      const num = Number(value);
      return isNaN(num) ? value : num;
    }

    if (fieldType === "string") {
      return String(value);
    }

    return value;
  }

  private sort(a: any, b: any, orderBy: readonly OrderByItem[]): number {
    for (const order of orderBy) {
      const fieldName = order.field;
      const valA = this.coerceForComparison(a[fieldName], fieldName);
      const valB = this.coerceForComparison(b[fieldName], fieldName);

      if (valA === valB) continue;

      const direction = order.direction === "asc" ? 1 : -1;

      if (valA === null || valA === undefined)
        return order.nulls === "first" ? -1 : 1;
      if (valB === null || valB === undefined)
        return order.nulls === "first" ? 1 : -1;

      if (valA < valB) return -1 * direction;
      if (valA > valB) return 1 * direction;
    }
    return 0;
  }
}
