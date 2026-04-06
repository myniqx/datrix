/**
 * PostgreSQL Aggregation Builder
 *
 * Generates JSON aggregation SQL for populate functionality.
 * Handles json_agg(), row_to_json(), and LATERAL subqueries.
 */

import type {
	QueryPopulate,
	QueryPopulateOptions,
	QuerySelect,
	QuerySelectObject,
} from "@forja/core/types";
import type {
	ForjaEntry,
	ISchemaRegistry,
	RelationField,
} from "@forja/core/types";
import type { PostgresQueryTranslator } from "../query-translator";
import type { AggregationClause, PopulateFieldSelection } from "./types";
import {
	throwModelNotFound,
	throwSchemaNotFound,
	throwRelationNotFound,
	throwInvalidRelationType,
	throwTargetModelNotFound,
	throwJsonAggregationError,
} from "@forja/core/types/errors";

/**
 * Aggregation Builder Class
 *
 * Generates SQL for JSON aggregation in SELECT clause.
 */
export class AggregationBuilder {
	constructor(
		private translator: PostgresQueryTranslator,
		private schemaRegistry: ISchemaRegistry,
	) {}

	/**
	 * Build all aggregation clauses for a query
	 *
	 * For json-aggregation strategy:
	 * - belongsTo/hasOne: Uses row_to_json with JOINed table
	 * - hasMany/manyToMany: Uses subquery with json_agg (no JOIN, no row explosion)
	 *
	 * @param tableName - Source table name
	 * @param populate - Populate clause
	 * @returns Array of aggregation SQL strings
	 */
	buildAggregations<T extends ForjaEntry>(
		tableName: string,
		populate: QueryPopulate<T>,
	): readonly AggregationClause[] {
		const modelName = this.schemaRegistry.findModelByTableName(tableName);
		if (!modelName) {
			throwModelNotFound({ adapter: "postgres", table: tableName });
		}

		const schema = this.schemaRegistry.get(modelName);
		if (!schema) {
			throwSchemaNotFound({ adapter: "postgres", modelName });
		}

		const aggregations: AggregationClause[] = [];

		for (const [relationName, options] of Object.entries(populate)) {
			const relationField = schema.fields[relationName];
			if (!relationField) {
				throwRelationNotFound({
					adapter: "postgres",
					relationName,
					schemaName: schema.name,
				});
			}

			if (relationField.type !== "relation") {
				throwInvalidRelationType({
					adapter: "postgres",
					relationName,
					fieldType: relationField.type,
					schemaName: schema.name,
				});
			}

			const relField = relationField as RelationField;

			try {
				const aggregation = this.buildRelationAggregation(
					tableName,
					relationName,
					relField,
					options,
				);
				aggregations.push(aggregation);
			} catch (error) {
				if (error instanceof Error && error.message.includes("ADAPTER_")) {
					throw error;
				}
				throwJsonAggregationError({
					adapter: "postgres",
					relationName,
					cause: error instanceof Error ? error : undefined,
				});
			}
		}

		return aggregations;
	}

	/**
	 * Build aggregation for a specific relation
	 */
	private buildRelationAggregation<T extends ForjaEntry>(
		sourceTable: string,
		relationName: string,
		relation: RelationField,
		options: QueryPopulateOptions<T>,
	): AggregationClause {
		const relationAlias = this.translator.escapeIdentifier(relationName);
		const fieldSelection = this.buildFieldSelection(
			relationName,
			relation,
			options,
		);

		let sql: string;

		switch (relation.kind) {
			case "belongsTo":
			case "hasOne":
				// Single object: row_to_json() with specific fields
				sql = `row_to_json((SELECT r FROM (SELECT ${fieldSelection.sql}) r)) AS ${relationAlias}`;
				break;

			case "hasMany":
				// Array: use subquery to avoid row explosion
				sql = this.buildHasManySubquery(
					sourceTable,
					relationName,
					relation,
					fieldSelection,
				);
				break;

			case "manyToMany":
				// Array: use subquery with junction table
				sql = this.buildManyToManySubquery(
					sourceTable,
					relationName,
					relation,
					fieldSelection,
				);
				break;

			default:
				throwJsonAggregationError({ adapter: "postgres", relationName });
		}

		return {
			relationName,
			relationKind: relation.kind,
			sql,
			alias: relationName,
		};
	}

	/**
	 * Build hasMany subquery (no JOIN, no row explosion)
	 *
	 * Generates:
	 * ```sql
	 * (
	 *   SELECT COALESCE(json_agg(row_to_json(t.*)), '[]'::jsonb)
	 *   FROM (
	 *     SELECT target.*
	 *     FROM target_table target
	 *     WHERE target.foreignKey = source_table.id
	 *   ) t
	 * ) AS relationName
	 * ```
	 */
	private buildHasManySubquery(
		sourceTable: string,
		relationName: string,
		relation: RelationField,
		fieldSelection: PopulateFieldSelection,
	): string {
		const targetSchema = this.schemaRegistry.get(relation.model);
		if (!targetSchema) {
			throwTargetModelNotFound({
				adapter: "postgres",
				targetModel: relation.model,
				relationName,
				schemaName: sourceTable,
			});
		}

		const targetTable = targetSchema.tableName ?? relation.model.toLowerCase();
		const foreignKey = relation.foreignKey!;

		const sourceTableEsc = this.translator.escapeIdentifier(sourceTable);
		const targetTableEsc = this.translator.escapeIdentifier(targetTable);
		const foreignKeyEsc = this.translator.escapeIdentifier(foreignKey);
		const relationAlias = this.translator.escapeIdentifier(relationName);

		const selectFields = fieldSelection.sql || `${targetTableEsc}.*`;

		const subquery = `
      (
        SELECT COALESCE(jsonb_agg(row_to_json(t.*)), '[]'::jsonb)
        FROM (
          SELECT ${selectFields}
          FROM ${targetTableEsc}
          WHERE ${targetTableEsc}.${foreignKeyEsc} = ${sourceTableEsc}."id"
        ) t
      ) AS ${relationAlias}
    `
			.trim()
			.replace(/\s+/g, " ");

		return subquery;
	}

	/**
	 * Build manyToMany subquery with junction table (no JOIN, no row explosion)
	 *
	 * Generates:
	 * ```sql
	 * (
	 *   SELECT COALESCE(json_agg(row_to_json(t.*)), '[]'::jsonb)
	 *   FROM (
	 *     SELECT target.*
	 *     FROM target_table target
	 *     INNER JOIN junction_table ON target.id = junction_table.TargetId
	 *     WHERE junction_table.SourceId = source_table.id
	 *   ) t
	 * ) AS relationName
	 * ```
	 */
	private buildManyToManySubquery(
		sourceTable: string,
		relationName: string,
		relation: RelationField,
		fieldSelection: PopulateFieldSelection,
	): string {
		const targetSchema = this.schemaRegistry.get(relation.model);
		if (!targetSchema) {
			throwTargetModelNotFound({
				adapter: "postgres",
				targetModel: relation.model,
				relationName,
				schemaName: sourceTable,
			});
		}

		const targetTable = targetSchema.tableName ?? relation.model.toLowerCase();
		const junctionTable = relation.through!;

		const currentModelName =
			this.schemaRegistry.findModelByTableName(sourceTable);
		if (!currentModelName) {
			throwModelNotFound({ adapter: "postgres", table: sourceTable });
		}

		const currentSchema = this.schemaRegistry.get(currentModelName);
		if (!currentSchema) {
			throwSchemaNotFound({ adapter: "postgres", modelName: currentModelName });
		}

		const sourceFK = `${currentSchema.name}Id`;
		const targetFK = `${relation.model}Id`;

		const sourceTableEsc = this.translator.escapeIdentifier(sourceTable);
		const targetTableEsc = this.translator.escapeIdentifier(targetTable);
		const junctionTableEsc = this.translator.escapeIdentifier(junctionTable);
		const sourceFKEsc = this.translator.escapeIdentifier(sourceFK);
		const targetFKEsc = this.translator.escapeIdentifier(targetFK);
		const relationAlias = this.translator.escapeIdentifier(relationName);

		const selectFields = fieldSelection.sql || `${targetTableEsc}.*`;

		const subquery = `
      (
        SELECT COALESCE(jsonb_agg(row_to_json(t.*)), '[]'::jsonb)
        FROM (
          SELECT ${selectFields}
          FROM ${targetTableEsc}
          INNER JOIN ${junctionTableEsc} ON ${targetTableEsc}."id" = ${junctionTableEsc}.${targetFKEsc}
          WHERE ${junctionTableEsc}.${sourceFKEsc} = ${sourceTableEsc}."id"
        ) t
      ) AS ${relationAlias}
    `
			.trim()
			.replace(/\s+/g, " ");

		return subquery;
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
	buildLateralSubquery<T extends ForjaEntry>(
		sourceTable: string,
		relationName: string,
		relation: RelationField,
		options: QueryPopulateOptions<T>,
	): string {
		// Get target schema
		const targetSchema = this.schemaRegistry.get(relation.model);
		if (!targetSchema) {
			throwTargetModelNotFound({
				adapter: "postgres",
				targetModel: relation.model,
				relationName,
				schemaName: sourceTable,
			});
		}

		const targetTable = targetSchema.tableName ?? relation.model.toLowerCase();
		const foreignKey = relation.foreignKey!;

		const sourceTableEsc = this.translator.escapeIdentifier(sourceTable);
		const targetTableEsc = this.translator.escapeIdentifier(targetTable);
		const foreignKeyEsc = this.translator.escapeIdentifier(foreignKey);
		const relationAlias = this.translator.escapeIdentifier(
			`${relationName}_data`,
		);

		// Build field selection
		const fieldSelection = this.buildFieldSelection(
			relationName,
			relation,
			options,
		);
		const selectFields = fieldSelection.sql || `${targetTableEsc}.*`;

		// Build WHERE clause
		const whereConditions: string[] = [];

		// FK condition
		if (relation.kind === "belongsTo") {
			// belongsTo: source.fk = target.id
			whereConditions.push(
				`${targetTableEsc}."id" = ${sourceTableEsc}.${foreignKeyEsc}`,
			);
		} else {
			// hasOne/hasMany: target.fk = source.id
			whereConditions.push(
				`${targetTableEsc}.${foreignKeyEsc} = ${sourceTableEsc}."id"`,
			);
		}

		// Additional WHERE conditions from options
		if (options.where) {
			const whereResult = this.translator.translateWhere(options.where, 1);
			whereConditions.push(`(${whereResult.sql})`);
		}

		const whereClause = whereConditions.join(" AND ");

		// Build ORDER BY
		let orderByClause = "";
		if (options.orderBy && options.orderBy.length > 0) {
			orderByClause = `ORDER BY ${this.buildOrderBy(options.orderBy)}`;
		}

		// Build LIMIT/OFFSET
		let limitClause = "";
		if (options.limit !== undefined) {
			limitClause = `LIMIT ${options.limit}`;
		}

		let offsetClause = "";
		if (options.offset !== undefined) {
			offsetClause = `OFFSET ${options.offset}`;
		}

		// Determine aggregation type
		const isArray =
			relation.kind === "hasMany" || relation.kind === "manyToMany";
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
    `
			.trim()
			.replace(/\s+/g, " ");

		return subquery;
	}

	/**
	 * Build LATERAL subquery for manyToMany with options
	 */
	buildManyToManyLateralSubquery<T extends ForjaEntry>(
		sourceTable: string,
		relationName: string,
		relation: RelationField,
		options: QueryPopulateOptions<T>,
	): string {
		// Get schemas
		const targetSchema = this.schemaRegistry.get(relation.model);
		if (!targetSchema) {
			throwTargetModelNotFound({
				adapter: "postgres",
				targetModel: relation.model,
				relationName,
				schemaName: sourceTable,
			});
		}

		const targetTable = targetSchema.tableName ?? relation.model.toLowerCase();
		const junctionTable = relation.through!;

		const currentModelName =
			this.schemaRegistry.findModelByTableName(sourceTable);
		if (!currentModelName) {
			throwModelNotFound({ adapter: "postgres", table: sourceTable });
		}

		const currentSchema = this.schemaRegistry.get(currentModelName);
		if (!currentSchema) {
			throwSchemaNotFound({ adapter: "postgres", modelName: currentModelName });
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
		const relationAlias = this.translator.escapeIdentifier(
			`${relationName}_data`,
		);

		// Build field selection
		const fieldSelection = this.buildFieldSelection(
			relationName,
			relation,
			options,
		);
		const selectFields = fieldSelection.sql || `${targetTableEsc}.*`;

		// Build WHERE for target table
		let targetWhereClause = "";
		if (options.where) {
			const whereResult = this.translator.translateWhere(options.where, 1);
			targetWhereClause = `WHERE ${whereResult.sql}`;
		}

		// Build ORDER BY
		let orderByClause = "";
		if (options.orderBy && options.orderBy.length > 0) {
			orderByClause = `ORDER BY ${this.buildOrderBy(options.orderBy)}`;
		}

		// Build LIMIT/OFFSET
		let limitClause = "";
		if (options.limit !== undefined) {
			limitClause = `LIMIT ${options.limit}`;
		}

		let offsetClause = "";
		if (options.offset !== undefined) {
			offsetClause = `OFFSET ${options.offset}`;
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
    `
			.trim()
			.replace(/\s+/g, " ");

		return subquery;
	}

	/**
	 * Build field selection for relation
	 */
	private buildFieldSelection<T extends ForjaEntry>(
		relationName: string,
		relation: RelationField,
		options: QueryPopulateOptions<T>,
	): PopulateFieldSelection {
		// Get target schema
		const targetSchema = this.schemaRegistry.get(relation.model);
		if (!targetSchema) {
			throwTargetModelNotFound({
				adapter: "postgres",
				targetModel: relation.model,
				relationName,
				schemaName: "unknown",
			});
		}

		const relationAlias = this.translator.escapeIdentifier(relationName);

		// select is always provided by normalizer (getCachedSelectFields)
		const fields = options.select as readonly string[];

		// Build field list
		const fieldSQL = fields
			.map((field) => {
				const fieldEsc = this.translator.escapeIdentifier(field);
				return `${relationAlias}.${fieldEsc}`;
			})
			.join(", ");

		return {
			fields: fields as unknown as QuerySelect,
			sql: fieldSQL,
		};
	}

	/**
	 * Build ORDER BY clause
	 */
	private buildOrderBy<T extends ForjaEntry>(
		orderBy: QuerySelectObject<T>["orderBy"],
	): string {
		return orderBy!
			.map((item) => {
				const field = this.translator.escapeIdentifier(item.field as string);
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
