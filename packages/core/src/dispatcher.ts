/**
 * Plugin Hook Dispatcher
 *
 * Orchestrates the execution of plugin hooks (lifecycle and query hooks).
 * Ensures hooks are called in the correct order and provides error isolation.
 */

import { QueryObject } from "forja-types/core/query-builder";
import { PluginRegistry } from "forja-types/plugin";
import { validateQueryObject } from "./utils/query";
import { SchemaRegistry } from "forja-types/core/schema";

/*
import type { PluginRegistry } from '@plugins/base/types';
import type { QueryObject } from '@adapters/base/types';
import type { SchemaRegistry } from '@core/schema/types';
import { validateQueryObject } from '@utils/query';
*/
/**
 * Dispatcher for plugin hooks
 */
export class Dispatcher {
  constructor(private readonly registry: PluginRegistry) { }

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
        // Log error but continue with other plugins to ensure system stability
        console.error(`[Dispatcher] Error in plugin '${plugin.name}' onSchemaLoad:`, error);
      }
    }
  }

  /**
   * Dispatch onBeforeQuery hook to all plugins (serial execution)
   * Plugins can modify the query object.
   */
  async dispatchBeforeQuery(query: QueryObject): Promise<QueryObject> {
    // 1. Validate entrance query (catch errors even without plugins)
    const entranceValidation = validateQueryObject(query);
    if (!entranceValidation.success) {
      throw new Error(`[Dispatcher] Entrance QueryObject is invalid: ${entranceValidation.error.message}`);
    }

    let currentQuery = { ...query };

    for (const plugin of this.registry.getAll()) {
      try {
        if (plugin.onBeforeQuery) {
          const modifiedQuery = await plugin.onBeforeQuery(currentQuery);

          // 2. Validate modified query (strict check for each plugin)
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
        console.error(`[Dispatcher] Error in plugin '${plugin.name}' onBeforeQuery:`, error);
        throw error; // Rethrow to stop the query pipeline on invalid state
      }
    }

    return currentQuery;
  }

  /**
   * Dispatch onAfterQuery hook to all plugins (serial execution)
   * Plugins can modify the result.
   */
  async dispatchAfterQuery<TResult>(result: TResult): Promise<TResult> {
    let currentResult = result;

    for (const plugin of this.registry.getAll()) {
      try {
        if (plugin.onAfterQuery) {
          currentResult = await plugin.onAfterQuery(currentResult);
        }
      } catch (error) {
        console.error(`[Dispatcher] Error in plugin '${plugin.name}' onAfterQuery:`, error);
      }
    }

    return currentResult;
  }
}

/**
 * Create a new dispatcher
 */
export function createDispatcher(registry: PluginRegistry): Dispatcher {
  return new Dispatcher(registry);
}
