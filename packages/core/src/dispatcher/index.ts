/**
 * Plugin Hook Dispatcher
 *
 * Orchestrates the execution of plugin hooks (lifecycle and query hooks).
 * Ensures hooks are called in the correct order and provides error isolation.
 */

import {
	QueryObject,
	QuerySelectObject,
	QueryInsertObject,
	QueryUpdateObject,
	QueryDeleteObject,
} from "@forja/core/types/core/query-builder";
import { PluginRegistry } from "@forja/core/types/core/plugin";
import {
	QueryAction,
	QueryContext,
} from "@forja/core/types/core/query-context";
import {
	ForjaEntry,
	ForjaRecord,
	SchemaDefinition,
	LifecycleHooks,
} from "@forja/core/types/core/schema";
import type { Forja } from "../forja";
import { validateQueryObject } from "@forja/core/types/utils/query";
import { SchemaRegistry } from "../schema";
import {
	throwHookInvalidReturn,
	throwHookPluginError,
	warnAfterHookError,
} from "./hook-errors";

/**
 * Create a new query context
 */
function createQueryContext(action: QueryAction, forja: Forja): QueryContext {
	return {
		action,
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
	async buildQueryContext(action: QueryAction): Promise<QueryContext> {
		let context = createQueryContext(action, this.forja);

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
		const context = await this.buildQueryContext(action);
		const modifiedQuery = await this.dispatchBeforeQuery(
			query,
			schema,
			context,
		);
		const result = await executor(modifiedQuery);
		return this.dispatchAfterQuery<R>(result, schema, context);
	}

	/**
	 * Dispatch onBeforeQuery hook to all plugins (serial execution),
	 * then call the schema lifecycle hook if defined.
	 * Both plugins and schema hooks can modify and return the query.
	 * hookCtx is shared with dispatchAfterQuery so metadata persists.
	 */
	async dispatchBeforeQuery<TResult extends ForjaEntry = ForjaRecord>(
		query: QueryObject<TResult>,
		schema: SchemaDefinition,
		context: QueryContext,
	): Promise<QueryObject<TResult>> {
		validateQueryObject(query);

		let currentQuery = { ...query } as QueryObject<TResult>;

		for (const plugin of this.registry.getAll()) {
			try {
				if (plugin.onBeforeQuery) {
					currentQuery = await plugin.onBeforeQuery(currentQuery, context);
				}
			} catch (error) {
				throwHookPluginError(plugin.name, "onBeforeQuery", error);
			}
		}

		currentQuery = await this.dispatchSchemaBeforeHook(
			currentQuery,
			schema,
			context,
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
		schema: SchemaDefinition,
		context: QueryContext,
	): Promise<TResult> {
		let currentResult = result;

		for (const plugin of this.registry.getAll()) {
			try {
				if (plugin.onAfterQuery) {
					currentResult = await plugin.onAfterQuery(currentResult, context);
				}
			} catch (error) {
				warnAfterHookError("afterFind", error);
			}
		}

		currentResult = await this.dispatchSchemaAfterHook(
			currentResult,
			schema,
			context,
		);

		return currentResult;
	}

	private async dispatchSchemaBeforeHook<TResult extends ForjaEntry>(
		query: QueryObject<TResult>,
		schema: SchemaDefinition,
		context: QueryContext,
	): Promise<QueryObject<TResult>> {
		const hooks = schema.hooks as LifecycleHooks<TResult> | undefined;
		if (!hooks) return query;

		const { action } = context;

		if (
			(action === "create" || action === "createMany") &&
			hooks.beforeCreate &&
			query.type === "insert"
		) {
			const modified = await hooks.beforeCreate(
				query as QueryInsertObject<TResult>,
				context,
			);
			if (modified == null) throwHookInvalidReturn("beforeCreate");
			return modified as QueryObject<TResult>;
		}

		if (
			(action === "update" || action === "updateMany") &&
			hooks.beforeUpdate &&
			query.type === "update"
		) {
			const modified = await hooks.beforeUpdate(
				query as QueryUpdateObject<TResult>,
				context,
			);
			if (modified == null) throwHookInvalidReturn("beforeUpdate");
			return modified as QueryObject<TResult>;
		}

		if (
			(action === "delete" || action === "deleteMany") &&
			hooks.beforeDelete &&
			query.type === "delete"
		) {
			const modified = await hooks.beforeDelete(
				query as QueryDeleteObject<TResult>,
				context,
			);
			if (modified == null) throwHookInvalidReturn("beforeDelete");
			return modified as QueryObject<TResult>;
		}

		if (
			(action === "findOne" || action === "findMany" || action === "count") &&
			hooks.beforeFind &&
			query.type === "select"
		) {
			const modified = await hooks.beforeFind(
				query as QuerySelectObject<TResult>,
				context,
			);
			if (modified == null) throwHookInvalidReturn("beforeFind");
			return modified as QueryObject<TResult>;
		}

		return query;
	}

	private async dispatchSchemaAfterHook<TResult extends ForjaEntry>(
		result: TResult,
		schema: SchemaDefinition,
		context: QueryContext,
	): Promise<TResult> {
		const hooks = schema.hooks as LifecycleHooks<TResult> | undefined;
		if (!hooks) return result;

		const { action } = context;
		const rows = result;

		if ((action === "create" || action === "createMany") && hooks.afterCreate) {
			try {
				return await hooks.afterCreate(rows, context);
			} catch (error) {
				warnAfterHookError("afterCreate", error);
			}
		}

		if ((action === "update" || action === "updateMany") && hooks.afterUpdate) {
			try {
				return await hooks.afterUpdate(rows, context);
			} catch (error) {
				warnAfterHookError("afterUpdate", error);
			}
		}

		if ((action === "delete" || action === "deleteMany") && hooks.afterDelete) {
			try {
				await hooks.afterDelete(rows, context);
			} catch (error) {
				warnAfterHookError("afterDelete", error);
			}
			return result;
		}

		if ((action === "findOne" || action === "findMany") && hooks.afterFind) {
			try {
				return await hooks.afterFind(rows, context);
			} catch (error) {
				warnAfterHookError("afterFind", error);
			}
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
