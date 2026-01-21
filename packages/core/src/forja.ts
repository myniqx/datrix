/**
 * Forja - Main Singleton Class
 *
 * Central orchestrator for the Forja framework.
 * Manages configuration, database adapter, plugins, and schemas.
 */

import { Result } from "forja-types/utils";
import {
  ForjaConfig,
  MigrationConfig,
  DevConfig,
  DEFAULT_MIGRATION_CONFIG,
  DEFAULT_DEV_CONFIG,
} from "forja-types/config";
import { DatabaseAdapter } from "forja-types/adapter";
import {
  ForjaPlugin,
  PluginContext,
  SchemaExtension,
} from "forja-types/plugin";
import { WhereClause } from "forja-types/core/query-builder";
import { CrudOperations } from "./mixins/crud";
import { SchemaHelpers } from "./mixins/schema";
import { SchemaExtensionContextImpl } from "./plugin/schema-extension-context";
import { Dispatcher, createDispatcher } from "./dispatcher";
import { PluginRegistry } from "forja-types/plugin";
import { SchemaRegistry } from "./schema";
import { ParsedQuery, ForjaEntry } from "forja-types";
import { IForja } from "forja-types/forja";

/**
 * Forja initialization error
 */
export class ForjaError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ForjaError";
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

/**
 * Forja Main Singleton Class
 */
export class Forja implements IForja {
  private static instance: Forja | null = null;
  private static initPromise: Promise<Forja> | null = null;

  private config: ForjaConfig | null = null;
  private adapter: DatabaseAdapter | null = null;
  private pluginRegistry: PluginRegistry = new PluginRegistry();
  private dispatcher: Dispatcher | null = null;
  private schemas: SchemaRegistry = new SchemaRegistry();
  private initialized = false;

  private _crud!: CrudOperations;
  private _rawCrud!: CrudOperations;
  private _schema!: SchemaHelpers;

  private constructor() { }

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
    options: ForjaInitOptions = {},
  ): Promise<Result<void, ForjaError>> {
    if (this.initialized) {
      return { success: true, data: undefined };
    }

    try {
      this.config = config;
      this.adapter = config.adapter;

      // Register plugins
      if (!options.skipPlugins && config.plugins) {
        for (const plugin of config.plugins) {
          const registerResult = this.pluginRegistry.register(plugin);
          if (!registerResult.success) {
            return {
              success: false,
              error: new ForjaError(
                `Failed to register plugin '${plugin.name}': ${registerResult.error.message}`,
                "PLUGIN_REGISTRATION_FAILED",
              ),
            };
          }
        }
      }

      // Create dispatcher
      this.dispatcher = createDispatcher(this.pluginRegistry, this);

      // Connect to database
      if (!options.skipConnection && this.adapter) {
        const connectResult = await this.adapter.connect();
        if (!connectResult.success) {
          return {
            success: false,
            error: new ForjaError(
              `Failed to connect to database: ${connectResult.error.message}`,
              "ADAPTER_CONNECTION_FAILED",
            ),
          };
        }
      }

      // 1. Register user schemas
      if (!options.skipSchemas && config.schemas.length > 0) {
        for (const schema of config.schemas) {
          const registerResult = this.schemas.register(schema);
          if (!registerResult.success) {
            return {
              success: false,
              error: new ForjaError(
                `Failed to register schema '${schema.name}': ${registerResult.error.message}`,
                "SCHEMA_REGISTRATION_FAILED",
              ),
            };
          }
        }
      }

      // 2. Register plugin schemas
      if (!options.skipPlugins) {
        for (const plugin of this.pluginRegistry.getAll()) {
          if (plugin.getSchemas) {
            const pluginSchemas = await plugin.getSchemas();
            for (const schema of pluginSchemas) {
              const registerResult = this.schemas.register(schema);
              if (!registerResult.success) {
                return {
                  success: false,
                  error: new ForjaError(
                    `Failed to register schema '${schema.name}' from plugin '${plugin.name}': ${registerResult.error.message}`,
                    "PLUGIN_SCHEMA_REGISTRATION_FAILED",
                  ),
                };
              }
            }
          }
        }
      }

      // 3. Apply schema extensions
      if (!options.skipPlugins) {
        const extensionContext = new SchemaExtensionContextImpl(
          this.schemas.getAll(),
        );

        for (const plugin of this.pluginRegistry.getAll()) {
          if (plugin.extendSchemas) {
            const extensions = await plugin.extendSchemas(extensionContext);
            const applyResult = this.applySchemaExtensions(extensions);
            if (!applyResult.success) {
              return {
                success: false,
                error: new ForjaError(
                  `Failed to apply schema extensions from plugin '${plugin.name}': ${applyResult.error.message}`,
                  "SCHEMA_EXTENSION_FAILED",
                ),
              };
            }
          }
        }
      }

      // Initialize mixins
      this._crud = new CrudOperations(
        this.schemas,
        () => this.adapter!,
        () => this.dispatcher!,
      );
      this._rawCrud = new CrudOperations(
        this.schemas,
        () => this.adapter!,
        null, // No dispatcher = raw mode (bypasses plugin hooks)
      );
      this._schema = new SchemaHelpers(this.schemas);

      // Initialize plugins
      if (!options.skipPlugins) {
        const pluginContext: PluginContext = {
          adapter: this.adapter!,
          schemas: this.schemas,
          config: this.config,
        };

        const initResult = await this.pluginRegistry.initAll(pluginContext);
        if (!initResult.success) {
          return {
            success: false,
            error: new ForjaError(
              `Failed to initialize plugins: ${initResult.error.message}`,
              "PLUGIN_INIT_FAILED",
            ),
          };
        }
      }

      // Dispatch schema load event
      if (!options.skipPlugins) {
        await this.dispatcher.dispatchSchemaLoad(this.schemas);
      }

      this.initialized = true;
      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: new ForjaError(
          `Initialization failed: ${error instanceof Error ? error.message : String(error)}`,
          "INIT_FAILED",
        ),
      };
    }
  }

  async shutdown(): Promise<Result<void, ForjaError>> {
    if (!this.initialized) {
      return { success: true, data: undefined };
    }

    try {
      const destroyResult = await this.pluginRegistry.destroyAll();
      if (!destroyResult.success) {
        return {
          success: false,
          error: new ForjaError(
            `Failed to destroy plugins: ${destroyResult.error.message}`,
            "PLUGIN_DESTROY_FAILED",
          ),
        };
      }

      if (this.adapter) {
        await this.adapter.disconnect();
      }

      this.schemas.clear();
      this.dispatcher = null;
      this.initialized = false;

      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: new ForjaError(
          `Shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
          "SHUTDOWN_FAILED",
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
    return this.pluginRegistry.getAll();
  }

  getPlugin<T extends ForjaPlugin = ForjaPlugin>(name: string): T | null {
    this.ensureInitialized();
    return (this.pluginRegistry.get(name) as T) ?? null;
  }

  hasPlugin(name: string): boolean {
    this.ensureInitialized();
    return this.pluginRegistry.has(name);
  }

  getDispatcher(): Dispatcher {
    this.ensureInitialized();
    return this.dispatcher!;
  }

  getSchemas(): SchemaRegistry {
    this.ensureInitialized();
    return this.schemas;
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

  /**
   * Raw CRUD operations (bypasses plugin hooks)
   *
   * Use this when you need direct database access without
   * triggering onBeforeQuery/onAfterQuery plugin hooks.
   *
   * @example
   * ```ts
   * // Normal (with hooks)
   * const user = await forja.findOne('User', { id: 1 });
   *
   * // Raw (without hooks)
   * const user = await forja.raw.findOne('User', { id: 1 });
   * ```
   */
  get raw(): CrudOperations {
    this.ensureInitialized();
    return this._rawCrud;
  }

  async findOne<T extends ForjaEntry = ForjaEntry>(
    model: string,
    where: WhereClause,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<T | null> {
    this.ensureInitialized();
    return this._crud.findOne<T>(model, where, options);
  }

  async findById<T extends ForjaEntry = ForjaEntry>(
    model: string,
    id: string | number,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<T | null> {
    this.ensureInitialized();
    return this._crud.findById<T>(model, id, options);
  }

  async findMany<T extends ForjaEntry = ForjaEntry>(
    model: string,
    options?: Pick<
      ParsedQuery,
      "where" | "select" | "populate" | "orderBy" | "limit" | "offset"
    >,
  ): Promise<T[]> {
    this.ensureInitialized();
    return this._crud.findMany<T>(model, options);
  }

  async count(model: string, where?: WhereClause): Promise<number> {
    this.ensureInitialized();
    return this._crud.count(model, where);
  }

  async create<T extends ForjaEntry = ForjaEntry>(
    model: string,
    data: Record<string, unknown>,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<T> {
    this.ensureInitialized();
    return this._crud.create<T>(model, data, options);
  }

  async update<T extends ForjaEntry = ForjaEntry>(
    model: string,
    id: string | number,
    data: Record<string, unknown>,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<T> {
    this.ensureInitialized();
    return this._crud.update<T>(model, id, data, options);
  }

  async updateMany(
    model: string,
    where: WhereClause,
    data: Record<string, unknown>,
  ): Promise<number> {
    this.ensureInitialized();
    return this._crud.updateMany(model, where, data);
  }

  async delete(
    model: string,
    id: string | number,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<boolean> {
    this.ensureInitialized();
    return this._crud.delete(model, id, options);
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
    this.pluginRegistry = new PluginRegistry();
    this.dispatcher = null;
    this.schemas = new SchemaRegistry();
    this.initialized = false;
    Forja.initPromise = null;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new ForjaError(
        "Forja not initialized. Use defineConfig() and call the returned function first.",
        "NOT_INITIALIZED",
      );
    }
  }

  private applySchemaExtensions(
    extensions: SchemaExtension[],
  ): Result<void, ForjaError> {
    for (const extension of extensions) {
      const schema = this.schemas.get(extension.targetSchema);

      if (!schema) {
        return {
          success: false,
          error: new ForjaError(
            `Cannot extend schema '${extension.targetSchema}': schema not found`,
            "SCHEMA_NOT_FOUND",
          ),
        };
      }

      const extendedFields = { ...schema.fields };
      const extendedIndexes = [...(schema.indexes || [])];

      if (extension.fields) {
        for (const [fieldName, fieldDef] of Object.entries(extension.fields)) {
          if (extendedFields[fieldName]) {
            console.warn(
              `[Forja] Field '${fieldName}' already exists in schema '${extension.targetSchema}'. Skipping.`,
            );
            continue;
          }
          extendedFields[fieldName] = fieldDef;
        }
      }

      if (extension.removeFields) {
        for (const fieldName of extension.removeFields) {
          delete extendedFields[fieldName];
        }
      }

      if (extension.modifyFields) {
        for (const [fieldName, modifications] of Object.entries(
          extension.modifyFields,
        )) {
          if (!extendedFields[fieldName]) {
            console.warn(
              `[Forja] Cannot modify field '${fieldName}' in schema '${extension.targetSchema}': field not found. Skipping.`,
            );
            continue;
          }

          extendedFields[fieldName] = {
            ...extendedFields[fieldName],
            ...modifications,
          } as any;
        }
      }

      if (extension.indexes) {
        extendedIndexes.push(...extension.indexes);
      }

      const extendedSchema = {
        ...schema,
        fields: extendedFields,
        indexes: extendedIndexes,
      };

      this.schemas.register(extendedSchema);
    }

    return { success: true, data: undefined };
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
  return async function getForjaInstance(): Promise<Forja> {
    const instance = Forja.getInstance();

    // Already initialized - return immediately
    if (instance.isInitialized()) {
      return instance;
    }

    // Initialization in progress - wait for it
    if (Forja["initPromise"]) {
      return Forja["initPromise"];
    }

    // Start initialization
    Forja["initPromise"] = (async () => {
      const config = factory();
      const result = await instance.initializeWithConfig(config);

      if (!result.success) {
        Forja["initPromise"] = null;
        throw result.error;
      }

      Forja["initPromise"] = null;
      return instance;
    })();

    return Forja["initPromise"];
  };
}
