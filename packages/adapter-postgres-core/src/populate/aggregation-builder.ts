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
} from "@datrix/core";
import type { DatrixEntry, ISchemaRegistry, RelationField } from "@datrix/core";
import type { PostgresQueryTranslator } from "../query-translator";
import type { AggregationClause, PopulateFieldSelection } from "./types";
import { resolveJunctionForeignKeys } from "./junction";
import {
	throwModelNotFound,
	throwSchemaNotFound,
	throwRelationNotFound,
	throwInvalidRelationType,
	throwTargetModelNotFound,
	throwJsonAggregationError,
} from "@datrix/core";

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
	buildAggregations<T extends DatrixEntry>(
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
	private buildRelationAggregation<T extends DatrixEntry>(
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
				// Single object: row_to_json() with specific fields
				sql = `row_to_json((SELECT r FROM (SELECT ${fieldSelection.sql}) r)) AS ${relationAlias}`;
				break;

			case "hasOne":
				// Single object via correlated subquery with LIMIT 1: nothing at
				// the DB level guarantees FK uniqueness for legacy tables created
				// before core marked hasOne FKs unique (core issue 3.12), and a
				// plain LEFT JOIN would duplicate the parent row per extra match.
				sql = this.buildHasOneSubquery(
					sourceTable,
					relationName,
					relation,
					fieldSelection,
				);
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
	 * Build hasOne subquery (no JOIN, no row explosion)
	 *
	 * The target table is aliased to the relation name so the field
	 * selection (relation-alias-qualified) resolves, and so self-relations
	 * don't shadow the outer table in the correlation.
	 *
	 * Generates:
	 * ```sql
	 * (
	 *   SELECT row_to_json(t.*)
	 *   FROM (
	 *     SELECT fields...
	 *     FROM target_table AS relationName
	 *     WHERE relationName.foreignKey = source_table.id
	 *     ORDER BY relationName.id
	 *     LIMIT 1
	 *   ) t
	 * ) AS relationName
	 * ```
	 */
	private buildHasOneSubquery(
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

		const subquery = `
      (
        SELECT row_to_json(t.*)
        FROM (
          SELECT ${fieldSelection.sql}
          FROM ${targetTableEsc} AS ${relationAlias}
          WHERE ${relationAlias}.${foreignKeyEsc} = ${sourceTableEsc}."id"
          ORDER BY ${relationAlias}."id"
          LIMIT 1
        ) t
      ) AS ${relationAlias}
    `
			.trim()
			.replace(/\s+/g, " ");

		return subquery;
	}

	/**
	 * Build hasMany subquery (no JOIN, no row explosion)
	 *
	 * The target table is aliased to the relation name (see buildHasOneSubquery).
	 *
	 * Generates:
	 * ```sql
	 * (
	 *   SELECT COALESCE(json_agg(row_to_json(t.*)), '[]'::jsonb)
	 *   FROM (
	 *     SELECT target.*
	 *     FROM target_table AS relationName
	 *     WHERE relationName.foreignKey = source_table.id
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

		const selectFields = fieldSelection.sql || `${relationAlias}.*`;

		const subquery = `
      (
        SELECT COALESCE(jsonb_agg(row_to_json(t.*)), '[]'::jsonb)
        FROM (
          SELECT ${selectFields}
          FROM ${targetTableEsc} AS ${relationAlias}
          WHERE ${relationAlias}.${foreignKeyEsc} = ${sourceTableEsc}."id"
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
	 * The target table is aliased to the relation name and the junction to
	 * `j` (see buildHasOneSubquery). Junction FK column names are resolved
	 * from the junction schema (self-relations use source/target prefixes).
	 *
	 * Generates:
	 * ```sql
	 * (
	 *   SELECT COALESCE(json_agg(row_to_json(t.*)), '[]'::jsonb)
	 *   FROM (
	 *     SELECT target.*
	 *     FROM target_table AS relationName
	 *     INNER JOIN junction_table AS j ON relationName.id = j.TargetId
	 *     WHERE j.SourceId = source_table.id
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

		const { sourceFK, targetFK } = resolveJunctionForeignKeys(
			junctionTable,
			currentSchema.name,
			relation.model,
			this.schemaRegistry,
		);

		const sourceTableEsc = this.translator.escapeIdentifier(sourceTable);
		const targetTableEsc = this.translator.escapeIdentifier(targetTable);
		const junctionTableEsc = this.translator.escapeIdentifier(junctionTable);
		const sourceFKEsc = this.translator.escapeIdentifier(sourceFK);
		const targetFKEsc = this.translator.escapeIdentifier(targetFK);
		const relationAlias = this.translator.escapeIdentifier(relationName);

		const selectFields = fieldSelection.sql || `${relationAlias}.*`;

		const subquery = `
      (
        SELECT COALESCE(jsonb_agg(row_to_json(t.*)), '[]'::jsonb)
        FROM (
          SELECT ${selectFields}
          FROM ${targetTableEsc} AS ${relationAlias}
          INNER JOIN ${junctionTableEsc} AS j ON ${relationAlias}."id" = j.${targetFKEsc}
          WHERE j.${sourceFKEsc} = ${sourceTableEsc}."id"
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
	 * Generate aggregation SQL for SELECT clause
	 */
	generateAggregationSQL(aggregations: readonly AggregationClause[]): string {
		return aggregations.map((agg) => agg.sql).join(", ");
	}
}
