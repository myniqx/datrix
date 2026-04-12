/**
 * PostgreSQL JOIN Builder
 *
 * Generates SQL JOIN clauses for populate functionality.
 * Supports all relation types: belongsTo, hasOne, hasMany, manyToMany.
 */

import type { DatrixEntry, ISchemaRegistry, RelationField } from "@datrix/core";
import type { PostgresQueryTranslator } from "../query-translator";
import type { JoinClause, PopulateStrategy } from "./types";
import {
	throwModelNotFound,
	throwSchemaNotFound,
	throwRelationNotFound,
	throwInvalidRelationType,
	throwTargetModelNotFound,
	throwJoinBuildError,
	throwJunctionTableNotFound,
} from "@datrix/core";
import { PostgresQueryObject } from "../types";

/**
 * JOIN Builder Class
 *
 * Generates optimized JOIN clauses for different populate strategies.
 */
export class JoinBuilder {
	constructor(
		private schemaRegistry: ISchemaRegistry,
		private translator: PostgresQueryTranslator,
	) {}

	/**
	 * Build all JOINs for a query
	 *
	 * For json-aggregation strategy:
	 * - Only generates JOINs for belongsTo and hasOne relations
	 * - hasMany and manyToMany use subqueries (no JOIN to avoid row explosion)
	 *
	 * For lateral-joins strategy:
	 * - Handles all complex populate options via LATERAL subqueries
	 *
	 * @param query - Query with populate
	 * @param strategy - Populate strategy
	 * @returns Array of JOIN clauses
	 */
	buildJoins<T extends DatrixEntry>(
		query: PostgresQueryObject<T>,
		strategy: PopulateStrategy,
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

		for (const [relationName, options] of Object.entries(query.populate)) {
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

			// For json-aggregation strategy: only JOIN belongsTo/hasOne
			// hasMany/manyToMany will use subqueries in AggregationBuilder
			if (strategy === "json-aggregation") {
				if (relField.kind === "belongsTo" || relField.kind === "hasOne") {
					const joinClauses = this.buildRelationJoin(
						query.table,
						relationName,
						relField,
						strategy,
						options,
					);
					joins.push(...joinClauses);
				}
			} else {
				// For lateral-joins: build LATERAL JOINs for all relations
				const joinClauses = this.buildRelationJoin(
					query.table,
					relationName,
					relField,
					strategy,
					options,
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
		strategy: PopulateStrategy,
		options: unknown,
	): JoinClause[] {
		try {
			switch (relation.kind) {
				case "belongsTo":
					return this.buildBelongsToJoin(sourceTable, relationName, relation);

				case "hasOne":
					if (strategy === "lateral-joins" && this.hasComplexOptions(options)) {
						return this.buildHasOneLateralJoin(
							sourceTable,
							relationName,
							relation,
							options,
						);
					}
					return this.buildHasOneJoin(sourceTable, relationName, relation);

				case "hasMany":
					if (strategy === "lateral-joins" && this.hasComplexOptions(options)) {
						return this.buildHasManyLateralJoin(
							sourceTable,
							relationName,
							relation,
							options,
						);
					}
					return this.buildHasManyJoin(sourceTable, relationName, relation);

				case "manyToMany":
					if (strategy === "lateral-joins" && this.hasComplexOptions(options)) {
						return this.buildManyToManyLateralJoin(
							sourceTable,
							relationName,
							relation,
							options,
						);
					}
					return this.buildManyToManyJoin(sourceTable, relationName, relation);

				default:
					throwJoinBuildError({
						adapter: "postgres",
						relationName,
						relationKind: relation.kind,
					});
			}
		} catch (error) {
			if (error instanceof Error && error.message.includes("ADAPTER_")) {
				throw error;
			}
			throwJoinBuildError({
				adapter: "postgres",
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
				isLateral: false,
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

		const condition = `${sourceTableEsc}."id" = ${relationAlias}.${foreignKeyEsc}`;

		return [
			{
				type: "LEFT JOIN",
				table: targetTable, // NOT escaped
				alias: relationName, // NOT escaped
				condition,
				isLateral: false,
			},
		];
	}

	/**
	 * Build JOIN for hasMany relation
	 *
	 * Target has FK: source.id = target.foreignKey
	 * Uses LEFT JOIN (aggregation happens in SELECT)
	 *
	 * Example: User.id <- Post.authorId
	 * LEFT JOIN posts ON users.id = posts.author_id
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
	 * Build LATERAL JOIN for hasOne with complex options
	 *
	 * Allows limit, offset, where, orderBy on the relation
	 */
	private buildHasOneLateralJoin(
		sourceTable: string,
		relationName: string,
		relation: RelationField,
		_options: unknown,
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
		const targetTableEsc = this.translator.escapeIdentifier(targetTable);
		const foreignKeyEsc = this.translator.escapeIdentifier(foreignKey);
		const relationAlias = this.translator.escapeIdentifier(relationName);

		// LATERAL JOIN allows subquery to reference outer query
		const condition = `${sourceTableEsc}."id" = ${targetTableEsc}.${foreignKeyEsc}`;

		// Note: The actual subquery with options is built in aggregation-builder.ts
		// This just creates the JOIN structure
		return [
			{
				type: "LATERAL",
				table: targetTable,
				alias: `${relationAlias}_lateral`,
				condition,
				isLateral: true,
			},
		];
	}

	/**
	 * Build LATERAL JOIN for hasMany with complex options
	 */
	private buildHasManyLateralJoin(
		sourceTable: string,
		relationName: string,
		relation: RelationField,
		options: unknown,
	): JoinClause[] {
		// Same as hasOne LATERAL but with json_agg in subquery
		return this.buildHasOneLateralJoin(
			sourceTable,
			relationName,
			relation,
			options,
		);
	}

	/**
	 * Build JOIN for manyToMany relation
	 *
	 * Requires junction table: source.id = junction.sourceFK
	 *                          junction.targetFK = target.id
	 *
	 * Example: Post <-> Tag via post_tags
	 * LEFT JOIN post_tags ON posts.id = post_tags.post_id
	 * LEFT JOIN tags ON post_tags.tag_id = tags.id
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
				adapter: "postgres",
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
			throwModelNotFound({ adapter: "postgres", table: sourceTable });
		}

		const currentSchema = this.schemaRegistry.get(currentModelName);
		if (!currentSchema) {
			throwSchemaNotFound({ adapter: "postgres", modelName: currentModelName });
		}

		// Foreign key names in junction table: {ModelName}Id
		const sourceFK = `${currentSchema.name}Id`;
		const targetFK = `${relation.model}Id`;

		// Check if junction table exists
		const junctionModelName =
			this.schemaRegistry.findModelByTableName(junctionTable);
		if (!junctionModelName) {
			throwJunctionTableNotFound({
				adapter: "postgres",
				junctionTable,
				relationName,
				schemaName: currentSchema.name,
			});
		}

		// Escape identifiers (for condition building only)
		const sourceTableEsc = this.translator.escapeIdentifier(sourceTable);
		const sourceFKEsc = this.translator.escapeIdentifier(sourceFK);
		const targetFKEsc = this.translator.escapeIdentifier(targetFK);
		const relationAlias = this.translator.escapeIdentifier(relationName);
		const junctionAlias = `${relationName}_junction`;
		const junctionAliasEsc = this.translator.escapeIdentifier(junctionAlias);

		// Two JOINs needed
		return [
			// First: source -> junction
			{
				type: "LEFT JOIN",
				table: junctionTable, // NOT escaped - will be escaped in generateJoinSQL
				alias: junctionAlias, // NOT escaped - will be escaped in generateJoinSQL
				condition: `${sourceTableEsc}."id" = ${junctionAliasEsc}.${sourceFKEsc}`,
				isLateral: false,
			},
			// Second: junction -> target
			{
				type: "LEFT JOIN",
				table: targetTable, // NOT escaped
				alias: relationName, // NOT escaped
				condition: `${junctionAliasEsc}.${targetFKEsc} = ${relationAlias}."id"`,
				isLateral: false,
			},
		];
	}

	/**
	 * Build LATERAL JOIN for manyToMany with complex options
	 */
	private buildManyToManyLateralJoin(
		sourceTable: string,
		relationName: string,
		relation: RelationField,
		_options: unknown,
	): JoinClause[] {
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

		// Check junction table exists
		const junctionModelName =
			this.schemaRegistry.findModelByTableName(junctionTable);
		if (!junctionModelName) {
			throwJunctionTableNotFound({
				adapter: "postgres",
				junctionTable,
				relationName,
				schemaName: currentSchema.name,
			});
		}

		// For LATERAL, we'll use a subquery that handles the junction internally
		const sourceTableEsc = this.translator.escapeIdentifier(sourceTable);

		return [
			{
				type: "LATERAL",
				table: targetTable,
				alias: `${relationName}_lateral`,
				condition: `${sourceTableEsc}."id" IS NOT NULL`, // Placeholder, actual condition in subquery
				isLateral: true,
			},
		];
	}

	/**
	 * Check if populate options include complex features
	 */
	private hasComplexOptions(options: unknown): boolean {
		if (typeof options !== "object" || options === null) {
			return false;
		}

		const opts = options as Record<string, unknown>;

		return (
			"limit" in opts ||
			"offset" in opts ||
			"where" in opts ||
			"orderBy" in opts
		);
	}

	/**
	 * Generate SQL string from JOIN clauses
	 */
	generateJoinSQL(joins: readonly JoinClause[]): string {
		return joins
			.map((join) => {
				const tableEsc = this.translator.escapeIdentifier(join.table);
				const aliasEsc = this.translator.escapeIdentifier(join.alias);

				if (join.isLateral) {
					// LATERAL joins handled by AggregationBuilder
					return "";
				}

				return `${join.type} ${tableEsc} AS ${aliasEsc} ON ${join.condition}`;
			})
			.filter((sql) => sql !== "")
			.join(" ");
	}
}
