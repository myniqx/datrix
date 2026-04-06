/**
 * Datrix API Module - Plugin Edition
 *
 * Provides REST API functionality as a Datrix plugin with integrated authentication system.
 *
 * @example
 * ```ts
 * import { createApiPlugin } from '@datrix/api';
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
export { ApiPlugin } from "./api";

// Auth exports
export { MemorySessionStore } from "./auth/session";

export { handleRequest } from "./helper";

// Middleware module (auth, context, permission)
export * from "./middleware";

// Parser module (query string parsing)
export * from "./parser";

// Serializer module (response serialization)
export * from "./serializer";

// Handler module (CRUD and auth handlers)
export * from "./handler";
