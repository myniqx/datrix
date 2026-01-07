/**
 * Hooks Plugin
 *
 * Provides lifecycle hooks for data operations.
 * NO `any` types, NO type assertions, NEVER throw exceptions.
 */

import type {
  HooksPluginOptions,
  LifecycleHooks,
  HookContext,
  HookName,
} from './types';
import { HooksManager, createHooksManager } from './manager';
import { HookRegistrationError } from './types';
import { ForjaPlugin, PluginContext, PluginError } from 'forja-types/plugin';
import { Result } from 'forja-types/utils';
import { QueryObject } from 'forja-types/core/query-builder';

/**
 * Hooks plugin implementation
 */
export class HooksPlugin implements ForjaPlugin<HooksPluginOptions> {
  readonly name = 'hooks' as const;
  readonly version = '0.1.0';
  readonly options: HooksPluginOptions;

  private manager: HooksManager | null = null;

  constructor(options: HooksPluginOptions = {}) {
    this.options = options;
  }

  /**
   * Initialize the plugin
   */
  async init(_context: PluginContext): Promise<Result<void, PluginError>> {
    // Create hooks manager
    const enableLogging = this.options.enableLogging ?? false;
    this.manager = createHooksManager({ enableLogging });

    // Register initial hooks if provided
    if (this.options.hooks && this.options.hooks.length > 0) {
      for (const registration of this.options.hooks) {
        const result = this.manager.registerHooks(
          registration.modelName,
          registration.hooks
        );

        if (!result.success) {
          return {
            success: false,
            error: result.error,
          };
        }
      }
    }

    return { success: true, data: undefined };
  }

  /**
   * Destroy the plugin
   */
  async destroy(): Promise<Result<void, PluginError>> {
    if (this.manager !== null) {
      this.manager.clear();
      this.manager = null;
    }

    return { success: true, data: undefined };
  }

  /**
   * Register hooks for a model
   */
  registerHooks(
    modelName: string,
    hooks: LifecycleHooks
  ): Result<void, HookRegistrationError> {
    if (this.manager === null) {
      return {
        success: false,
        error: new HookRegistrationError('Plugin not initialized'),
      };
    }

    return this.manager.registerHooks(modelName, hooks);
  }

  /**
   * Unregister hooks for a model
   */
  unregisterHooks(modelName: string): Result<void, HookRegistrationError> {
    if (this.manager === null) {
      return {
        success: false,
        error: new HookRegistrationError('Plugin not initialized'),
      };
    }

    return this.manager.unregisterHooks(modelName);
  }

  /**
   * Execute a hook
   */
  async executeHook<TData>(
    modelName: string,
    hookName: HookName,
    data: TData,
    context: HookContext
  ): Promise<Result<unknown, PluginError>> {
    if (this.manager === null) {
      return {
        success: false,
        error: new HookRegistrationError('Plugin not initialized'),
      };
    }

    return await this.manager.executeHook<TData>(
      modelName,
      hookName,
      data,
      context
    );
  }

  /**
   * Check if a hook exists
   */
  hasHook(modelName: string, hookName: HookName): boolean {
    if (this.manager === null) {
      return false;
    }

    return this.manager.hasHook(modelName, hookName);
  }

  /**
   * Get hooks for a model
   */
  getHooks(modelName: string): LifecycleHooks | undefined {
    if (this.manager === null) {
      return undefined;
    }

    return this.manager.getHooks(modelName);
  }

  /**
   * Get all registered models
   */
  getRegisteredModels(): readonly string[] {
    if (this.manager === null) {
      return [];
    }

    return this.manager.getRegisteredModels();
  }

  /**
   * Hook into query execution (called before query)
   */
  async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
    if (this.manager === null) {
      return query;
    }

    // Execute beforeFind hook if it exists
    if (query.type === 'select') {
      const context: HookContext = {
        modelName: query.table,
        operation: 'find',
      };

      const result = await this.manager.executeHook<QueryObject>(
        query.table,
        'beforeFind',
        query,
        context
      );

      if (result.success && this.isQueryObject(result.data)) {
        return result.data;
      }
    }

    return query;
  }

  /**
   * Type guard for QueryObject
   */
  private isQueryObject(value: unknown): value is QueryObject {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const obj = value as Record<string, unknown>;
    return (
      'type' in obj &&
      'table' in obj &&
      typeof obj['type'] === 'string' &&
      typeof obj['table'] === 'string'
    );
  }

  /**
   * Hook into query results (called after query)
   */
  async onAfterQuery<TResult>(result: TResult): Promise<TResult> {
    // This would be called after query execution
    // Implementation depends on how results are structured
    return result;
  }
}

/**
 * Create a new hooks plugin instance
 */
export function createHooksPlugin(
  options: HooksPluginOptions = {}
): HooksPlugin {
  return new HooksPlugin(options);
}

/**
 * Re-export types
 */
export type {
  HooksPluginOptions,
  LifecycleHooks,
  HookContext,
  HookName,
  HookHandler,
  HookRegistration,
} from './types';

export { HookError, HookRegistrationError } from './types';
export { HooksManager, createHooksManager } from './manager';
