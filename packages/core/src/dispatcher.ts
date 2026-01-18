/**
 * Plugin Hook Dispatcher
 *
 * Orchestrates the execution of plugin hooks (lifecycle and query hooks).
 * Ensures hooks are called in the correct order and provides error isolation.
 */

import { QueryObject } from "forja-types/core/query-builder";
import { PluginRegistry, QueryAction, QueryContext } from "forja-types/plugin";
import { validateQueryObject } from "./utils/query";
import { SchemaRegistry } from "forja-types/core/schema";
import type { Forja } from "./forja";

/**
 * Create a new query context
 */
function createQueryContext(
  action: QueryAction,
  model: string,
  table: string,
  forja: Forja,
): QueryContext {
  return {
    action,
    model,
    table,
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
  private async buildQueryContext(
    action: QueryAction,
    model: string,
    table: string,
  ): Promise<QueryContext> {
    let context = createQueryContext(action, model, table, this.forja);

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
  async executeQuery<TResult>(
    action: QueryAction,
    model: string,
    table: string,
    query: QueryObject,
    executor: (query: QueryObject) => Promise<TResult>,
  ): Promise<TResult> {
    const context = await this.buildQueryContext(action, model, table);
    const modifiedQuery = await this.dispatchBeforeQuery(query, context);
    const result = await executor(modifiedQuery);
    const finalResult = await this.dispatchAfterQuery(result, context);
    return finalResult;
  }

  /**
   * Dispatch onBeforeQuery hook to all plugins (serial execution)
   * Plugins can modify the query object.
   */
  private async dispatchBeforeQuery(
    query: QueryObject,
    context: QueryContext,
  ): Promise<QueryObject> {
    const entranceValidation = validateQueryObject(query);
    if (!entranceValidation.success) {
      throw new Error(
        `[Dispatcher] Entrance QueryObject is invalid: ${entranceValidation.error.message}`,
      );
    }

    let currentQuery = { ...query };

    for (const plugin of this.registry.getAll()) {
      try {
        if (plugin.onBeforeQuery) {
          const modifiedQuery = await plugin.onBeforeQuery(currentQuery, context);

          const validation = validateQueryObject(modifiedQuery);
          if (validation.success) {
            currentQuery = validation.data;
          } else {
            const errorMsg = `[Dispatcher] Plugin '${plugin.name}' returned an invalid query: ${validation.error.message}`;
            console.error(errorMsg);
            throw new Error(errorMsg);
          }
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
  private async dispatchAfterQuery<TResult>(
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
