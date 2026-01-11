/**
 * Forja - Main Singleton Class
 *
 * Central orchestrator for the Forja framework.
 * Manages configuration, database adapter, plugins, and schemas.
 */

import { Result } from 'forja-types/utils';
import { ForjaConfig, ApiConfig, MigrationConfig, DevConfig, DEFAULT_API_CONFIG, DEFAULT_MIGRATION_CONFIG, DEFAULT_DEV_CONFIG } from 'forja-types/config';
import { DatabaseAdapter } from 'forja-types/adapter';
import { ForjaPlugin, PluginContext } from 'forja-types/plugin';
import { SchemaRegistry } from 'forja-types/core/schema';
import { WhereClause, SelectClause, PopulateClause, OrderByItem } from 'forja-types/core/query-builder';
import { CrudOperations } from './mixins/crud';
import { SchemaHelpers } from './mixins/schema';

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
export interface ForjaInitOptions {
  readonly skipConnection?: boolean;
  readonly skipPlugins?: boolean;
  readonly skipSchemas?: boolean;
}

/**
 * Config factory function type
 */
export type ConfigFactory = () => ForjaConfig;

// Global config factory storage
let globalConfigFactory: ConfigFactory | null = null;

/**
 * Forja Main Singleton Class
 */
export class Forja {
  private static instance: Forja | null = null;
  private static initPromise: Promise<Forja> | null = null;

  private config: ForjaConfig | null = null;
  private adapter: DatabaseAdapter | null = null;
  private plugins: readonly ForjaPlugin[] = [];
  private schemas: SchemaRegistry = new SchemaRegistry();
  private initialized = false;

  private _crud!: CrudOperations;
  private _schema!: SchemaHelpers;

  private constructor() {}

  static getInstance(): Forja {
    if (!Forja.instance) {
      Forja.instance = new Forja();
    }
    return Forja.instance;
  }

  /**
   * Initialize with config object directly
   */
  async initializeWithConfig(
    config: ForjaConfig,
    options: ForjaInitOptions = {}
  ): Promise<Result<void, ForjaError>> {
    if (this.initialized) {
      return { success: true, data: undefined };
    }

    try {
      this.config = config;
      this.adapter = config.adapter;
      this.plugins = config.plugins || [];

      // Connect to database
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

      // Register schemas
      if (!options.skipSchemas && config.schemas.length > 0) {
        for (const schema of config.schemas) {
          this.schemas.register(schema);
        }
      }

      // Initialize mixins
      this._crud = new CrudOperations(this.schemas, () => this.adapter!);
      this._schema = new SchemaHelpers(this.schemas);

      // Initialize plugins
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

  async shutdown(): Promise<Result<void, ForjaError>> {
    if (!this.initialized) {
      return { success: true, data: undefined };
    }

    try {
      for (const plugin of this.plugins) {
        await plugin.destroy();
      }

      if (this.adapter) {
        await this.adapter.disconnect();
      }

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

  getConfig(): ForjaConfig {
    this.ensureInitialized();
    return this.config!;
  }

  getAdapter<T extends DatabaseAdapter = DatabaseAdapter>(): T {
    this.ensureInitialized();
    return this.adapter as T;
  }

  getPlugins(): readonly ForjaPlugin[] {
    this.ensureInitialized();
    return this.plugins;
  }

  getPlugin<T extends ForjaPlugin = ForjaPlugin>(name: string): T | null {
    this.ensureInitialized();
    const plugin = this.plugins.find((p) => p.name === name);
    return (plugin as T) ?? null;
  }

  hasPlugin(name: string): boolean {
    this.ensureInitialized();
    return this.plugins.some((p) => p.name === name);
  }

  getSchemas(): SchemaRegistry {
    this.ensureInitialized();
    return this.schemas;
  }

  getApiConfig(): Required<ApiConfig> {
    this.ensureInitialized();
    const userConfig = this.config!.api ?? {};
    return { ...DEFAULT_API_CONFIG, ...userConfig };
  }

  getMigrationConfig(): Required<MigrationConfig> {
    this.ensureInitialized();
    const userConfig = this.config!.migration ?? {};
    return { ...DEFAULT_MIGRATION_CONFIG, ...userConfig };
  }

  getDevConfig(): Required<DevConfig> {
    this.ensureInitialized();
    const userConfig = this.config!.dev ?? {};
    return { ...DEFAULT_DEV_CONFIG, ...userConfig };
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  get crud(): CrudOperations {
    this.ensureInitialized();
    return this._crud;
  }

  async findOne<T = unknown>(
    model: string,
    where: WhereClause,
    options?: {
      readonly select?: SelectClause;
      readonly populate?: PopulateClause;
    }
  ): Promise<T | null> {
    this.ensureInitialized();
    return this._crud.findOne<T>(model, where, options);
  }

  async findById<T = unknown>(
    model: string,
    id: string | number,
    options?: {
      readonly select?: SelectClause;
      readonly populate?: PopulateClause;
    }
  ): Promise<T | null> {
    this.ensureInitialized();
    return this._crud.findById<T>(model, id, options);
  }

  async findMany<T = unknown>(
    model: string,
    options?: {
      readonly where?: WhereClause;
      readonly select?: SelectClause;
      readonly populate?: PopulateClause;
      readonly orderBy?: readonly OrderByItem[];
      readonly limit?: number;
      readonly offset?: number;
    }
  ): Promise<T[]> {
    this.ensureInitialized();
    return this._crud.findMany<T>(model, options);
  }

  async count(model: string, where?: WhereClause): Promise<number> {
    this.ensureInitialized();
    return this._crud.count(model, where);
  }

  async create<T = unknown>(
    model: string,
    data: Record<string, unknown>
  ): Promise<T> {
    this.ensureInitialized();
    return this._crud.create<T>(model, data);
  }

  async update<T = unknown>(
    model: string,
    id: string | number,
    data: Record<string, unknown>
  ): Promise<T> {
    this.ensureInitialized();
    return this._crud.update<T>(model, id, data);
  }

  async updateMany(
    model: string,
    where: WhereClause,
    data: Record<string, unknown>
  ): Promise<number> {
    this.ensureInitialized();
    return this._crud.updateMany(model, where, data);
  }

  async delete(model: string, id: string | number): Promise<boolean> {
    this.ensureInitialized();
    return this._crud.delete(model, id);
  }

  async deleteMany(model: string, where: WhereClause): Promise<number> {
    this.ensureInitialized();
    return this._crud.deleteMany(model, where);
  }

  get schema(): SchemaHelpers {
    this.ensureInitialized();
    return this._schema;
  }

  getSchema(name: string) {
    this.ensureInitialized();
    return this._schema.get(name);
  }

  getAllSchemas() {
    this.ensureInitialized();
    return this._schema.getAll();
  }

  hasSchema(name: string): boolean {
    this.ensureInitialized();
    return this._schema.has(name);
  }

  reset(): void {
    this.config = null;
    this.adapter = null;
    this.plugins = [];
    this.schemas = new SchemaRegistry();
    this.initialized = false;
    Forja.initPromise = null;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new ForjaError(
        'Forja not initialized. Use defineConfig() and call the returned function first.',
        'NOT_INITIALIZED'
      );
    }
  }
}

/**
 * Define Forja configuration
 *
 * Returns a function that when called, returns an initialized Forja instance.
 * The config factory is only called once on first invocation.
 *
 * @example
 * ```ts
 * // forja.config.ts
 * import { defineConfig } from 'forja-core';
 *
 * export default defineConfig(() => ({
 *   adapter: new JsonAdapter({ root: './data' }),
 *   schemas: [userSchema, topicSchema],
 * }));
 * ```
 *
 * @example
 * ```ts
 * // Usage anywhere
 * import forja from './forja.config';
 *
 * const users = await forja().findMany('user');
 * ```
 */
export function defineConfig(factory: ConfigFactory): () => Promise<Forja> {
  globalConfigFactory = factory;

  return async function getForjaInstance(): Promise<Forja> {
    const instance = Forja.getInstance();

    // Already initialized - return immediately
    if (instance.isInitialized()) {
      return instance;
    }

    // Initialization in progress - wait for it
    if (Forja['initPromise']) {
      return Forja['initPromise'];
    }

    // Start initialization
    Forja['initPromise'] = (async () => {
      const config = factory();
      const result = await instance.initializeWithConfig(config);

      if (!result.success) {
        Forja['initPromise'] = null;
        throw result.error;
      }

      Forja['initPromise'] = null;
      return instance;
    })();

    return Forja['initPromise'];
  };
}

/**
 * Get Forja instance with lazy initialization
 *
 * Uses the config factory set by defineConfig().
 * Throws if defineConfig() was never called.
 */
export async function getForja(): Promise<Forja> {
  const instance = Forja.getInstance();

  if (instance.isInitialized()) {
    return instance;
  }

  if (!globalConfigFactory) {
    throw new ForjaError(
      'No config defined. Import your forja.config.ts file or call defineConfig() first.',
      'NO_CONFIG'
    );
  }

  // Use the stored factory to initialize
  const config = globalConfigFactory();
  const result = await instance.initializeWithConfig(config);

  if (!result.success) {
    throw result.error;
  }

  return instance;
}
