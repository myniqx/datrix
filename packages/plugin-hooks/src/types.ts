/**
 * Hooks Plugin Types
 *
 * This file defines types for the lifecycle hooks plugin.
 * NO `any` types, NO type assertions, ONLY Error classes.
 */

import { QueryObject } from "forja-types/core/query-builder";
import { PluginError } from "forja-types/plugin";
import { Result } from "forja-types/utils";


/**
 * Hook context
 */
export interface HookContext {
  readonly modelName: string;
  readonly operation: 'create' | 'update' | 'delete' | 'find';
  readonly user?: {
    readonly id: string;
    readonly role: string;
  };
  readonly metadata?: Record<string, unknown>;
}

/**
 * Lifecycle hook handler
 */
export type HookHandler<TData = unknown, TResult = TData> = (
  data: TData,
  context: HookContext
) => Promise<TResult> | TResult;

/**
 * Lifecycle hooks map
 */
export interface LifecycleHooks<T = Record<string, unknown>> {
  readonly beforeCreate?: HookHandler<Partial<T>, Partial<T>>;
  readonly afterCreate?: HookHandler<T, T>;
  readonly beforeUpdate?: HookHandler<Partial<T>, Partial<T>>;
  readonly afterUpdate?: HookHandler<T, T>;
  readonly beforeDelete?: HookHandler<string, void>;
  readonly afterDelete?: HookHandler<string, void>;
  readonly beforeFind?: HookHandler<QueryObject, QueryObject>;
  readonly afterFind?: HookHandler<T | readonly T[], T | readonly T[]>;
}

/**
 * Hook name type
 */
export type HookName = keyof LifecycleHooks;

/**
 * Hook registration
 */
export interface HookRegistration {
  readonly modelName: string;
  readonly hooks: LifecycleHooks;
}

/**
 * Hook execution error
 */
export class HookError extends PluginError {
  readonly hookName: string;
  readonly modelName: string;

  constructor(
    message: string,
    options: {
      hookName: string;
      modelName: string;
      details?: unknown;
    }
  ) {
    super(message, {
      code: 'HOOK_ERROR',
      pluginName: 'hooks',
      details: options.details,
    });
    this.name = 'HookError';
    this.hookName = options.hookName;
    this.modelName = options.modelName;
  }
}

/**
 * Hook registration error
 */
export class HookRegistrationError extends PluginError {
  constructor(message: string, details?: unknown) {
    super(message, {
      code: 'HOOK_REGISTRATION_ERROR',
      pluginName: 'hooks',
      details,
    });
    this.name = 'HookRegistrationError';
  }
}

/**
 * Hooks plugin options
 */
export interface HooksPluginOptions {
  readonly enableLogging?: boolean;
  readonly hooks?: readonly HookRegistration[];
}

/**
 * Type guard for LifecycleHooks
 */
export function isLifecycleHooks(value: unknown): value is LifecycleHooks {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  const validKeys = [
    'beforeCreate',
    'afterCreate',
    'beforeUpdate',
    'afterUpdate',
    'beforeDelete',
    'afterDelete',
    'beforeFind',
    'afterFind',
  ];

  // Check that all keys are valid hook names
  for (const key of Object.keys(obj)) {
    if (!validKeys.includes(key)) {
      return false;
    }
    if (typeof obj[key] !== 'function') {
      return false;
    }
  }

  return true;
}

/**
 * Type guard for HookContext
 */
export function isHookContext(value: unknown): value is HookContext {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  const operation = obj['operation'];

  return (
    typeof obj['modelName'] === 'string' &&
    typeof operation === 'string' &&
    ['create', 'update', 'delete', 'find'].includes(operation)
  );
}

/**
 * Validate hook name
 */
export function isValidHookName(hookName: string): hookName is HookName {
  const validHooks: readonly string[] = [
    'beforeCreate',
    'afterCreate',
    'beforeUpdate',
    'afterUpdate',
    'beforeDelete',
    'afterDelete',
    'beforeFind',
    'afterFind',
  ];

  return validHooks.includes(hookName);
}

/**
 * Create hook execution result
 */
export function createHookResult<T>(data: T): Result<T, HookError> {
  return { success: true, data };
}

/**
 * Create hook error result
 */
export function createHookErrorResult<T>(
  error: HookError
): Result<T, HookError> {
  return { success: false, error };
}
