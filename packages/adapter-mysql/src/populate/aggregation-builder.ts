/**
 * MySQL Aggregation Builder
 *
 * Generates JSON aggregation SQL for populate functionality.
 * Uses JSON_ARRAYAGG(), JSON_OBJECT() for MySQL 8.0+.
 */

import type {
	QueryPopulate,
	QueryPopulateOptions,
	QuerySelect,
} from "@datrix/core";
import type { DatrixEntry, ISchemaRegistry, RelationField } from "@datrix/core";
import { escapeIdentifier } from "../helpers";
import type { AggregationClause, PopulateFieldSelection } from "./types";
import {
	throwModelNotFound,
	throwSchemaNotFound,
	throwRelationNotFound,
	throwInvalidRelationType,
	throwTargetModelNotFound,
	throwJsonAggregationError,
	DatrixAdapterError,
} from "@datrix/core";
import { resolveJunctionForeignKeys } from "./junction";

/**
 * Aggregation Builder Class
 *
 * Generates SQL for JSON aggregation in SELECT clause.
 */
export class AggregationBuilder {
	constructor(private schemaRegistry: ISchemaRegistry) {}

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
	buildAggregations<T extends DatrixEntry>(
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
				if (error instanceof DatrixAdapterError) {
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
	private buildRelationAggregation<T extends DatrixEntry>(
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

		// Alias the target table to the relation name so a self-relation
		// (target table === source table, e.g. department.children ->
		// department) doesn't shadow the outer correlation: `WHERE
		// targetTable.foreignKey = department.id` would otherwise resolve
		// `department` to the subquery's own FROM instead of the outer row.
		const targetAliasEsc = relationAlias;

		// Build JSON_OBJECT for inner select
		const jsonObject = this.buildJsonObjectForSubquery(
			targetAliasEsc,
			fieldSelection,
		);

		const subquery = `( SELECT COALESCE(JSON_ARRAYAGG(${jsonObject}), JSON_ARRAY()) FROM ${targetTableEsc} AS ${targetAliasEsc} WHERE ${targetAliasEsc}.${foreignKeyEsc} = ${sourceTableEsc}.\`id\` ) AS ${relationAlias}`;

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

		// Junction FK column names come from the junction schema (handles
		// self-referential source/target FK naming)
		const { sourceFK, targetFK } = resolveJunctionForeignKeys(
			junctionTable,
			currentSchema.name,
			relation.model,
			this.schemaRegistry,
		);

		const sourceTableEsc = escapeIdentifier(sourceTable);
		const junctionTableEsc = escapeIdentifier(junctionTable);
		const sourceFKEsc = escapeIdentifier(sourceFK);
		const targetFKEsc = escapeIdentifier(targetFK);
		const relationAlias = escapeIdentifier(relationName);

		// Alias the target table to the relation name (not its bare table
		// name) so a self-relation (target table === source table, e.g.
		// person.friends -> person) doesn't shadow the outer correlation:
		// `WHERE junction.sourceFK = people.id` would otherwise resolve
		// `people` to the subquery's own FROM instead of the outer row.
		const targetAliasEsc = relationAlias;

		// Build JSON_OBJECT for inner select
		const jsonObject = this.buildJsonObjectForSubquery(
			targetAliasEsc,
			fieldSelection,
		);

		const targetTableEsc = escapeIdentifier(targetTable);
		const subquery = `( SELECT COALESCE(JSON_ARRAYAGG(${jsonObject}), JSON_ARRAY()) FROM ${targetTableEsc} AS ${targetAliasEsc} INNER JOIN ${junctionTableEsc} ON ${targetAliasEsc}.\`id\` = ${junctionTableEsc}.${targetFKEsc} WHERE ${junctionTableEsc}.${sourceFKEsc} = ${sourceTableEsc}.\`id\` ) AS ${relationAlias}`;

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
	 * Build field selection for relation
	 */
	private buildFieldSelection<T extends DatrixEntry>(
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
	 * Generate aggregation SQL for SELECT clause
	 */
	generateAggregationSQL(aggregations: readonly AggregationClause[]): string {
		return aggregations.map((agg) => agg.sql).join(", ");
	}
}
