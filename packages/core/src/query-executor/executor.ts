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

import { DatabaseAdapter, QueryRunner } from "forja-types/adapter";
import {
	ISchemaRegistry,
	SchemaDefinition,
	ForjaEntry,
} from "forja-types/core/schema";
import {
	QueryObject,
	QuerySelectObject,
	QueryCountObject,
	QueryInsertObject,
	QueryUpdateObject,
	QueryDeleteObject,
	WhereClause,
} from "forja-types/core/query-builder";
import { QueryAction } from "forja-types/plugin";
import { Dispatcher } from "../dispatcher";
import { validateData } from "./validation";
import { processRelations, resolveRelationCUD } from "./relations";
import {
	throwSchemaNotFoundError,
	throwUnsupportedQueryType,
} from "./error-helper";

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
		private readonly schemas: ISchemaRegistry,
		private readonly getAdapter: () => DatabaseAdapter,
		private readonly getDispatcher: () => Dispatcher,
	) { }

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
	async execute<T extends ForjaEntry, R>(
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

		throwUnsupportedQueryType((query as { type: string }).type);
	}

	/**
	 * Execute SELECT query
	 *
	 * Always returns array (caller decides single vs multiple).
	 * Can be reused for fetching after INSERT/UPDATE/DELETE.
	 */
	async executeSelect<T extends ForjaEntry>(
		query: QuerySelectObject<T>,
		schema: SchemaDefinition,
		options: ExecutorOptions,
	): Promise<T[]> {
		return this.withLifecycle(
			options.action ?? "findMany",
			schema,
			options.noDispatcher ?? false,
			query,
			async (mq) => {
				const result = await this.getAdapter().executeQuery<T>(mq);
				return result.rows as T[];
			},
		);
	}

	/**
	 * Execute COUNT query
	 */
	async executeCount<T extends ForjaEntry>(
		query: QueryCountObject<T>,
		schema: SchemaDefinition,
		options: ExecutorOptions,
	): Promise<number> {
		return this.withLifecycle(
			options.action ?? "count",
			schema,
			options.noDispatcher ?? false,
			query,
			async (mq) => {
				const result = await this.getAdapter().executeQuery<T>(mq);
				return result.metadata.count ?? 0;
			},
		);
	}

	/**
	 * Execute DELETE query (cascade junction tables, fetch first, then delete)
	 *
	 * Transaction flow: onBefore → BEGIN → SELECT (fetch) + junction cascade + DELETE → COMMIT → onAfter
	 */
	async executeDelete<T extends ForjaEntry>(
		query: QueryDeleteObject<T>,
		schema: SchemaDefinition,
		options: ExecutorOptions,
	): Promise<readonly T[]> {
		return this.withLifecycle(
			options.action ?? "delete",
			schema,
			options.noDispatcher ?? false,
			query,
			async (mq) => {
				// 1. Begin transaction
				const adapter = this.getAdapter();
				const { runner, commit, rollback } =
					await this.beginTransaction(adapter);

				let deleteResult: readonly T[];
				let returningResult: readonly T[];

				try {
					// 2. Pre-fetch rows if caller needs select/populate results
					const needsReturnSelect =
						!options.noReturning && (mq.select || mq.populate);

					let prefetchedRows: readonly T[] | undefined;

					if (needsReturnSelect) {
						const selectResult = await runner.executeQuery<T>({
							type: "select",
							table: mq.table,
							where: mq.where,
							select: mq.select ?? ["id"],
							...(mq.populate !== undefined && { populate: mq.populate }),
						});
						prefetchedRows = selectResult.rows;
					}
					// TODO: do we need transaction here?
					// 3. Execute DELETE (junction cleanup handled by DB via ON DELETE CASCADE)
					const deleteQueryResult = await runner.executeQuery<T>(mq);
					deleteResult = deleteQueryResult.rows;

					// 4. Commit transaction
					await commit();

					returningResult = needsReturnSelect ? prefetchedRows! : deleteResult;
				} catch (error) {
					await rollback();
					throw error;
				}

				return returningResult;
			},
		);
	}

	/**
	 * Execute INSERT with validation and relations
	 *
	 * Transaction flow: onBefore → validate → BEGIN → INSERT + relations → COMMIT → SELECT → onAfter
	 */
	async executeInsert<T extends ForjaEntry>(
		query: QueryInsertObject<T>,
		schema: SchemaDefinition,
		options: ExecutorOptions,
	): Promise<readonly T[]> {
		const noDispatcher = options.noDispatcher ?? false;

		return this.withLifecycle(
			options.action ?? "create",
			schema,
			noDispatcher,
			query,
			async (mq) => {
				const insertQuery = mq as QueryInsertObject<T>;

				// 1. Validate each data item against schema + add timestamps
				const validatedItems = insertQuery.data.map((item) =>
					validateData<T, false>(item, insertQuery.relations, schema, {
						partial: false,
						isCreate: true,
						isRawMode: noDispatcher,
					}),
				);

				// 2. Begin transaction
				const adapter = this.getAdapter();
				const { runner, commit, rollback } =
					await this.beginTransaction(adapter);

				let insertedIds: readonly T[];

				try {
					// 3. Execute INSERT query (bulk)
					const queryWithValidatedData: QueryInsertObject<T> = {
						type: "insert",
						table: insertQuery.table,
						data: validatedItems,
					};

					const insertResult = await runner.executeQuery<T>(
						queryWithValidatedData,
					);
					insertedIds = insertResult.rows;

					// 4. Process relations (if any) - resolve CUD once, then link per record
					if (insertQuery.relations) {
						const resolvedOps = await resolveRelationCUD(
							insertQuery.relations,
							schema,
							runner,
							this.schemas,
						);
						for (const recordId of insertedIds) {
							await processRelations(
								resolvedOps,
								recordId.id,
								schema.name,
								schema,
								runner,
								this.schemas,
							);
						}
					}

					// 5. Commit transaction
					await commit();
				} catch (error) {
					await rollback();
					throw error;
				}

				// 6. Fetch full records (if returning enabled)
				if (options.noReturning) {
					return insertedIds;
				}

				const selectQuery: QuerySelectObject<T> = {
					type: "select",
					table: insertQuery.table,
					select: insertQuery.select!,
					where: {
						id: { $in: insertedIds.map((r) => r.id) },
					} as unknown as WhereClause<T>,
					...(insertQuery.populate !== undefined && {
						populate: insertQuery.populate,
					}),
				};

				return this.executeSelect<T>(selectQuery, schema, {
					noDispatcher: true,
				});
			},
		);
	}

	/**
	 * Execute UPDATE with validation and relations
	 *
	 * Transaction flow: onBefore → validate → BEGIN → UPDATE + relations → COMMIT → SELECT → onAfter
	 */
	async executeUpdate<T extends ForjaEntry>(
		query: QueryUpdateObject<T>,
		schema: SchemaDefinition,
		options: ExecutorOptions,
	): Promise<readonly T[]> {
		const noDispatcher = options.noDispatcher ?? false;

		return this.withLifecycle(
			options.action ?? "update",
			schema,
			noDispatcher,
			query,
			async (mq) => {
				const updateQuery = mq as QueryUpdateObject<T>;

				// 1. Validate data against schema (min/max/regex/type) + add timestamps
				const validatedData = validateData<T, true>(
					updateQuery.data,
					updateQuery.relations,
					schema,
					{
						partial: true,
						isCreate: false,
						isRawMode: noDispatcher,
					},
				);

				// 2. Begin transaction
				const adapter = this.getAdapter();
				const { runner, commit, rollback } =
					await this.beginTransaction(adapter);

				let recordIds: readonly T[];

				try {
					// 3. Execute UPDATE query (scalars only)
					const queryWithValidatedData: QueryUpdateObject<T> = {
						type: "update",
						table: updateQuery.table,
						data: validatedData,
						...(updateQuery.where !== undefined && {
							where: updateQuery.where,
						}),
					};

					const updateResult = await runner.executeQuery<T>(
						queryWithValidatedData,
					);
					recordIds = updateResult.rows;

					// 4. Process relations (if any) - resolve CUD ONCE, then link per parent
					if (updateQuery.relations) {
						const resolvedOps = await resolveRelationCUD(
							updateQuery.relations,
							schema,
							runner,
							this.schemas,
						);
						for (const recordId of recordIds) {
							await processRelations(
								resolvedOps,
								recordId.id,
								schema.name,
								schema,
								runner,
								this.schemas,
							);
						}
					}

					// 5. Commit transaction
					await commit();
				} catch (error) {
					await rollback();
					throw error;
				}

				// 6. Fetch full records (if returning enabled)
				if (options.noReturning) {
					return recordIds;
				}

				// Use updated record IDs for select (not original where, which may no longer match)
				const selectQuery: QuerySelectObject<T> = {
					type: "select",
					table: updateQuery.table,
					select: updateQuery.select!,
					where: {
						id: { $in: recordIds.map((r) => r.id) },
					} as unknown as WhereClause<T>,
					...(updateQuery.populate !== undefined && {
						populate: updateQuery.populate,
					}),
				};

				return this.executeSelect<T>(selectQuery, schema, {
					noDispatcher: true,
				});
			},
		);
	}

	/**
	 * Wraps a handler with dispatcher lifecycle: buildContext → onBefore → handler → onAfter.
	 * If noDispatcher is true, skips all hooks and runs handler directly.
	 * hookCtx is created once and shared between before/after so metadata persists.
	 */
	private async withLifecycle<TResult, TQuery>(
		action: QueryAction,
		schema: SchemaDefinition,
		noDispatcher: boolean,
		query: TQuery,
		handler: (modifiedQuery: TQuery) => Promise<TResult>,
	): Promise<TResult> {
		const dispatcher = this.getDispatcher();

		if (noDispatcher) {
			return handler(query);
		}

		const context = await dispatcher.buildQueryContext(action, schema);
		const hookCtx = { schema, metadata: context.metadata };

		const modifiedQuery = (await dispatcher.dispatchBeforeQuery(
			query as QueryObject,
			context,
			hookCtx,
		)) as TQuery;

		const result = await handler(modifiedQuery);

		return dispatcher.dispatchAfterQuery(
			result as ForjaEntry,
			context,
			hookCtx,
		) as Promise<TResult>;
	}

	/**
	 * Begin transaction and return runner, commit, rollback helpers.
	 */
	private async beginTransaction(adapter: DatabaseAdapter): Promise<{
		runner: QueryRunner;
		commit: () => Promise<void>;
		rollback: () => Promise<void>;
	}> {
		const tx = await adapter.beginTransaction();
		return {
			runner: tx,
			commit: async () => {
				await tx.commit();
			},
			rollback: async () => {
				await tx.rollback();
			},
		};
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
