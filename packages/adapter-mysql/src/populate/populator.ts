/**
 * MySQL Populator
 *
 * Main orchestrator for populate functionality.
 * Decides strategy based on query complexity and executes accordingly.
 */

import type {
	OrderByItem,
	QueryPopulate,
	QueryPopulateOptions,
	QuerySelectObject,
	SchemaDefinition,
} from "@datrix/core";
import type { MySQLQueryTranslator } from "../query-translator";
import { escapeIdentifier, buildOrderByClause } from "../helpers";
import type { PopulateStrategy, PopulateOptionsAnalysis } from "./types";
import { JoinBuilder } from "./join-builder";
import { AggregationBuilder } from "./aggregation-builder";
import { ResultProcessor } from "./result-processor";
import { MySQLClient } from "../mysql-client";
import { throwMaxDepthExceeded, throwQueryError } from "@datrix/core";
import { DatrixEntry } from "@datrix/core";
import { MySQLQueryObject } from "../types";
import { ISchemaRegistry } from "@datrix/core";
import { resolveJunctionForeignKeys } from "./junction";

/**
 * Maximum populate nesting depth
 */
const MAX_POPULATE_DEPTH = 5;

/**
 * MySQL Populator Class
 *
 * Handles all populate operations with strategy selection:
 * - JSON Aggregation: Single query with JSON_ARRAYAGG() for simple cases
 * - Batched Queries: Complex populate options (limit, offset, where, orderBy)
 *   and/or nested populate — per-parent limit/offset via window functions
 *
 * @example
 * ```ts
 * const populator = new MySQLPopulator(client, translator, schemaRegistry);
 * const results = await populator.populate(query);
 * ```
 */
export class MySQLPopulator {
	private joinBuilder: JoinBuilder;
	private aggregationBuilder: AggregationBuilder;
	private resultProcessor: ResultProcessor;

	constructor(
		private client: MySQLClient,
		private translator: MySQLQueryTranslator,
		private schemaRegistry: ISchemaRegistry,
	) {
		this.joinBuilder = new JoinBuilder(schemaRegistry);
		this.aggregationBuilder = new AggregationBuilder(schemaRegistry);
		this.resultProcessor = new ResultProcessor();
	}

	/**
	 * Main entry point for populate
	 *
	 * Analyzes query, selects strategy, and executes populate
	 *
	 * @param query - Query object with populate
	 * @returns Rows with populated relations
	 */
	async populate<T extends DatrixEntry>(
		query: QuerySelectObject<T>,
	): Promise<readonly T[]> {
		if (!query.populate) {
			return [] as readonly T[];
		}

		// Normalize the select list once: core guarantees a concrete list, but
		// keep a fail-safe (schema-derived, non-hidden scalar fields) so a
		// missing select neither crashes the FK injection nor leaks hidden
		// columns via the `*` fallback.
		const modelName = this.schemaRegistry.findModelByTableName(query.table);
		const schema = modelName ? this.schemaRegistry.get(modelName) : undefined;
		const normalizedQuery: QuerySelectObject<T> = schema
			? ({
					...query,
					select: this.resolveSelectList(
						schema,
						query.select as readonly string[] | undefined,
					) as unknown as QuerySelectObject<T>["select"],
				} as QuerySelectObject<T>)
			: query;

		// Analyze populate requirements
		const analysis = this.analyzePopulate(
			normalizedQuery.populate!,
			normalizedQuery.table,
		);

		// Check max depth
		if (analysis.maxDepth > MAX_POPULATE_DEPTH) {
			throwMaxDepthExceeded({
				adapter: "mysql",
				currentDepth: analysis.maxDepth,
				maxDepth: MAX_POPULATE_DEPTH,
				relationPath: this.buildRelationPath(normalizedQuery.populate!),
			});
		}

		// Select strategy
		const strategy = this.selectStrategy(analysis);

		// Execute based on strategy
		switch (strategy) {
			case "json-aggregation":
				return this.executeJsonAggregation<T>(normalizedQuery);
			case "batched-queries":
				return this.executeBatchedQueries<T>(normalizedQuery);
		}
	}

	/**
	 * Strategy 1: JSON Aggregation (Default, Most Performant)
	 *
	 * Uses JSON_ARRAYAGG() and JSON_OBJECT() for single-query populate.
	 * Best for simple cases without complex populate options.
	 */
	private async executeJsonAggregation<T extends DatrixEntry>(
		query: QuerySelectObject<T>,
	): Promise<readonly T[]> {
		const modifiedQuery = this.buildJsonAggregationQuery(query);
		const { sql, params } = this.translator.translate(modifiedQuery);
		const [rows] = await this.client.execute(sql, params as unknown[]);

		return this.resultProcessor.processJsonAggregation<T>(
			rows as T[],
			query.populate!,
		);
	}

	/**
	 * Strategy 2: Batched Queries (Complex Options / Deep Nesting)
	 *
	 * Executes batched queries for each relation (avoids N+1).
	 * Supports recursive nested populate at any depth and per-parent
	 * limit/offset via ROW_NUMBER() window functions (MySQL 8.0+).
	 */
	private async executeBatchedQueries<T extends DatrixEntry>(
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

		const baseSelect = this.resolveSelectList(
			schema,
			query.select as readonly string[] | undefined,
		);
		for (const fk of fkColumnsNeeded) {
			if (!baseSelect.includes(fk)) {
				baseSelect.push(fk);
			}
		}
		const queryWithFks: QuerySelectObject<T> = {
			...query,
			select: baseSelect as unknown as QuerySelectObject<T>["select"],
		};

		const { sql, params } = this.translator.translate(queryWithFks);
		const [mainRows] = await this.client.execute(sql, params as unknown[]);
		const rows = mainRows as T[];

		if (rows.length === 0) {
			return rows;
		}

		const parentIds = rows.map((row) => row.id);

		for (const [relationName, _options] of Object.entries(query.populate!)) {
			const relationField = schema.fields[relationName];
			const options = _options as QueryPopulateOptions<T>;
			if (!relationField || relationField.type !== "relation") continue;

			const relation = relationField;
			const targetSchema = this.schemaRegistry.get(relation.model);
			if (!targetSchema) continue;

			const targetTable =
				targetSchema.tableName ?? relation.model.toLowerCase();
			const targetTableEsc = escapeIdentifier(targetTable);
			const jsonObj = this.buildJsonObject(relation.model, options);

			if (relation.kind === "belongsTo") {
				const fkColumn = relation.foreignKey!;
				const fkValues = rows
					.map((row) => row[fkColumn as keyof T])
					.filter((v) => v != null);

				if (fkValues.length === 0) {
					for (const row of rows) {
						row[relationName as keyof T] = null as T[keyof T];
						delete row[fkColumn as keyof T];
					}
					continue;
				}

				// where on a single-record relation = "populate only when the
				// target matches, else null"; orderBy/limit/offset have no
				// per-parent meaning on a single row and are not applied
				const where = this.buildPopulateWhere(options, targetTable);
				const batchQuery = `
          SELECT t.\`id\` as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t${where.joins}
          WHERE t.\`id\` IN (?)${where.sql}
        `;

				let relatedRows = await this.fetchBatchQueryResultsWithParams<T>(
					batchQuery,
					fkValues,
					where.params,
				);

				// Recursive nested populate
				const nestedPopulate = options?.["populate"];
				if (nestedPopulate && relatedRows.length > 0) {
					relatedRows = await this.populateBatchedRows(
						relatedRows,
						targetTable,
						nestedPopulate,
					);
				}

				const dataMap = new Map(relatedRows.map((r) => [r._fk, r]));

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
				const where = this.buildPopulateWhere(options, targetTable);

				const batchQuery = `
          SELECT t.${fkColumnEsc} as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t${where.joins}
          WHERE t.${fkColumnEsc} IN (?)${where.sql}
        `;

				let relatedRows = await this.fetchBatchQueryResultsWithParams<T>(
					batchQuery,
					parentIds,
					where.params,
				);

				const nestedPopulate = options?.["populate"];
				if (nestedPopulate && relatedRows.length > 0) {
					relatedRows = await this.populateBatchedRows<T>(
						relatedRows,
						targetTable,
						nestedPopulate,
					);
				}

				const dataMap = new Map(relatedRows.map((r) => [r._fk, r]));

				for (const row of rows) {
					row[relationName as keyof T] = (dataMap.get(row.id) ||
						null) as T[keyof T];
				}
			} else if (relation.kind === "hasMany") {
				const fkColumn = relation.foreignKey!;
				const fkColumnEsc = escapeIdentifier(fkColumn);
				const { sql: batchQuery, params: extraParams } =
					this.buildConstrainedBatchSql(
						`t.${fkColumnEsc}`,
						jsonObj,
						`FROM ${targetTableEsc} t`,
						options,
						targetTable,
					);

				let allRelatedRows = await this.fetchBatchQueryResultsWithParams<T>(
					batchQuery,
					parentIds,
					extraParams,
				);

				const nestedPopulate = options?.["populate"];
				if (nestedPopulate && allRelatedRows.length > 0) {
					allRelatedRows = await this.populateBatchedRows<T>(
						allRelatedRows,
						targetTable,
						nestedPopulate,
					);
				}

				const groupMap = new Map<number, Partial<T>[]>();
				for (const r of allRelatedRows) {
					if (!groupMap.has(r._fk)) groupMap.set(r._fk, []);
					groupMap.get(r._fk)!.push(r);
				}

				for (const row of rows) {
					row[relationName as keyof T] = (groupMap.get(row.id) ||
						[]) as T[keyof T];
				}
			} else if (relation.kind === "manyToMany") {
				const junctionTable = relation.through!;
				const { sourceFK, targetFK } = resolveJunctionForeignKeys(
					junctionTable,
					schema.name,
					relation.model,
					this.schemaRegistry,
				);

				const junctionTableEsc = escapeIdentifier(junctionTable);
				const sourceFKEsc = escapeIdentifier(sourceFK);
				const targetFKEsc = escapeIdentifier(targetFK);
				const { sql: batchQuery, params: extraParams } =
					this.buildConstrainedBatchSql(
						`j.${sourceFKEsc}`,
						jsonObj,
						`FROM ${targetTableEsc} t INNER JOIN ${junctionTableEsc} j ON t.\`id\` = j.${targetFKEsc}`,
						options,
						targetTable,
					);

				let allRelatedRows = await this.fetchBatchQueryResultsWithParams<T>(
					batchQuery,
					parentIds,
					extraParams,
				);

				const nestedPopulate = options?.["populate"];
				if (nestedPopulate && allRelatedRows.length > 0) {
					allRelatedRows = await this.populateBatchedRows(
						allRelatedRows,
						targetTable,
						nestedPopulate,
					);
				}

				const groupMap = new Map<number, Partial<T>[]>();
				for (const r of allRelatedRows) {
					if (!groupMap.has(r._fk)) groupMap.set(r._fk, []);
					groupMap.get(r._fk)!.push(r);
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
	private async populateBatchedRows<T extends DatrixEntry>(
		rows: (T & { _fk: number })[],
		tableName: string,
		populate: QueryPopulate<T>,
	): Promise<(T & { _fk: number })[]> {
		const modelName = this.schemaRegistry.findModelByTableName(tableName);
		if (!modelName) return rows;

		const schema = this.schemaRegistry.get(modelName);
		if (!schema) return rows;

		for (const [_relationName, _opts] of Object.entries(populate)) {
			const relationField = schema.fields[_relationName];
			const opts = _opts as QueryPopulateOptions<T>;
			const relationName = _relationName as keyof T;
			if (!relationField || relationField.type !== "relation") continue;

			const relation = relationField;
			const targetSchema = this.schemaRegistry.get(relation.model);
			if (!targetSchema) continue;

			const targetTable =
				targetSchema.tableName ?? relation.model.toLowerCase();
			const targetTableEsc = escapeIdentifier(targetTable);
			const jsonObj = this.buildJsonObject(relation.model, opts);

			if (relation.kind === "belongsTo") {
				const fkColumn = relation.foreignKey! as keyof T;
				const fkValues = rows
					.map((row) => row[fkColumn])
					.filter((v) => v != null);

				if (fkValues.length === 0) continue;

				const where = this.buildPopulateWhere(opts, targetTable);
				const batchQuery = `
          SELECT t.\`id\` as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t${where.joins}
          WHERE t.\`id\` IN (?)${where.sql}
        `;

				const dataMap = await this.fetchAndPopulateNested<T>(
					opts,
					targetTable,
					batchQuery,
					fkValues,
					where.params,
				);

				for (const row of rows) {
					const fkValue = row[fkColumn];
					(row as T)[relationName] = (dataMap.get(fkValue as number) ||
						null) as T[keyof T];
					delete row[fkColumn];
				}
			} else if (relation.kind === "hasOne") {
				const fkColumn = relation.foreignKey!;
				const fkColumnEsc = escapeIdentifier(fkColumn);
				const nestedParentIds = rows.map((r) => r.id as number).filter(Boolean);
				const where = this.buildPopulateWhere(opts, targetTable);

				const batchQuery = `
          SELECT t.${fkColumnEsc} as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t${where.joins}
          WHERE t.${fkColumnEsc} IN (?)${where.sql}
        `;

				const dataMap = await this.fetchAndPopulateNested<T>(
					opts,
					targetTable,
					batchQuery,
					nestedParentIds,
					where.params,
				);

				for (const row of rows) {
					(row as T)[relationName] = (dataMap.get(row.id!) ||
						null) as T[keyof T];
				}
			} else if (relation.kind === "hasMany") {
				const fkColumn = relation.foreignKey!;
				const fkColumnEsc = escapeIdentifier(fkColumn);
				const nestedParentIds = rows.map((r) => r.id as number).filter(Boolean);
				const { sql: batchQuery, params: extraParams } =
					this.buildConstrainedBatchSql(
						`t.${fkColumnEsc}`,
						jsonObj,
						`FROM ${targetTableEsc} t`,
						opts,
						targetTable,
					);

				let relatedRowsHM = await this.fetchBatchQueryResultsWithParams<T>(
					batchQuery,
					nestedParentIds,
					extraParams,
				);

				const nestedPopulateHM = opts.populate;
				if (nestedPopulateHM && relatedRowsHM.length > 0) {
					relatedRowsHM = await this.populateBatchedRows<T>(
						relatedRowsHM,
						targetTable,
						nestedPopulateHM,
					);
				}

				const groupMapHM = new Map<number, Partial<T>[]>();
				for (const r of relatedRowsHM) {
					if (!groupMapHM.has(r._fk)) groupMapHM.set(r._fk, []);
					groupMapHM.get(r._fk)!.push(r);
				}

				for (const row of rows) {
					(row as T)[relationName] = (groupMapHM.get(row.id!) ||
						[]) as T[keyof T];
				}
			} else if (relation.kind === "manyToMany") {
				const junctionTable = relation.through!;
				const { sourceFK, targetFK } = resolveJunctionForeignKeys(
					junctionTable,
					schema.name,
					relation.model,
					this.schemaRegistry,
				);
				const nestedParentIds = rows.map((r) => r.id as number).filter(Boolean);

				const junctionTableEsc = escapeIdentifier(junctionTable);
				const sourceFKEsc = escapeIdentifier(sourceFK);
				const targetFKEsc = escapeIdentifier(targetFK);
				const { sql: batchQuery, params: extraParams } =
					this.buildConstrainedBatchSql(
						`j.${sourceFKEsc}`,
						jsonObj,
						`FROM ${targetTableEsc} t INNER JOIN ${junctionTableEsc} j ON t.\`id\` = j.${targetFKEsc}`,
						opts,
						targetTable,
					);

				let relatedRowsM2M = await this.fetchBatchQueryResultsWithParams<T>(
					batchQuery,
					nestedParentIds,
					extraParams,
				);

				const nestedPopulateM2M = opts.populate;
				if (nestedPopulateM2M && relatedRowsM2M.length > 0) {
					relatedRowsM2M = await this.populateBatchedRows<T>(
						relatedRowsM2M,
						targetTable,
						nestedPopulateM2M,
					);
				}

				const groupMapM2M = new Map<number, Partial<T>[]>();
				for (const r of relatedRowsM2M) {
					if (!groupMapM2M.has(r._fk)) groupMapM2M.set(r._fk, []);
					groupMapM2M.get(r._fk)!.push(r);
				}

				for (const row of rows) {
					(row as T)[relationName] = (groupMapM2M.get(row.id!) ||
						[]) as T[keyof T];
				}
			}
		}

		return rows;
	}

	/**
	 * Build query with JSON aggregation
	 */
	private buildJsonAggregationQuery<T extends DatrixEntry>(
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
	 * Analyze populate requirements
	 */
	private analyzePopulate<T extends DatrixEntry>(
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
	 * 1. Complex options (limit/offset/where/orderBy) or nesting → batched-queries
	 * 2. Default → json-aggregation (subquery-based, no row explosion)
	 */
	private selectStrategy(analysis: PopulateOptionsAnalysis): PopulateStrategy {
		if (analysis.hasComplexOptions || analysis.maxDepth > 1) {
			return "batched-queries";
		}

		// Default: JSON aggregation (single query, most performant)
		return "json-aggregation";
	}

	/**
	 * Resolve a concrete select list: the query's own select when present,
	 * otherwise all non-relation, non-hidden fields from the schema.
	 */
	private resolveSelectList(
		schema: SchemaDefinition,
		select: readonly string[] | undefined,
	): string[] {
		if (select && select.length > 0) {
			return [...select];
		}
		return Object.entries(schema.fields)
			.filter(
				([, field]) =>
					field.type !== "relation" &&
					!(field as { hidden?: boolean }).hidden,
			)
			.map(([name]) => name);
	}

	/**
	 * Collect FK columns needed by nested populate (belongsTo).
	 * These must be included in JSON_OBJECT so recursive populate can use them.
	 */
	private collectNestedFkColumns<T extends DatrixEntry>(
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
	 * Execute a batched query, parse JSON data column, and return typed rows with _fk.
	 * MySQL positional params: first param is the IN array, rest are flat extra params.
	 * Error handling is delegated to MySQLClient.
	 */
	private async fetchBatchQueryResultsWithParams<T extends DatrixEntry>(
		sql: string,
		inParams: unknown[],
		extraParams: unknown[],
	): Promise<(T & { _fk: number })[]> {
		const [rows] = await this.client.query(sql, [inParams, ...extraParams]);
		const raw = rows as { _fk: number; data: string | Partial<T> }[];
		return raw.map((r) => ({
			...((typeof r.data === "string" ? JSON.parse(r.data) : r.data) as T),
			_fk: r._fk,
		}));
	}

	/**
	 * Helper function to fetch target related rows, populate nested relations, and return a map
	 */
	private async fetchAndPopulateNested<T extends DatrixEntry, R = Partial<T>>(
		opts: QueryPopulateOptions<T>,
		targetTable: string,
		batchQuery: string,
		ids: unknown[],
		extraParams: unknown[],
		isMany: boolean = false,
	): Promise<Map<number, R>> {
		let relatedRows = await this.fetchBatchQueryResultsWithParams<T>(
			batchQuery,
			ids,
			extraParams,
		);

		const nestedPopulate = opts.populate;
		if (nestedPopulate && relatedRows.length > 0) {
			relatedRows = await this.populateBatchedRows<T>(
				relatedRows,
				targetTable,
				nestedPopulate,
			);
		}

		const map = new Map<number, R>();
		for (const r of relatedRows) {
			if (isMany) {
				if (!map.has(r._fk)) map.set(r._fk, [] as unknown as R);
				(map.get(r._fk) as unknown as Partial<T>[]).push(r);
			} else {
				map.set(r._fk, r as unknown as R);
			}
		}

		return map;
	}

	/**
	 * Build JSON_OBJECT expression for a target model.
	 * Includes all non-relation fields + FK columns needed for nested populate.
	 */
	private buildJsonObject<T extends DatrixEntry>(
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
	 * Translate populate-level WHERE against the target schema.
	 * Relation sub-conditions produce JOINs — they are wired into the batch
	 * SQL (never discarded, the aliases they introduce must exist).
	 */
	private buildPopulateWhere<T extends DatrixEntry>(
		options: QueryPopulateOptions<T>,
		targetTable: string,
	): { sql: string; joins: string; params: unknown[] } {
		if (!options.where) {
			return { sql: "", joins: "", params: [] };
		}
		const whereResult = this.translator.translateWhere(
			options.where,
			0,
			targetTable,
			"t",
		);
		return {
			sql: ` AND ${whereResult.sql}`,
			joins:
				whereResult.joins.length > 0 ? ` ${whereResult.joins.join(" ")}` : "",
			params: [...whereResult.params],
		};
	}

	/**
	 * Build the batch SQL for a many-relation (hasMany/manyToMany).
	 *
	 * Without limit/offset: a single flat `IN (?)` query.
	 * With limit/offset: ROW_NUMBER() partitioned by the FK so the bounds
	 * apply PER PARENT ROW, not globally across the whole batch.
	 *
	 * @param fkExpr - Fully escaped FK expression (e.g. "t.`authorId`" or "j.`PostId`")
	 * @param fromClause - FROM clause with target aliased as `t` (junction as `j`)
	 */
	private buildConstrainedBatchSql<T extends DatrixEntry>(
		fkExpr: string,
		jsonObj: string,
		fromClause: string,
		options: QueryPopulateOptions<T>,
		targetTable: string,
	): { sql: string; params: unknown[] } {
		const where = this.buildPopulateWhere(options, targetTable);
		const orderClause =
			options.orderBy && options.orderBy.length > 0
				? buildOrderByClause(
						options.orderBy as unknown as readonly OrderByItem<DatrixEntry>[],
						"t",
					)
				: "";

		const limit = this.toSafePopulateBound(options.limit, "limit");
		const offset = this.toSafePopulateBound(options.offset, "offset");

		if (limit === undefined && (offset === undefined || offset === 0)) {
			const orderSQL = orderClause ? ` ORDER BY ${orderClause}` : "";
			return {
				sql: `SELECT ${fkExpr} as _fk, ${jsonObj} as data ${fromClause}${where.joins} WHERE ${fkExpr} IN (?)${where.sql}${orderSQL}`,
				params: where.params,
			};
		}

		const off = offset ?? 0;
		const rnConditions: string[] = [];
		if (off > 0) {
			rnConditions.push(`w.\`_rn\` > ${off}`);
		}
		if (limit !== undefined) {
			rnConditions.push(`w.\`_rn\` <= ${off + limit}`);
		}
		const innerOrder = orderClause || "t.`id` ASC";

		return {
			sql: `SELECT w.\`_fk\`, w.\`data\` FROM ( SELECT ${fkExpr} as _fk, ${jsonObj} as data, ROW_NUMBER() OVER (PARTITION BY ${fkExpr} ORDER BY ${innerOrder}) as _rn ${fromClause}${where.joins} WHERE ${fkExpr} IN (?)${where.sql} ) w WHERE ${rnConditions.join(" AND ")} ORDER BY w.\`_fk\`, w.\`_rn\``,
			params: where.params,
		};
	}

	/**
	 * Validate a populate limit/offset value for literal inlining
	 */
	private toSafePopulateBound(
		value: number | undefined,
		name: string,
	): number | undefined {
		if (value === undefined) {
			return undefined;
		}
		if (!Number.isInteger(value) || value < 0) {
			throwQueryError({
				adapter: "mysql",
				message: `Invalid populate ${name}: ${String(value)} (must be a non-negative integer)`,
			});
		}
		return value;
	}

	/**
	 * Build relation path string for error messages
	 */
	private buildRelationPath<T extends DatrixEntry>(
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
