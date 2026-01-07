/**
 * API Handler Module
 *
 * Exports request handlers and handler factory functions.
 */


// Export request context
export { buildContext } from './context';

// Export CRUD handlers
export { findMany, findOne, create, update, deleteRecord, count } from './crud';

// Export handler factory
export { createCrudHandler, createHandlers } from './factory';
