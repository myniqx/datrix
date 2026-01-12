/**
 * Middleware Module
 *
 * Exports all middleware functionality
 */

export { buildRequestContext } from './context';
export { authenticate } from './auth';
export { checkPermission, methodToAction } from './permission';

export type {
  RequestContext,
  AuthenticatedUser,
  HttpMethod,
  PermissionAction,
  ContextBuilderOptions,
} from './types';
