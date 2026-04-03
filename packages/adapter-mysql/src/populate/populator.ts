/**
 * MySQL Populator
 *
 * Main orchestrator for populate functionality.
 * Decides strategy based on query complexity and executes accordingly.
 */

import type {
	QueryPopulate,
	QueryPopulateOptions,
	QuerySelectObject,
} from "@forja/types/core/query-builder";
import type { MySQLQueryTranslator } from "../query-translator";
import { escapeIdentifier } from "../helpers";
import type { PopulateStrategy, PopulateOptionsAnalysis } from "./types";
import { JoinBuilder } from "./join-builder";
import { AggregationBuilder } from "./aggregation-builder";
import { ResultProcessor } from "./result-processor";
import { MySQLClient } from "../mysql-client";
import { throwMaxDepthExceeded } from "@forja/types/errors/adapter";
import { ForjaEntry } from "@forja/types";
import { MySQLQueryObject } from "../types";
import { ISchemaRegistry } from "@forja/types/core/schema";

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
		private client: MySQLClient,
		private translator: MySQLQueryTranslator,
		private schemaRegistry: ISchemaRegistry,
	) {
		this.joinBuilder = new JoinBuilder(schemaRegistry);
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
		const modifiedQuery = this.buildJsonAggregationQuery(query);
		const { sql, params } = this.translator.translate(modifiedQuery);
		const [rows] = await this.client.execute(sql, params as unknown[]);

		return this.resultProcessor.processJsonAggregation<T>(
			rows as T[],
			query.populate!,
		);
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
		const modelName = this.schemaRegistry.findModelByTableName(query.table);
		if (!modelName) return [];

		const schema = this.schemaRegistry.get(modelName);
		if (!schema) return [];

		// Collect FK columns needed for belongsTo so they are present in main result
		const fkColumnsNeeded: string[] = [];
		for (const [relationName] of Object.entries(query.populate ?? {})) {
			const relationField = schema.fields[relationName];
			if (!relationField || relationField.type !== "relation") continue;
			const rel = relationField as { kind: string; foreignKey?: string };
			if (rel.kind === "belongsTo" && rel.foreignKey) {
				fkColumnsNeeded.push(rel.foreignKey);
			}
		}

		// Run main query without populate
		const mainQuery: QuerySelectObject<T> =
			fkColumnsNeeded.length > 0
				? {
						...query,
						populate: undefined,
						select: [
							...(query.select as string[]),
							...fkColumnsNeeded,
						] as unknown as QuerySelectObject<T>["select"],
					}
				: { ...query, populate: undefined };

		const { sql: mainSql, params: mainParams } =
			this.translator.translate(mainQuery);
		const [mainRows] = await this.client.execute(
			mainSql,
			mainParams as unknown[],
		);
		const rows = mainRows as T[];

		if (rows.length === 0) return rows;

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

				const extra = this.buildBatchOptionsClause(options, targetTable);
				const lateralSql = `
          SELECT t.\`id\` as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          WHERE t.\`id\` IN (?)${extra.sql}
        `;
				const relatedRows = await this.fetchBatchQueryResultsWithParams<T>(
					lateralSql,
					fkValues,
					extra.params,
				);

				const dataMap = new Map(relatedRows.map((r) => [r._fk, r]));
				for (const row of rows) {
					const fkValue = row[fkColumn as keyof T];
					row[relationName as keyof T] = (dataMap.get(fkValue as number) ??
						null) as T[keyof T];
					delete row[fkColumn as keyof T];
				}
			} else if (relation.kind === "hasOne") {
				const fkColumn = relation.foreignKey!;
				const fkColumnEsc = escapeIdentifier(fkColumn);
				const extra = this.buildBatchOptionsClause(options, targetTable);
				const lateralSql = `
          SELECT t.${fkColumnEsc} as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          WHERE t.${fkColumnEsc} IN (?)${extra.sql}
        `;
				const relatedRows = await this.fetchBatchQueryResultsWithParams<T>(
					lateralSql,
					parentIds,
					extra.params,
				);

				const dataMap = new Map(relatedRows.map((r) => [r._fk, r]));
				for (const row of rows) {
					row[relationName as keyof T] = (dataMap.get(row.id) ??
						null) as T[keyof T];
				}
			} else if (relation.kind === "hasMany") {
				const fkColumn = relation.foreignKey!;
				const fkColumnEsc = escapeIdentifier(fkColumn);
				const innerParams: unknown[] = [];

				let whereSQL = "";
				if (options.where) {
					const whereResult = this.translator.translateWhere(
						options.where,
						0,
						targetTable,
						"t",
					);
					whereSQL = ` AND ${whereResult.sql}`;
					innerParams.push(...whereResult.params);
				}

				let orderSQL = "";
				if (options.orderBy && options.orderBy.length > 0) {
					orderSQL =
						" ORDER BY " +
						options.orderBy
							.map((item) => {
								let s = `t.${escapeIdentifier(item.field as string)} ${item.direction.toUpperCase()}`;
								if (item.nulls) s += ` NULLS ${item.nulls.toUpperCase()}`;
								return s;
							})
							.join(", ");
				}

				let limitSQL = "";
				let offsetSQL = "";
				if (options.limit !== undefined) {
					limitSQL = " LIMIT ?";
					innerParams.push(options.limit);
					if (options.offset !== undefined && options.offset > 0) {
						offsetSQL = " OFFSET ?";
						innerParams.push(options.offset);
					}
				} else if (options.offset !== undefined && options.offset > 0) {
					// MySQL requires LIMIT when using OFFSET
					limitSQL = " LIMIT 18446744073709551615";
					offsetSQL = " OFFSET ?";
					innerParams.push(options.offset);
				}

				const lateralSql = `
          SELECT t.${fkColumnEsc} as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          WHERE t.${fkColumnEsc} IN (?)${whereSQL}${orderSQL}${limitSQL}${offsetSQL}
        `;
				const allRelatedRows = await this.fetchBatchQueryResultsWithParams<T>(
					lateralSql,
					parentIds,
					innerParams,
				);

				const groupMap = new Map<number, Partial<T>[]>();
				for (const r of allRelatedRows) {
					if (!groupMap.has(r._fk)) groupMap.set(r._fk, []);
					groupMap.get(r._fk)!.push(r);
				}
				for (const row of rows) {
					row[relationName as keyof T] = (groupMap.get(row.id) ??
						[]) as T[keyof T];
				}
			} else if (relation.kind === "manyToMany") {
				const junctionTable = relation.through!;
				const sourceFK = `${schema.name}Id`;
				const targetFK = `${relation.model}Id`;
				const junctionTableEsc = escapeIdentifier(junctionTable);
				const sourceFKEsc = escapeIdentifier(sourceFK);
				const targetFKEsc = escapeIdentifier(targetFK);
				const innerParams: unknown[] = [];

				let whereSQL = "";
				if (options.where) {
					const whereResult = this.translator.translateWhere(
						options.where,
						0,
						targetTable,
						"t",
					);
					whereSQL = ` AND ${whereResult.sql}`;
					innerParams.push(...whereResult.params);
				}

				let orderSQL = "";
				if (options.orderBy && options.orderBy.length > 0) {
					orderSQL =
						" ORDER BY " +
						options.orderBy
							.map((item) => {
								let s = `t.${escapeIdentifier(item.field as string)} ${item.direction.toUpperCase()}`;
								if (item.nulls) s += ` NULLS ${item.nulls.toUpperCase()}`;
								return s;
							})
							.join(", ");
				}

				let limitSQL = "";
				let offsetSQL = "";
				if (options.limit !== undefined) {
					limitSQL = " LIMIT ?";
					innerParams.push(options.limit);
					if (options.offset !== undefined && options.offset > 0) {
						offsetSQL = " OFFSET ?";
						innerParams.push(options.offset);
					}
				} else if (options.offset !== undefined && options.offset > 0) {
					// MySQL requires LIMIT when using OFFSET
					limitSQL = " LIMIT 18446744073709551615";
					offsetSQL = " OFFSET ?";
					innerParams.push(options.offset);
				}

				const lateralSql = `
          SELECT j.${sourceFKEsc} as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          INNER JOIN ${junctionTableEsc} j ON t.\`id\` = j.${targetFKEsc}
          WHERE j.${sourceFKEsc} IN (?)${whereSQL}${orderSQL}${limitSQL}${offsetSQL}
        `;
				const allRelatedRows = await this.fetchBatchQueryResultsWithParams<T>(
					lateralSql,
					parentIds,
					innerParams,
				);

				const groupMap = new Map<number, Partial<T>[]>();
				for (const r of allRelatedRows) {
					if (!groupMap.has(r._fk)) groupMap.set(r._fk, []);
					groupMap.get(r._fk)!.push(r);
				}
				for (const row of rows) {
					row[relationName as keyof T] = (groupMap.get(row.id) ??
						[]) as T[keyof T];
				}
			}
		}

		return rows;
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

				let relatedRows = await this.fetchBatchQueryResults<T>(
					batchQuery,
					fkValues,
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
				const jsonObj = this.buildJsonObject(relation.model, options);

				const batchQuery = `
          SELECT t.${fkColumnEsc} as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          WHERE t.${fkColumnEsc} IN (?)
        `;

				let relatedRows = await this.fetchBatchQueryResults<T>(
					batchQuery,
					parentIds,
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
				const jsonObj = this.buildJsonObject(relation.model, options);
				const extra = this.buildBatchOptionsClause(options, targetTable);

				const batchQuery = `
          SELECT t.${fkColumnEsc} as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          WHERE t.${fkColumnEsc} IN (?)${extra.sql}
        `;

				let allRelatedRows = await this.fetchBatchQueryResultsWithParams<T>(
					batchQuery,
					parentIds,
					extra.params,
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
				const sourceFK = `${schema.name}Id`;
				const targetFK = `${relation.model}Id`;

				const junctionTableEsc = escapeIdentifier(junctionTable);
				const sourceFKEsc = escapeIdentifier(sourceFK);
				const targetFKEsc = escapeIdentifier(targetFK);
				const jsonObj = this.buildJsonObject(relation.model, options);
				const extra = this.buildBatchOptionsClause(options, targetTable);

				const batchQuery = `
          SELECT j.${sourceFKEsc} as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          INNER JOIN ${junctionTableEsc} j ON t.\`id\` = j.${targetFKEsc}
          WHERE j.${sourceFKEsc} IN (?)${extra.sql}
        `;

				let allRelatedRows = await this.fetchBatchQueryResultsWithParams<T>(
					batchQuery,
					parentIds,
					extra.params,
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
	private async populateBatchedRows<T extends ForjaEntry>(
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

				const batchQuery = `
          SELECT t.\`id\` as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          WHERE t.\`id\` IN (?)
        `;

				const dataMap = await this.fetchAndPopulateNested<T>(
					opts,
					targetTable,
					batchQuery,
					fkValues,
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

				const batchQuery = `
          SELECT t.${fkColumnEsc} as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          WHERE t.${fkColumnEsc} IN (?)
        `;

				const dataMap = await this.fetchAndPopulateNested<T>(
					opts,
					targetTable,
					batchQuery,
					nestedParentIds,
				);

				for (const row of rows) {
					(row as T)[relationName] = (dataMap.get(row.id!) ||
						null) as T[keyof T];
				}
			} else if (relation.kind === "hasMany") {
				const fkColumn = relation.foreignKey!;
				const fkColumnEsc = escapeIdentifier(fkColumn);
				const nestedParentIds = rows.map((r) => r.id as number).filter(Boolean);
				const hasManyExtra = this.buildBatchOptionsClause(opts, targetTable);

				const batchQuery = `
          SELECT t.${fkColumnEsc} as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          WHERE t.${fkColumnEsc} IN (?)${hasManyExtra.sql}
        `;

				let relatedRowsHM = await this.fetchBatchQueryResultsWithParams<T>(
					batchQuery,
					nestedParentIds,
					hasManyExtra.params,
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
				const sourceFK = `${schema.name}Id`;
				const targetFK = `${relation.model}Id`;
				const nestedParentIds = rows.map((r) => r.id as number).filter(Boolean);

				const junctionTableEsc = escapeIdentifier(junctionTable);
				const sourceFKEsc = escapeIdentifier(sourceFK);
				const targetFKEsc = escapeIdentifier(targetFK);
				const m2mExtra = this.buildBatchOptionsClause(opts, targetTable);

				const batchQuery = `
          SELECT j.${sourceFKEsc} as _fk, ${jsonObj} as data
          FROM ${targetTableEsc} t
          INNER JOIN ${junctionTableEsc} j ON t.\`id\` = j.${targetFKEsc}
          WHERE j.${sourceFKEsc} IN (?)${m2mExtra.sql}
        `;

				let relatedRowsM2M = await this.fetchBatchQueryResultsWithParams<T>(
					batchQuery,
					nestedParentIds,
					m2mExtra.params,
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
		// Complex options at depth 1: LATERAL joins (per-row limit/offset/where/orderBy)
		if (analysis.hasComplexOptions && analysis.maxDepth === 1) {
			return "lateral-joins";
		}

		// Deep nesting or complex options at depth > 1: batched queries
		if (analysis.maxDepth > 1 || analysis.hasComplexOptions) {
			return "batched-queries";
		}

		// Default: JSON aggregation (single query, most performant)
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
	 * Execute a batched query, parse JSON data column, and return typed rows with _fk.
	 * Error handling is delegated to MySQLClient.
	 */
	private async fetchBatchQueryResults<T extends ForjaEntry>(
		sql: string,
		params: unknown[],
	): Promise<(T & { _fk: number })[]> {
		const [rows] = await this.client.query(sql, [params]);
		const raw = rows as { _fk: number; data: string | Partial<T> }[];
		return raw.map((r) => ({
			...((typeof r.data === "string" ? JSON.parse(r.data) : r.data) as T),
			_fk: r._fk,
		}));
	}

	/**
	 * Like fetchBatchQueryResults but supports extra params after the IN (?) array.
	 * MySQL positional params: first param is the IN array, rest are flat extra params.
	 */
	private async fetchBatchQueryResultsWithParams<T extends ForjaEntry>(
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
	private async fetchAndPopulateNested<T extends ForjaEntry, R = Partial<T>>(
		opts: QueryPopulateOptions<T>,
		targetTable: string,
		batchQuery: string,
		ids: unknown[],
		isMany: boolean = false,
	): Promise<Map<number, R>> {
		let relatedRows = await this.fetchBatchQueryResults<T>(batchQuery, ids);

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
	 * Build extra SQL clauses (WHERE/ORDER BY) for batch/lateral queries from populate options.
	 * MySQL uses positional ? params — returns sql fragment and params to append.
	 */
	private buildBatchOptionsClause<T extends ForjaEntry>(
		options: QueryPopulateOptions<T>,
		targetTable: string,
	): { sql: string; params: unknown[] } {
		let sql = "";
		const params: unknown[] = [];

		if (options.where) {
			const whereResult = this.translator.translateWhere(
				options.where,
				0,
				targetTable,
				"t",
			);
			sql += ` AND ${whereResult.sql}`;
			params.push(...whereResult.params);
		}

		if (options.orderBy && options.orderBy.length > 0) {
			const orderSQL = options.orderBy
				.map((item) => {
					let s = `t.${escapeIdentifier(item.field as string)} ${item.direction.toUpperCase()}`;
					if (item.nulls) s += ` NULLS ${item.nulls.toUpperCase()}`;
					return s;
				})
				.join(", ");
			sql += ` ORDER BY ${orderSQL}`;
		}

		if (options.limit !== undefined) {
			sql += ` LIMIT ?`;
			params.push(options.limit);
			if (options.offset !== undefined && options.offset > 0) {
				sql += ` OFFSET ?`;
				params.push(options.offset);
			}
		} else if (options.offset !== undefined && options.offset > 0) {
			// MySQL requires LIMIT when using OFFSET
			sql += ` LIMIT 18446744073709551615 OFFSET ?`;
			params.push(options.offset);
		}

		return { sql, params };
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
