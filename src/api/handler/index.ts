/**
 * API Handler Module
 *
 * Exports request handlers and handler factory functions.
 */

// Export handler types
export type {
  RequestContext,
  ResponseData,
  ErrorResponse,
  HandlerConfig,
  HandlerFunction,
  HandlerResponse,
  CrudHandler,
  Middleware,
  PermissionCheck,
} from './types';

// Export request context
export { buildContext } from './context';

// Export CRUD handlers
export { findMany, findOne, create, update, deleteRecord, count } from './crud';

// Export handler factory
export { createCrudHandler, createHandlers } from './factory';
