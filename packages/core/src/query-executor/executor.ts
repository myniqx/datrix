/**
 * Query Executor
 *
 * Responsible for:
 * 1. Schema validation (min/max/regex/type/required)
 * 2. Timestamp injection
 * 3. Query execution via adapter
 * 4. Relation processing (async operations)
 * 5. Plugin hooks (via dispatcher)
 */

import { DatabaseAdapter } from "forja-types/adapter";
import {
	SchemaRegistry,
	SchemaDefinition,
	ForjaEntry,
	RelationField,
} from "forja-types/core/schema";
import { QueryObject, WhereClause } from "forja-types/core/query-builder";
import { QueryAction } from "forja-types/plugin";
import { Dispatcher } from "../dispatcher";
import { validateData } from "./validation";
import { processRelations, resolveRelationCUD } from "./relations";
import {
	throwQueryExecutionError,
	throwSchemaNotFoundError,
} from "../mixins/error-helper";
import { throwUnsupportedQueryType } from "./error-helper";

/**
 * Executor execution options
 */
export interface ExecutorOptions {
	/** If true, bypass dispatcher (no hooks) */
	noDispatcher?: boolean;
	/** If true, return only ID/count instead of full record */
	noReturning?: boolean;
	/** Query action override */
	action?: QueryAction;
}

/**
 * Query Executor Class
 *
 * Executes QueryObject instances with full validation, timestamp management,
 * and relation processing.
 */
export class QueryExecutor {
	constructor(
		private readonly schemas: SchemaRegistry,
		private readonly getAdapter: () => DatabaseAdapter,
		private readonly getDispatcher: () => Dispatcher,
	) {}

	/**
	 * Execute a query
	 *
	 * @param query - Query object from QueryBuilder
	 * @param options - Execution options (dispatcher, returning)
	 * @returns Query result
	 *
	 * @example
	 * ```ts
	 * const query = insertInto('User', { name: 'John' }, registry).build();
	 * const user = await executor.execute(query);
	 *
	 * // Raw mode (no hooks)
	 * const result = await executor.execute(query, { noDispatcher: true });
	 *
	 * // ID only (no fetch)
	 * const id = await executor.execute<User, number>(query, { noReturning: true });
	 * ```
	 */
	async execute<T extends ForjaEntry, R = T | T[] | number | boolean>(
		query: QueryObject<T>,
		options: ExecutorOptions = {},
	): Promise<R> {
		const schema = this.getSchema(query.table);

		// SELECT: Direct execution
		if (query.type === "select") {
			return this.executeSelect<T>(query, schema, options) as R;
		}

		// COUNT: Direct execution
		if (query.type === "count") {
			return this.executeCount<T>(query, schema, options) as R;
		}

		// DELETE: Fetch first (if returning), then delete
		if (query.type === "delete") {
			return this.executeDelete<T>(query, schema, options) as R;
		}

		// INSERT/UPDATE: Validation + relations + fetch result
		if (query.type === "insert") {
			return this.executeInsert<T>(query, schema, options) as R;
		}

		// INSERT/UPDATE: Validation + relations + fetch result
		if (query.type === "update") {
			return this.executeUpdate<T>(query, schema, options) as R;
		}

		throwUnsupportedQueryType(query.type);
	}

	/**
	 * Execute SELECT query
	 *
	 * Always returns array (caller decides single vs multiple).
	 * Can be reused for fetching after INSERT/UPDATE/DELETE.
	 */
	async executeSelect<T extends ForjaEntry>(
		query: QueryObject<T>,
		schema: SchemaDefinition,
		options: ExecutorOptions,
	): Promise<T[]> {
		return this.executeWithDispatcher<T, T[]>(
			options.action ?? "findMany",
			schema,
			query,
			options.noDispatcher ?? false,
			async (q) => {
				const result = await this.getAdapter().executeQuery<T>(q);
				if (!result.success) {
					throwQueryExecutionError("findMany", schema.name, q, result.error);
				}
				return result.data.rows as T[];
			},
		);
	}

	/**
	 * Execute COUNT query
	 */
	async executeCount<T extends ForjaEntry>(
		query: QueryObject<T>,
		schema: SchemaDefinition,
		options: ExecutorOptions,
	): Promise<number> {
		return this.executeWithDispatcher<T, number>(
			options.action ?? "count",
			schema,
			query,
			options.noDispatcher ?? false,
			async (q) => {
				const result = await this.getAdapter().executeQuery<T>(q);
				if (!result.success) {
					throwQueryExecutionError("count", schema.name, q, result.error);
				}
				return (
					(result.data.rows[0] as unknown as { count: number })?.count ?? 0
				);
			},
		);
	}

	/**
	 * Execute DELETE query (cascade junction tables, fetch first, then delete)
	 */
	async executeDelete<T extends ForjaEntry>(
		query: QueryObject<T>,
		schema: SchemaDefinition,
		options: ExecutorOptions,
	): Promise<T[] | boolean> {
		// 1. CASCADE DELETE: Clean up junction tables for manyToMany relations
		// Find all manyToMany relations in schema
		const m2mRelations = Object.entries(schema.fields).filter(
			([_, field]) => field.type === "relation" && field.kind === "manyToMany",
		);

		if (m2mRelations.length > 0 && query.where) {
			// Need to fetch IDs first to clean junction tables
			const selectQuery: QueryObject<T> = {
				type: "select",
				table: query.table,
				where: query.where,
				select: ["id"] as readonly (keyof T)[],
			};

			const recordsToDelete = await this.executeSelect<T>(
				selectQuery,
				schema,
				options,
			);
			const idsToDelete = recordsToDelete.map((r) => r.id);

			if (idsToDelete.length > 0) {
				// Clean up junction tables for each manyToMany relation
				for (const [_, field] of m2mRelations) {
					const relation = field as RelationField;
					const junctionTable = relation.through!;
					const sourceForeignKey = `${schema.name}Id`;

					// Delete junction records
					const junctionQuery: QueryObject<T> = {
						type: "delete",
						table: junctionTable,
						where: {
							[sourceForeignKey]: { $in: idsToDelete },
						} as WhereClause<T>,
					};

					const result = await this.getAdapter().executeQuery(junctionQuery);
					if (!result.success) {
						throwQueryExecutionError(
							"delete",
							junctionTable,
							junctionQuery,
							result.error,
						);
					}
				}
			}
		}

		// 2. Fetch records that will be deleted (if returning enabled)
		let recordsToDelete: T[] | undefined = undefined;

		if (!options.noReturning && (query.select || query.populate)) {
			const selectQuery: QueryObject<T> = {
				...query,
				type: "select",
			};
			recordsToDelete = await this.executeSelect<T>(
				selectQuery,
				schema,
				options,
			);
		}

		// 3. Execute DELETE
		const deleteResult = await this.executeWithDispatcher<T, boolean>(
			options.action ?? "delete",
			schema,
			query,
			options.noDispatcher ?? false,
			async (q) => {
				const result = await this.getAdapter().executeQuery<T>(q);
				if (!result.success) {
					throwQueryExecutionError("delete", schema.name, q, result.error);
				}
				return (result.data.metadata.rowCount ?? 0) > 0;
			},
		);

		// 4. Return fetched records if requested, otherwise boolean
		if (recordsToDelete !== undefined) {
			return recordsToDelete;
		}
		return deleteResult;
	}

	/**
	 * Execute INSERT with validation and relations
	 */
	private async executeInsert<T extends ForjaEntry>(
		query: QueryObject<T>,
		schema: SchemaDefinition,
		options: ExecutorOptions,
	): Promise<T | number> {
		const isRawMode = options.noDispatcher ?? false;

		// 1. Validate data against schema (min/max/regex/type) + add timestamps
		const validatedData = validateData<T, false>(
			query.data,
			query.relations,
			schema,
			{
				partial: false,
				isCreate: true,
				isRawMode,
			},
		);

		// 2. Execute INSERT query (scalars only)
		const queryWithValidatedData: QueryObject<T> = {
			type: "insert",
			table: query.table,
			data: validatedData,
		};

		const recordId = await this.executeWithDispatcher<T, number>(
			options.action ?? "create",
			schema,
			queryWithValidatedData,
			options.noDispatcher ?? false,
			async (q) => {
				const result = await this.getAdapter().executeQuery<T>(q);
				if (!result.success) {
					throwQueryExecutionError("create", schema.name, q, result.error);
				}
				// INSERT: Return inserted ID
				return result.data.metadata?.insertId ?? result.data.rows?.[0]?.id!;
			},
		);

		// 3. Process relations (if any) - resolve CUD once, then link
		if (query.relations) {
			const resolvedOps = await resolveRelationCUD(
				query.relations,
				schema,
				this,
				this.schemas,
			);
			await processRelations(
				resolvedOps,
				recordId,
				schema.name,
				schema,
				this,
				this.schemas,
			);
		}

		// 4. Fetch and return the created record (if returning enabled)
		if (options.noReturning) {
			return typeof recordId === "number"
				? recordId
				: parseInt(recordId as string, 10);
		}

		// Build SELECT query to fetch the record
		const selectQuery: QueryObject<T> = {
			type: "select",
			table: query.table,
			where: { id: recordId } as WhereClause<T>,
			select: query.select,
			populate: query.populate,
		};

		const results = await this.executeSelect<T>(selectQuery, schema, {
			noDispatcher: true,
		});
		return results[0]!;
	}

	/**
	 * Execute UPDATE with validation and relations
	 *
	 */
	async executeUpdate<T extends ForjaEntry>(
		query: QueryObject<T>,
		schema: SchemaDefinition,
		options: ExecutorOptions,
	): Promise<T | number[]> {
		const isRawMode = options.noDispatcher ?? false;

		// 1. Validate data against schema (min/max/regex/type) + add timestamps
		const validatedData = validateData<T, true>(
			query.data,
			query.relations,
			schema,
			{
				partial: true,
				isCreate: false,
				isRawMode,
			},
		);

		// 2. Execute UPDATE query (scalars only)
		const queryWithValidatedData: QueryObject<T> = {
			type: "update",
			table: query.table,
			data: validatedData,
			where: query.where,
		};

		const recordIds = await this.executeWithDispatcher<T, number[]>(
			options.action ?? "update",
			schema,
			queryWithValidatedData,
			options.noDispatcher ?? false,
			async (q) => {
				const result = await this.getAdapter().executeQuery<T>(q);
				if (!result.success) {
					throwQueryExecutionError("update", schema.name, q, result.error);
				}
				return result.data.rows.map((r) => r.id) ?? [];
			},
		);

		// 3. Process relations (if any) - resolve CUD ONCE, then link per parent
		if (query.relations) {
			const resolvedOps = await resolveRelationCUD(
				query.relations,
				schema,
				this,
				this.schemas,
			);
			for (const recordId of recordIds) {
				await processRelations(
					resolvedOps,
					recordId,
					schema.name,
					schema,
					this,
					this.schemas,
				);
			}
		}

		// 4. Fetch and return the updated record (if returning enabled)
		if (options.noReturning) {
			return recordIds;
		}

		// Build SELECT query to fetch the record
		const selectQuery: QueryObject<T> = {
			type: "select",
			table: query.table,
			where: query.where, // Use original WHERE clause to fetch updated records
			select: query.select,
			populate: query.populate,
		};

		const results = await this.executeSelect<T>(selectQuery, schema, {
			noDispatcher: true,
		});
		return results as unknown as T;
	}

	/**
	 * Execute query with optional dispatcher hooks
	 */
	private async executeWithDispatcher<T extends ForjaEntry, R>(
		action: QueryAction,
		schema: SchemaDefinition,
		query: QueryObject<T>,
		noDispatcher: boolean,
		handler: (q: QueryObject<T>) => Promise<R>,
	): Promise<R> {
		if (noDispatcher) {
			// Raw mode: Execute directly (no hooks)
			return handler(query);
		}

		// Normal mode: Execute with hooks
		return this.getDispatcher().executeQuery<T, R>(
			action,
			schema,
			query,
			handler,
		);
	}

	/**
	 * Get schema by table name
	 */
	private getSchema(tableName: string): SchemaDefinition {
		const result = this.schemas.getByTableName(tableName);
		if (!result) {
			throwSchemaNotFoundError(tableName);
		}
		return result.schema;
	}
}
