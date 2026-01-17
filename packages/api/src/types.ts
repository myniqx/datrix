import { AuthPluginOptions } from "./auth/types";
import type { DefaultPermission } from "forja-types/core/permission";

/**
 * API Configuration
 *
 * @template TRoles - Union type of valid role names
 *
 * @example
 * ```ts
 * const roles = ['admin', 'editor', 'user', 'guest'] as const;
 * type Roles = typeof roles[number];
 *
 * const apiConfig: ApiConfig<Roles> = {
 *   roles: roles,
 *   defaultPermission: {
 *     create: ['admin'],
 *     read: true,
 *     update: ['admin'],
 *     delete: ['admin'],
 *   },
 * };
 * ```
 */
export interface ApiConfig<TRoles extends string>
  extends Record<string, unknown> {
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
   * Defined roles for the application
   * Used for compile-time and runtime validation of permissions
   *
   * @example
   * ```ts
   * const roles = ['admin', 'editor', 'user', 'guest'] as const;
   * // In config:
   * roles: roles,
   * ```
   */
  readonly roles?: readonly TRoles[];

  /**
   * Default permission applied to schemas without explicit permissions
   * Schemas can override these with their own `permission` field
   *
   * @example
   * ```ts
   * defaultPermission: {
   *   create: ['admin'],
   *   read: true,           // Everyone can read
   *   update: ['admin'],
   *   delete: ['admin'],
   * }
   * ```
   */
  readonly defaultPermission?: DefaultPermission<TRoles>;
  readonly defaultRole?: TRoles;

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
   * Authentication configuration (optional)
   * When enabled, API automatically manages user authentication
   */
  readonly auth?: AuthPluginOptions;

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
