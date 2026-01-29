/**
 * PostgreSQL Query Translator (~350 LOC)
 *
 * Translates database-agnostic QueryObject to PostgreSQL SQL.
 * Handles WHERE clauses, JOINs, pagination, and all operators.
 */

import type {
  QueryObject,
  WhereClause,
  SelectClause,
  ComparisonOperators,
  OrderByItem,
} from "forja-types/core/query-builder";
import type { QueryTranslator } from "forja-types/adapter";
import { QueryError } from "forja-types/adapter";
import type { SchemaRegistry } from "forja-core/schema";
import { ForjaEntry } from "forja-types";
import { PostgresQueryObject, TranslateResult } from "./types";

/**
 * Maximum nesting depth for WHERE clauses to prevent stack overflow
 */
const MAX_WHERE_DEPTH = 10;

/**
 * PostgreSQL query translator implementation
 */
export class PostgresQueryTranslator implements QueryTranslator {
  private paramIndex = 0;
  private params: unknown[] = [];
  private schemaRegistry: SchemaRegistry;

  constructor(schemaRegistry: SchemaRegistry) {
    this.schemaRegistry = schemaRegistry;
  }

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

    // Convert arrays and objects to JSON string for PostgreSQL JSONB
    let processedValue = value;
    if (Array.isArray(value) || (typeof value === 'object' && value !== null && !(value instanceof Date))) {
      processedValue = JSON.stringify(value);
    } else if (typeof value === 'string') {
      // Try to parse numeric strings to avoid type mismatch with INTEGER columns
      // This handles cases where API sends "123" instead of 123
      const numValue = Number(value);
      if (!isNaN(numValue) && value.trim() !== '') {
        processedValue = numValue;
      }
    }

    this.params.push(processedValue);
    return this.getParameterPlaceholder(this.paramIndex);
  }

  /**
   * Escape identifier (table/column name)
   */
  escapeIdentifier(identifier: string): string {
    // Handle wildcard
    if (identifier === "*") {
      return "*";
    }

    // Validate identifier format (PostgreSQL naming rules)
    // Must start with letter or underscore, followed by letters, digits, or underscores
    // Maximum length is 63 characters
    const validIdentifierPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

    if (!validIdentifierPattern.test(identifier)) {
      throw new QueryError(
        `Invalid identifier '${identifier}': must start with letter or underscore, contain only alphanumeric characters and underscores`,
      );
    }

    if (identifier.length > 63) {
      throw new QueryError(
        `Invalid identifier '${identifier}': exceeds PostgreSQL maximum length of 63 characters`,
      );
    }

    // Escape double quotes and wrap in double quotes
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  /**
   * Escape string value (for literals)
   */
  escapeValue(value: unknown): string {
    if (value === null || value === undefined) {
      return "NULL";
    }

    if (typeof value === "string") {
      return `'${value.replace(/'/g, "''")}'`;
    }

    if (typeof value === "number") {
      return String(value);
    }

    if (typeof value === "boolean") {
      return value ? "TRUE" : "FALSE";
    }

    if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    }

    if (Array.isArray(value)) {
      // Arrays as JSONB (PostgreSQL JSONB handles arrays natively)
      return `'${JSON.stringify(value)}'::jsonb`;
    }

    // Objects as JSONB
    return `'${JSON.stringify(value)}'::jsonb`;
  }

  /**
   * Translate main query
   */
  translate<T extends ForjaEntry>(query: PostgresQueryObject<T>): TranslateResult {
    this.reset();

    try {
      let sql: string;

      switch (query.type) {
        case "select":
        case "count":
          sql = this.translateSelect(query);
          break;
        case "insert":
          sql = this.translateInsert(query);
          break;
        case "update":
          sql = this.translateUpdate(query);
          break;
        case "delete":
          sql = this.translateDelete(query);
          break;
        default:
          throw new QueryError(
            `Unsupported query type: ${String((query as { type: string }).type)}`,
          );
      }

      return {
        sql,
        params: [...this.params],
        needAggregation: false
      };
    } catch (error) {
      if (error instanceof QueryError) {
        throw error;
      }
      throw new QueryError(
        `Query translation failed: ${error instanceof Error ? error.message : String(error)}`,
        { query: query as QueryObject },
      );
    }
  }

  /**
   * Translate SELECT query
   */
  private translateSelect<T extends ForjaEntry>(query: PostgresQueryObject<T>): string {
    const parts: string[] = [];

    // SELECT clause
    if (query.type === "count") {
      parts.push("SELECT COUNT(*)");
    } else {
      const baseSelect = this.translateSelectClause(query.select, query.table);

      const metadata = query._metadata;
      const populateAggregations = metadata?.populateAggregations as string | undefined;

      if (populateAggregations) {
        parts.push(`SELECT ${baseSelect}, ${populateAggregations}`);
      } else {
        parts.push(`SELECT ${baseSelect}`);
      }
    }

    // DISTINCT
    if ("distinct" in query && query.distinct) {
      parts[0] = parts[0]!.replace("SELECT", "SELECT DISTINCT");
    }

    // FROM clause
    parts.push(`FROM ${this.escapeIdentifier(query.table)}`);

    // WHERE clause (must come before adding JOINs to parts, to collect WHERE JOINs)
    let whereSQL: string | undefined;
    let whereJoins: string[] = [];
    if (query.where) {
      const whereResult = this.translateWhere(query.where, this.paramIndex, query.table);
      whereSQL = whereResult.sql;
      whereJoins = whereResult.joins;
      this.paramIndex += whereResult.params.length;
      this.params.push(...whereResult.params);
    }

    // Add populate JOINs
    const metadata = query._metadata;
    const populateJoins = metadata?.populateJoins as string | undefined;

    if (populateJoins) {
      parts.push(populateJoins);
    }

    // Add WHERE JOINs (only if not already in populate JOINs)
    // This prevents duplicate JOINs when WHERE filters on populated relations
    if (whereJoins.length > 0) {
      const populateJoinSQL = populateJoins || "";
      const uniqueWhereJoins = whereJoins.filter(join => !populateJoinSQL.includes(join));

      if (uniqueWhereJoins.length > 0) {
        parts.push(uniqueWhereJoins.join(" "));
      }
    }

    // Add WHERE clause
    if (whereSQL) {
      parts.push(`WHERE ${whereSQL}`);
    }

    // GROUP BY (required for json_agg aggregations)
    const hasAggregations = metadata?.populateAggregations;
    if (hasAggregations && query.populate) {
      const tableEsc = this.escapeIdentifier(query.table);
      const groupByFields: string[] = [`${tableEsc}."id"`];

      // Add populated relation primary keys to GROUP BY
      // ONLY for belongsTo and hasOne (single record relations)
      // NOT for hasMany or manyToMany (array relations with json_agg)
      const modelName = this.schemaRegistry.findModelByTableName(query.table);
      if (modelName) {
        const schema = this.schemaRegistry.get(modelName);
        if (schema) {
          for (const relationName of Object.keys(query.populate)) {
            const field = schema.fields[relationName];
            if (field && field.type === "relation") {
              const relKind = (field as any).kind;
              // Only add to GROUP BY if it's a single-record relation
              if (relKind === "belongsTo" || relKind === "hasOne") {
                const relationAlias = this.escapeIdentifier(relationName);
                groupByFields.push(`${relationAlias}."id"`);
              }
            }
          }
        }
      }

      parts.push(`GROUP BY ${groupByFields.join(", ")}`);
    } else if ("groupBy" in query && query.groupBy && query.groupBy.length > 0) {
      const groupByFields = query.groupBy
        .map((field) => this.escapeIdentifier(field))
        .join(", ");
      parts.push(`GROUP BY ${groupByFields}`);
    }

    // HAVING
    if ("having" in query && query.having) {
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

    return parts.join(" ");
  }

  /**
   * Translate SELECT fields with aliases
   */
  private translateSelectClause(
    select: SelectClause | undefined,
    tableAlias?: string,
  ): string {
    if (!select || select === "*") {
      return tableAlias ? `${this.escapeIdentifier(tableAlias)}.*` : "*";
    }

    return select
      .map((field) => {
        const escaped = this.escapeIdentifier(field);
        return tableAlias ?
          `${this.escapeIdentifier(tableAlias)}.${escaped}`
          : escaped;
      })
      .join(", ");
  }


  /**
   * Translate INSERT query
   */
  private translateInsert<T extends ForjaEntry>(query: PostgresQueryObject<T>): string {
    if (!query.data || Object.keys(query.data).length === 0) {
      throw new QueryError("INSERT query requires data");
    }

    const parts: string[] = [];
    const columns: string[] = [];
    const values: string[] = [];

    for (const [key, value] of Object.entries(query.data)) {
      columns.push(this.escapeIdentifier(key));
      values.push(this.addParam(value));
    }

    parts.push(`INSERT INTO ${this.escapeIdentifier(query.table)}`);
    parts.push(`(${columns.join(", ")})`);
    parts.push(`VALUES (${values.join(", ")})`);

    // RETURNING clause
    // - If query.returning is specified (raw query), use it
    // - Otherwise, default to returning only ID (adapter standardization)
    if (query.returning) {
      parts.push(`RETURNING ${this.translateSelectClause(query.returning)}`);
    } else {
      parts.push(`RETURNING id`);
    }

    return parts.join(" ");
  }

  /**
   * Translate UPDATE query
   */
  private translateUpdate<T extends ForjaEntry>(query: PostgresQueryObject<T>): string {
    if (!query.data || Object.keys(query.data).length === 0) {
      throw new QueryError("UPDATE query requires data");
    }

    const parts: string[] = [];
    const sets: string[] = [];

    parts.push(`UPDATE ${this.escapeIdentifier(query.table)}`);

    for (const [key, value] of Object.entries(query.data)) {
      sets.push(`${this.escapeIdentifier(key)} = ${this.addParam(value)}`);
    }

    parts.push(`SET ${sets.join(", ")}`);

    // WHERE clause (important for UPDATE!)
    if (query.where) {
      const whereResult = this.translateWhere(query.where, this.paramIndex, query.table);

      // Add WHERE JOINs if any
      if (whereResult.joins.length > 0) {
        parts.push(whereResult.joins.join(" "));
      }

      parts.push(`WHERE ${whereResult.sql}`);
      this.paramIndex += whereResult.params.length;
      this.params.push(...whereResult.params);
    }

    // RETURNING clause
    if (query.returning) {
      parts.push(`RETURNING ${this.translateSelectClause(query.returning)}`);
    }

    return parts.join(" ");
  }

  /**
   * Translate DELETE query
   */
  private translateDelete<T extends ForjaEntry>(query: PostgresQueryObject<T>): string {
    const parts: string[] = [];

    parts.push(`DELETE FROM ${this.escapeIdentifier(query.table)}`);

    // WHERE clause (important for DELETE!)
    if (query.where) {
      const whereResult = this.translateWhere(query.where, this.paramIndex, query.table);

      // Add WHERE JOINs if any
      if (whereResult.joins.length > 0) {
        parts.push(whereResult.joins.join(" "));
      }

      parts.push(`WHERE ${whereResult.sql}`);
      this.paramIndex += whereResult.params.length;
      this.params.push(...whereResult.params);
    }

    // RETURNING clause
    if (query.returning) {
      parts.push(`RETURNING ${this.translateSelectClause(query.returning)}`);
    }

    return parts.join(" ");
  }

  /**
   * Translate SELECT clause
   */

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
      .join(", ");
  }

  /**
   * Translate WHERE clause
   */
  translateWhere<T extends ForjaEntry>(
    where: WhereClause<T>,
    startIndex: number,
    tableName?: string,
  ): {
    readonly sql: string;
    readonly params: readonly unknown[];
    readonly joins: string[];
  } {
    const savedIndex = this.paramIndex;
    const savedParams = [...this.params];

    this.paramIndex = startIndex;
    this.params = [];
    const whereJoins: string[] = [];

    try {
      const sql = this.translateWhereConditions(where, 0, tableName, undefined, whereJoins);
      const params = [...this.params];

      // Restore state
      this.paramIndex = savedIndex;
      this.params = savedParams;

      return { sql, params, joins: whereJoins };
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
  private translateWhereConditions<T extends ForjaEntry>(
    where: WhereClause<T>,
    depth = 0,
    tableName?: string,
    tableAlias?: string,
    joins?: string[],
  ): string {
    // Check depth limit to prevent stack overflow
    if (depth > MAX_WHERE_DEPTH) {
      throw new QueryError(
        `WHERE clause exceeds maximum nesting depth of ${MAX_WHERE_DEPTH}`,
      );
    }

    const conditions: string[] = [];
    const currentTableAlias = tableAlias || tableName;

    for (const [key, value] of Object.entries(where)) {
      // Handle logical operators
      if (key === "$and") {
        const andConditions = (value as readonly WhereClause[])
          .map(
            (condition) => `(${this.translateWhereConditions(condition, depth + 1, tableName, tableAlias, joins)})`,
          )
          .join(" AND ");
        conditions.push(`(${andConditions})`);
        continue;
      }

      if (key === "$or") {
        const orConditions = (value as readonly WhereClause[])
          .map(
            (condition) => `(${this.translateWhereConditions(condition, depth + 1, tableName, tableAlias, joins)})`,
          )
          .join(" OR ");
        conditions.push(`(${orConditions})`);
        continue;
      }

      if (key === "$not") {
        const notCondition = this.translateWhereConditions(
          value as WhereClause,
          depth + 1,
          tableName,
          tableAlias,
          joins,
        );
        conditions.push(`NOT (${notCondition})`);
        continue;
      }

      // Check if this is a relation field (needs schema lookup)
      if (tableName) {
        const modelName = this.schemaRegistry.findModelByTableName(tableName);
        if (modelName) {
          const schema = this.schemaRegistry.get(modelName);
          if (schema) {
            const field = schema.fields[key];

            if (field && field.type === "relation") {
              // Relation field with nested conditions
              const relationField = field as { foreignKey?: string; model?: string };

              // Case 1: Simple value (number/string) → foreign key equality
              // { category: 1 } → categoryId = 1
              if (
                typeof value === "number" ||
                typeof value === "string" ||
                value === null
              ) {
                if (relationField.foreignKey) {
                  const fkFieldName = this.escapeIdentifier(relationField.foreignKey);
                  const qualifiedFK = currentTableAlias ?
                    `${this.escapeIdentifier(currentTableAlias)}.${fkFieldName}` :
                    fkFieldName;

                  if (value === null) {
                    conditions.push(`${qualifiedFK} IS NULL`);
                  } else {
                    conditions.push(`${qualifiedFK} = ${this.addParam(value)}`);
                  }
                  continue;
                }
              }

              // Case 2: Nested object (relation filtering)
              if (
                typeof value === "object" &&
                value !== null &&
                !Array.isArray(value) &&
                !(value instanceof Date)
              ) {
                const nestedValue = value as Record<string, unknown>;

                // Check if this is a simple foreign key filter (id with operators)
                const hasOnlyId = Object.keys(nestedValue).length === 1 && "id" in nestedValue;

                if (hasOnlyId && relationField.foreignKey) {
                  // Simple case: { category: { id: { $ne: 1 } } } → categoryId <> 1
                  const idValue = nestedValue["id"];
                  const fkFieldName = this.escapeIdentifier(relationField.foreignKey);
                  const qualifiedFK = currentTableAlias ?
                    `${this.escapeIdentifier(currentTableAlias)}.${fkFieldName}` :
                    fkFieldName;

                  if (
                    typeof idValue === "object" &&
                    idValue !== null &&
                    !Array.isArray(idValue)
                  ) {
                    // Has operators: { id: { $ne: 1 } }
                    const ops = idValue as ComparisonOperators;
                    for (const [operator, opValue] of Object.entries(ops)) {
                      conditions.push(
                        this.translateComparisonOperator(qualifiedFK, operator, opValue),
                      );
                    }
                  } else {
                    // Simple equality: { id: 1 }
                    if (idValue === null) {
                      conditions.push(`${qualifiedFK} IS NULL`);
                    } else {
                      conditions.push(`${qualifiedFK} = ${this.addParam(idValue)}`);
                    }
                  }
                  continue;
                } else {
                  // Complex nested relation filtering - requires JOIN
                  const targetSchema = this.schemaRegistry.get(relationField.model);
                  if (!targetSchema) {
                    throw new QueryError(`Target model '${relationField.model}' not found for relation '${key}'`);
                  }

                  const targetTable = targetSchema.tableName ?? relationField.model.toLowerCase();
                  const foreignKey = relationField.foreignKey!;

                  const sourceTableEsc = this.escapeIdentifier(currentTableAlias || tableName!);
                  const targetTableEsc = this.escapeIdentifier(targetTable);
                  const relationAlias = this.escapeIdentifier(key);
                  const foreignKeyEsc = this.escapeIdentifier(foreignKey);

                  // Generate JOIN based on relation kind
                  let joinSQL: string;
                  const relKind = (relationField as any).kind;

                  if (relKind === "belongsTo") {
                    // Source has FK: source.foreignKey = target.id
                    joinSQL = `LEFT JOIN ${targetTableEsc} AS ${relationAlias} ON ${sourceTableEsc}.${foreignKeyEsc} = ${relationAlias}."id"`;
                  } else if (relKind === "hasOne" || relKind === "hasMany") {
                    // Target has FK: source.id = target.foreignKey
                    joinSQL = `LEFT JOIN ${targetTableEsc} AS ${relationAlias} ON ${sourceTableEsc}."id" = ${relationAlias}.${foreignKeyEsc}`;
                  } else {
                    throw new QueryError(`Relation kind '${relKind}' not yet supported for nested WHERE filtering`);
                  }

                  // Add JOIN to collection
                  if (joins && !joins.includes(joinSQL)) {
                    joins.push(joinSQL);
                  }

                  // Recursively translate nested conditions with relation table context
                  const nestedCondition = this.translateWhereConditions(
                    nestedValue as WhereClause,
                    depth + 1,
                    targetTable,
                    key, // Use relation name as alias
                    joins,
                  );

                  conditions.push(nestedCondition);
                  continue;
                }
              }
            }
          }
        }
      }

      // Regular field handling
      const fieldName = currentTableAlias ?
        `${this.escapeIdentifier(currentTableAlias)}.${this.escapeIdentifier(key)}` :
        this.escapeIdentifier(key);

      // Handle comparison operators
      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        !(value instanceof Date)
      ) {
        const ops = value as ComparisonOperators;
        for (const [operator, opValue] of Object.entries(ops)) {
          conditions.push(
            this.translateComparisonOperator(fieldName, operator, opValue),
          );
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

    return conditions.length > 0 ? conditions.join(" AND ") : "TRUE";
  }

  /**
   * Translate comparison operator
   */
  private translateComparisonOperator(
    fieldName: string,
    operator: string,
    value: unknown,
  ): string {
    switch (operator) {
      case "$eq":
        return value === null ?
          `${fieldName} IS NULL`
          : `${fieldName} = ${this.addParam(value)}`;

      case "$ne":
        return value === null ?
          `${fieldName} IS NOT NULL`
          : `${fieldName} <> ${this.addParam(value)}`;

      case "$gt":
        return `${fieldName} > ${this.addParam(value)}`;

      case "$gte":
        return `${fieldName} >= ${this.addParam(value)}`;

      case "$lt":
        return `${fieldName} < ${this.addParam(value)}`;

      case "$lte":
        return `${fieldName} <= ${this.addParam(value)}`;

      case "$in":
        if (!Array.isArray(value)) {
          throw new QueryError(`$in operator requires array value`);
        }
        if (value.length === 0) {
          return "FALSE";
        }
        return `${fieldName} IN (${value.map((v) => this.addParam(v)).join(", ")})`;

      case "$nin":
        if (!Array.isArray(value)) {
          throw new QueryError(`$nin operator requires array value`);
        }
        if (value.length === 0) {
          return "TRUE";
        }
        return `${fieldName} NOT IN (${value.map((v) => this.addParam(v)).join(", ")})`;

      case "$like":
        return `${fieldName} LIKE ${this.addParam(value)}`;

      case "$ilike":
        return `${fieldName} ILIKE ${this.addParam(value)}`;

      case "$contains":
        return `${fieldName} ILIKE ${this.addParam(`%${String(value)}%`)}`;

      case "$notContains":
        return `${fieldName} NOT ILIKE ${this.addParam(`%${String(value)}%`)}`;

      case "$startsWith":
        return `${fieldName} ILIKE ${this.addParam(`${String(value)}%`)}`;

      case "$endsWith":
        return `${fieldName} ILIKE ${this.addParam(`%${String(value)}`)}`;

      case "$regex":
        if (value instanceof RegExp) {
          return `${fieldName} ~ ${this.addParam(value.source)}`;
        }
        return `${fieldName} ~ ${this.addParam(value)}`;

      case "$exists":
        return value ? `${fieldName} IS NOT NULL` : `${fieldName} IS NULL`;

      case "$null":
        return value ? `${fieldName} IS NULL` : `${fieldName} IS NOT NULL`;

      case "$notNull":
        return value ? `${fieldName} IS NOT NULL` : `${fieldName} IS NULL`;

      default:
        throw new QueryError(`Unsupported operator: ${operator}`);
    }
  }
}

/**
 * Create a new PostgreSQL query translator
 */
export function createPostgresTranslator(
  schemaRegistry: SchemaRegistry,
): PostgresQueryTranslator {
  return new PostgresQueryTranslator(schemaRegistry);
}
