/**
 * Core Configuration Types
 *
 * Datrix framework configuration types used in datrix.config.ts files.
 */

import type { DatabaseAdapter } from "../adapter";
import type { DatrixPlugin } from "./plugin";
import type { SchemaDefinition } from "./schema";

/**
 * Main Datrix Configuration
 *
 * Users export this from their datrix.config.ts file
 *
 * @example
 * ```ts
 * // datrix.config.ts
 * import { PostgresAdapter } from 'datrix/adapters';
 * import { AuthPlugin } from 'datrix/plugins';
 *
 * export default {
 *   adapter: new PostgresAdapter({ connectionString: process.env.DATABASE_URL! }),
 *   schemas: { path: './schemas/**\/*.schema.ts' },
 *   plugins: [new AuthPlugin({ ... })],
 * } as const;
 * ```
 */
export interface DatrixConfig<
	TAdapter extends DatabaseAdapter = DatabaseAdapter,
> {
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
	readonly plugins?: readonly DatrixPlugin[];

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

	/**
	 * Table name for storing migration history
	 * @default '_datrix_migrations'
	 */
	readonly modelName?: string;
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
export type ConfigFileExport<T extends DatrixConfig = DatrixConfig> =
	| T
	| { default: T };

/**
 * Config loading options
 */
export interface LoadConfigOptions {
	/**
	 * Path to config file
	 * @default './datrix.config.ts' (with fallback to .js)
	 */
	readonly configPath?: string;

	/**
	 * Environment name
	 * Used to load environment-specific config files
	 * @default process.env.NODE_ENV ?? 'development'
	 */
	readonly environment?: "development" | "production" | "test";

	/**
	 * Current working directory
	 * @default process.cwd()
	 */
	readonly cwd?: string;
}

/**
 * Type guard for DatrixConfig
 */
export function isDatrixConfig(value: unknown): value is DatrixConfig {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const obj = value as Record<string, unknown>;

	return (
		"adapter" in obj &&
		typeof obj["adapter"] === "object" &&
		"schemas" in obj &&
		typeof obj["schemas"] === "object"
	);
}

/**
 * Type guard for ESM default export
 */
export function hasDefaultExport<T>(value: unknown): value is { default: T } {
	return typeof value === "object" && value !== null && "default" in value;
}

/**
 * Default migration configuration values
 */
export const DEFAULT_MIGRATION_CONFIG: Required<MigrationConfig> = {
	auto: false,
	directory: "./migrations",
	modelName: "_datrix_migration",
} as const;

/**
 * Default dev configuration values
 */
export const DEFAULT_DEV_CONFIG: Required<DevConfig> = {
	logging: false,
	validateQueries: false,
	prettyErrors: false,
} as const;
