import type { AuthConfig } from "./auth/types";
import type { IUpload } from "@forja/core/types/api";

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
	 * Disable all HTTP request handling.
	 * The plugin remains loaded — schemas are still injected and migrations still run.
	 * Use this when you want the DB schema to stay in sync but don't want to expose REST endpoints.
	 * @default false
	 */
	readonly disabled?: boolean;

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

	/**
	 * Upload instance (from @forja/api-upload)
	 *
	 * When defined, file upload is enabled.
	 * Injects media schema and exposes /upload endpoints.
	 */
	readonly upload?: IUpload;

	/**
	 * Exclude schemas from auto-generated routes
	 * '_forja' and '_forja_migrations' are always excluded
	 * @default []
	 */
	readonly excludeSchemas?: readonly string[];
}
