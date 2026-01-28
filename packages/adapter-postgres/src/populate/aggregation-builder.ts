/**
 * PostgreSQL Aggregation Builder
 *
 * Generates JSON aggregation SQL for populate functionality.
 * Handles json_agg(), row_to_json(), and LATERAL subqueries.
 */

import type {
  PopulateClause,
  SelectClause,
  WhereClause,
  OrderByItem,
} from "forja-types/core/query-builder";
import type { SchemaRegistry } from "forja-core/schema";
import type { RelationField } from "forja-types/core/schema";
import type { PostgresQueryTranslator } from "../query-translator";
import type { AggregationClause, PopulateFieldSelection } from "./types";
import {
  throwModelNotFound,
  throwSchemaNotFound,
  throwRelationNotFound,
  throwInvalidRelationType,
  throwTargetModelNotFound,
  throwJsonAggregationError,
} from "../error-helper";

/**
 * Aggregation Builder Class
 *
 * Generates SQL for JSON aggregation in SELECT clause.
 */
export class AggregationBuilder {
  constructor(
    private translator: PostgresQueryTranslator,
    private schemaRegistry: SchemaRegistry,
  ) {}

  /**
   * Build all aggregation clauses for a query
   *
   * @param tableName - Source table name
   * @param populate - Populate clause
   * @returns Array of aggregation SQL strings
   */
  buildAggregations(
    tableName: string,
    populate: PopulateClause,
  ): readonly AggregationClause[] {
    // Get current schema
    const modelName = this.schemaRegistry.findModelByTableName(tableName);
    if (!modelName) {
      throwModelNotFound(tableName);
    }

    const schema = this.schemaRegistry.get(modelName);
    if (!schema) {
      throwSchemaNotFound(modelName);
    }

    const aggregations: AggregationClause[] = [];

    // Build aggregation for each relation
    for (const [relationName, options] of Object.entries(populate)) {
      // Get relation field
      const relationField = schema.fields[relationName];
      if (!relationField) {
        throwRelationNotFound(relationName, schema.name);
      }

      if (relationField.type !== "relation") {
        throwInvalidRelationType(relationName, relationField.type, schema.name);
      }

      const relField = relationField as RelationField;

      try {
        const aggregation = this.buildRelationAggregation(
          relationName,
          relField,
          options,
        );
        aggregations.push(aggregation);
      } catch (error) {
        if (error instanceof Error && error.message.includes("ADAPTER_")) {
          throw error;
        }
        throwJsonAggregationError(
          relationName,
          error instanceof Error ? error : undefined,
        );
      }
    }

    return aggregations;
  }

  /**
   * Build aggregation for a specific relation
   */
  private buildRelationAggregation(
    relationName: string,
    relation: RelationField,
    options: unknown,
  ): AggregationClause {
    const relationAlias = this.translator.escapeIdentifier(relationName);

    // Get field selection
    const fieldSelection = this.buildFieldSelection(relationName, relation, options);

    let sql: string;

    switch (relation.kind) {
      case "belongsTo":
      case "hasOne":
        // Single object: row_to_json()
        sql = `row_to_json(${relationAlias}.*) AS ${relationAlias}`;
        if (fieldSelection.fields && fieldSelection.fields !== "*") {
          // If specific fields selected, use ROW constructor
          sql = `row_to_json((SELECT r FROM (SELECT ${fieldSelection.sql}) r)) AS ${relationAlias}`;
        }
        break;

      case "hasMany":
      case "manyToMany":
        // Array of objects: json_agg()
        // FILTER clause handles NULL values (no related records)
        const distinctClause = relation.kind === "manyToMany" ? "DISTINCT " : "";

        if (fieldSelection.fields && fieldSelection.fields !== "*") {
          sql = `json_agg(${distinctClause}row_to_json((SELECT r FROM (SELECT ${fieldSelection.sql}) r))) FILTER (WHERE ${relationAlias}."id" IS NOT NULL) AS ${relationAlias}`;
        } else {
          sql = `json_agg(${distinctClause}${relationAlias}.*) FILTER (WHERE ${relationAlias}."id" IS NOT NULL) AS ${relationAlias}`;
        }
        break;

      default:
        throwJsonAggregationError(relationName);
    }

    return {
      relationName,
      relationKind: relation.kind,
      sql,
      alias: relationName,
    };
  }

  /**
   * Build LATERAL subquery for complex populate options
   *
   * Generates:
   * ```sql
   * LEFT JOIN LATERAL (
   *   SELECT json_agg(row_to_json(t.*)) as data
   *   FROM (
   *     SELECT fields...
   *     FROM target_table
   *     WHERE target.fk = source.id
   *       AND additional_where_conditions
   *     ORDER BY field ASC
   *     LIMIT 10
   *     OFFSET 20
   *   ) t
   * ) relation_data ON true
   * ```
   */
  buildLateralSubquery(
    sourceTable: string,
    relationName: string,
    relation: RelationField,
    options: unknown,
  ): string {
    // Get target schema
    const targetSchema = this.schemaRegistry.get(relation.model);
    if (!targetSchema) {
      throwTargetModelNotFound(relation.model, relationName, sourceTable);
    }

    const targetTable = targetSchema.tableName ?? relation.model.toLowerCase();
    const foreignKey = relation.foreignKey!;

    const sourceTableEsc = this.translator.escapeIdentifier(sourceTable);
    const targetTableEsc = this.translator.escapeIdentifier(targetTable);
    const foreignKeyEsc = this.translator.escapeIdentifier(foreignKey);
    const relationAlias = this.translator.escapeIdentifier(`${relationName}_data`);

    // Parse options
    const opts = this.parsePopulateOptions(options);

    // Build field selection
    const fieldSelection = this.buildFieldSelection(relationName, relation, options);
    const selectFields = fieldSelection.sql || `${targetTableEsc}.*`;

    // Build WHERE clause
    const whereConditions: string[] = [];

    // FK condition
    if (relation.kind === "belongsTo") {
      // belongsTo: source.fk = target.id
      whereConditions.push(`${targetTableEsc}."id" = ${sourceTableEsc}.${foreignKeyEsc}`);
    } else {
      // hasOne/hasMany: target.fk = source.id
      whereConditions.push(`${targetTableEsc}.${foreignKeyEsc} = ${sourceTableEsc}."id"`);
    }

    // Additional WHERE conditions from options
    if (opts.where) {
      const whereResult = this.translator.translateWhere(opts.where, 1);
      whereConditions.push(`(${whereResult.sql})`);
    }

    const whereClause = whereConditions.join(" AND ");

    // Build ORDER BY
    let orderByClause = "";
    if (opts.orderBy && opts.orderBy.length > 0) {
      orderByClause = `ORDER BY ${this.buildOrderBy(opts.orderBy)}`;
    }

    // Build LIMIT/OFFSET
    let limitClause = "";
    if (opts.limit !== undefined) {
      limitClause = `LIMIT ${opts.limit}`;
    }

    let offsetClause = "";
    if (opts.offset !== undefined) {
      offsetClause = `OFFSET ${opts.offset}`;
    }

    // Determine aggregation type
    const isArray = relation.kind === "hasMany" || relation.kind === "manyToMany";
    const aggregationFunc = isArray ? "json_agg" : "row_to_json";

    // Build subquery
    const subquery = `
      LEFT JOIN LATERAL (
        SELECT ${aggregationFunc}(row_to_json(t.*)) as data
        FROM (
          SELECT ${selectFields}
          FROM ${targetTableEsc}
          WHERE ${whereClause}
          ${orderByClause}
          ${limitClause}
          ${offsetClause}
        ) t
      ) ${relationAlias} ON true
    `.trim().replace(/\s+/g, " ");

    return subquery;
  }

  /**
   * Build LATERAL subquery for manyToMany with options
   */
  buildManyToManyLateralSubquery(
    sourceTable: string,
    relationName: string,
    relation: RelationField,
    options: unknown,
  ): string {
    // Get schemas
    const targetSchema = this.schemaRegistry.get(relation.model);
    if (!targetSchema) {
      throwTargetModelNotFound(relation.model, relationName, sourceTable);
    }

    const targetTable = targetSchema.tableName ?? relation.model.toLowerCase();
    const junctionTable = relation.through!;

    const currentModelName = this.schemaRegistry.findModelByTableName(sourceTable);
    if (!currentModelName) {
      throwModelNotFound(sourceTable);
    }

    const currentSchema = this.schemaRegistry.get(currentModelName);
    if (!currentSchema) {
      throwSchemaNotFound(currentModelName);
    }

    // Foreign keys
    const sourceFK = `${currentSchema.name}Id`;
    const targetFK = `${relation.model}Id`;

    // Escape identifiers
    const sourceTableEsc = this.translator.escapeIdentifier(sourceTable);
    const junctionTableEsc = this.translator.escapeIdentifier(junctionTable);
    const targetTableEsc = this.translator.escapeIdentifier(targetTable);
    const sourceFKEsc = this.translator.escapeIdentifier(sourceFK);
    const targetFKEsc = this.translator.escapeIdentifier(targetFK);
    const relationAlias = this.translator.escapeIdentifier(`${relationName}_data`);

    // Parse options
    const opts = this.parsePopulateOptions(options);

    // Build field selection
    const fieldSelection = this.buildFieldSelection(relationName, relation, options);
    const selectFields = fieldSelection.sql || `${targetTableEsc}.*`;

    // Build WHERE for target table
    let targetWhereClause = "";
    if (opts.where) {
      const whereResult = this.translator.translateWhere(opts.where, 1);
      targetWhereClause = `WHERE ${whereResult.sql}`;
    }

    // Build ORDER BY
    let orderByClause = "";
    if (opts.orderBy && opts.orderBy.length > 0) {
      orderByClause = `ORDER BY ${this.buildOrderBy(opts.orderBy)}`;
    }

    // Build LIMIT/OFFSET
    let limitClause = "";
    if (opts.limit !== undefined) {
      limitClause = `LIMIT ${opts.limit}`;
    }

    let offsetClause = "";
    if (opts.offset !== undefined) {
      offsetClause = `OFFSET ${opts.offset}`;
    }

    // Build subquery with junction join
    const subquery = `
      LEFT JOIN LATERAL (
        SELECT json_agg(row_to_json(t.*)) as data
        FROM (
          SELECT ${selectFields}
          FROM ${targetTableEsc}
          INNER JOIN ${junctionTableEsc} ON ${targetTableEsc}."id" = ${junctionTableEsc}.${targetFKEsc}
          WHERE ${junctionTableEsc}.${sourceFKEsc} = ${sourceTableEsc}."id"
          ${targetWhereClause ? `AND ${targetWhereClause.replace("WHERE", "")}` : ""}
          ${orderByClause}
          ${limitClause}
          ${offsetClause}
        ) t
      ) ${relationAlias} ON true
    `.trim().replace(/\s+/g, " ");

    return subquery;
  }

  /**
   * Build field selection for relation
   */
  private buildFieldSelection(
    relationName: string,
    relation: RelationField,
    options: unknown,
  ): PopulateFieldSelection {
    const opts = this.parsePopulateOptions(options);

    // Get target schema
    const targetSchema = this.schemaRegistry.get(relation.model);
    if (!targetSchema) {
      throwTargetModelNotFound(relation.model, relationName, "unknown");
    }

    const relationAlias = this.translator.escapeIdentifier(relationName);

    // If no select specified, return all fields
    if (!opts.select || opts.select === "*") {
      return {
        fields: "*",
        sql: `${relationAlias}.*`,
      };
    }

    // Build field list
    const fields = opts.select as string[];
    const fieldSQL = fields
      .map((field) => {
        const fieldEsc = this.translator.escapeIdentifier(field);
        return `${relationAlias}.${fieldEsc}`;
      })
      .join(", ");

    return {
      fields: opts.select,
      sql: fieldSQL,
    };
  }

  /**
   * Parse populate options
   */
  private parsePopulateOptions(options: unknown): {
    select?: SelectClause;
    where?: WhereClause;
    orderBy?: readonly OrderByItem[];
    limit?: number;
    offset?: number;
    populate?: PopulateClause;
  } {
    if (typeof options === "string") {
      return { select: options === "*" ? "*" : [options] };
    }

    if (typeof options !== "object" || options === null) {
      return {};
    }

    const opts = options as Record<string, unknown>;

    return {
      select: opts.select as SelectClause | undefined,
      where: opts.where as WhereClause | undefined,
      orderBy: opts.orderBy as readonly OrderByItem[] | undefined,
      limit: opts.limit as number | undefined,
      offset: opts.offset as number | undefined,
      populate: opts.populate as PopulateClause | undefined,
    };
  }

  /**
   * Build ORDER BY clause
   */
  private buildOrderBy(orderBy: readonly OrderByItem[]): string {
    return orderBy
      .map((item) => {
        const field = this.translator.escapeIdentifier(item.field);
        const direction = item.direction.toUpperCase();
        let clause = `${field} ${direction}`;

        if (item.nulls) {
          clause += ` NULLS ${item.nulls.toUpperCase()}`;
        }

        return clause;
      })
      .join(", ");
  }

  /**
   * Generate aggregation SQL for SELECT clause
   */
  generateAggregationSQL(aggregations: readonly AggregationClause[]): string {
    return aggregations.map((agg) => agg.sql).join(", ");
  }
}
