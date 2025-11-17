/**
 * PostgreSQL Query Translator (~350 LOC)
 *
 * Translates database-agnostic QueryObject to PostgreSQL SQL.
 * Handles WHERE clauses, JOINs, pagination, and all operators.
 */

import type {
  QueryObject,
  QueryTranslator,
  WhereClause,
  SelectClause,
  ComparisonOperators
} from '../base/types';
import type {
  QueryObject as BuilderQueryObject,
  OrderByItem
} from '@core/query-builder/types';
import { QueryError } from '../base/types';

/**
 * PostgreSQL query translator implementation
 */
export class PostgresQueryTranslator implements QueryTranslator {
  private paramIndex = 0;
  private params: unknown[] = [];

  /**
   * Reset state for new query
   */
  private reset(): void {
    this.paramIndex = 0;
    this.params = [];
  }

  /**
   * Get parameter placeholder ($1, $2, etc.)
   */
  getParameterPlaceholder(index: number): string {
    return `$${index}`;
  }

  /**
   * Add parameter and return placeholder
   */
  private addParam(value: unknown): string {
    this.paramIndex++;
    this.params.push(value);
    return this.getParameterPlaceholder(this.paramIndex);
  }

  /**
   * Escape identifier (table/column name)
   */
  escapeIdentifier(identifier: string): string {
    // Escape double quotes and wrap in double quotes
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  /**
   * Escape string value (for literals)
   */
  escapeValue(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    if (typeof value === 'string') {
      return `'${value.replace(/'/g, "''")}'`;
    }

    if (typeof value === 'number') {
      return String(value);
    }

    if (typeof value === 'boolean') {
      return value ? 'TRUE' : 'FALSE';
    }

    if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    }

    if (Array.isArray(value)) {
      return `ARRAY[${value.map((v) => this.escapeValue(v)).join(', ')}]`;
    }

    // Objects as JSONB
    return `'${JSON.stringify(value)}'::jsonb`;
  }

  /**
   * Translate main query
   */
  translate(query: QueryObject | BuilderQueryObject): {
    readonly sql: string;
    readonly params: readonly unknown[];
  } {
    this.reset();

    try {
      let sql: string;

      switch (query.type) {
        case 'select':
        case 'count':
          sql = this.translateSelect(query);
          break;
        case 'insert':
          sql = this.translateInsert(query);
          break;
        case 'update':
          sql = this.translateUpdate(query);
          break;
        case 'delete':
          sql = this.translateDelete(query);
          break;
        default:
          throw new QueryError(`Unsupported query type: ${String((query as {type: string}).type)}`);
      }

      return {
        sql,
        params: [...this.params]
      };
    } catch (error) {
      if (error instanceof QueryError) {
        throw error;
      }
      throw new QueryError(
        `Query translation failed: ${error instanceof Error ? error.message : String(error)}`,
        { query: query as QueryObject }
      );
    }
  }

  /**
   * Translate SELECT query
   */
  private translateSelect(query: QueryObject | BuilderQueryObject): string {
    const parts: string[] = [];

    // SELECT clause
    if (query.type === 'count') {
      parts.push('SELECT COUNT(*)');
    } else {
      parts.push(`SELECT ${this.translateSelectClause(query.select)}`);
    }

    // DISTINCT
    if ('distinct' in query && query.distinct) {
      parts[0] = parts[0]!.replace('SELECT', 'SELECT DISTINCT');
    }

    // FROM clause
    parts.push(`FROM ${this.escapeIdentifier(query.table)}`);

    // WHERE clause
    if (query.where) {
      const whereResult = this.translateWhere(query.where, this.paramIndex);
      parts.push(`WHERE ${whereResult.sql}`);
      this.paramIndex += whereResult.params.length;
      this.params.push(...whereResult.params);
    }

    // GROUP BY
    if ('groupBy' in query && query.groupBy && query.groupBy.length > 0) {
      const groupByFields = query.groupBy
        .map((field) => this.escapeIdentifier(field))
        .join(', ');
      parts.push(`GROUP BY ${groupByFields}`);
    }

    // HAVING
    if ('having' in query && query.having) {
      const havingResult = this.translateWhere(query.having, this.paramIndex);
      parts.push(`HAVING ${havingResult.sql}`);
      this.paramIndex += havingResult.params.length;
      this.params.push(...havingResult.params);
    }

    // ORDER BY
    if (query.orderBy && query.orderBy.length > 0) {
      parts.push(`ORDER BY ${this.translateOrderBy(query.orderBy)}`);
    }

    // LIMIT
    if (query.limit !== undefined) {
      parts.push(`LIMIT ${this.addParam(query.limit)}`);
    }

    // OFFSET
    if (query.offset !== undefined) {
      parts.push(`OFFSET ${this.addParam(query.offset)}`);
    }

    return parts.join(' ');
  }

  /**
   * Translate INSERT query
   */
  private translateInsert(query: QueryObject | BuilderQueryObject): string {
    if (!query.data || Object.keys(query.data).length === 0) {
      throw new QueryError('INSERT query requires data');
    }

    const parts: string[] = [];
    const columns: string[] = [];
    const values: string[] = [];

    for (const [key, value] of Object.entries(query.data)) {
      columns.push(this.escapeIdentifier(key));
      values.push(this.addParam(value));
    }

    parts.push(`INSERT INTO ${this.escapeIdentifier(query.table)}`);
    parts.push(`(${columns.join(', ')})`);
    parts.push(`VALUES (${values.join(', ')})`);

    // RETURNING clause
    if (query.returning) {
      parts.push(`RETURNING ${this.translateSelectClause(query.returning)}`);
    }

    return parts.join(' ');
  }

  /**
   * Translate UPDATE query
   */
  private translateUpdate(query: QueryObject | BuilderQueryObject): string {
    if (!query.data || Object.keys(query.data).length === 0) {
      throw new QueryError('UPDATE query requires data');
    }

    const parts: string[] = [];
    const sets: string[] = [];

    parts.push(`UPDATE ${this.escapeIdentifier(query.table)}`);

    for (const [key, value] of Object.entries(query.data)) {
      sets.push(`${this.escapeIdentifier(key)} = ${this.addParam(value)}`);
    }

    parts.push(`SET ${sets.join(', ')}`);

    // WHERE clause (important for UPDATE!)
    if (query.where) {
      const whereResult = this.translateWhere(query.where, this.paramIndex);
      parts.push(`WHERE ${whereResult.sql}`);
      this.paramIndex += whereResult.params.length;
      this.params.push(...whereResult.params);
    }

    // RETURNING clause
    if (query.returning) {
      parts.push(`RETURNING ${this.translateSelectClause(query.returning)}`);
    }

    return parts.join(' ');
  }

  /**
   * Translate DELETE query
   */
  private translateDelete(query: QueryObject | BuilderQueryObject): string {
    const parts: string[] = [];

    parts.push(`DELETE FROM ${this.escapeIdentifier(query.table)}`);

    // WHERE clause (important for DELETE!)
    if (query.where) {
      const whereResult = this.translateWhere(query.where, this.paramIndex);
      parts.push(`WHERE ${whereResult.sql}`);
      this.paramIndex += whereResult.params.length;
      this.params.push(...whereResult.params);
    }

    // RETURNING clause
    if (query.returning) {
      parts.push(`RETURNING ${this.translateSelectClause(query.returning)}`);
    }

    return parts.join(' ');
  }

  /**
   * Translate SELECT clause
   */
  private translateSelectClause(select: SelectClause | undefined): string {
    if (!select || select === '*') {
      return '*';
    }

    return select.map((field) => this.escapeIdentifier(field)).join(', ');
  }

  /**
   * Translate ORDER BY clause
   */
  private translateOrderBy(orderBy: readonly OrderByItem[]): string {
    return orderBy
      .map((item) => {
        let sql = this.escapeIdentifier(item.field);
        sql += ` ${item.direction.toUpperCase()}`;
        if (item.nulls) {
          sql += ` NULLS ${item.nulls.toUpperCase()}`;
        }
        return sql;
      })
      .join(', ');
  }

  /**
   * Translate WHERE clause
   */
  translateWhere(
    where: WhereClause,
    startIndex: number
  ): {
    readonly sql: string;
    readonly params: readonly unknown[];
  } {
    const savedIndex = this.paramIndex;
    const savedParams = [...this.params];

    this.paramIndex = startIndex;
    this.params = [];

    try {
      const sql = this.translateWhereConditions(where);
      const params = [...this.params];

      // Restore state
      this.paramIndex = savedIndex;
      this.params = savedParams;

      return { sql, params };
    } catch (error) {
      // Restore state on error
      this.paramIndex = savedIndex;
      this.params = savedParams;
      throw error;
    }
  }

  /**
   * Translate WHERE conditions recursively
   */
  private translateWhereConditions(where: WhereClause): string {
    const conditions: string[] = [];

    for (const [key, value] of Object.entries(where)) {
      // Handle logical operators
      if (key === '$and') {
        const andConditions = (value as readonly WhereClause[])
          .map((condition) => `(${this.translateWhereConditions(condition)})`)
          .join(' AND ');
        conditions.push(`(${andConditions})`);
        continue;
      }

      if (key === '$or') {
        const orConditions = (value as readonly WhereClause[])
          .map((condition) => `(${this.translateWhereConditions(condition)})`)
          .join(' OR ');
        conditions.push(`(${orConditions})`);
        continue;
      }

      if (key === '$not') {
        const notCondition = this.translateWhereConditions(value as WhereClause);
        conditions.push(`NOT (${notCondition})`);
        continue;
      }

      // Handle field conditions
      const fieldName = this.escapeIdentifier(key);

      // Handle comparison operators
      if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)) {
        const ops = value as ComparisonOperators;
        for (const [operator, opValue] of Object.entries(ops)) {
          conditions.push(this.translateComparisonOperator(fieldName, operator, opValue));
        }
      } else {
        // Simple equality
        if (value === null) {
          conditions.push(`${fieldName} IS NULL`);
        } else {
          conditions.push(`${fieldName} = ${this.addParam(value)}`);
        }
      }
    }

    return conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';
  }

  /**
   * Translate comparison operator
   */
  private translateComparisonOperator(
    fieldName: string,
    operator: string,
    value: unknown
  ): string {
    switch (operator) {
      case '$eq':
        return value === null
          ? `${fieldName} IS NULL`
          : `${fieldName} = ${this.addParam(value)}`;

      case '$ne':
        return value === null
          ? `${fieldName} IS NOT NULL`
          : `${fieldName} <> ${this.addParam(value)}`;

      case '$gt':
        return `${fieldName} > ${this.addParam(value)}`;

      case '$gte':
        return `${fieldName} >= ${this.addParam(value)}`;

      case '$lt':
        return `${fieldName} < ${this.addParam(value)}`;

      case '$lte':
        return `${fieldName} <= ${this.addParam(value)}`;

      case '$in':
        if (!Array.isArray(value)) {
          throw new QueryError(`$in operator requires array value`);
        }
        if (value.length === 0) {
          return 'FALSE';
        }
        return `${fieldName} IN (${value.map((v) => this.addParam(v)).join(', ')})`;

      case '$nin':
        if (!Array.isArray(value)) {
          throw new QueryError(`$nin operator requires array value`);
        }
        if (value.length === 0) {
          return 'TRUE';
        }
        return `${fieldName} NOT IN (${value.map((v) => this.addParam(v)).join(', ')})`;

      case '$like':
        return `${fieldName} LIKE ${this.addParam(value)}`;

      case '$ilike':
        return `${fieldName} ILIKE ${this.addParam(value)}`;

      case '$regex':
        if (value instanceof RegExp) {
          return `${fieldName} ~ ${this.addParam(value.source)}`;
        }
        return `${fieldName} ~ ${this.addParam(value)}`;

      case '$exists':
        return value ? `${fieldName} IS NOT NULL` : `${fieldName} IS NULL`;

      case '$null':
        return value ? `${fieldName} IS NULL` : `${fieldName} IS NOT NULL`;

      default:
        throw new QueryError(`Unsupported operator: ${operator}`);
    }
  }
}

/**
 * Create a new PostgreSQL query translator
 */
export function createPostgresTranslator(): PostgresQueryTranslator {
  return new PostgresQueryTranslator();
}
