/**
 * Soft Delete Plugin Types
 *
 * This file defines types for the soft delete plugin.
 * NO `any` types, NO type assertions, ONLY Error classes.
 */

import type { QueryObject } from '@adapters/base/types';
import { PluginError } from '@plugins/base/types';

/**
 * Soft delete options
 */
export interface SoftDeleteOptions {
  readonly field?: string; // Field name (default: 'deletedAt')
  readonly type?: 'timestamp' | 'boolean'; // Field type (default: 'timestamp')
  readonly excludedModels?: readonly string[]; // Models to exclude from soft delete
}

/**
 * Soft delete mode
 */
export type SoftDeleteMode = 'default' | 'include-deleted' | 'only-deleted';

/**
 * Soft delete query options
 */
export interface SoftDeleteQueryOptions {
  readonly mode?: SoftDeleteMode;
  readonly bypassSoftDelete?: boolean;
}

/**
 * Soft delete error
 */
export class SoftDeleteError extends PluginError {
  constructor(message: string, details?: unknown) {
    super(message, {
      code: 'SOFT_DELETE_ERROR',
      pluginName: 'soft-delete',
      details,
    });
    this.name = 'SoftDeleteError';
  }
}

/**
 * Soft delete interceptor interface
 */
export interface SoftDeleteInterceptorInterface {
  interceptQuery(query: QueryObject, options?: SoftDeleteQueryOptions): QueryObject;
  hardDelete(query: QueryObject): QueryObject;
  findDeleted(query: QueryObject): QueryObject;
  findWithDeleted(query: QueryObject): QueryObject;
  restore(tableName: string, id: string): QueryObject;
}

/**
 * Type guard for SoftDeleteOptions
 */
export function isSoftDeleteOptions(
  value: unknown
): value is SoftDeleteOptions {
  if (typeof value !== 'object' || value === null) {
    return true; // Empty options are valid
  }

  const obj = value as Record<string, unknown>;

  if ('field' in obj && typeof obj['field'] !== 'string') {
    return false;
  }

  if ('type' in obj && obj['type'] !== 'timestamp' && obj['type'] !== 'boolean') {
    return false;
  }

  if ('excludedModels' in obj) {
    if (!Array.isArray(obj['excludedModels'])) {
      return false;
    }
    if (!obj['excludedModels'].every((m) => typeof m === 'string')) {
      return false;
    }
  }

  return true;
}

/**
 * Type guard for SoftDeleteQueryOptions
 */
export function isSoftDeleteQueryOptions(
  value: unknown
): value is SoftDeleteQueryOptions {
  if (typeof value !== 'object' || value === null) {
    return true; // Empty options are valid
  }

  const obj = value as Record<string, unknown>;

  if ('mode' in obj) {
    const validModes: readonly string[] = [
      'default',
      'include-deleted',
      'only-deleted',
    ];
    if (typeof obj['mode'] !== 'string' || !validModes.includes(obj['mode'])) {
      return false;
    }
  }

  if ('bypassSoftDelete' in obj && typeof obj['bypassSoftDelete'] !== 'boolean') {
    return false;
  }

  return true;
}

/**
 * Get deleted value based on field type
 */
export function getDeletedValue(type: 'timestamp' | 'boolean'): Date | boolean {
  return type === 'timestamp' ? new Date() : true;
}

/**
 * Get not deleted value based on field type
 */
export function getNotDeletedValue(
  type: 'timestamp' | 'boolean'
): null | boolean {
  return type === 'timestamp' ? null : false;
}
