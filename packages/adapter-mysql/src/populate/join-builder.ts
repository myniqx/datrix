/**
 * MySQL JOIN Builder
 *
 * Generates SQL JOIN clauses for populate functionality.
 * Supports all relation types: belongsTo, hasOne, hasMany, manyToMany.
 */

import type { DatrixEntry, ISchemaRegistry, RelationField } from "@datrix/core";
import { escapeIdentifier } from "../helpers";
import type { JoinClause, PopulateStrategy } from "./types";
import {
	throwModelNotFound,
	throwSchemaNotFound,
	throwRelationNotFound,
	throwInvalidRelationType,
	throwTargetModelNotFound,
	throwJoinBuildError,
	throwJunctionTableNotFound,
	DatrixAdapterError,
} from "@datrix/core";
import { MySQLQueryObject } from "../types";
import { resolveJunctionForeignKeys } from "./junction";

/**
 * JOIN Builder Class
 *
 * Generates optimized JOIN clauses for the json-aggregation strategy.
 */
export class JoinBuilder {
	constructor(private schemaRegistry: ISchemaRegistry) {}

	/**
	 * Build all JOINs for a query
	 *
	 * For json-aggregation strategy:
	 * - Only generates JOINs for belongsTo and hasOne relations
	 * - hasMany and manyToMany use subqueries (no JOIN to avoid row explosion)
	 *
	 * @param query - Query with populate
	 * @param strategy - Populate strategy
	 * @returns Array of JOIN clauses
	 */
	buildJoins<T extends DatrixEntry>(
		query: MySQLQueryObject<T>,
		strategy: PopulateStrategy,
	): readonly JoinClause[] {
		if (!query.populate) {
			return [];
		}

		const modelName = this.schemaRegistry.findModelByTableName(query.table);
		if (!modelName) {
			throwModelNotFound({ adapter: "mysql", table: query.table });
		}

		const schema = this.schemaRegistry.get(modelName);
		if (!schema) {
			throwSchemaNotFound({ adapter: "mysql", modelName });
		}

		const joins: JoinClause[] = [];

		for (const [relationName] of Object.entries(query.populate)) {
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

			// For json-aggregation strategy: only JOIN belongsTo/hasOne
			// hasMany/manyToMany will use subqueries in AggregationBuilder
			if (strategy === "json-aggregation") {
				if (relField.kind === "belongsTo" || relField.kind === "hasOne") {
					const joinClauses = this.buildRelationJoin(
						query.table,
						relationName,
						relField,
					);
					joins.push(...joinClauses);
				}
			} else {
				const joinClauses = this.buildRelationJoin(
					query.table,
					relationName,
					relField,
				);
				joins.push(...joinClauses);
			}
		}

		return joins;
	}

	/**
	 * Build JOIN for a specific relation
	 */
	private buildRelationJoin(
		sourceTable: string,
		relationName: string,
		relation: RelationField,
	): JoinClause[] {
		try {
			switch (relation.kind) {
				case "belongsTo":
					return this.buildBelongsToJoin(sourceTable, relationName, relation);

				case "hasOne":
					return this.buildHasOneJoin(sourceTable, relationName, relation);

				case "hasMany":
					return this.buildHasManyJoin(sourceTable, relationName, relation);

				case "manyToMany":
					return this.buildManyToManyJoin(sourceTable, relationName, relation);

				default:
					throwJoinBuildError({
						adapter: "mysql",
						relationName,
						relationKind: relation.kind,
					});
			}
		} catch (error) {
			if (error instanceof DatrixAdapterError) {
				throw error;
			}
			throwJoinBuildError({
				adapter: "mysql",
				relationName,
				relationKind: relation.kind,
				cause: error instanceof Error ? error : undefined,
			});
		}
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
				adapter: "mysql",
				targetModel: relation.model,
				relationName,
				schemaName: sourceTable,
			});
		}

		const targetTable = targetSchema.tableName ?? relation.model.toLowerCase();
		const foreignKey = relation.foreignKey!;

		const sourceTableEsc = escapeIdentifier(sourceTable);
		const foreignKeyEsc = escapeIdentifier(foreignKey);
		const relationAlias = escapeIdentifier(relationName);

		const condition = `${sourceTableEsc}.${foreignKeyEsc} = ${relationAlias}.\`id\``;

		return [
			{
				type: "LEFT JOIN",
				table: targetTable,
				alias: relationName,
				condition,
			},
		];
	}

	/**
	 * Build JOIN for hasOne relation
	 *
	 * Target has FK: source.id = target.foreignKey
	 *
	 * Example: User.id <- Profile.userId
	 * LEFT JOIN profiles ON users.id = profiles.user_id
	 */
	private buildHasOneJoin(
		sourceTable: string,
		relationName: string,
		relation: RelationField,
	): JoinClause[] {
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
		const foreignKeyEsc = escapeIdentifier(foreignKey);
		const relationAlias = escapeIdentifier(relationName);

		const condition = `${sourceTableEsc}.\`id\` = ${relationAlias}.${foreignKeyEsc}`;

		return [
			{
				type: "LEFT JOIN",
				table: targetTable,
				alias: relationName,
				condition,
			},
		];
	}

	/**
	 * Build JOIN for hasMany relation
	 *
	 * Target has FK: source.id = target.foreignKey
	 * Uses LEFT JOIN (aggregation happens in SELECT)
	 */
	private buildHasManyJoin(
		sourceTable: string,
		relationName: string,
		relation: RelationField,
	): JoinClause[] {
		// Same as hasOne but with aggregation in SELECT clause
		return this.buildHasOneJoin(sourceTable, relationName, relation);
	}

	/**
	 * Build JOIN for manyToMany relation
	 *
	 * Requires junction table: source.id = junction.sourceFK
	 *                          junction.targetFK = target.id
	 */
	private buildManyToManyJoin(
		sourceTable: string,
		relationName: string,
		relation: RelationField,
	): JoinClause[] {
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
		const junctionTable = relation.through!;

		// Get current schema to determine FK names
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

		// Check if junction table exists
		const junctionModelName =
			this.schemaRegistry.findModelByTableName(junctionTable);
		if (!junctionModelName) {
			throwJunctionTableNotFound({
				adapter: "mysql",
				junctionTable,
				relationName,
				schemaName: currentSchema.name,
			});
		}

		// Escape identifiers
		const sourceTableEsc = escapeIdentifier(sourceTable);
		const sourceFKEsc = escapeIdentifier(sourceFK);
		const targetFKEsc = escapeIdentifier(targetFK);
		const relationAlias = escapeIdentifier(relationName);
		const junctionAlias = `${relationName}_junction`;
		const junctionAliasEsc = escapeIdentifier(junctionAlias);

		// Two JOINs needed
		return [
			// First: source -> junction
			{
				type: "LEFT JOIN",
				table: junctionTable,
				alias: junctionAlias,
				condition: `${sourceTableEsc}.\`id\` = ${junctionAliasEsc}.${sourceFKEsc}`,
			},
			// Second: junction -> target
			{
				type: "LEFT JOIN",
				table: targetTable,
				alias: relationName,
				condition: `${junctionAliasEsc}.${targetFKEsc} = ${relationAlias}.\`id\``,
			},
		];
	}

	/**
	 * Generate SQL string from JOIN clauses
	 */
	generateJoinSQL(joins: readonly JoinClause[]): string {
		return joins
			.map((join) => {
				const tableEsc = escapeIdentifier(join.table);
				const aliasEsc = escapeIdentifier(join.alias);

				return `${join.type} ${tableEsc} AS ${aliasEsc} ON ${join.condition}`;
			})
			.join(" ");
	}
}
