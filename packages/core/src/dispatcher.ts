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
} from "forja-types/core/schema";
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
	) { }

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
	 * 1. Create context
	 * 2. onBeforeQuery hooks
	 * 3. Execute query
	 * 4. onAfterQuery hooks
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
		const modifiedQuery = await this.dispatchBeforeQuery(query, context);
		const result = await executor(modifiedQuery);
		const finalResult = await this.dispatchAfterQuery<R>(result, context);
		return finalResult;
	}

	/**
	 * Dispatch onBeforeQuery hook to all plugins (serial execution)
	 * Plugins can modify the query object.
	 */
	async dispatchBeforeQuery<TResult extends ForjaEntry = ForjaRecord>(
		query: QueryObject<TResult>,
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
				console.error(
					`[Dispatcher] Error in plugin '${plugin.name}' onBeforeQuery:`,
					error,
				);
				throw error;
			}
		}

		return currentQuery;
	}

	/**
	 * Dispatch onAfterQuery hook to all plugins (serial execution)
	 * Plugins can modify the result.
	 */
	async dispatchAfterQuery<TResult extends ForjaEntry>(
		result: TResult,
		context: QueryContext,
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

		return currentResult;
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
