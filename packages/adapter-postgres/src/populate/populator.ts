/**
 * PostgreSQL Populator
 *
 * Main orchestrator for populate functionality.
 * Decides strategy based on query complexity and executes accordingly.
 */

import type { Pool, PoolClient } from "pg";
import type {
	QueryPopulate,
	QuerySelectObject,
} from "forja-types/core/query-builder";
import type { SchemaRegistry } from "forja-core/schema";
import type { PostgresQueryTranslator } from "../query-translator";
import type { PopulateStrategy, PopulateOptionsAnalysis } from "./types";
import { JoinBuilder } from "./join-builder";
import { AggregationBuilder } from "./aggregation-builder";
import { ResultProcessor } from "./result-processor";
import {
	throwMaxDepthExceeded,
	throwPopulateQueryError,
} from "forja-types/errors/adapter";
import { ForjaEntry } from "forja-types";
import { PostgresQueryObject } from "forja-adapter-postgres/types";

/**
 * Maximum populate nesting depth
 */
const MAX_POPULATE_DEPTH = 5;

/**
 * PostgreSQL Populator Class
 *
 * Handles all populate operations with strategy selection:
 * - JSON Aggregation: Single query with json_agg() for simple cases
 * - LATERAL Joins: Complex populate options (limit, offset, where, orderBy)
 * - Separate Queries: Fallback for very deep nesting (>3 levels)
 *
 * @example
 * ```ts
 * const populator = new PostgresPopulator(pool, translator, schemaRegistry);
 * const results = await populator.populate(query);
 * ```
 */
export class PostgresPopulator {
	private joinBuilder: JoinBuilder;
	private aggregationBuilder: AggregationBuilder;
	private resultProcessor: ResultProcessor;

	constructor(
		private pool: Pool | PoolClient,
		private translator: PostgresQueryTranslator,
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
				adapter: "postgres",
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
	 * Uses json_agg() and row_to_json() for single-query populate.
	 * Best for simple cases without complex populate options.
	 *
	 * SQL Example:
	 * ```sql
	 * SELECT
	 *   posts.*,
	 *   row_to_json(users.*) as author,
	 *   json_agg(DISTINCT comments.*) FILTER (WHERE comments.id IS NOT NULL) as comments
	 * FROM posts
	 * LEFT JOIN users ON posts.author_id = users.id
	 * LEFT JOIN comments ON posts.id = comments.post_id
	 * GROUP BY posts.id, users.id
	 * ```
	 */
	private async executeJsonAggregation<T extends ForjaEntry>(
		query: QuerySelectObject<T>,
	): Promise<readonly T[]> {
		// Build modified query with JOINs and aggregations
		const modifiedQuery = this.buildJsonAggregationQuery(query);

		// Execute query
		const { sql, params } = this.translator.translate(modifiedQuery);
		try {
			const result = await this.pool.query(sql, params as unknown[]);

			// Process results (parse JSON fields)
			const processed = this.resultProcessor.processJsonAggregation<T>(
				result.rows as T[],
				query.populate!,
			);

			return processed;
		} catch (error) {
			throwPopulateQueryError({
				adapter: "postgres",
				query,
				sql,
				cause: error instanceof Error ? error : new Error(String(error)),
				strategy: "json-aggregation",
				queryParams: params,
			});
		}
	}

	/**
	 * Strategy 2: LATERAL Joins (Complex Options)
	 *
	 * Uses LATERAL joins for populate with limit/offset/where/orderBy.
	 * Allows per-relation options while maintaining single query.
	 *
	 * SQL Example:
	 * ```sql
	 * SELECT
	 *   posts.*,
	 *   related_comments.data as comments
	 * FROM posts
	 * LEFT JOIN LATERAL (
	 *   SELECT json_agg(row_to_json(c.*)) as data
	 *   FROM (
	 *     SELECT comments.*
	 *     FROM comments
	 *     WHERE comments.post_id = posts.id
	 *       AND comments.status = 'approved'
	 *     ORDER BY comments.created_at DESC
	 *     LIMIT 5
	 *   ) c
	 * ) related_comments ON true
	 * ```
	 */
	private async executeLateralJoins<T extends ForjaEntry>(
		query: QuerySelectObject<T>,
	): Promise<readonly T[]> {
		// Build modified query with LATERAL JOINs
		const modifiedQuery = this.buildLateralJoinsQuery(query);

		// Execute query
		const { sql, params } = this.translator.translate(modifiedQuery);
		try {
			const result = await this.pool.query(sql, params as unknown[]);

			// Process results (parse JSON fields)
			const processed = this.resultProcessor.processJsonAggregation<T>(
				result.rows as T[],
				query.populate!,
			);

			return processed;
		} catch (error) {
			throwPopulateQueryError({
				adapter: "postgres",
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
	 *
	 * Example:
	 * 1. Execute main query: SELECT * FROM posts
	 * 2. Batch populate tags: SELECT post_id, jsonb_agg(tags.*) FROM tags ... WHERE post_id = ANY($1) GROUP BY post_id
	 * 3. Map in memory: posts[i].tags = tagsMap.get(posts[i].id)
	 */
	private async executeBatchedQueries<T extends ForjaEntry>(
		query: QuerySelectObject<T>,
	): Promise<readonly T[]> {
		const modelName = this.schemaRegistry.findModelByTableName(query.table);
		if (!modelName) return [];

		const schema = this.schemaRegistry.get(modelName);
		if (!schema) return [];

		// Collect FK columns needed for belongsTo/hasOne relations so they
		// are present in the main query result even though they are hidden fields.
		const fkColumnsNeeded: string[] = [];
		for (const [relationName, _opts] of Object.entries(query.populate ?? {})) {
			const relationField = schema.fields[relationName];
			if (!relationField || relationField.type !== "relation") continue;
			const rel = relationField as { kind: string; foreignKey?: string };
			if (
				(rel.kind === "belongsTo" || rel.kind === "hasOne") &&
				rel.foreignKey
			) {
				fkColumnsNeeded.push(rel.foreignKey);
			}
		}

		// Inject FK columns into the select list if needed
		const queryWithFks: QuerySelectObject<T> =
			fkColumnsNeeded.length > 0
				? {
					...query,
					select: ([
						...(query.select as string[]),
						...fkColumnsNeeded,
					] as unknown as QuerySelectObject<T>["select"])
				}
				: query;

		const { sql, params } = this.translator.translate(queryWithFks);

		let rows: T[];
		try {
			const mainResult = await this.pool.query(sql, params as unknown[]);
			rows = mainResult.rows as T[];
		} catch (error) {
			throwPopulateQueryError({
				adapter: "postgres",
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

		for (const [relationName, _options] of Object.entries(query.populate!)) {
			const relationField = schema.fields[relationName];
			const options = _options as QueryPopulate<T>;
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
			let fkColumn: string;

			if (relation.kind === "belongsTo" || relation.kind === "hasOne") {
				fkColumn = relation.foreignKey!;
				const fkValues = rows
					.map((row) => row[fkColumn as keyof T])
					.filter((v) => v != null);
				batchQuery = `
          SELECT t."id" as _fk, row_to_json(t.*) as data
          FROM ${this.translator.escapeIdentifier(targetTable)} t
          WHERE t."id" = ANY($1)
        `;
				let batchResult;
				try {
					batchResult = await this.pool.query(batchQuery, [fkValues]);
				} catch (error) {
					throwPopulateQueryError({
						adapter: "postgres",
						query,
						sql: batchQuery,
						cause: error instanceof Error ? error : new Error(String(error)),
						strategy: "batched-queries",
						queryParams: [fkValues],
					});
				}

				let relatedRows: ForjaEntry[] = batchResult.rows.map(
					(r) => r.data as ForjaEntry,
				);

				// Recursive nested populate
				const nestedPopulate = options?.["populate"];
				if (nestedPopulate && relatedRows.length > 0) {
					relatedRows = await this.populateBatchedRows<T>(
						relatedRows,
						targetTable,
						nestedPopulate,
					);
				}

				const dataMap = new Map(relatedRows.map((r) => [r.id, r]));

				for (const row of rows) {
					const fkValue = row[fkColumn as keyof T];
					row[relationName as keyof T] = (dataMap.get(fkValue as number) ||
						null) as T[keyof T];
					// Remove the hidden FK column injected for this lookup
					delete row[fkColumn as keyof T];
				}
			} else if (relation.kind === "hasMany") {
				fkColumn = relation.foreignKey!;
				batchQuery = `
          SELECT t."${fkColumn}" as _fk, row_to_json(t.*) as data
          FROM ${this.translator.escapeIdentifier(targetTable)} t
          WHERE t."${fkColumn}" = ANY($1)
        `;
				let batchResult;
				try {
					batchResult = await this.pool.query(batchQuery, [parentIds]);
				} catch (error) {
					throwPopulateQueryError({
						adapter: "postgres",
						query,
						sql: batchQuery,
						cause: error instanceof Error ? error : new Error(String(error)),
						strategy: "batched-queries",
						queryParams: [parentIds],
					});
				}

				let allRelatedRows: ForjaEntry[] = batchResult.rows.map((r) => ({
					...(r.data as ForjaEntry),
					_fk: r._fk,
				}));

				// Recursive nested populate
				const nestedPopulate = options?.["populate"];
				if (nestedPopulate && allRelatedRows.length > 0) {
					allRelatedRows = await this.populateBatchedRows(
						allRelatedRows,
						targetTable,
						nestedPopulate as QueryPopulate<ForjaEntry>,
					);
				}

				const groupMap = new Map<number, ForjaEntry[]>();
				for (const r of allRelatedRows) {
					const fk = (r as ForjaEntry & { _fk: number })._fk;
					if (!groupMap.has(fk)) groupMap.set(fk, []);
					groupMap.get(fk)!.push(r);
				}

				for (const row of rows) {
					row[relationName as keyof T] = (groupMap.get(row.id) ||
						[]) as T[keyof T];
				}
			} else if (relation.kind === "manyToMany") {
				const junctionTable = relation.through!;
				const sourceFK = `${schema.name}Id`;
				const targetFK = `${relation.model}Id`;

				batchQuery = `
          SELECT j."${sourceFK}" as _fk, row_to_json(t.*) as data
          FROM ${this.translator.escapeIdentifier(targetTable)} t
          INNER JOIN ${this.translator.escapeIdentifier(junctionTable)} j
            ON t."id" = j."${targetFK}"
          WHERE j."${sourceFK}" = ANY($1)
        `;
				let batchResult;
				try {
					batchResult = await this.pool.query(batchQuery, [parentIds]);
				} catch (error) {
					throwPopulateQueryError({
						adapter: "postgres",
						query,
						sql: batchQuery,
						cause: error instanceof Error ? error : new Error(String(error)),
						strategy: "batched-queries",
						queryParams: [parentIds],
					});
				}

				let allRelatedRows: ForjaEntry[] = batchResult.rows.map((r) => ({
					...(r.data as ForjaEntry),
					_fk: r._fk,
				}));

				// Recursive nested populate
				const nestedPopulate = options?.["populate"];
				if (nestedPopulate && allRelatedRows.length > 0) {
					allRelatedRows = await this.populateBatchedRows(
						allRelatedRows,
						targetTable,
						nestedPopulate as QueryPopulate<ForjaEntry>,
					);
				}

				const groupMap = new Map<number, ForjaEntry[]>();
				for (const r of allRelatedRows) {
					const fk = (r as ForjaEntry & { _fk: number })._fk;
					if (!groupMap.has(fk)) groupMap.set(fk, []);
					groupMap.get(fk)!.push(r);
				}

				for (const row of rows) {
					row[relationName as keyof T] = (groupMap.get(row.id) ||
						[]) as T[keyof T];
				}
			} else {
				continue;
			}
		}

		return rows;
	}

	/**
	 * Recursively populate nested relations on already-fetched rows
	 */
	private async populateBatchedRows<T extends ForjaEntry>(
		rows: T[],
		tableName: string,
		populate: QueryPopulate<T>,
	): Promise<T[]> {
		const modelName = this.schemaRegistry.findModelByTableName(tableName);
		if (!modelName) return rows;

		const schema = this.schemaRegistry.get(modelName);
		if (!schema) return rows;

		for (const [relationName, options] of Object.entries(populate)) {
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

			if (relation.kind === "belongsTo" || relation.kind === "hasOne") {
				const fkColumn = relation.foreignKey!;
				const fkValues = rows
					.map((row) => row[fkColumn as keyof T])
					.filter((v) => v != null);

				if (fkValues.length === 0) continue;

				const batchQuery = `
          SELECT t."id" as _fk, row_to_json(t.*) as data
          FROM ${this.translator.escapeIdentifier(targetTable)} t
          WHERE t."id" = ANY($1)
        `;
				const batchResult = await this.pool.query(batchQuery, [fkValues]);

				let relatedRows: ForjaEntry[] = batchResult.rows.map(
					(r) => r.data as ForjaEntry,
				);

				const nestedPopulate = options?.["populate"];
				if (nestedPopulate && relatedRows.length > 0) {
					relatedRows = await this.populateBatchedRows(
						relatedRows,
						targetTable,
						nestedPopulate as QueryPopulate<ForjaEntry>,
					);
				}

				const dataMap = new Map(relatedRows.map((r) => [r.id, r]));
				for (const row of rows) {
					const fkValue = row[fkColumn as keyof T];
					row[relationName as keyof T] = (dataMap.get(fkValue as number) ||
						null) as T[keyof T];
					delete row[fkColumn as keyof T];
				}
			} else if (relation.kind === "hasMany") {
				const fkColumn = relation.foreignKey!;
				const parentIds = rows.map((r) => r.id);

				const batchQuery = `
          SELECT t."${fkColumn}" as _fk, row_to_json(t.*) as data
          FROM ${this.translator.escapeIdentifier(targetTable)} t
          WHERE t."${fkColumn}" = ANY($1)
        `;
				const batchResult = await this.pool.query(batchQuery, [parentIds]);

				let allRelatedRows: ForjaEntry[] = batchResult.rows.map((r) => ({
					...(r.data as ForjaEntry),
					_fk: r._fk,
				}));

				const nestedPopulate = options?.["populate"];
				if (nestedPopulate && allRelatedRows.length > 0) {
					allRelatedRows = await this.populateBatchedRows(
						allRelatedRows,
						targetTable,
						nestedPopulate as QueryPopulate<ForjaEntry>,
					);
				}

				const groupMap = new Map<number, ForjaEntry[]>();
				for (const r of allRelatedRows) {
					const fk = (r as ForjaEntry & { _fk: number })._fk;
					if (!groupMap.has(fk)) groupMap.set(fk, []);
					groupMap.get(fk)!.push(r);
				}
				for (const row of rows) {
					row[relationName as keyof T] = (groupMap.get(row.id) ||
						[]) as T[keyof T];
				}
			} else if (relation.kind === "manyToMany") {
				const junctionTable = relation.through!;
				const sourceFK = `${schema.name}Id`;
				const targetFK = `${relation.model}Id`;
				const parentIds = rows.map((r) => r.id);

				const batchQuery = `
          SELECT j."${sourceFK}" as _fk, row_to_json(t.*) as data
          FROM ${this.translator.escapeIdentifier(targetTable)} t
          INNER JOIN ${this.translator.escapeIdentifier(junctionTable)} j
            ON t."id" = j."${targetFK}"
          WHERE j."${sourceFK}" = ANY($1)
        `;
				const batchResult = await this.pool.query(batchQuery, [parentIds]);

				let allRelatedRows: ForjaEntry[] = batchResult.rows.map((r) => ({
					...(r.data as ForjaEntry),
					_fk: r._fk,
				}));

				const nestedPopulate = options?.["populate"];
				if (nestedPopulate && allRelatedRows.length > 0) {
					allRelatedRows = await this.populateBatchedRows(
						allRelatedRows,
						targetTable,
						nestedPopulate as QueryPopulate<ForjaEntry>,
					);
				}

				const groupMap = new Map<number, ForjaEntry[]>();
				for (const r of allRelatedRows) {
					const fk = (r as ForjaEntry & { _fk: number })._fk;
					if (!groupMap.has(fk)) groupMap.set(fk, []);
					groupMap.get(fk)!.push(r);
				}
				for (const row of rows) {
					row[relationName as keyof T] = (groupMap.get(row.id) ||
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
	): PostgresQueryObject<T> {
		const pgQuery = query as PostgresQueryObject<T>;
		const joins = this.joinBuilder.buildJoins(pgQuery, "json-aggregation");
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
		} as PostgresQueryObject<T>;
	}

	/**
	 * Build query with LATERAL joins
	 */
	private buildLateralJoinsQuery<T extends ForjaEntry>(
		query: QuerySelectObject<T>,
	): PostgresQueryObject<T> {
		return {
			...query,
			_metadata: {
				populateStrategy: "lateral-joins" as const,
				populateClause: query.populate,
			},
		} as PostgresQueryObject<T>;
	}

	/**
	 * Analyze populate requirements
	 *
	 * Determines:
	 * - Max nesting depth
	 * - Whether complex options are used
	 * - Whether LATERAL joins are needed
	 * - Number of relations
	 * - One-to-many relation count (cardinality risk)
	 * - Constrained relation count (limit/orderBy)
	 * - Estimated cost for strategy selection
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
		if (analysis.maxDepth > 1 || analysis.estimatedCost > 8) {
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
