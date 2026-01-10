import {
  QueryObject,
  WhereClause,
  OrderByItem,
  ComparisonOperators
} from 'forja-types/core/query-builder';

export class JsonQueryRunner {

  run<T>(data: T[], query: QueryObject): T[] {
    let result = [...data];

    // 1. Filter
    if (query.where) {
      result = result.filter(item => this.match(item, query.where!));
    }

    // 3. Project & Distinct
    if (query.select || query.distinct) {
      result = this.project(result, query.select, query.distinct);
    }

    // 4. Sort
    if (query.orderBy && query.orderBy.length > 0) {
      result.sort((a, b) => this.sort(a, b, query.orderBy!));
    }

    // 5. Offset/Limit
    const offset = query.offset ?? 0;
    const limit = query.limit;

    if (query.limit !== undefined) {
      result = result.slice(offset, offset + limit);
    } else if (offset > 0) {
      result = result.slice(offset);
    }

    return result;
  }

  // Exposed for Adapter's RETURNING clause usage
  public projectData<T>(data: T[], select?: readonly string[] | '*', distinct?: boolean): Partial<T>[] {
    return this.project(data, select, distinct);
  }

  private project<T>(data: T[], select?: readonly string[] | '*', distinct?: boolean): any[] {
    let result: any[] = data;

    // Projection
    if (select && select !== '*') {
      result = data.map(item => {
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
      result = result.filter(item => {
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
      if (key === '$and') {
        if (!(value as WhereClause[]).every(cond => this.match(item, cond))) return false;
        continue;
      }
      if (key === '$or') {
        if (!(value as WhereClause[]).some(cond => this.match(item, cond))) return false;
        continue;
      }
      if (key === '$not') {
        if (this.match(item, value as WhereClause)) return false;
        continue;
      }

      // Field check
      const itemValue = item[key];

      if (value === null) {
        if (itemValue !== null && itemValue !== undefined) return false;
      } else if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        // Operators
        if (!this.matchOperators(itemValue, value as ComparisonOperators)) return false;
      } else {
        // Direct equality
        if (itemValue !== value) return false;
      }
    }
    return true;
  }

  private matchOperators(value: any, operators: ComparisonOperators): boolean {
    for (const [op, opValue] of Object.entries(operators)) {
      switch (op) {
        case '$eq':
          if (value !== opValue) return false;
          break;
        case '$ne':
          if (value === opValue) return false;
          break;
        case '$gt':
          if (!(value > opValue)) return false;
          break;
        case '$gte':
          if (!(value >= opValue)) return false;
          break;
        case '$lt':
          if (!(value < opValue)) return false;
          break;
        case '$lte':
          if (!(value <= opValue)) return false;
          break;
        case '$in':
          if (!(opValue as any[]).includes(value)) return false;
          break;
        case '$nin':
          if ((opValue as any[]).includes(value)) return false;
          break;
        case '$exists':
          if (opValue && (value === undefined || value === null)) return false;
          if (!opValue && (value !== undefined && value !== null)) return false;
          break;
        case '$null':
          // Checks if value is null
          if (opValue && value !== null) return false;
          if (!opValue && value === null) return false;
          break;
        case '$like':
        case '$ilike':
          const pattern = (opValue as string).replace(/%/g, '.*').replace(/_/g, '.');
          const flags = op === '$ilike' ? 'i' : '';
          const regex = new RegExp(`^${pattern}$`, flags);
          if (!regex.test(String(value ?? ''))) return false;
          break;
        // Add others if needed
      }
    }
    return true;
  }

  private sort(a: any, b: any, orderBy: readonly OrderByItem[]): number {
    for (const order of orderBy) {
      const valA = a[order.field];
      const valB = b[order.field];

      if (valA === valB) continue;

      const direction = order.direction === 'asc' ? 1 : -1;

      if (valA === null || valA === undefined) return order.nulls === 'first' ? -1 : 1;
      if (valB === null || valB === undefined) return order.nulls === 'first' ? 1 : -1;

      if (valA < valB) return -1 * direction;
      if (valA > valB) return 1 * direction;
    }
    return 0;
  }
}
