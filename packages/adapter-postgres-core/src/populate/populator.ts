/**
 * PostgreSQL Populator
 *
 * Main orchestrator for populate functionality.
 * Decides strategy based on query complexity and executes accordingly.
 */

import type {
	QueryPopulate,
	QueryPopulateOptions,
	QuerySelectObject,
} from "@datrix/core";
import type { PgClient } from "../pg-client";
import type { PostgresQueryTranslator } from "../query-translator";
import type { PopulateStrategy, PopulateOptionsAnalysis } from "./types";
import { JoinBuilder } from "./join-builder";
import { AggregationBuilder } from "./aggregation-builder";
import { ResultProcessor } from "./result-processor";
import { throwMaxDepthExceeded, throwQueryError } from "@datrix/core";
import { DatrixEntry, SchemaDefinition } from "@datrix/core";
import { PostgresQueryObject } from "../types";
import { ISchemaRegistry } from "@datrix/core";
import { convertRowTypes, schemaNeedsConversion } from "../type-conversion";

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
		private client: PgClient,
		private translator: PostgresQueryTranslator,
		private schemaRegistry: ISchemaRegistry,
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
	async populate<T extends DatrixEntry>(
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
	private async executeJsonAggregation<T extends DatrixEntry>(
		query: QuerySelectObject<T>,
	): Promise<readonly T[]> {
		const modifiedQuery = this.buildJsonAggregationQuery(query);
		const { sql, params } = this.translator.translate(modifiedQuery);
		const result = await this.client.query(sql, params as unknown[]);
		return this.resultProcessor.processJsonAggregation<T>(
			result.rows as T[],
			query.populate!,
			query.table,
		);
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
	private async executeLateralJoins<T extends DatrixEntry>(
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
		const baseSelect =
			query.select && (query.select as string[]).length > 0
				? (query.select as string[])
				: ["id"];
		const mainQuery: QuerySelectObject<T> =
			fkColumnsNeeded.length > 0
				? {
						...query,
						populate: undefined,
						select: [
							...baseSelect,
							...fkColumnsNeeded,
						] as unknown as QuerySelectObject<T>["select"],
					}
				: { ...query, populate: undefined };

		const { sql: mainSql, params: mainParams } =
			this.translator.translate(mainQuery);
		const mainResult = await this.client.query(mainSql, mainParams);
		const rows = mainResult.rows as T[];

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
			const rowToJson = this.buildSelectiveRowToJson(
				options.select as readonly string[],
				relation.model,
				options,
			);

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

				const whereExtra = this.buildBatchOptionsClause(
					options,
					targetTable,
					1,
					relationName,
				);
				const lateralSql = `
          SELECT t."id" as _fk, ${rowToJson} as data
          FROM ${this.translator.escapeIdentifier(targetTable)} t
          WHERE t."id" = ANY($1)${whereExtra.sql}
        `;
				const batchRows = await this.fetchBatchQueryResults<T>(
					lateralSql,
					[fkValues, ...whereExtra.params],
					targetSchema,
				);

				const dataMap = new Map<number, T>();
				for (const r of batchRows) dataMap.set(r._fk, r.data);

				for (const row of rows) {
					const fkValue = row[fkColumn as keyof T];
					row[relationName as keyof T] = (dataMap.get(fkValue as number) ??
						null) as T[keyof T];
					delete row[fkColumn as keyof T];
				}
			} else if (relation.kind === "hasOne") {
				const fkColumn = relation.foreignKey!;
				const whereExtra = this.buildBatchOptionsClause(
					options,
					targetTable,
					1,
					relationName,
				);
				const lateralSql = `
          SELECT t.${this.translator.escapeIdentifier(fkColumn)} as _fk, ${rowToJson} as data
          FROM ${this.translator.escapeIdentifier(targetTable)} t
          WHERE t.${this.translator.escapeIdentifier(fkColumn)} = ANY($1)${whereExtra.sql}
        `;
				const batchRows = await this.fetchBatchQueryResults<T>(
					lateralSql,
					[parentIds, ...whereExtra.params],
					targetSchema,
				);

				const dataMap = new Map<number, T>();
				for (const r of batchRows) dataMap.set(r._fk, r.data);

				for (const row of rows) {
					row[relationName as keyof T] = (dataMap.get(row.id) ??
						null) as T[keyof T];
				}
			} else if (relation.kind === "hasMany") {
				const fkColumn = relation.foreignKey!;
				const fkExpr = `t.${this.translator.escapeIdentifier(fkColumn)}`;
				const { sql: lateralSql, params: extraParams } =
					this.buildOneToManyBatchQuery(
						options,
						targetTable,
						relationName,
						fkExpr,
						fkExpr,
						this.translator.escapeIdentifier(targetTable) + " t",
						rowToJson,
					);
				const batchRows = await this.fetchBatchQueryResults<T>(
					lateralSql,
					[parentIds, ...extraParams],
					targetSchema,
				);

				const groupMap = new Map<number, T[]>();
				for (const r of batchRows) {
					const fk = r._fk;
					if (!groupMap.has(fk)) groupMap.set(fk, []);
					groupMap.get(fk)!.push(r.data);
				}
				for (const row of rows) {
					row[relationName as keyof T] = (groupMap.get(row.id) ??
						[]) as T[keyof T];
				}
			} else if (relation.kind === "manyToMany") {
				const junctionTable = relation.through!;
				const sourceFK = `${schema.name}Id`;
				const targetFK = `${relation.model}Id`;
				const fkExpr = `j.${this.translator.escapeIdentifier(sourceFK)}`;
				const fromClause = `${this.translator.escapeIdentifier(targetTable)} t
          INNER JOIN ${this.translator.escapeIdentifier(junctionTable)} j
            ON t."id" = j.${this.translator.escapeIdentifier(targetFK)}`;
				const { sql: lateralSql, params: extraParams } =
					this.buildOneToManyBatchQuery(
						options,
						targetTable,
						relationName,
						fkExpr,
						fkExpr,
						fromClause,
						rowToJson,
					);
				const batchRows = await this.fetchBatchQueryResults<T>(
					lateralSql,
					[parentIds, ...extraParams],
					targetSchema,
				);

				const groupMap = new Map<number, T[]>();
				for (const r of batchRows) {
					const fk = r._fk;
					if (!groupMap.has(fk)) groupMap.set(fk, []);
					groupMap.get(fk)!.push(r.data);
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
	 * Best for deep nesting (depth > 2) or high cardinality (estimatedCost > 8).
	 *
	 * Example:
	 * 1. Execute main query: SELECT * FROM posts
	 * 2. Batch populate tags: SELECT post_id, jsonb_agg(tags.*) FROM tags ... WHERE post_id = ANY($1) GROUP BY post_id
	 * 3. Map in memory: posts[i].tags = tagsMap.get(posts[i].id)
	 */
	private async executeBatchedQueries<T extends DatrixEntry>(
		query: QuerySelectObject<T>,
	): Promise<readonly T[]> {
		const modelName = this.schemaRegistry.findModelByTableName(query.table);
		if (!modelName) return [];

		const schema = this.schemaRegistry.get(modelName);
		if (!schema) return [];

		// Collect FK columns needed for belongsTo relations so they
		// are present in the main query result even though they are hidden fields.
		// Note: hasOne FK lives in the TARGET table, not the source table.
		const fkColumnsNeeded: string[] = [];
		for (const [relationName, _opts] of Object.entries(query.populate ?? {})) {
			const relationField = schema.fields[relationName];
			if (!relationField || relationField.type !== "relation") continue;
			const rel = relationField as { kind: string; foreignKey?: string };
			if (rel.kind === "belongsTo" && rel.foreignKey) {
				fkColumnsNeeded.push(rel.foreignKey);
			}
		}

		// Inject FK columns into the select list if needed
		const baseSelect =
			query.select && (query.select as string[]).length > 0
				? (query.select as string[])
				: ["id"];
		const queryWithFks: QuerySelectObject<T> =
			fkColumnsNeeded.length > 0
				? {
						...query,
						select: [
							...baseSelect,
							...fkColumnsNeeded,
						] as unknown as QuerySelectObject<T>["select"],
					}
				: query;

		const { sql, params } = this.translator.translate(queryWithFks);
		const mainResult = await this.client.query(sql, params);
		const rows = mainResult.rows as T[];

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

			let batchQuery: string;
			let fkColumn: string;

			if (relation.kind === "belongsTo") {
				fkColumn = relation.foreignKey!;
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

				const rowToJson = this.buildSelectiveRowToJson(
					options.select as readonly string[],
					relation.model,
					options,
				);
				const belongsToExtra = this.buildBatchOptionsClause(
					options,
					targetTable,
					1,
					relationName,
				);
				batchQuery = `
          SELECT t."id" as _fk, ${rowToJson} as data
          FROM ${this.translator.escapeIdentifier(targetTable)} t
          WHERE t."id" = ANY($1)${belongsToExtra.sql}
        `;
				const batchRows = await this.fetchBatchQueryResults<T>(
					batchQuery,
					[fkValues, ...belongsToExtra.params],
					targetSchema,
				);

				let relatedRows = batchRows.map((r) => r.data);

				// Recursive nested populate
				const nestedPopulate = options?.["populate"];
				if (nestedPopulate && relatedRows.length > 0) {
					relatedRows = await this.populateBatchedRows<T>(
						relatedRows,
						targetTable,
						nestedPopulate,
					);
				}

				const dataMap = new Map<number, T>();
				for (const r of batchRows) {
					dataMap.set(r._fk, r.data);
				}

				for (const row of rows) {
					const fkValue = row[fkColumn as keyof T];
					row[relationName as keyof T] = (dataMap.get(fkValue as number) ||
						null) as T[keyof T];
					// Remove the hidden FK column injected for this lookup
					delete row[fkColumn as keyof T];
				}
			} else if (relation.kind === "hasOne") {
				// hasOne: FK is in the TARGET table (like hasMany but single result)
				fkColumn = relation.foreignKey!;
				const hasOneRowToJson = this.buildSelectiveRowToJson(
					options.select as readonly string[],
					relation.model,
					options,
				);
				const hasOneExtra = this.buildBatchOptionsClause(
					options,
					targetTable,
					1,
					relationName,
				);
				batchQuery = `
          SELECT t.${this.translator.escapeIdentifier(fkColumn)} as _fk, ${hasOneRowToJson} as data
          FROM ${this.translator.escapeIdentifier(targetTable)} t
          WHERE t.${this.translator.escapeIdentifier(fkColumn)} = ANY($1)${hasOneExtra.sql}
        `;
				const batchRows = await this.fetchBatchQueryResults<T>(
					batchQuery,
					[parentIds, ...hasOneExtra.params],
					targetSchema,
				);

				const nestedPopulate = options?.["populate"];
				if (nestedPopulate && batchRows.length > 0) {
					await this.populateBatchedRows<T>(
						batchRows.map((r) => r.data),
						targetTable,
						nestedPopulate,
					);
				}

				const dataMap = new Map<number, T>();
				for (const r of batchRows) {
					dataMap.set(r._fk, r.data);
				}

				for (const row of rows) {
					row[relationName as keyof T] = (dataMap.get(row.id) ||
						null) as T[keyof T];
				}
			} else if (relation.kind === "hasMany") {
				fkColumn = relation.foreignKey!;
				const hasManyRowToJson = this.buildSelectiveRowToJson(
					options.select as readonly string[],
					relation.model,
					options,
				);
				const hasManyFkExpr = `t.${this.translator.escapeIdentifier(fkColumn)}`;
				const { sql: hasManySql, params: hasManyExtraParams } =
					this.buildOneToManyBatchQuery(
						options,
						targetTable,
						relationName,
						hasManyFkExpr,
						hasManyFkExpr,
						this.translator.escapeIdentifier(targetTable) + " t",
						hasManyRowToJson,
					);
				batchQuery = hasManySql;
				const batchRows = await this.fetchBatchQueryResults<T>(
					batchQuery,
					[parentIds, ...hasManyExtraParams],
					targetSchema,
				);

				const nestedPopulate = options?.["populate"];
				if (nestedPopulate && batchRows.length > 0) {
					await this.populateBatchedRows<T>(
						batchRows.map((r) => r.data),
						targetTable,
						nestedPopulate,
					);
				}

				const groupMap = new Map<number, T[]>();
				for (const r of batchRows) {
					const fk = r._fk;
					if (!groupMap.has(fk)) groupMap.set(fk, []);
					groupMap.get(fk)!.push(r.data);
				}

				for (const row of rows) {
					row[relationName as keyof T] = (groupMap.get(row.id) ||
						[]) as T[keyof T];
				}
			} else if (relation.kind === "manyToMany") {
				const junctionTable = relation.through!;
				const sourceFK = `${schema.name}Id`;
				const targetFK = `${relation.model}Id`;

				const m2mRowToJson = this.buildSelectiveRowToJson(
					options.select as readonly string[],
					relation.model,
					options,
				);
				const m2mFkExpr = `j.${this.translator.escapeIdentifier(sourceFK)}`;
				const m2mFromClause = `${this.translator.escapeIdentifier(targetTable)} t
          INNER JOIN ${this.translator.escapeIdentifier(junctionTable)} j
            ON t."id" = j.${this.translator.escapeIdentifier(targetFK)}`;
				const { sql: m2mSql, params: m2mExtraParams } =
					this.buildOneToManyBatchQuery(
						options,
						targetTable,
						relationName,
						m2mFkExpr,
						m2mFkExpr,
						m2mFromClause,
						m2mRowToJson,
					);
				batchQuery = m2mSql;
				const batchRows = await this.fetchBatchQueryResults<T>(
					batchQuery,
					[parentIds, ...m2mExtraParams],
					targetSchema,
				);

				const nestedPopulate = options?.["populate"];
				if (nestedPopulate && batchRows.length > 0) {
					await this.populateBatchedRows<T>(
						batchRows.map((r) => r.data),
						targetTable,
						nestedPopulate,
					);
				}

				const groupMap = new Map<number, T[]>();
				for (const r of batchRows) {
					const fk = r._fk;
					if (!groupMap.has(fk)) groupMap.set(fk, []);
					groupMap.get(fk)!.push(r.data);
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
	private async populateBatchedRows<T extends DatrixEntry>(
		rows: T[],
		tableName: string,
		populate: QueryPopulate<T>,
	): Promise<T[]> {
		const modelName = this.schemaRegistry.findModelByTableName(tableName);
		if (!modelName) return rows;

		const schema = this.schemaRegistry.get(modelName);
		if (!schema) return rows;

		const parentIds = rows.map((r) => r.id);

		for (const [relationName, _opts] of Object.entries(populate)) {
			const relationField = schema.fields[relationName];
			const opts = _opts as QueryPopulateOptions<T>;
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

			const nestedRowToJson = this.buildSelectiveRowToJson(
				opts.select as readonly string[],
				relation.model,
				opts,
			);

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

				const belongsToExtra = this.buildBatchOptionsClause(
					opts,
					targetTable,
					1,
					relationName,
				);
				const batchQuery = `
          SELECT t."id" as _fk, ${nestedRowToJson} as data
          FROM ${this.translator.escapeIdentifier(targetTable)} t
          WHERE t."id" = ANY($1)${belongsToExtra.sql}
        `;
				const batchRows = await this.fetchBatchQueryResults<T>(
					batchQuery,
					[fkValues, ...belongsToExtra.params],
					targetSchema,
				);

				let relatedRows = batchRows.map((r) => r.data);

				const nestedPopulate = opts.populate;
				if (nestedPopulate && relatedRows.length > 0) {
					relatedRows = await this.populateBatchedRows<T>(
						relatedRows,
						targetTable,
						nestedPopulate,
					);
				}

				const dataMap = new Map<number, T>();
				for (const r of batchRows) {
					dataMap.set(r._fk, r.data);
				}
				for (const row of rows) {
					const fkValue = row[fkColumn as keyof T];
					row[relationName as keyof T] = (dataMap.get(fkValue as number) ||
						null) as T[keyof T];
					delete row[fkColumn as keyof T];
				}
			} else if (relation.kind === "hasOne") {
				const fkColumn = relation.foreignKey!;
				const nestedParentIds = parentIds;
				const hasOneExtra = this.buildBatchOptionsClause(
					opts,
					targetTable,
					1,
					relationName,
				);

				const batchQuery = `
          SELECT t.${this.translator.escapeIdentifier(fkColumn)} as _fk, ${nestedRowToJson} as data
          FROM ${this.translator.escapeIdentifier(targetTable)} t
          WHERE t.${this.translator.escapeIdentifier(fkColumn)} = ANY($1)${hasOneExtra.sql}
        `;
				const batchRows = await this.fetchBatchQueryResults<T>(
					batchQuery,
					[nestedParentIds, ...hasOneExtra.params],
					targetSchema,
				);

				const nestedPopulate = opts.populate;
				if (nestedPopulate && batchRows.length > 0) {
					await this.populateBatchedRows<T>(
						batchRows.map((r) => r.data),
						targetTable,
						nestedPopulate,
					);
				}

				const dataMap = new Map<number, T>();
				for (const r of batchRows) {
					dataMap.set(r._fk, r.data);
				}
				for (const row of rows) {
					row[relationName as keyof T] = (dataMap.get(row.id) ||
						null) as T[keyof T];
				}
			} else if (relation.kind === "hasMany") {
				const fkColumn = relation.foreignKey!;
				const nestedHasManyFkExpr = `t.${this.translator.escapeIdentifier(fkColumn)}`;
				const { sql: batchQuery, params: hasManyExtraParams } =
					this.buildOneToManyBatchQuery(
						opts,
						targetTable,
						relationName,
						nestedHasManyFkExpr,
						nestedHasManyFkExpr,
						this.translator.escapeIdentifier(targetTable) + " t",
						nestedRowToJson,
					);
				const batchRows = await this.fetchBatchQueryResults<T>(
					batchQuery,
					[parentIds, ...hasManyExtraParams],
					targetSchema,
				);

				const nestedPopulate = opts.populate;
				if (nestedPopulate && batchRows.length > 0) {
					await this.populateBatchedRows<T>(
						batchRows.map((r) => r.data),
						targetTable,
						nestedPopulate,
					);
				}

				const groupMap = new Map<number, T[]>();
				for (const r of batchRows) {
					const fk = r._fk;
					if (!groupMap.has(fk)) groupMap.set(fk, []);
					groupMap.get(fk)!.push(r.data);
				}
				for (const row of rows) {
					row[relationName as keyof T] = (groupMap.get(row.id) ||
						[]) as T[keyof T];
				}
			} else if (relation.kind === "manyToMany") {
				const junctionTable = relation.through!;
				const sourceFK = `${schema.name}Id`;
				const targetFK = `${relation.model}Id`;
				const nestedM2mFkExpr = `j.${this.translator.escapeIdentifier(sourceFK)}`;
				const nestedM2mFromClause = `${this.translator.escapeIdentifier(targetTable)} t
          INNER JOIN ${this.translator.escapeIdentifier(junctionTable)} j
            ON t."id" = j.${this.translator.escapeIdentifier(targetFK)}`;
				const { sql: batchQuery, params: m2mExtraParams } =
					this.buildOneToManyBatchQuery(
						opts,
						targetTable,
						relationName,
						nestedM2mFkExpr,
						nestedM2mFkExpr,
						nestedM2mFromClause,
						nestedRowToJson,
					);
				const batchRows = await this.fetchBatchQueryResults<T>(
					batchQuery,
					[parentIds, ...m2mExtraParams],
					targetSchema,
				);

				const nestedPopulate = opts.populate;
				if (nestedPopulate && batchRows.length > 0) {
					await this.populateBatchedRows<T>(
						batchRows.map((r) => r.data),
						targetTable,
						nestedPopulate,
					);
				}

				const groupMap = new Map<number, T[]>();
				for (const r of batchRows) {
					const fk = r._fk;
					if (!groupMap.has(fk)) groupMap.set(fk, []);
					groupMap.get(fk)!.push(r.data);
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
	private buildJsonAggregationQuery<T extends DatrixEntry>(
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
	 * Collect FK columns needed by nested populate (belongsTo/hasOne).
	 * These must be included in the row_to_json so recursive populate can use them.
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
	 * Build row_to_json with specific fields instead of t.*
	 * Automatically injects FK columns needed by nested populate.
	 * Returns: row_to_json((SELECT r FROM (SELECT t."id", t."name") r))
	 */
	private buildSelectiveRowToJson<T extends DatrixEntry>(
		select: readonly string[],
		targetModel?: string,
		opts?: QueryPopulateOptions<T>,
	): string {
		const allFields = [...select];

		// Inject FK columns needed for nested populate
		if (targetModel && opts) {
			const fkColumns = this.collectNestedFkColumns(targetModel, opts);
			for (const fk of fkColumns) {
				if (!allFields.includes(fk)) {
					allFields.push(fk);
				}
			}
		}

		const fields = allFields
			.map((field) => `t.${this.translator.escapeIdentifier(field as string)}`)
			.join(", ");
		return `row_to_json((SELECT r FROM (SELECT ${fields}) r))`;
	}

	/**
	 * Translate a populate-level `where` against the target table, aliased as
	 * `t` (or `j`/`t` for manyToMany — the alias is always "t" for the target
	 * table itself). Returns the ` AND <cond>` SQL fragment (empty string if no
	 * `where`) plus the extra params, starting at `startParamIndex`.
	 *
	 * Nested relation filters (conditions whose translation needs a JOIN, e.g.
	 * `{ author: { verified: true } }` inside a populate-level `where`) are not
	 * wired into the batch SQL — the joins that `translateWhere` would produce
	 * have no attachment point here. Per contract §4 ("never silently ignore a
	 * condition"), this is a hard error rather than a silent drop.
	 */
	private translateOptionsWhere<T extends DatrixEntry>(
		options: QueryPopulateOptions<T>,
		targetTable: string,
		startParamIndex: number,
		relationName: string,
	): { sql: string; params: unknown[] } {
		if (!options.where) {
			return { sql: "", params: [] };
		}

		const whereResult = this.translator.translateWhere(
			options.where,
			startParamIndex,
			targetTable,
			"t",
		);

		if (whereResult.joins.length > 0) {
			throwQueryError({
				adapter: "postgres",
				message:
					`Populate "where" on relation "${relationName}" contains a nested ` +
					`relation condition, which is not supported in the batched/lateral ` +
					`populate strategies. Move the nested-relation filter to the top-level ` +
					`query WHERE, or filter on scalar fields of "${targetTable}" only.`,
			});
		}

		return { sql: ` AND ${whereResult.sql}`, params: [...whereResult.params] };
	}

	/**
	 * Build extra SQL clauses (WHERE/ORDER BY/LIMIT/OFFSET) for batch queries
	 * from populate options, WITHOUT per-parent-row semantics. Used only for
	 * belongsTo/hasOne (single-row relations), where `limit`/`offset` are
	 * meaningless and therefore intentionally not applied (Part 5 resolution).
	 * `orderBy` alone (no limit/offset) is harmless to keep here too, but
	 * belongsTo/hasOne never pass more than one matching row per parent so it
	 * has no observable effect; kept for parity with the previous behavior.
	 */
	private buildBatchOptionsClause<T extends DatrixEntry>(
		options: QueryPopulateOptions<T>,
		targetTable: string,
		startParamIndex: number,
		relationName: string,
	): { sql: string; params: unknown[] } {
		const { sql: whereSQL, params } = this.translateOptionsWhere(
			options,
			targetTable,
			startParamIndex,
			relationName,
		);

		return { sql: whereSQL, params };
	}

	/**
	 * Build the full batched SQL query for a hasMany or manyToMany populate.
	 *
	 * Fast path (no `limit`/`offset`): a plain `WHERE fk = ANY($1) [AND where] [ORDER BY]`.
	 * Windowed path (`limit` and/or `offset` present): wraps the same
	 * projection in `ROW_NUMBER() OVER (PARTITION BY <partition column> ORDER
	 * BY <orderBy or "id">)` so limit/offset apply PER parent row instead of
	 * globally across the whole batch (Part 2 resolution).
	 *
	 * @param fkSelectExpr - SQL expression selected as `_fk` (e.g. `t."postId"` or `j."postId"`).
	 * @param partitionExpr - SQL expression to PARTITION BY in the windowed path
	 *   (same as fkSelectExpr for hasMany; the junction sourceFK for manyToMany).
	 * @param fromClause - SQL after `FROM` (target table alone, or target + junction JOIN).
	 */
	private buildOneToManyBatchQuery<T extends DatrixEntry>(
		options: QueryPopulateOptions<T>,
		targetTable: string,
		relationName: string,
		fkSelectExpr: string,
		partitionExpr: string,
		fromClause: string,
		rowToJson: string,
	): { sql: string; params: unknown[] } {
		const { sql: whereSQL, params: whereParams } = this.translateOptionsWhere(
			options,
			targetTable,
			2,
			relationName,
		);

		const needsWindow =
			options.limit !== undefined ||
			(options.offset !== undefined && options.offset > 0);

		if (!needsWindow) {
			let orderSQL = "";
			if (options.orderBy && options.orderBy.length > 0) {
				orderSQL = ` ORDER BY ${this.buildOrderBySQL(options.orderBy)}`;
			}

			const sql = `
        SELECT ${fkSelectExpr} as _fk, ${rowToJson} as data
        FROM ${fromClause}
        WHERE ${fkSelectExpr} = ANY($1)${whereSQL}${orderSQL}
      `;
			return { sql, params: whereParams };
		}

		const partitionOrderSQL =
			options.orderBy && options.orderBy.length > 0
				? this.buildOrderBySQL(options.orderBy)
				: `t."id"`;

		const params = [...whereParams];
		let paramIdx = 2 + whereParams.length;

		let boundsSQL = "";
		if (options.offset !== undefined && options.offset > 0) {
			boundsSQL += ` AND w._rn > $${paramIdx}`;
			params.push(options.offset);
			paramIdx++;
		} else {
			boundsSQL += ` AND w._rn > 0`;
		}

		if (options.limit !== undefined) {
			const offsetValue =
				options.offset !== undefined && options.offset > 0 ? options.offset : 0;
			boundsSQL += ` AND w._rn <= $${paramIdx}`;
			params.push(offsetValue + options.limit);
			paramIdx++;
		}

		const sql = `
      SELECT w."_fk", w."data"
      FROM (
        SELECT ${fkSelectExpr} as _fk, ${rowToJson} as data,
          ROW_NUMBER() OVER (PARTITION BY ${partitionExpr} ORDER BY ${partitionOrderSQL}) AS _rn
        FROM ${fromClause}
        WHERE ${fkSelectExpr} = ANY($1)${whereSQL}
      ) w
      WHERE TRUE${boundsSQL}
    `;

		return { sql, params };
	}

	/**
	 * Shared ORDER BY builder for populate options (target table aliased "t").
	 */
	private buildOrderBySQL<T extends DatrixEntry>(
		orderBy: NonNullable<QueryPopulateOptions<T>["orderBy"]>,
	): string {
		return orderBy
			.map((item) => {
				let s = `t.${this.translator.escapeIdentifier(item.field as string)} ${item.direction.toUpperCase()}`;
				if (item.nulls) s += ` NULLS ${item.nulls.toUpperCase()}`;
				return s;
			})
			.join(", ");
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

	/**
	 * Execute a batched SQL query and cast the result rows.
	 * Error handling is delegated to PgClient (already wraps errors in DatrixAdapterError).
	 *
	 * `targetSchema`, when provided, is the schema of the relation's target
	 * model (the `row_to_json` payload in `r.data`). Part 3: `row_to_json` has
	 * no knowledge of the schema, so date/number/json fields inside `data`
	 * arrive as strings — this is the single choke point every batched/lateral
	 * relation fetch goes through, so converting here covers site (b) for all
	 * strategies (lateral-joins, batched-queries, populateBatchedRows) without
	 * repeating the conversion call at each of the ~11 call sites.
	 */
	private async fetchBatchQueryResults<T extends DatrixEntry>(
		sql: string,
		params: unknown[],
		targetSchema?: SchemaDefinition,
	): Promise<(T & { _fk: number; data: T })[]> {
		const result = await this.client.query<T & { _fk: number; data: T }>(
			sql,
			params,
		);

		if (targetSchema && schemaNeedsConversion(targetSchema)) {
			for (const row of result.rows) {
				if (row.data && typeof row.data === "object") {
					convertRowTypes(
						row.data as unknown as Record<string, unknown>,
						targetSchema,
					);
				}
			}
		}

		return result.rows;
	}
}
