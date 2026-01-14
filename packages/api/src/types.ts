import { AuthPluginOptions } from "./auth/types";

/**
 * API Configuration
 */
export interface ApiConfig {
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
