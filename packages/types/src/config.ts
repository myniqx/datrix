/**
 * Configuration Types
 *
 * This file defines all configuration-related types for Forja framework.
 * Config files (forja.config.ts) should export values matching these types.
 */

import type { DatabaseAdapter } from './adapter';
import type { ForjaPlugin } from './plugin';
import type { SchemaDefinition } from './core/schema';
import { ForjaError } from './utils';

/**
 * Main Forja Configuration
 *
 * Users export this from their forja.config.ts file
 *
 * @example
 * ```ts
 * // forja.config.ts
 * import { PostgresAdapter } from 'forja/adapters';
 * import { AuthPlugin } from 'forja/plugins';
 *
 * export default {
 *   adapter: new PostgresAdapter({ connectionString: process.env.DATABASE_URL! }),
 *   schemas: { path: './schemas/**\/*.schema.ts' },
 *   plugins: [new AuthPlugin({ ... })],
 * } as const;
 * ```
 */
export interface ForjaConfig<TAdapter extends DatabaseAdapter = DatabaseAdapter> {
  /**
   * Database adapter instance
   * Must be an initialized adapter (PostgresAdapter, MySQLAdapter, etc.)
   */
  readonly adapter: TAdapter;

  /**
   * Schema definitions
   * Import your schemas and add them to this array
   *
   * @example
   * ```ts
   * import { userSchema } from './schemas/user.schema';
   * import { postSchema } from './schemas/post.schema';
   *
   * export default {
   *   schemas: [userSchema, postSchema],
   * }
   * ```
   */
  readonly schemas: readonly SchemaDefinition[];

  /**
   * Plugin instances (optional)
   * Order matters - plugins are initialized in the order they appear
   */
  readonly plugins?: readonly ForjaPlugin[];

  /**
   * Migration configuration (optional)
   * Controls database migration behavior
   */
  readonly migration?: MigrationConfig;

  /**
   * Development mode options (optional)
   * Enables additional debugging and validation features
   */
  readonly dev?: DevConfig;
}

/**
 * Migration Configuration
 */
export interface MigrationConfig {
  /**
   * Automatically run migrations on startup
   * @default false (true in development)
   */
  readonly auto?: boolean;

  /**
   * Directory to store migration files
   * @default './migrations'
   */
  readonly directory?: string;
}

/**
 * Development Configuration
 */
export interface DevConfig {
  /**
   * Enable detailed query logging
   * @default false (true in development)
   */
  readonly logging?: boolean;

  /**
   * Validate all queries before execution
   * @default false (true in development)
   */
  readonly validateQueries?: boolean;

  /**
   * Pretty-print errors with stack traces
   * @default false (true in development)
   */
  readonly prettyErrors?: boolean;
}

/**
 * Config file export format
 *
 * Supports both ESM default export and direct export
 */
export type ConfigFileExport<T extends ForjaConfig = ForjaConfig> =
  | T // Direct export
  | { default: T }; // ESM default export

/**
 * Config loading options
 */
export interface LoadConfigOptions {
  /**
   * Path to config file
   * @default './forja.config.ts' (with fallback to .js)
   */
  readonly configPath?: string;

  /**
   * Environment name
   * Used to load environment-specific config files
   * @default process.env.NODE_ENV ?? 'development'
   */
  readonly environment?: 'development' | 'production' | 'test';

  /**
   * Current working directory
   * @default process.cwd()
   */
  readonly cwd?: string;
}

/**
 * Config validation error
 */
export class ConfigError extends ForjaError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'CONFIG_ERROR', details });
    this.name = 'ConfigError';
  }
}

/**
 * Config not found error
 */
export class ConfigNotFoundError extends ConfigError {
  constructor(path: string) {
    super(`Config file not found: ${path}`, { code: 'CONFIG_NOT_FOUND' });
    this.name = 'ConfigNotFoundError';
  }
}

/**
 * Config validation failed error
 */
export class ConfigValidationError extends ConfigError {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(
      `Config validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`,
      { code: 'CONFIG_VALIDATION_FAILED', details: { errors } }
    );
    this.name = 'ConfigValidationError';
    this.errors = errors;
  }
}

/**
 * TypeScript config requires compilation error
 */
export class TypeScriptConfigError extends ConfigError {
  constructor(configPath: string) {
    super(
      `TypeScript config found but not compiled.\n\n` +
      `Config file: ${configPath}\n\n` +
      `Option 1: Compile your config:\n` +
      `  tsc ${configPath}\n\n` +
      `Option 2: Install tsx for automatic TS support:\n` +
      `  npm install -D tsx\n\n` +
      `Option 3: Use JavaScript config instead:\n` +
      `  Rename to forja.config.js`,
      { code: 'TYPESCRIPT_CONFIG_NOT_COMPILED' }
    );
    this.name = 'TypeScriptConfigError';
  }
}

/**
 * Type guard for ForjaConfig
 */
export function isForjaConfig(value: unknown): value is ForjaConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    'adapter' in obj &&
    typeof obj['adapter'] === 'object' &&
    'schemas' in obj &&
    typeof obj['schemas'] === 'object'
  );
}

/**
 * Type guard for ESM default export
 */
export function hasDefaultExport<T>(
  value: unknown
): value is { default: T } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'default' in value
  );
}

/**
 * Default API configuration values
 */
export const DEFAULT_API_CONFIG = {
  enabled: true,
  prefix: '/api',
  defaultPageSize: 25,
  maxPageSize: 100,
  maxPopulateDepth: 5,
  autoRoutes: true,
  excludeSchemas: [],
} as const;

/**
 * Default API Auth configuration values
 */
export const DEFAULT_API_AUTH_CONFIG = {
  enabled: true,
  userSchema: {
    name: 'user',
    fields: {
      email: 'email',
      password: 'password',
      role: 'role',
    },
    extraFields: [],
  },
  jwt: {
    expiresIn: '7d',
    algorithm: 'HS256' as const,
  },
  session: {
    store: 'memory' as const,
    maxAge: 86400, // 24 hours
    checkPeriod: 3600, // 1 hour
    prefix: 'forja:session:',
  },
  rbac: {
    defaultRole: 'user',
    roles: [],
  },
  password: {
    iterations: 100000,
    keyLength: 64,
    minLength: 8,
  },
  endpoints: {
    login: '/auth/login',
    register: '/auth/register',
    logout: '/auth/logout',
    me: '/auth/me',
    disableRegister: false,
  },
} as const;

/**
 * Default migration configuration values
 */
export const DEFAULT_MIGRATION_CONFIG: Required<MigrationConfig> = {
  auto: false,
  directory: './migrations',
} as const;

/**
 * Default dev configuration values
 */
export const DEFAULT_DEV_CONFIG: Required<DevConfig> = {
  logging: false,
  validateQueries: false,
  prettyErrors: false,
} as const;
