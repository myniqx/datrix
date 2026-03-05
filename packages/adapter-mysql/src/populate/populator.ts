/**
 * MySQL Populator
 *
 * Main orchestrator for populate functionality.
 * Decides strategy based on query complexity and executes accordingly.
 */

import type { Pool, PoolConnection } from "mysql2/promise";
import type {
	QueryPopulate,
	QuerySelectObject,
} from "forja-types/core/query-builder";
import type { SchemaRegistry } from "forja-core/schema";
import type { MySQLQueryTranslator } from "../query-translator";
import type { PopulateStrategy, PopulateOptionsAnalysis } from "./types";
import { JoinBuilder } from "./join-builder";
import { AggregationBuilder } from "./aggregation-builder";
import { ResultProcessor } from "./result-processor";
import {
	throwMaxDepthExceeded,
	throwPopulateQueryError,
} from "forja-types/errors/adapter";
import { ForjaEntry } from "forja-types";
import { MySQLQueryObject } from "../types";

/**
 * Maximum populate nesting depth
 */
const MAX_POPULATE_DEPTH = 5;

/**
 * MySQL Populator Class
 *
 * Handles all populate operations with strategy selection:
 * - JSON Aggregation: Single query with JSON_ARRAYAGG() for simple cases
 * - LATERAL Joins: Complex populate options (limit, offset, where, orderBy) - MySQL 8.0.14+
 * - Separate Queries: Fallback for very deep nesting (>3 levels)
 *
 * @example
 * ```ts
 * const populator = new MySQLPopulator(pool, translator, schemaRegistry);
 * const results = await populator.populate(query);
 * ```
 */
export class MySQLPopulator {
	private joinBuilder: JoinBuilder;
	private aggregationBuilder: AggregationBuilder;
	private resultProcessor: ResultProcessor;

	constructor(
		private pool: Pool | PoolConnection,
		private translator: MySQLQueryTranslator,
		private schemaRegistry: SchemaRegistry,
	) {
		this.joinBuilder = new JoinBuilder(schemaRegistry, translator);
		this.aggregationBuilder = new AggregationBuilder(
			translator,
			schemaRegistry,
		);
		this.resultProcessor = new ResultProcessor(schemaRegistry);
	}

	/**
	 * Main entry point for populate
	 *
	 * Analyzes query, selects strategy, and executes populate
	 *
	 * @param query - Query object with populate
	 * @returns Rows with populated relations
	 */
	async populate<T extends ForjaEntry>(
		query: QuerySelectObject<T>,
	): Promise<readonly T[]> {
		if (!query.populate) {
			return [] as readonly T[];
		}

		// Analyze populate requirements
		const analysis = this.analyzePopulate(query.populate, query.table);

		// Check max depth
		if (analysis.maxDepth > MAX_POPULATE_DEPTH) {
			throwMaxDepthExceeded({
				adapter: "mysql",
				currentDepth: analysis.maxDepth,
				maxDepth: MAX_POPULATE_DEPTH,
				relationPath: this.buildRelationPath(query.populate),
			});
		}

		// Select strategy
		const strategy = this.selectStrategy(analysis);

		// Execute based on strategy
		switch (strategy) {
			case "json-aggregation":
				return this.executeJsonAggregation<T>(query);
			case "lateral-joins":
				return this.executeLateralJoins<T>(query);
			case "batched-queries":
				return this.executeBatchedQueries<T>(query);
		}
	}

	/**
	 * Strategy 1: JSON Aggregation (Default, Most Performant)
	 *
	 * Uses JSON_ARRAYAGG() and JSON_OBJECT() for single-query populate.
	 * Best for simple cases without complex populate options.
	 */
	private async executeJsonAggregation<T extends ForjaEntry>(
		query: QuerySelectObject<T>,
	): Promise<readonly T[]> {
		// Build modified query with JOINs and aggregations
		const modifiedQuery = this.buildJsonAggregationQuery(query);

		// Execute query
		const { sql, params } = this.translator.translate(modifiedQuery);
		try {
			const [rows] = await this.pool.query(sql, params);

			// Process results (parse JSON fields)
			const processed = this.resultProcessor.processJsonAggregation<T>(
				rows as T[],
				query.populate!,
			);

			return processed;
		} catch (error) {
			throwPopulateQueryError({
				adapter: "mysql",
				query,
				sql,
				cause: error instanceof Error ? error : new Error(String(error)),
				strategy: "json-aggregation",
				queryParams: params,
			});
		}
	}

	/**
	 * Strategy 2: LATERAL Joins (Complex Options) - MySQL 8.0.14+
	 *
	 * Uses LATERAL joins for populate with limit/offset/where/orderBy.
	 * Allows per-relation options while maintaining single query.
	 */
	private async executeLateralJoins<T extends ForjaEntry>(
		query: QuerySelectObject<T>,
	): Promise<readonly T[]> {
		// Build modified query with LATERAL JOINs
		const modifiedQuery = this.buildLateralJoinsQuery(query);

		// Execute query
		const { sql, params } = this.translator.translate(modifiedQuery);
		try {
			const [rows] = await this.pool.query(sql, params);

			// Process results (parse JSON fields)
			const processed = this.resultProcessor.processJsonAggregation<T>(
				rows as T[],
				query.populate!,
			);

			return processed;
		} catch (error) {
			throwPopulateQueryError({
				adapter: "mysql",
				query,
				sql,
				cause: error instanceof Error ? error : new Error(String(error)),
				strategy: "lateral-joins",
				queryParams: params,
			});
		}
	}

	/**
	 * Strategy 3: Batched Queries (Deep Nesting / High Cardinality)
	 *
	 * Executes batched queries for each relation (avoids N+1).
	 * Best for deep nesting (depth > 2) or high cardinality (estimatedCost > 8).
	 */
	private async executeBatchedQueries<T extends ForjaEntry>(
		query: QuerySelectObject<T>,
	): Promise<readonly T[]> {
		const { sql, params } = this.translator.translate(query);

		let rows: T[];
		try {
			const [mainRows] = await this.pool.query(sql, params);
			rows = mainRows as T[];
		} catch (error) {
			throwPopulateQueryError({
				adapter: "mysql",
				query,
				sql,
				cause: error instanceof Error ? error : new Error(String(error)),
				strategy: "batched-queries",
				queryParams: params,
			});
		}

		if (rows.length === 0) {
			return rows;
		}

		const parentIds = rows.map((row) => row.id);

		const modelName = this.schemaRegistry.findModelByTableName(query.table);
		if (!modelName) return rows;

		const schema = this.schemaRegistry.get(modelName);
		if (!schema) return rows;

		for (const [relationName, _options] of Object.entries(query.populate!)) {
			const relationField = schema.fields[relationName];
			if (!relationField || relationField.type !== "relation") continue;

			const relation = relationField as {
				kind: string;
				model: string;
				foreignKey?: string;
				through?: string;
			};
			const targetSchema = this.schemaRegistry.get(relation.model);
			if (!targetSchema) continue;

			const targetTable =
				targetSchema.tableName ?? relation.model.toLowerCase();

			let batchQuery: string;
			let fkColumn: string = "";

			const targetTableEsc = this.translator.escapeIdentifier(targetTable);

			if (relation.kind === "belongsTo" || relation.kind === "hasOne") {
				fkColumn = relation.foreignKey!;
				const fkColumnEsc = this.translator.escapeIdentifier(fkColumn);
				// Build JSON_OBJECT for all non-relation fields
				const fields = Object.entries(targetSchema.fields)
					.filter(([_, field]) => field.type !== "relation")
					.map(([name]) => name);
				const jsonPairs = fields
					.map((f) => `'${f}', t.${this.translator.escapeIdentifier(f)}`)
					.join(", ");

				batchQuery = `
          SELECT t.${fkColumnEsc} as _fk, JSON_OBJECT(${jsonPairs}) as data
          FROM ${targetTableEsc} t
          WHERE t.\`id\` IN (?)
        `;
			} else if (relation.kind === "hasMany") {
				fkColumn = relation.foreignKey!;
				const fkColumnEsc = this.translator.escapeIdentifier(fkColumn);
				// Build JSON_OBJECT for all non-relation fields
				const fields = Object.entries(targetSchema.fields)
					.filter(([_, field]) => field.type !== "relation")
					.map(([name]) => name);
				const jsonPairs = fields
					.map((f) => `'${f}', t.${this.translator.escapeIdentifier(f)}`)
					.join(", ");

				batchQuery = `
          SELECT t.${fkColumnEsc} as _fk, JSON_ARRAYAGG(JSON_OBJECT(${jsonPairs})) as data
          FROM ${targetTableEsc} t
          WHERE t.${fkColumnEsc} IN (?)
          GROUP BY t.${fkColumnEsc}
        `;
			} else if (relation.kind === "manyToMany") {
				const junctionTable = relation.through!;
				const sourceFK = `${schema.name}Id`;
				const targetFK = `${relation.model}Id`;

				const junctionTableEsc =
					this.translator.escapeIdentifier(junctionTable);
				const sourceFKEsc = this.translator.escapeIdentifier(sourceFK);
				const targetFKEsc = this.translator.escapeIdentifier(targetFK);

				// Build JSON_OBJECT for all non-relation fields
				const fields = Object.entries(targetSchema.fields)
					.filter(([_, field]) => field.type !== "relation")
					.map(([name]) => name);
				const jsonPairs = fields
					.map((f) => `'${f}', t.${this.translator.escapeIdentifier(f)}`)
					.join(", ");

				batchQuery = `
          SELECT j.${sourceFKEsc} as _fk, JSON_ARRAYAGG(JSON_OBJECT(${jsonPairs})) as data
          FROM ${targetTableEsc} t
          INNER JOIN ${junctionTableEsc} j ON t.\`id\` = j.${targetFKEsc}
          WHERE j.${sourceFKEsc} IN (?)
          GROUP BY j.${sourceFKEsc}
        `;
			} else {
				continue;
			}

			let batchResult;
			try {
				const [batchRows] = await this.pool.query(batchQuery, [parentIds]);
				batchResult = batchRows as Array<{ _fk: unknown; data: unknown }>;
			} catch (error) {
				throwPopulateQueryError({
					adapter: "mysql",
					query,
					sql: batchQuery,
					cause: error instanceof Error ? error : new Error(String(error)),
					strategy: "batched-queries",
					queryParams: [parentIds],
				});
			}

			const dataMap = new Map(batchResult.map((r) => [r._fk, r.data]));

			for (const row of rows) {
				if (relation.kind === "belongsTo" || relation.kind === "hasOne") {
					const fkValue = row[fkColumn as keyof T];
					row[relationName as keyof T] = (dataMap.get(fkValue) ||
						null) as T[keyof T];
				} else {
					row[relationName as keyof T] = (dataMap.get(row.id) ||
						[]) as T[keyof T];
				}
			}
		}

		return rows;
	}

	/**
	 * Build query with JSON aggregation
	 */
	private buildJsonAggregationQuery<T extends ForjaEntry>(
		query: QuerySelectObject<T>,
	): MySQLQueryObject<T> {
		const mysqlQuery = query as MySQLQueryObject<T>;
		const joins = this.joinBuilder.buildJoins(mysqlQuery, "json-aggregation");
		const aggregations = this.aggregationBuilder.buildAggregations(
			query.table,
			query.populate!,
		);

		const joinSQL = this.joinBuilder.generateJoinSQL(joins);
		const aggregationSQL =
			this.aggregationBuilder.generateAggregationSQL(aggregations);

		return {
			...query,
			_metadata: {
				populateJoins: joinSQL,
				populateAggregations: aggregationSQL,
			},
		} as MySQLQueryObject<T>;
	}

	/**
	 * Build query with LATERAL joins
	 */
	private buildLateralJoinsQuery<T extends ForjaEntry>(
		query: QuerySelectObject<T>,
	): MySQLQueryObject<T> {
		return {
			...query,
			_metadata: {
				populateStrategy: "lateral-joins" as const,
				populateClause: query.populate,
			},
		} as MySQLQueryObject<T>;
	}

	/**
	 * Analyze populate requirements
	 */
	private analyzePopulate<T extends ForjaEntry>(
		populate: QueryPopulate<T>,
		tableName: string,
	): PopulateOptionsAnalysis {
		let maxDepth = 1;
		let hasComplexOptions = false;
		let relationCount = 0;
		let oneToManyCount = 0;
		let constrainedRelationCount = 0;

		const analyze = (
			pop: QueryPopulate<T>,
			currentTableName: string,
			depth: number,
		): void => {
			if (depth > maxDepth) {
				maxDepth = depth;
			}

			const modelName =
				this.schemaRegistry.findModelByTableName(currentTableName);
			if (!modelName) return;

			const schema = this.schemaRegistry.get(modelName);
			if (!schema) return;

			for (const [relationName, options] of Object.entries(pop)) {
				relationCount++;

				const relationField = schema.fields[relationName];
				if (!relationField || relationField.type !== "relation") continue;

				const relation = relationField as { kind: string; model: string };

				if (relation.kind === "hasMany" || relation.kind === "manyToMany") {
					oneToManyCount++;
				}

				if (typeof options === "object" && options !== null) {
					if (
						"limit" in options ||
						"offset" in options ||
						"where" in options ||
						"orderBy" in options
					) {
						hasComplexOptions = true;
						constrainedRelationCount++;
					}

					if ("populate" in options && options.populate) {
						const targetSchema = this.schemaRegistry.get(relation.model);
						if (targetSchema) {
							const targetTableName =
								targetSchema.tableName ?? relation.model.toLowerCase();
							analyze(options.populate, targetTableName, depth + 1);
						}
					}
				}
			}
		};

		analyze(populate, tableName, 1);

		const estimatedCost = oneToManyCount * maxDepth;

		return {
			hasComplexOptions,
			maxDepth,
			requiresLateral: hasComplexOptions,
			requiresSeparateQueries: maxDepth > 3,
			relationCount,
			oneToManyCount,
			constrainedRelationCount,
			estimatedCost,
		};
	}

	/**
	 * Select populate strategy based on analysis
	 *
	 * Strategy selection logic:
	 * 1. Complex options (limit/where/orderBy) → lateral-joins
	 * 2. Deep nesting (depth > 2) or high cardinality (estimatedCost > 8) → batched-queries
	 * 3. Default → json-aggregation (subquery-based, no row explosion)
	 */
	private selectStrategy(analysis: PopulateOptionsAnalysis): PopulateStrategy {
		// Complex options: use LATERAL joins
		if (analysis.hasComplexOptions) {
			return "lateral-joins";
		}

		// Deep nesting or high cardinality: use batched queries
		if (analysis.maxDepth > 2 || analysis.estimatedCost > 8) {
			return "batched-queries";
		}

		// Default: JSON aggregation (subquery-based)
		return "json-aggregation";
	}

	/**
	 * Build relation path string for error messages
	 */
	private buildRelationPath<T extends ForjaEntry>(
		populate: QueryPopulate<T>,
		prefix = "",
	): string {
		const paths: string[] = [];

		for (const [relationName, options] of Object.entries(populate)) {
			const currentPath = prefix ? `${prefix}.${relationName}` : relationName;
			paths.push(currentPath);

			if (typeof options === "object" && options.populate) {
				paths.push(
					...this.buildRelationPath(options.populate, currentPath).split(", "),
				);
			}
		}

		return paths.join(", ");
	}
}
