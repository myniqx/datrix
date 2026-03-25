/**
 * Plugin Hook Dispatcher
 *
 * Orchestrates the execution of plugin hooks (lifecycle and query hooks).
 * Ensures hooks are called in the correct order and provides error isolation.
 */

import { QueryObject } from "forja-types/core/query-builder";
import { PluginRegistry, QueryAction, QueryContext } from "forja-types/plugin";
import {
	ForjaEntry,
	ForjaRecord,
	SchemaDefinition,
	HookContext,
	LifecycleHooks,
} from "forja-types/core/schema";
import { QuerySelectObject } from "forja-types/core/query-builder";
import type { Forja } from "./forja";
import { validateQueryObject } from "forja-types/utils/query";
import { SchemaRegistry } from "./schema";

/**
 * Create a new query context
 */
function createQueryContext(
	action: QueryAction,
	schema: SchemaDefinition,
	forja: Forja,
): QueryContext {
	return {
		action,
		schema,
		forja,
		metadata: {},
	};
}

/**
 * Dispatcher for plugin hooks
 */
export class Dispatcher {
	constructor(
		private readonly registry: PluginRegistry,
		private readonly forja: Forja,
	) {}

	/**
	 * Create and populate query context
	 *
	 * This allows plugins to enrich the context before query execution.
	 */
	async buildQueryContext(
		action: QueryAction,
		schema: SchemaDefinition,
	): Promise<QueryContext> {
		let context = createQueryContext(action, schema, this.forja);

		for (const plugin of this.registry.getAll()) {
			try {
				if (plugin.onCreateQueryContext) {
					const result = await plugin.onCreateQueryContext(context);
					if (result) {
						context = result;
					}
				}
			} catch (error) {
				console.error(
					`[Dispatcher] Error in plugin '${plugin.name}' onCreateQueryContext:`,
					error,
				);
			}
		}

		return context;
	}

	/**
	 * Dispatch onSchemaLoad hook to all plugins
	 */
	async dispatchSchemaLoad(schemas: SchemaRegistry): Promise<void> {
		for (const plugin of this.registry.getAll()) {
			try {
				if (plugin.onSchemaLoad) {
					await plugin.onSchemaLoad(schemas);
				}
			} catch (error) {
				console.error(
					`[Dispatcher] Error in plugin '${plugin.name}' onSchemaLoad:`,
					error,
				);
			}
		}
	}

	/**
	 * Execute full query lifecycle:
	 * 1. Create context + shared hookCtx (metadata shared between before/after)
	 * 2. onBeforeQuery plugin hooks + schema before hook
	 * 3. Execute query
	 * 4. onAfterQuery plugin hooks + schema after hook
	 */
	async executeQuery<
		TResult extends ForjaEntry,
		R extends ForjaEntry = ForjaEntry,
	>(
		action: QueryAction,
		schema: SchemaDefinition,
		query: QueryObject<TResult>,
		executor: (query: QueryObject<TResult>) => Promise<R>,
	): Promise<R> {
		const context = await this.buildQueryContext(action, schema);
		const hookCtx: HookContext = { schema, metadata: context.metadata };
		const modifiedQuery = await this.dispatchBeforeQuery(
			query,
			context,
			hookCtx,
		);
		const result = await executor(modifiedQuery);
		const finalResult = await this.dispatchAfterQuery<R>(
			result,
			context,
			hookCtx,
		);
		return finalResult;
	}

	/**
	 * Dispatch onBeforeQuery hook to all plugins (serial execution),
	 * then call the schema lifecycle hook if defined.
	 * Both plugins and schema hooks can modify and return the query.
	 * hookCtx is shared with dispatchAfterQuery so metadata persists.
	 */
	async dispatchBeforeQuery<TResult extends ForjaEntry = ForjaRecord>(
		query: QueryObject<TResult>,
		context: QueryContext,
		hookCtx: HookContext,
	): Promise<QueryObject<TResult>> {
		validateQueryObject(query);

		let currentQuery = { ...query } as QueryObject<TResult>;

		for (const plugin of this.registry.getAll()) {
			try {
				if (plugin.onBeforeQuery) {
					currentQuery = await plugin.onBeforeQuery(currentQuery, context);
				}
			} catch (error) {
				console.error(
					`[Dispatcher] Error in plugin '${plugin.name}' onBeforeQuery:`,
					error,
				);
				throw error;
			}
		}

		currentQuery = await this.dispatchSchemaBeforeHook(
			currentQuery,
			context.action,
			hookCtx,
		);

		return currentQuery;
	}

	/**
	 * Dispatch onAfterQuery hook to all plugins (serial execution),
	 * then call the schema lifecycle hook if defined.
	 * Both plugins and schema hooks can modify and return the result.
	 * hookCtx is the same instance as in dispatchBeforeQuery so metadata is shared.
	 */
	async dispatchAfterQuery<TResult extends ForjaEntry>(
		result: TResult,
		context: QueryContext,
		hookCtx: HookContext,
	): Promise<TResult> {
		let currentResult = result;

		for (const plugin of this.registry.getAll()) {
			try {
				if (plugin.onAfterQuery) {
					currentResult = await plugin.onAfterQuery(currentResult, context);
				}
			} catch (error) {
				console.error(
					`[Dispatcher] Error in plugin '${plugin.name}' onAfterQuery:`,
					error,
				);
			}
		}

		currentResult = await this.dispatchSchemaAfterHook(
			currentResult,
			context.action,
			hookCtx,
		);

		return currentResult;
	}

	private async dispatchSchemaBeforeHook<TResult extends ForjaEntry>(
		query: QueryObject<TResult>,
		action: QueryAction,
		hookCtx: HookContext,
	): Promise<QueryObject<TResult>> {
		const hooks = hookCtx.schema.hooks as LifecycleHooks<TResult> | undefined;
		if (!hooks) return query;

		if (
			(action === "create" || action === "createMany") &&
			hooks.beforeCreate
		) {
			if (query.type === "insert") {
				const insertQuery = query as QueryObject<TResult> & {
					data: Partial<TResult>[];
				};
				const modifiedItems = await Promise.all(
					insertQuery.data.map((item) => hooks.beforeCreate!(item, hookCtx)),
				);
				return { ...query, data: modifiedItems } as QueryObject<TResult>;
			}
		}

		if (
			(action === "update" || action === "updateMany") &&
			hooks.beforeUpdate
		) {
			if (query.type === "update") {
				const updateQuery = query as QueryObject<TResult> & {
					data: Partial<TResult>;
				};
				const modifiedData = await hooks.beforeUpdate(
					updateQuery.data,
					hookCtx,
				);
				return { ...query, data: modifiedData } as QueryObject<TResult>;
			}
		}

		if (
			(action === "delete" || action === "deleteMany") &&
			hooks.beforeDelete
		) {
			if (query.type === "delete") {
				const deleteQuery = query as QueryObject<TResult> & {
					where?: { id?: number };
				};
				if (deleteQuery.where?.id !== undefined) {
					const modifiedId = await hooks.beforeDelete(
						deleteQuery.where.id,
						hookCtx,
					);
					return {
						...query,
						where: { ...deleteQuery.where, id: modifiedId },
					} as QueryObject<TResult>;
				}
			}
		}

		if (
			(action === "findOne" || action === "findMany" || action === "count") &&
			hooks.beforeFind
		) {
			if (query.type === "select") {
				const modifiedQuery = await hooks.beforeFind(
					query as QuerySelectObject<TResult>,
					hookCtx,
				);
				return modifiedQuery as QueryObject<TResult>;
			}
		}

		return query;
	}

	private async dispatchSchemaAfterHook<TResult extends ForjaEntry>(
		result: TResult,
		action: QueryAction,
		hookCtx: HookContext,
	): Promise<TResult> {
		const hooks = hookCtx.schema.hooks as LifecycleHooks<TResult> | undefined;
		if (!hooks) return result;

		const isArray = Array.isArray(result);
		const rows = isArray ? (result as TResult[]) : [result];

		if ((action === "create" || action === "createMany") && hooks.afterCreate) {
			const modified = await Promise.all(
				rows.map((row) => hooks.afterCreate!(row, hookCtx)),
			);
			return (isArray ? modified : modified[0]) as TResult;
		}

		if ((action === "update" || action === "updateMany") && hooks.afterUpdate) {
			const modified = await Promise.all(
				rows.map((row) => hooks.afterUpdate!(row, hookCtx)),
			);
			return (isArray ? modified : modified[0]) as TResult;
		}

		if ((action === "delete" || action === "deleteMany") && hooks.afterDelete) {
			await Promise.all(
				rows.map((row) => hooks.afterDelete!((row as ForjaEntry).id, hookCtx)),
			);
			return result;
		}

		if ((action === "findOne" || action === "findMany") && hooks.afterFind) {
			const modified = await hooks.afterFind(rows, hookCtx);
			return (isArray ? modified : modified[0]) as TResult;
		}

		return result;
	}
}

/**
 * Create a new dispatcher
 */
export function createDispatcher(
	registry: PluginRegistry,
	forja: Forja,
): Dispatcher {
	return new Dispatcher(registry, forja);
}
