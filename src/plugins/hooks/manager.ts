/**
 * Hooks Manager
 *
 * Manages registration and execution of lifecycle hooks.
 * NO `any` types, NO type assertions, NEVER throw exceptions.
 */

import type { Result } from '@utils/types';
import type {
  HookContext,
  HookName,
  LifecycleHooks,
} from './types';
import {
  HookError,
  HookRegistrationError,
  isLifecycleHooks,
  isValidHookName,
} from './types';

/**
 * Hooks manager interface
 */
export interface HooksManagerInterface {
  registerHooks(modelName: string, hooks: LifecycleHooks): Result<void, HookRegistrationError>;
  getHooks(modelName: string): LifecycleHooks | undefined;
  executeHook<TData>(
    modelName: string,
    hookName: HookName,
    data: TData,
    context: HookContext
  ): Promise<Result<unknown, HookError>>;
  hasHook(modelName: string, hookName: HookName): boolean;
  clear(): void;
}

/**
 * Hooks manager implementation
 */
export class HooksManager implements HooksManagerInterface {
  private readonly hooks: Map<string, LifecycleHooks> = new Map();
  private readonly enableLogging: boolean;

  constructor(options?: { enableLogging?: boolean }) {
    this.enableLogging = options?.enableLogging ?? false;
  }

  /**
   * Register lifecycle hooks for a model
   */
  registerHooks(
    modelName: string,
    hooks: LifecycleHooks
  ): Result<void, HookRegistrationError> {
    // Validate model name
    if (typeof modelName !== 'string' || modelName.trim().length === 0) {
      return {
        success: false,
        error: new HookRegistrationError('Model name must be a non-empty string', {
          modelName,
        }),
      };
    }

    // Validate hooks
    if (!isLifecycleHooks(hooks)) {
      return {
        success: false,
        error: new HookRegistrationError('Invalid hooks object', {
          modelName,
          hooks,
        }),
      };
    }

    // Check if hooks already exist
    if (this.hooks.has(modelName)) {
      return {
        success: false,
        error: new HookRegistrationError(
          `Hooks already registered for model: ${modelName}`,
          { modelName }
        ),
      };
    }

    // Register hooks
    this.hooks.set(modelName, hooks);

    if (this.enableLogging) {
      console.log(`[Hooks] Registered hooks for model: ${modelName}`);
    }

    return { success: true, data: undefined };
  }

  /**
   * Get hooks for a model
   */
  getHooks(modelName: string): LifecycleHooks | undefined {
    return this.hooks.get(modelName);
  }

  /**
   * Execute a specific hook
   *
   * Returns the hook result if hook exists, or the original data if no hook is registered.
   * This design avoids type assertions by using unknown and letting the caller handle types.
   */
  async executeHook<TData>(
    modelName: string,
    hookName: HookName,
    data: TData,
    context: HookContext
  ): Promise<Result<unknown, HookError>> {
    // Validate hook name
    if (!isValidHookName(hookName)) {
      return {
        success: false,
        error: new HookError('Invalid hook name', {
          hookName,
          modelName,
          details: { validHooks: this.getValidHookNames() },
        }),
      };
    }

    // Get model hooks
    const modelHooks = this.hooks.get(modelName);
    if (!modelHooks) {
      // No hooks registered, return data unchanged
      return { success: true, data };
    }

    // Get specific hook - TypeScript infers the union of all possible hook handler types
    const hook = modelHooks[hookName];
    if (!hook) {
      // Hook not registered, return data unchanged
      return { success: true, data };
    }

    // Type guard to check if hook is a function
    if (typeof hook !== 'function') {
      return {
        success: false,
        error: new HookError('Hook is not a function', {
          hookName,
          modelName,
        }),
      };
    }

    // Execute hook
    try {
      if (this.enableLogging) {
        console.log(`[Hooks] Executing ${hookName} for ${modelName}`);
      }

      // Execute hook using helper to work around TypeScript union type limitations
      const result = await this.callHook(hook, data, context);

      if (this.enableLogging) {
        console.log(`[Hooks] Completed ${hookName} for ${modelName}`);
      }

      return { success: true, data: result };
    } catch (error) {
      // Catch any unexpected errors and wrap in HookError
      return {
        success: false,
        error: new HookError(`Hook execution failed: ${hookName}`, {
          hookName,
          modelName,
          details: error,
        }),
      };
    }
  }

  /**
   * Check if a hook exists
   */
  hasHook(modelName: string, hookName: HookName): boolean {
    const modelHooks = this.hooks.get(modelName);
    if (!modelHooks) {
      return false;
    }
    return hookName in modelHooks && typeof modelHooks[hookName] === 'function';
  }

  /**
   * Clear all hooks
   */
  clear(): void {
    this.hooks.clear();
  }

  /**
   * Call hook safely - works around TypeScript union type limitations
   * We know hook is a function from the type guard, but TypeScript can't prove
   * that a union of function types is callable with a given set of parameters
   */
  private async callHook(
    hook: Function,
    data: unknown,
    context: HookContext
  ): Promise<unknown> {
    const result = hook(data, context);

    // Handle both sync and async results
    if (result instanceof Promise) {
      return await result;
    }

    return result;
  }

  /**
   * Get list of valid hook names
   */
  private getValidHookNames(): readonly string[] {
    return [
      'beforeCreate',
      'afterCreate',
      'beforeUpdate',
      'afterUpdate',
      'beforeDelete',
      'afterDelete',
      'beforeFind',
      'afterFind',
    ];
  }

  /**
   * Get all registered model names
   */
  getRegisteredModels(): readonly string[] {
    return Array.from(this.hooks.keys());
  }

  /**
   * Unregister hooks for a model
   */
  unregisterHooks(modelName: string): Result<void, HookRegistrationError> {
    if (!this.hooks.has(modelName)) {
      return {
        success: false,
        error: new HookRegistrationError(
          `No hooks registered for model: ${modelName}`,
          { modelName }
        ),
      };
    }

    this.hooks.delete(modelName);

    if (this.enableLogging) {
      console.log(`[Hooks] Unregistered hooks for model: ${modelName}`);
    }

    return { success: true, data: undefined };
  }
}

/**
 * Create a new hooks manager
 */
export function createHooksManager(options?: {
  enableLogging?: boolean;
}): HooksManager {
  return new HooksManager(options);
}
