/**
 * Forja API Module
 *
 * Provides REST API functionality with integrated authentication system.
 */

// Main exports (user-facing)
export { ForjaApi } from './api';
export { handleRequest } from './helper';

// Type exports
export type { IForjaApi } from 'forja-types/api';
export type { ApiConfig, ApiAuthConfig } from 'forja-types/config';

// Middleware module (auth, context, permission)
export * from './middleware';

// Parser module (query string parsing)
export * from './parser';

// Serializer module (response serialization)
export * from './serializer';

// Handler module (CRUD and auth handlers)
export * from './handler';

// Auth module (authentication and authorization)
export * from './auth';

// Lifecycle module (API initialization and schema management)
export * from './lifecycle';
