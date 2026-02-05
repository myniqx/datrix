import type { AuthConfig } from "./auth/types";

/**
 * API Configuration
 *
 * @template TRole - Union type of valid role names
 *
 * @example
 * ```ts
 * const roles = ['admin', 'editor', 'user', 'guest'] as const;
 * type Roles = typeof roles[number];
 *
 * const apiConfig: ApiConfig<Roles> = {
 *   auth: {
 *     roles: roles,
 *     defaultRole: 'user',
 *     defaultPermission: {
 *       create: ['admin'],
 *       read: true,
 *       update: ['admin'],
 *       delete: ['admin'],
 *     },
 *     jwt: {
 *       secret: 'your-secret-key-at-least-32-chars',
 *     },
 *   },
 * };
 * ```
 */
export interface ApiConfig<TRole extends string = string> extends Record<
	string,
	unknown
> {
	/**
	 * Enable API routes
	 * @default true
	 */
	readonly enabled?: boolean;

	/**
	 * API route prefix
	 * @default '/api'
	 */
	readonly prefix?: string;

	/**
	 * Default pagination page size
	 * @default 25
	 */
	readonly defaultPageSize?: number;

	/**
	 * Maximum allowed page size
	 * @default 100
	 */
	readonly maxPageSize?: number;

	/**
	 * Maximum depth for nested relation population
	 * @default 5
	 */
	readonly maxPopulateDepth?: number;

	/**
	 * Authentication configuration
	 *
	 * When defined, authentication is enabled.
	 * When undefined, authentication is disabled.
	 *
	 * Contains: roles, defaultRole, defaultPermission, jwt/session config
	 */
	readonly auth?: AuthConfig<TRole>;

	readonly disabled?: boolean;
	/**
	 * Auto-generate CRUD routes for schemas
	 * @default true
	 */
	readonly autoRoutes?: boolean;

	/**
	 * Exclude schemas from auto-generated routes
	 * 'auth' is always reserved for authentication endpoints
	 * @default []
	 */
	readonly excludeSchemas?: readonly string[];
}
