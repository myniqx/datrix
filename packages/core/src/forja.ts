/**
 * Forja - Main Singleton Class
 *
 * This is the central orchestrator for the entire Forja framework.
 * It manages configuration, database adapter, plugins, and schemas.
 *
 * @example
 * ```ts
 * // Initialize Forja at application startup
 * await Forja.getInstance().initialize();
 *
 * // Access from anywhere
 * const adapter = Forja.getInstance().getAdapter();
 * const config = Forja.getInstance().getConfig();
 * ```
 */

import { Result } from 'forja-types/utils';
import { ForjaConfig, LoadConfigOptions, ApiConfig, MigrationConfig, DevConfig, DEFAULT_API_CONFIG, DEFAULT_MIGRATION_CONFIG, DEFAULT_DEV_CONFIG } from 'forja-types/config';
import { DatabaseAdapter } from 'forja-types/adapter';
import { ForjaPlugin, PluginContext } from 'forja-types/plugin';
import { SchemaRegistry } from 'forja-types/core/schema';
import { loadConfig } from './config/loader';

/**
 * Forja initialization error
 */
export class ForjaError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ForjaError';
  }
}

/**
 * Forja initialization options
 */
export interface ForjaInitOptions extends LoadConfigOptions {
  /**
   * Skip adapter connection (useful for testing)
   * @default false
   */
  readonly skipConnection?: boolean;

  /**
   * Skip plugin initialization (useful for testing)
   * @default false
   */
  readonly skipPlugins?: boolean;

  /**
   * Skip schema loading (useful for testing)
   * @default false
   */
  readonly skipSchemas?: boolean;
}

/**
 * Forja Main Singleton Class
 *
 * This is the heart of the Forja framework. It manages:
 * - Configuration loading and validation
 * - Database adapter lifecycle (connect/disconnect)
 * - Plugin initialization and lifecycle
 * - Schema loading and registry
 *
 * Usage:
 * 1. Call `Forja.getInstance()` to get singleton instance
 * 2. Call `initialize()` once at application startup
 * 3. Access config, adapter, plugins from anywhere via `getInstance()`
 */
export class Forja {
  private static instance: Forja | null = null;

  private config: ForjaConfig | null = null;
  private adapter: DatabaseAdapter | null = null;
  private plugins: readonly ForjaPlugin[] = [];
  private schemas: SchemaRegistry = new SchemaRegistry();
  private initialized = false;

  /**
   * Private constructor (singleton pattern)
   */
  private constructor() { }

  /**
   * Get singleton instance
   *
   * @returns Forja singleton instance
   */
  static getInstance(): Forja {
    if (!Forja.instance) {
      Forja.instance = new Forja();
    }
    return Forja.instance;
  }

  /**
   * Initialize Forja
   *
   * This should be called once at application startup.
   * It performs the following steps:
   * 1. Load and validate configuration
   * 2. Connect to database
   * 3. Load schemas from glob pattern
   * 4. Initialize all plugins
   *
   * @param options - Initialization options
   * @returns Result indicating success or failure
   *
   * @example
   * ```ts
   * const result = await Forja.getInstance().initialize();
   * if (!result.success) {
   *   console.error(result.error.message);
   *   process.exit(1);
   * }
   * ```
   */
  async initialize(options: ForjaInitOptions = {}): Promise<Result<void, ForjaError>> {
    if (this.initialized) {
      return {
        success: false,
        error: new ForjaError(
          'Forja already initialized. Call reset() before re-initializing.',
          'ALREADY_INITIALIZED'
        ),
      };
    }

    try {
      // Step 1: Load configuration
      const configResult = await loadConfig(options);
      if (!configResult.success) {
        return {
          success: false,
          error: new ForjaError(
            `Failed to load config: ${configResult.error.message}`,
            'CONFIG_LOAD_FAILED'
          ),
        };
      }

      this.config = configResult.data;
      this.adapter = this.config.adapter;
      this.plugins = this.config.plugins || [];

      // Step 2: Connect to database
      if (!options.skipConnection && this.adapter) {
        const connectResult = await this.adapter.connect();
        if (!connectResult.success) {
          return {
            success: false,
            error: new ForjaError(
              `Failed to connect to database: ${connectResult.error.message}`,
              'ADAPTER_CONNECTION_FAILED'
            ),
          };
        }
      }

      // Step 3: Load schemas (TODO: implement schema loader)
      if (!options.skipSchemas) {
        // TODO: Load schemas from config.schemas.path glob pattern
        // const schemas = await loadSchemas(this.config.schemas.path);
        // schemas.forEach(schema => this.schemas.register(schema));
      }

      // Step 4: Initialize plugins
      if (!options.skipPlugins) {
        const pluginContext: PluginContext = {
          adapter: this.adapter,
          schemas: this.schemas,
          config: this.config,
        };

        for (const plugin of this.plugins) {
          const initResult = await plugin.init(pluginContext);
          if (!initResult.success) {
            return {
              success: false,
              error: new ForjaError(
                `Failed to initialize plugin '${plugin.name}': ${initResult.error.message}`,
                'PLUGIN_INIT_FAILED'
              ),
            };
          }
        }
      }

      this.initialized = true;

      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: new ForjaError(
          `Initialization failed: ${error instanceof Error ? error.message : String(error)}`,
          'INIT_FAILED'
        ),
      };
    }
  }

  /**
   * Shutdown Forja gracefully
   *
   * This performs cleanup:
   * 1. Destroy all plugins
   * 2. Disconnect from database
   * 3. Clear schemas
   *
   * @returns Result indicating success or failure
   */
  async shutdown(): Promise<Result<void, ForjaError>> {
    if (!this.initialized) {
      return {
        success: false,
        error: new ForjaError('Forja not initialized', 'NOT_INITIALIZED'),
      };
    }

    try {
      // Step 1: Destroy plugins
      for (const plugin of this.plugins) {
        const destroyResult = await plugin.destroy();
        if (!destroyResult.success) {
          // Log error but continue shutdown
          console.error(`Failed to destroy plugin '${plugin.name}':`, destroyResult.error);
        }
      }

      // Step 2: Disconnect adapter
      if (this.adapter) {
        const disconnectResult = await this.adapter.disconnect();
        if (!disconnectResult.success) {
          return {
            success: false,
            error: new ForjaError(
              `Failed to disconnect adapter: ${disconnectResult.error.message}`,
              'ADAPTER_DISCONNECT_FAILED'
            ),
          };
        }
      }

      // Step 3: Clear state
      this.schemas.clear();
      this.initialized = false;

      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: new ForjaError(
          `Shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
          'SHUTDOWN_FAILED'
        ),
      };
    }
  }

  /**
   * Get full configuration
   *
   * @throws {ForjaError} If not initialized
   */
  getConfig(): ForjaConfig {
    this.ensureInitialized();
    return this.config!;
  }

  /**
   * Get database adapter
   *
   * @throws {ForjaError} If not initialized
   */
  getAdapter<T extends DatabaseAdapter = DatabaseAdapter>(): T {
    this.ensureInitialized();
    return this.adapter as T;
  }

  /**
   * Get all plugins
   *
   * @returns Array of plugins (empty if no plugins configured)
   */
  getPlugins(): readonly ForjaPlugin[] {
    this.ensureInitialized();
    return this.plugins;
  }

  /**
   * Get specific plugin by name
   *
   * @param name - Plugin name
   * @returns Plugin instance or null if not found
   */
  getPlugin<T extends ForjaPlugin = ForjaPlugin>(name: string): T | null {
    this.ensureInitialized();
    const plugin = this.plugins.find((p) => p.name === name);
    return (plugin as T) ?? null;
  }

  /**
   * Check if plugin is registered
   *
   * @param name - Plugin name
   * @returns True if plugin exists
   */
  hasPlugin(name: string): boolean {
    this.ensureInitialized();
    return this.plugins.some((p) => p.name === name);
  }

  /**
   * Get schema registry
   *
   * @returns Schema registry instance
   */
  getSchemas(): SchemaRegistry {
    this.ensureInitialized();
    return this.schemas;
  }

  /**
   * Get API config with defaults
   *
   * Missing values are filled with defaults from DEFAULT_API_CONFIG
   */
  getApiConfig(): Required<ApiConfig> {
    this.ensureInitialized();
    const userConfig = this.config!.api ?? {};
    return { ...DEFAULT_API_CONFIG, ...userConfig };
  }

  /**
   * Get migration config with defaults
   *
   * Missing values are filled with defaults from DEFAULT_MIGRATION_CONFIG
   */
  getMigrationConfig(): Required<MigrationConfig> {
    this.ensureInitialized();
    const userConfig = this.config!.migration ?? {};
    return { ...DEFAULT_MIGRATION_CONFIG, ...userConfig };
  }

  /**
   * Get dev config with defaults
   *
   * Missing values are filled with defaults from DEFAULT_DEV_CONFIG
   */
  getDevConfig(): Required<DevConfig> {
    this.ensureInitialized();
    const userConfig = this.config!.dev ?? {};
    return { ...DEFAULT_DEV_CONFIG, ...userConfig };
  }

  /**
   * Check if Forja is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Reset Forja state (for testing only!)
   *
   * WARNING: This should only be used in test environments.
   * Do not call this in production code.
   */
  reset(): void {
    this.config = null;
    this.adapter = null;
    this.plugins = [];
    this.schemas = new SchemaRegistry();
    this.initialized = false;
  }

  /**
   * Ensure Forja is initialized
   *
   * @throws {ForjaError} If not initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new ForjaError(
        'Forja not initialized. Call Forja.getInstance().initialize() first.',
        'NOT_INITIALIZED'
      );
    }
  }
}

/**
 * Get Forja instance (convenience export)
 */
export function getForja(): Forja {
  return Forja.getInstance();
}

/**
 * Initialize Forja with options (convenience function)
 *
 * @param options - Initialization options
 * @returns Result indicating success or failure
 *
 * @example
 * ```ts
 * const result = await initializeForja();
 * if (!result.success) {
 *   console.error(result.error.message);
 *   process.exit(1);
 * }
 * ```
 */
export async function initializeForja(
  options?: ForjaInitOptions
): Promise<Result<void, ForjaError>> {
  return await Forja.getInstance().initialize(options);
}
