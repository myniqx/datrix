/**
 * MySQL Aggregation Builder
 *
 * Generates JSON aggregation SQL for populate functionality.
 * Uses JSON_ARRAYAGG(), JSON_OBJECT() for MySQL 5.7+/8.0+.
 */

import type {
	QueryPopulate,
	OrderByItem,
	QueryPopulateOptions,
	QuerySelect,
} from "forja-types/core/query-builder";
import type { SchemaRegistry } from "forja-core/schema";
import type { ForjaEntry, RelationField } from "forja-types/core/schema";
import type { MySQLQueryTranslator } from "../query-translator";
import { escapeIdentifier } from "../helpers";
import type { AggregationClause, PopulateFieldSelection } from "./types";
import {
	throwModelNotFound,
	throwSchemaNotFound,
	throwRelationNotFound,
	throwInvalidRelationType,
	throwTargetModelNotFound,
	throwJsonAggregationError,
} from "forja-types/errors/adapter";

/**
 * Aggregation Builder Class
 *
 * Generates SQL for JSON aggregation in SELECT clause.
 */
export class AggregationBuilder {
	constructor(
		private translator: MySQLQueryTranslator,
		private schemaRegistry: SchemaRegistry,
	) {}

	/**
	 * Build all aggregation clauses for a query
	 *
	 * For json-aggregation strategy:
	 * - belongsTo/hasOne: Uses JSON_OBJECT with JOINed table
	 * - hasMany/manyToMany: Uses subquery with JSON_ARRAYAGG (no JOIN, no row explosion)
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
			throwModelNotFound({ adapter: "mysql", table: tableName });
		}

		const schema = this.schemaRegistry.get(modelName);
		if (!schema) {
			throwSchemaNotFound({ adapter: "mysql", modelName });
		}

		const aggregations: AggregationClause[] = [];

		for (const [relationName, options] of Object.entries(populate)) {
			const relationField = schema.fields[relationName];
			if (!relationField) {
				throwRelationNotFound({
					adapter: "mysql",
					relationName,
					schemaName: schema.name,
				});
			}

			if (relationField.type !== "relation") {
				throwInvalidRelationType({
					adapter: "mysql",
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
					// TODO: instanceof ERROR ??
					throw error;
				}
				throwJsonAggregationError({
					adapter: "mysql",
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
		const relationAlias = escapeIdentifier(relationName);
		const fieldSelection = this.buildFieldSelection(
			relationName,
			relation,
			options,
		);

		let sql: string;

		switch (relation.kind) {
			case "belongsTo":
			case "hasOne":
				// Single object: JSON_OBJECT() from JOINed table
				sql = this.buildJsonObjectSelect(relationAlias, fieldSelection);
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
				throwJsonAggregationError({ adapter: "mysql", relationName });
		}

		return {
			relationName,
			relationKind: relation.kind,
			sql,
			alias: relationName,
		};
	}

	/**
	 * Build JSON_OBJECT select for belongsTo/hasOne
	 *
	 * MySQL doesn't have row_to_json, so we build JSON_OBJECT manually
	 */
	private buildJsonObjectSelect(
		relationAlias: string,
		fieldSelection: PopulateFieldSelection,
	): string {
		// Build JSON_OBJECT with specific fields
		const fields = fieldSelection.fields as readonly string[];
		const jsonPairs = fields
			.map((field) => {
				const fieldEsc = escapeIdentifier(field);
				return `'${field}', ${relationAlias}.${fieldEsc}`;
			})
			.join(", ");

		return `CASE WHEN ${relationAlias}.\`id\` IS NOT NULL THEN JSON_OBJECT(${jsonPairs}) ELSE NULL END AS ${relationAlias}`;
	}

	/**
	 * Build hasMany subquery (no JOIN, no row explosion)
	 *
	 * Generates:
	 * ```sql
	 * (
	 *   SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT(...)), JSON_ARRAY())
	 *   FROM target_table
	 *   WHERE target.foreignKey = source_table.id
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
				adapter: "mysql",
				targetModel: relation.model,
				relationName,
				schemaName: sourceTable,
			});
		}

		const targetTable = targetSchema.tableName ?? relation.model.toLowerCase();
		const foreignKey = relation.foreignKey!;

		const sourceTableEsc = escapeIdentifier(sourceTable);
		const targetTableEsc = escapeIdentifier(targetTable);
		const foreignKeyEsc = escapeIdentifier(foreignKey);
		const relationAlias = escapeIdentifier(relationName);

		// Build JSON_OBJECT for inner select
		const jsonObject = this.buildJsonObjectForSubquery(
			targetTableEsc,
			fieldSelection,
		);

		const subquery = `( SELECT COALESCE(JSON_ARRAYAGG(${jsonObject}), JSON_ARRAY()) FROM ${targetTableEsc} WHERE ${targetTableEsc}.${foreignKeyEsc} = ${sourceTableEsc}.\`id\` ) AS ${relationAlias}`;

		return subquery;
	}

	/**
	 * Build manyToMany subquery with junction table (no JOIN, no row explosion)
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
				adapter: "mysql",
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
			throwModelNotFound({ adapter: "mysql", table: sourceTable });
		}

		const currentSchema = this.schemaRegistry.get(currentModelName);
		if (!currentSchema) {
			throwSchemaNotFound({ adapter: "mysql", modelName: currentModelName });
		}

		const sourceFK = `${currentSchema.name}Id`;
		const targetFK = `${relation.model}Id`;

		const sourceTableEsc = escapeIdentifier(sourceTable);
		const targetTableEsc = escapeIdentifier(targetTable);
		const junctionTableEsc = escapeIdentifier(junctionTable);
		const sourceFKEsc = escapeIdentifier(sourceFK);
		const targetFKEsc = escapeIdentifier(targetFK);
		const relationAlias = escapeIdentifier(relationName);

		// Build JSON_OBJECT for inner select
		const jsonObject = this.buildJsonObjectForSubquery(
			targetTableEsc,
			fieldSelection,
		);

		const subquery = `( SELECT COALESCE(JSON_ARRAYAGG(${jsonObject}), JSON_ARRAY()) FROM ${targetTableEsc} INNER JOIN ${junctionTableEsc} ON ${targetTableEsc}.\`id\` = ${junctionTableEsc}.${targetFKEsc} WHERE ${junctionTableEsc}.${sourceFKEsc} = ${sourceTableEsc}.\`id\` ) AS ${relationAlias}`;

		return subquery;
	}

	/**
	 * Build JSON_OBJECT for subquery
	 */
	private buildJsonObjectForSubquery(
		tableEsc: string,
		fieldSelection: PopulateFieldSelection,
	): string {
		// fields is always an array (normalizer guarantees select is provided)
		const fields = fieldSelection.fields as readonly string[];
		const jsonPairs = fields
			.map((field) => {
				const fieldEsc = escapeIdentifier(field);
				return `'${field}', ${tableEsc}.${fieldEsc}`;
			})
			.join(", ");

		return `JSON_OBJECT(${jsonPairs})`;
	}

	/**
	 * Build LATERAL subquery for complex populate options (MySQL 8.0.14+)
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
				adapter: "mysql",
				targetModel: relation.model,
				relationName,
				schemaName: sourceTable,
			});
		}

		const targetTable = targetSchema.tableName ?? relation.model.toLowerCase();
		const foreignKey = relation.foreignKey!;

		const sourceTableEsc = escapeIdentifier(sourceTable);
		const targetTableEsc = escapeIdentifier(targetTable);
		const foreignKeyEsc = escapeIdentifier(foreignKey);
		const relationAlias = escapeIdentifier(
			`${relationName}_data`,
		);

		// Build field selection
		const fieldSelection = this.buildFieldSelection(
			relationName,
			relation,
			options,
		);

		// Build JSON_OBJECT
		const jsonObject = this.buildJsonObjectForSubquery(
			targetTableEsc,
			fieldSelection,
		);

		// Build WHERE clause
		const whereConditions: string[] = [];

		// FK condition
		if (relation.kind === "belongsTo") {
			whereConditions.push(
				`${targetTableEsc}.\`id\` = ${sourceTableEsc}.${foreignKeyEsc}`,
			);
		} else {
			whereConditions.push(
				`${targetTableEsc}.${foreignKeyEsc} = ${sourceTableEsc}.\`id\``,
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
		const aggregationFunc = isArray ? "JSON_ARRAYAGG" : "";

		// Build subquery
		let subquery: string;
		if (isArray) {
			subquery = `LEFT JOIN LATERAL ( SELECT ${aggregationFunc}(${jsonObject}) as data FROM ${targetTableEsc} WHERE ${whereClause} ${orderByClause} ${limitClause} ${offsetClause} ) ${relationAlias} ON TRUE`;
		} else {
			subquery = `LEFT JOIN LATERAL ( SELECT ${jsonObject} as data FROM ${targetTableEsc} WHERE ${whereClause} ${orderByClause} LIMIT 1 ) ${relationAlias} ON TRUE`;
		}

		return subquery.trim().replace(/\s+/g, " ");
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
				adapter: "mysql",
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
			throwModelNotFound({ adapter: "mysql", table: sourceTable });
		}

		const currentSchema = this.schemaRegistry.get(currentModelName);
		if (!currentSchema) {
			throwSchemaNotFound({ adapter: "mysql", modelName: currentModelName });
		}

		// Foreign keys
		const sourceFK = `${currentSchema.name}Id`;
		const targetFK = `${relation.model}Id`;

		// Escape identifiers
		const sourceTableEsc = escapeIdentifier(sourceTable);
		const junctionTableEsc = escapeIdentifier(junctionTable);
		const targetTableEsc = escapeIdentifier(targetTable);
		const sourceFKEsc = escapeIdentifier(sourceFK);
		const targetFKEsc = escapeIdentifier(targetFK);
		const relationAlias = escapeIdentifier(
			`${relationName}_data`,
		);

		// Build field selection
		const fieldSelection = this.buildFieldSelection(
			relationName,
			relation,
			options,
		);

		// Build JSON_OBJECT
		const jsonObject = this.buildJsonObjectForSubquery(
			targetTableEsc,
			fieldSelection,
		);

		// Build WHERE for target table
		let targetWhereClause = "";
		if (options.where) {
			const whereResult = this.translator.translateWhere(options.where, 1);
			targetWhereClause = `AND ${whereResult.sql}`;
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
		const subquery = `LEFT JOIN LATERAL ( SELECT JSON_ARRAYAGG(${jsonObject}) as data FROM ${targetTableEsc} INNER JOIN ${junctionTableEsc} ON ${targetTableEsc}.\`id\` = ${junctionTableEsc}.${targetFKEsc} WHERE ${junctionTableEsc}.${sourceFKEsc} = ${sourceTableEsc}.\`id\` ${targetWhereClause} ${orderByClause} ${limitClause} ${offsetClause} ) ${relationAlias} ON TRUE`;

		return subquery.trim().replace(/\s+/g, " ");
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
				adapter: "mysql",
				targetModel: relation.model,
				relationName,
				schemaName: "unknown",
			});
		}

		const relationAlias = escapeIdentifier(relationName);

		// select is always provided by normalizer (getCachedSelectFields)
		const fields = options.select as readonly string[];

		// Build field list SQL
		const fieldSQL = fields
			.map((field) => {
				const fieldEsc = escapeIdentifier(field);
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
	 * Note: MySQL doesn't support NULLS FIRST/LAST natively
	 */
	private buildOrderBy<T extends ForjaEntry>(
		orderBy: readonly OrderByItem<T>[],
	): string {
		return orderBy
			.map((item) => {
				const field = escapeIdentifier(item.field as string);
				const direction = item.direction.toUpperCase();

				if (item.nulls) {
					// MySQL workaround for NULLS FIRST/LAST
					const nullsFirst = item.nulls.toUpperCase() === "FIRST";
					return `CASE WHEN ${field} IS NULL THEN ${nullsFirst ? 0 : 1} ELSE ${nullsFirst ? 1 : 0} END, ${field} ${direction}`;
				}

				return `${field} ${direction}`;
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
