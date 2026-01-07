/**
 * Plugin Hook Dispatcher
 *
 * Orchestrates the execution of plugin hooks (lifecycle and query hooks).
 * Ensures hooks are called in the correct order and provides error isolation.
 */

import type { ForjaPlugin, PluginRegistry } from '@plugins/base/types';
import type { QueryObject } from '@adapters/base/types';
import type { SchemaRegistry } from '@core/schema/types';

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
    let currentQuery = { ...query };

    for (const plugin of this.registry.getAll()) {
      try {
        if (plugin.onBeforeQuery) {
          currentQuery = await plugin.onBeforeQuery(currentQuery);
        }
      } catch (error) {
        console.error(`[Dispatcher] Error in plugin '${plugin.name}' onBeforeQuery:`, error);
        // We continue with the current state of the query
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
