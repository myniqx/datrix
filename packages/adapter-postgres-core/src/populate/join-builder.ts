/**
 * PostgreSQL JOIN Builder
 *
 * Generates SQL JOIN clauses for the json-aggregation populate strategy.
 * Only belongsTo relations need a JOIN: hasOne, hasMany and manyToMany are
 * populated via correlated subqueries in AggregationBuilder (no JOIN, no
 * row explosion).
 */

import type { DatrixEntry, ISchemaRegistry, RelationField } from "@datrix/core";
import type { PostgresQueryTranslator } from "../query-translator";
import type { JoinClause } from "./types";
import {
	throwModelNotFound,
	throwSchemaNotFound,
	throwRelationNotFound,
	throwInvalidRelationType,
	throwTargetModelNotFound,
	throwJoinBuildError,
} from "@datrix/core";
import { PostgresQueryObject } from "../types";

/**
 * JOIN Builder Class
 */
export class JoinBuilder {
	constructor(
		private schemaRegistry: ISchemaRegistry,
		private translator: PostgresQueryTranslator,
	) {}

	/**
	 * Build all JOINs for a query (json-aggregation strategy)
	 *
	 * @param query - Query with populate
	 * @returns Array of JOIN clauses (belongsTo relations only)
	 */
	buildJoins<T extends DatrixEntry>(
		query: PostgresQueryObject<T>,
	): readonly JoinClause[] {
		if (!query.populate) {
			return [];
		}

		const modelName = this.schemaRegistry.findModelByTableName(query.table);
		if (!modelName) {
			throwModelNotFound({ adapter: "postgres", table: query.table });
		}

		const schema = this.schemaRegistry.get(modelName);
		if (!schema) {
			throwSchemaNotFound({ adapter: "postgres", modelName });
		}

		const joins: JoinClause[] = [];

		for (const relationName of Object.keys(query.populate)) {
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

			// Only belongsTo uses a JOIN; other kinds are handled by
			// AggregationBuilder subqueries.
			if (relField.kind === "belongsTo") {
				try {
					joins.push(
						...this.buildBelongsToJoin(query.table, relationName, relField),
					);
				} catch (error) {
					if (error instanceof Error && error.message.includes("ADAPTER_")) {
						throw error;
					}
					throwJoinBuildError({
						adapter: "postgres",
						relationName,
						relationKind: relField.kind,
						cause: error instanceof Error ? error : undefined,
					});
				}
			}
		}

		return joins;
	}

	/**
	 * Build JOIN for belongsTo relation
	 *
	 * Source has FK: source.foreignKey = target.id
	 *
	 * Example: Post.authorId -> User.id
	 * LEFT JOIN users ON posts.author_id = users.id
	 */
	private buildBelongsToJoin(
		sourceTable: string,
		relationName: string,
		relation: RelationField,
	): JoinClause[] {
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
		const foreignKeyEsc = this.translator.escapeIdentifier(foreignKey);
		const relationAlias = this.translator.escapeIdentifier(relationName);

		const condition = `${sourceTableEsc}.${foreignKeyEsc} = ${relationAlias}."id"`;

		return [
			{
				type: "LEFT JOIN",
				table: targetTable, // NOT escaped - will be escaped in generateJoinSQL
				alias: relationName, // NOT escaped - will be escaped in generateJoinSQL
				condition,
			},
		];
	}

	/**
	 * Generate SQL string from JOIN clauses
	 */
	generateJoinSQL(joins: readonly JoinClause[]): string {
		return joins
			.map((join) => {
				const tableEsc = this.translator.escapeIdentifier(join.table);
				const aliasEsc = this.translator.escapeIdentifier(join.alias);

				return `${join.type} ${tableEsc} AS ${aliasEsc} ON ${join.condition}`;
			})
			.join(" ");
	}
}
