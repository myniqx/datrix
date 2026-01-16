/**
 * Middleware Module
 *
 * Exports all middleware functionality
 */

export { buildRequestContext } from './context';
export { authenticate } from './auth';
export {
  methodToAction,
  evaluatePermissionValue,
  checkSchemaPermission,
  checkFieldsForWrite,
  filterFieldsForRead,
  filterRecordsForRead,
  createPermissionContext,
} from './permission';

export type {
  RequestContext,
  AuthenticatedUser,
  HttpMethod,
  ContextBuilderOptions,
} from './types';

// Re-export permission types
export type { PermissionAction } from 'forja-types/core/permission';
