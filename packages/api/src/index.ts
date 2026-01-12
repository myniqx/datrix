/**
 * Forja API Module - Plugin Edition
 *
 * Provides REST API functionality as a Forja plugin with integrated authentication system.
 *
 * @example
 * ```ts
 * import { createApiPlugin } from 'forja-api';
 *
 * const apiPlugin = createApiPlugin({
 *   enabled: true,
 *   prefix: '/api',
 *   auth: {
 *     enabled: true,
 *     jwt: { secret: process.env.JWT_SECRET }
 *   }
 * });
 *
 * export default defineConfig(() => ({
 *   adapter: new PostgresAdapter({ ... }),
 *   schemas: [userSchema],
 *   plugins: [apiPlugin]
 * }));
 * ```
 */

// Main exports - Plugin API
export { ApiPlugin, createApiPlugin, createApi } from './api';
export type { ApiPluginOptions } from './api';

// Deprecated exports (backward compatibility)
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

// Lifecycle module (deprecated - now handled by plugin)
export * from './lifecycle';
