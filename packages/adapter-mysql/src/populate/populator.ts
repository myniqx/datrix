/**
 * MySQL Populator
 *
 * Main orchestrator for populate functionality.
 * Decides strategy based on query complexity and executes accordingly.
 */

import type { Pool, PoolConnection } from "mysql2/promise";
import type {
	QueryPopulate,
	QueryPopulateOptions,
	QuerySelectObject,
} from "forja-types/core/query-builder";
import type { SchemaRegistry } from "forja-core/schema";
import type { MySQLQueryTranslator } from "../query-translator";
import { escapeIdentifier } from "../helpers";
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
	 * Supports recursive nested populate at any depth.
	 */
	private async executeBatchedQueries<T extends ForjaEntry>(
		query: QuerySelectObject<T>,
	): Promise<readonly T[]> {
		const modelName = this.schemaRegistry.findModelByTableName(query.table);
		if (!modelName) return [];

		const schema = this.schemaRegistry.get(modelName);
		if (!schema) return [];

		// Inject belongsTo FK columns into SELECT
		const fkColumnsNeeded: string[] = [];
		for (const [relationName] of Object.entries(query.populate ?? {})) {
			const relationField = schema.fields[relationName];
			if (!relationField || relationField.type !== "relation") continue;
			const rel = relationField as { kind: string; foreignKey?: string };
			if (rel.kind === "belongsTo" && rel.foreignKey) {
				fkColumnsNeeded.push(rel.foreignKey);
			}
		}

		const queryWithFks: QuerySelectObject<T> =
			fkColumnsNeeded.length > 0
				? {
					...query,
					select: [
						...(query.select as string[]),
						...fkColumnsNeeded,
					] as unknown as QuerySelectObject<T>["select"],
				}
				: query;

		const { sql, params } = this.translator.translate(queryWithFks);

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

		for (const [relationName, _options] of Object.entries(query.populate!)) {
			const relationField = schema.fields[relationName];
			const options = _options as QueryPopulateOptions<T>;
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
			const targetTableEsc = escapeIdentifier(targetTable);

			if (relation.kind === "belongsTo") {
				const fkColumn = relation.foreignKey!;
				const fkValues = rows
					.map((row) => row[fkColumn as keyof T])
					.filter((v) => v != null);

				if (fkValues.length === 0) {
					for (const row of rows) {
						row[relationName as keyof T] = null as T[keyof T];
					}
					continue;
				}

				const jsonObj = this.buildJsonObject(relation.model, options);
				const batchQuery = `
          SELECT t.\`id\` as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          WHERE t.\`id\` IN (?)
        `;

				let batchResult;
				try {
					const [batchRows] = await this.pool.query(batchQuery, [fkValues]);
					batchResult = batchRows as Array<{ _fk: unknown; data: unknown }>;
				} catch (error) {
					throwPopulateQueryError({
						adapter: "mysql",
						query,
						sql: batchQuery,
						cause: error instanceof Error ? error : new Error(String(error)),
						strategy: "batched-queries",
						queryParams: [fkValues],
					});
				}

				let relatedRows: Partial<T>[] = batchResult.map(
					(r) =>
						(typeof r.data === "string"
							? JSON.parse(r.data)
							: r.data) as Partial<T>,
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
					// Remove the injected FK column
					delete row[fkColumn as keyof T];
				}
			} else if (relation.kind === "hasOne") {
				const fkColumn = relation.foreignKey!;
				const fkColumnEsc = escapeIdentifier(fkColumn);
				const jsonObj = this.buildJsonObject(relation.model, options);

				const batchQuery = `
          SELECT t.${fkColumnEsc} as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          WHERE t.${fkColumnEsc} IN (?)
        `;

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

				let relatedRows: Partial<T>[] = batchResult.map((r) => ({
					...((typeof r.data === "string"
						? JSON.parse(r.data)
						: r.data) as Partial<T>),
					_fk: r._fk,
				}));

				const nestedPopulate = options?.["populate"];
				if (nestedPopulate && relatedRows.length > 0) {
					relatedRows = await this.populateBatchedRows<T>(
						relatedRows,
						targetTable,
						nestedPopulate,
					);
				}

				const dataMap = new Map(
					relatedRows.map((r) => [(r as Partial<T> & { _fk: number })._fk, r]),
				);

				for (const row of rows) {
					row[relationName as keyof T] = (dataMap.get(row.id) ||
						null) as T[keyof T];
				}
			} else if (relation.kind === "hasMany") {
				const fkColumn = relation.foreignKey!;
				const fkColumnEsc = escapeIdentifier(fkColumn);
				const jsonObj = this.buildJsonObject(relation.model, options);

				const batchQuery = `
          SELECT t.${fkColumnEsc} as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          WHERE t.${fkColumnEsc} IN (?)
        `;

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

				let allRelatedRows: Partial<T>[] = batchResult.map((r) => ({
					...((typeof r.data === "string"
						? JSON.parse(r.data)
						: r.data) as Partial<T>),
					_fk: r._fk,
				}));

				const nestedPopulate = options?.["populate"];
				if (nestedPopulate && allRelatedRows.length > 0) {
					allRelatedRows = await this.populateBatchedRows<T>(
						allRelatedRows,
						targetTable,
						nestedPopulate as QueryPopulate<ForjaEntry>,
					);
				}

				const groupMap = new Map<number, Partial<T>[]>();
				for (const r of allRelatedRows) {
					const fk = (r as Partial<T> & { _fk: number })._fk;
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

				const junctionTableEsc = escapeIdentifier(junctionTable);
				const sourceFKEsc = escapeIdentifier(sourceFK);
				const targetFKEsc = escapeIdentifier(targetFK);
				const jsonObj = this.buildJsonObject(relation.model, options);

				const batchQuery = `
          SELECT j.${sourceFKEsc} as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          INNER JOIN ${junctionTableEsc} j ON t.\`id\` = j.${targetFKEsc}
          WHERE j.${sourceFKEsc} IN (?)
        `;

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

				let allRelatedRows: Partial<T>[] = batchResult.map((r) => ({
					...((typeof r.data === "string"
						? JSON.parse(r.data)
						: r.data) as Partial<T>),
					_fk: r._fk,
				}));

				const nestedPopulate = options?.["populate"];
				if (nestedPopulate && allRelatedRows.length > 0) {
					allRelatedRows = await this.populateBatchedRows<T>(
						allRelatedRows,
						targetTable,
						nestedPopulate as QueryPopulate<ForjaEntry>,
					);
				}

				const groupMap = new Map<number, Partial<T>[]>();
				for (const r of allRelatedRows) {
					const fk = (r as Partial<T> & { _fk: number })._fk;
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
	 * Recursively populate nested relations on already-fetched rows
	 */
	private async populateBatchedRows<T extends ForjaEntry>(
		rows: Partial<T>[],
		tableName: string,
		populate: QueryPopulate<T>,
	): Promise<Partial<T>[]> {
		const modelName = this.schemaRegistry.findModelByTableName(tableName);
		if (!modelName) return rows;

		const schema = this.schemaRegistry.get(modelName);
		if (!schema) return rows;

		for (const [relationName, _opts] of Object.entries(populate)) {
			const relationField = schema.fields[relationName];
			const opts = _opts as QueryPopulateOptions<ForjaEntry>;
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
			const targetTableEsc = escapeIdentifier(targetTable);
			const jsonObj = this.buildJsonObject(relation.model, opts);

			if (relation.kind === "belongsTo") {
				const fkColumn = relation.foreignKey!;
				const fkValues = rows
					.map((row) => row[fkColumn as keyof ForjaEntry])
					.filter((v) => v != null);

				if (fkValues.length === 0) continue;

				const batchQuery = `
          SELECT t.\`id\` as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          WHERE t.\`id\` IN (?)
        `;
				const [batchRows] = await this.pool.query(batchQuery, [fkValues]);
				let relatedRows: Partial<T>[] = (
					batchRows as Array<{ data: unknown }>
				).map(
					(r) =>
						(typeof r.data === "string"
							? JSON.parse(r.data)
							: r.data) as Partial<T>,
				);

				const nestedPopulate = opts.populate;
				if (nestedPopulate && relatedRows.length > 0) {
					relatedRows = await this.populateBatchedRows<T>(
						relatedRows,
						targetTable,
						nestedPopulate as QueryPopulate<ForjaEntry>,
					);
				}

				const dataMap = new Map(relatedRows.map((r) => [r.id, r]));
				for (const row of rows) {
					const fkValue = row[fkColumn as keyof ForjaEntry];
					(row as Record<string, unknown>)[relationName] =
						dataMap.get(fkValue as number) || null;
					delete (row as Record<string, unknown>)[fkColumn];
				}
			} else if (relation.kind === "hasOne") {
				const fkColumn = relation.foreignKey!;
				const fkColumnEsc = escapeIdentifier(fkColumn);
				const nestedParentIds = rows.map((r) => r.id);

				const batchQuery = `
          SELECT t.${fkColumnEsc} as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          WHERE t.${fkColumnEsc} IN (?)
        `;
				const [batchRows] = await this.pool.query(batchQuery, [
					nestedParentIds,
				]);
				let relatedRows: Partial<T>[] = (
					batchRows as Array<{ _fk: unknown; data: unknown }>
				).map((r) => ({
					...((typeof r.data === "string"
						? JSON.parse(r.data)
						: r.data) as Partial<T>),
					_fk: r._fk,
				}));

				const nestedPopulate = opts.populate;
				if (nestedPopulate && relatedRows.length > 0) {
					relatedRows = await this.populateBatchedRows<T>(
						relatedRows,
						targetTable,
						nestedPopulate as QueryPopulate<ForjaEntry>,
					);
				}

				const dataMap = new Map(
					relatedRows.map((r) => [(r as Partial<T> & { _fk: number })._fk, r]),
				);
				for (const row of rows) {
					(row as Record<string, unknown>)[relationName] =
						dataMap.get(row.id) || null;
				}
			} else if (relation.kind === "hasMany") {
				const fkColumn = relation.foreignKey!;
				const fkColumnEsc = escapeIdentifier(fkColumn);
				const nestedParentIds = rows.map((r) => r.id);

				const batchQuery = `
          SELECT t.${fkColumnEsc} as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          WHERE t.${fkColumnEsc} IN (?)
        `;
				const [batchRows] = await this.pool.query(batchQuery, [
					nestedParentIds,
				]);
				let allRelatedRows: Partial<T>[] = (
					batchRows as Array<{ _fk: unknown; data: unknown }>
				).map((r) => ({
					...((typeof r.data === "string"
						? JSON.parse(r.data)
						: r.data) as Partial<T>),
					_fk: r._fk,
				}));

				const nestedPopulate = opts.populate;
				if (nestedPopulate && allRelatedRows.length > 0) {
					allRelatedRows = await this.populateBatchedRows<T>(
						allRelatedRows,
						targetTable,
						nestedPopulate as QueryPopulate<ForjaEntry>,
					);
				}

				const groupMap = new Map<number, Partial<T>[]>();
				for (const r of allRelatedRows) {
					const fk = (r as Partial<T> & { _fk: number })._fk;
					if (!groupMap.has(fk)) groupMap.set(fk, []);
					groupMap.get(fk)!.push(r);
				}
				for (const row of rows) {
					(row as Record<string, unknown>)[relationName] =
						groupMap.get(row.id) || [];
				}
			} else if (relation.kind === "manyToMany") {
				const junctionTable = relation.through!;
				const sourceFK = `${schema.name}Id`;
				const targetFK = `${relation.model}Id`;
				const nestedParentIds = rows.map((r) => r.id);

				const junctionTableEsc = escapeIdentifier(junctionTable);
				const sourceFKEsc = escapeIdentifier(sourceFK);
				const targetFKEsc = escapeIdentifier(targetFK);

				const batchQuery = `
          SELECT j.${sourceFKEsc} as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          INNER JOIN ${junctionTableEsc} j ON t.\`id\` = j.${targetFKEsc}
          WHERE j.${sourceFKEsc} IN (?)
        `;
				const [batchRows] = await this.pool.query(batchQuery, [
					nestedParentIds,
				]);
				let allRelatedRows: Partial<T>[] = (
					batchRows as Array<{ _fk: unknown; data: unknown }>
				).map((r) => ({
					...((typeof r.data === "string"
						? JSON.parse(r.data)
						: r.data) as Partial<T>),
					_fk: r._fk,
				}));

				const nestedPopulate = opts.populate;
				if (nestedPopulate && allRelatedRows.length > 0) {
					allRelatedRows = await this.populateBatchedRows<T>(
						allRelatedRows,
						targetTable,
						nestedPopulate as QueryPopulate<T>,
					);
				}

				const groupMap = new Map<number, Partial<T>[]>();
				for (const r of allRelatedRows) {
					const fk = (r as Partial<T> & { _fk: number })._fk;
					if (!groupMap.has(fk)) groupMap.set(fk, []);
					groupMap.get(fk)!.push(r);
				}
				for (const row of rows) {
					(row as Record<string, unknown>)[relationName] =
						groupMap.get(row.id) || [];
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
		if (analysis.maxDepth > 1 || analysis.estimatedCost > 8) {
			return "batched-queries";
		}

		// Default: JSON aggregation (subquery-based)
		return "json-aggregation";
	}

	/**
	 * Collect FK columns needed by nested populate (belongsTo).
	 * These must be included in JSON_OBJECT so recursive populate can use them.
	 */
	private collectNestedFkColumns<T extends ForjaEntry>(
		targetModel: string,
		opts: QueryPopulateOptions<T>,
	): readonly string[] {
		if (!opts.populate) return [];

		const targetSchema = this.schemaRegistry.get(targetModel);
		if (!targetSchema) return [];

		const fkColumns: string[] = [];
		for (const [relName] of Object.entries(opts.populate)) {
			const relField = targetSchema.fields[relName];
			if (!relField || relField.type !== "relation") continue;
			const rel = relField as { kind: string; foreignKey?: string };
			if (rel.kind === "belongsTo" && rel.foreignKey) {
				fkColumns.push(rel.foreignKey);
			}
		}
		return fkColumns;
	}

	/**
	 * Build JSON_OBJECT expression for a target model.
	 * Includes all non-relation fields + FK columns needed for nested populate.
	 */
	private buildJsonObject<T extends ForjaEntry>(
		targetModel: string,
		opts?: QueryPopulateOptions<T>,
	): string {
		const targetSchema = this.schemaRegistry.get(targetModel);
		if (!targetSchema) return "JSON_OBJECT()";

		// Use select from options if provided, otherwise all non-relation fields
		const fields: string[] = opts?.select
			? [...(opts.select as string[])]
			: Object.entries(targetSchema.fields)
				.filter(([_, field]) => field.type !== "relation")
				.map(([name]) => name);

		// Inject FK columns needed for nested populate
		if (opts) {
			const fkColumns = this.collectNestedFkColumns(targetModel, opts);
			for (const fk of fkColumns) {
				if (!fields.includes(fk)) {
					fields.push(fk);
				}
			}
		}

		const jsonPairs = fields
			.map((f) => `'${f}', t.${escapeIdentifier(f)}`)
			.join(", ");

		return `JSON_OBJECT(${jsonPairs})`;
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
