/**
 * Plugin Interface
 *
 * This file defines the standard interface that ALL plugins must implement.
 * Plugins extend Forja's core functionality with features like auth, upload, hooks, etc.
 */

import type {
  SchemaRegistry,
  SchemaDefinition,
  FieldDefinition,
  IndexDefinition,
} from "./core/schema";
import type { DatabaseAdapter } from "./adapter";
import type { ForjaConfig } from "./config";
import { Result } from "./utils";
import { QueryObject } from "./core/query-builder";
import { IForja } from "./forja";
import { AuthenticatedUser } from "./api/auth";

export type { SchemaDefinition } from "./core/schema";

/**
 * Query operation type
 */
export type QueryAction =
  | "findOne"
  | "findMany"
  | "count"
  | "create"
  | "update"
  | "updateMany"
  | "delete"
  | "deleteMany";

/**
 * Query context passed to plugin hooks
 */
export interface QueryContext {
  readonly action: QueryAction;
  readonly model: string;
  readonly table: string;
  readonly forja: IForja;
  readonly metadata: Record<string, unknown>;
  user?: AuthenticatedUser | undefined;
}

/**
 * Plugin context (provided during initialization)
 */
export interface PluginContext {
  readonly adapter: DatabaseAdapter;
  readonly schemas: SchemaRegistry;
  readonly config: ForjaConfig;
}

/**
 * Plugin interface
 *
 * ALL plugins MUST implement this interface
 */
export interface ForjaPlugin<TOptions = Record<string, unknown>> {
  // Metadata
  readonly name: string;
  readonly version: string;
  readonly options: TOptions;

  // Lifecycle
  init(context: PluginContext): Promise<Result<void, PluginError>>;
  destroy(): Promise<Result<void, PluginError>>;

  // Schema hooks
  getSchemas?(): Promise<SchemaDefinition[]>;
  extendSchemas?(context: SchemaExtensionContext): Promise<SchemaExtension[]>;

  // Query hooks
  onSchemaLoad?(schemas: SchemaRegistry): Promise<void>;
  onCreateQueryContext?(context: QueryContext): Promise<QueryContext>;
  onBeforeQuery?(
    query: QueryObject,
    context: QueryContext,
  ): Promise<QueryObject>;
  onAfterQuery?<TResult>(
    result: TResult,
    context: QueryContext,
  ): Promise<TResult>;
}

/**
 * Base plugin error
 */
export class PluginError extends Error {
  readonly code: string;
  readonly pluginName: string | undefined;
  readonly details: unknown | undefined;

  constructor(
    message: string,
    options?: { code?: string; pluginName?: string; details?: unknown },
  ) {
    super(message);
    this.name = "PluginError";
    this.code = options?.code ?? "UNKNOWN";
    this.pluginName = options?.pluginName;
    this.details = options?.details;
  }
}

/**
 * Type guard for ForjaPlugin
 */
export function isForjaPlugin(value: unknown): value is ForjaPlugin {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    "name" in obj &&
    "version" in obj &&
    "init" in obj &&
    "destroy" in obj &&
    typeof obj["name"] === "string" &&
    typeof obj["version"] === "string" &&
    typeof obj["init"] === "function" &&
    typeof obj["destroy"] === "function"
  );
}

/**
 * Plugin factory type
 */
export type PluginFactory<TOptions = Record<string, unknown>> = (
  options: TOptions,
) => ForjaPlugin<TOptions>;

/**
 * Lifecycle hook context
 */
export interface HookContext {
  readonly modelName: string;
  readonly operation: "create" | "update" | "delete" | "find";
  readonly user?: {
    readonly id: string;
    readonly role: string;
  };
  readonly metadata?: Record<string, unknown>;
}

/**
 * Lifecycle hook handler
 */
export type HookHandler<TData = unknown, TResult = TData> = (
  data: TData,
  context: HookContext,
) => Promise<TResult> | TResult;

/**
 * Lifecycle hooks map
 */
export interface LifecycleHooks<T = Record<string, unknown>> {
  readonly beforeCreate?: HookHandler<Partial<T>, Partial<T>>;
  readonly afterCreate?: HookHandler<T, T>;
  readonly beforeUpdate?: HookHandler<Partial<T>, Partial<T>>;
  readonly afterUpdate?: HookHandler<T, T>;
  readonly beforeDelete?: HookHandler<string, void>;
  readonly afterDelete?: HookHandler<string, void>;
  readonly beforeFind?: HookHandler<QueryObject, QueryObject>;
  readonly afterFind?: HookHandler<T | readonly T[], T | readonly T[]>;
}

/**
 * Auth plugin types
 */

/**
 * JWT payload
 */
export interface JwtPayload {
  readonly userId: string;
  readonly role: string;
  readonly iat: number;
  readonly exp: number;
  readonly [key: string]: unknown;
}

/**
 * Session data
 */
export interface SessionData {
  readonly id: string;
  readonly userId: string;
  readonly role: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly [key: string]: unknown;
}

/**
 * Auth user
 */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly [key: string]: unknown;
}

/**
 * Auth error
 *
 * @deprecated Use ForjaAuthError from 'forja-types/errors' instead.
 * This class is kept for backwards compatibility only.
 *
 * @example
 * ```ts
 * // Old (deprecated)
 * throw new AuthError('Invalid credentials', { userId: '123' });
 *
 * // New (recommended)
 * import { throwInvalidCredentials } from '@forja/api/auth/error-helper';
 * throwInvalidCredentials();
 * ```
 */
export class AuthError extends PluginError {
  constructor(
    message: string,
    options?: { code?: string; details?: unknown },
  ) {
    super(message, {
      code: options?.code ?? "AUTH_ERROR",
      details: options?.details,
    });
    this.name = "AuthError";
  }
}

// Permission types are now in core/permission.ts
// Re-export for backwards compatibility
export type {
  PermissionAction,
  SchemaPermission,
  FieldPermission,
  PermissionValue,
  PermissionContext,
  PermissionFn,
} from "./core/permission";

/**
 * Upload plugin types
 */

/**
 * Upload file data
 */
export interface UploadFile {
  readonly filename: string;
  readonly originalName: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Uint8Array;
}

/**
 * Upload result
 */
export interface UploadResult {
  readonly key: string;
  readonly url: string;
  readonly size: number;
  readonly mimetype: string;
  readonly uploadedAt: Date;
}

/**
 * Storage provider interface
 */
export interface StorageProvider {
  readonly name: string;

  upload(file: UploadFile): Promise<Result<UploadResult, UploadError>>;
  delete(key: string): Promise<Result<void, UploadError>>;
  getUrl(key: string): Promise<string>;
  exists(key: string): Promise<boolean>;
}

/**
 * Upload error
 */
export class UploadError extends PluginError {
  constructor(message: string, details?: unknown) {
    super(message, { code: "UPLOAD_ERROR", details });
    this.name = "UploadError";
  }
}

/**
 * Soft delete plugin types
 */

/**
 * Soft delete options
 */
export interface SoftDeleteOptions {
  readonly field?: string; // Field name (default: 'deletedAt')
  readonly type?: "timestamp" | "boolean"; // Field type
}

/**
 * Soft delete interceptor
 */
export interface SoftDeleteInterceptor {
  interceptQuery(query: QueryObject): QueryObject;
  hardDelete(query: QueryObject): QueryObject;
  findDeleted(query: QueryObject): QueryObject;
  restore(tableName: string, id: string): QueryObject;
}

/**
 * Hooks plugin types
 */

/**
 * Hook registration
 */
export interface HookRegistration {
  readonly modelName: string;
  readonly hooks: LifecycleHooks;
}

/**
 * Hooks manager
 */
export interface HooksManager {
  registerHooks(modelName: string, hooks: LifecycleHooks): void;
  getHooks(modelName: string): LifecycleHooks | undefined;
  executeHook<TData, TResult = TData>(
    modelName: string,
    hookName: keyof LifecycleHooks,
    data: TData,
    context: HookContext,
  ): Promise<TResult>;
  hasHook(modelName: string, hookName: keyof LifecycleHooks): boolean;
}

/**
 * Validation plugin types
 */

/**
 * Validation rule
 */
export interface ValidationRule<T = unknown> {
  readonly validator: (value: T) => boolean | Promise<boolean>;
  readonly message: string;
}

/**
 * Field validation
 */
export interface FieldValidation {
  readonly field: string;
  readonly rules: readonly ValidationRule[];
}

/**
 * Validation result
 */
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationErrorDetail[];
}

/**
 * Validation error detail
 */
export interface ValidationErrorDetail {
  readonly field: string;
  readonly message: string;
  readonly value?: unknown;
}

/**
 * Plugin registry
 */
export class PluginRegistry {
  private readonly plugins: Map<string, ForjaPlugin> = new Map();

  register(plugin: ForjaPlugin): Result<void, PluginError> {
    if (this.plugins.has(plugin.name)) {
      return {
        success: false,
        error: new PluginError(`Plugin already registered: ${plugin.name}`, {
          code: "DUPLICATE_PLUGIN",
        }),
      };
    }
    this.plugins.set(plugin.name, plugin);
    return { success: true, data: undefined };
  }

  get(name: string): ForjaPlugin | undefined {
    return this.plugins.get(name);
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  getAll(): readonly ForjaPlugin[] {
    return Array.from(this.plugins.values());
  }

  async initAll(context: PluginContext): Promise<Result<void, PluginError>> {
    for (const plugin of this.plugins.values()) {
      const result = await plugin.init(context);
      if (!result.success) {
        return result;
      }
    }
    return { success: true, data: undefined };
  }

  async destroyAll(): Promise<Result<void, PluginError>> {
    for (const plugin of this.plugins.values()) {
      const result = await plugin.destroy();
      if (!result.success) {
        return result;
      }
    }
    return { success: true, data: undefined };
  }
}

/**
 * Middleware type for plugins
 */
export type Middleware<TRequest = unknown, TResponse = unknown> = (
  request: TRequest,
  next: () => Promise<TResponse>,
) => Promise<TResponse>;

/**
 * Plugin options validator
 */
export type OptionsValidator<T> = (options: unknown) => Result<T, PluginError>;

/**
 * Create options validator helper
 */
export function createOptionsValidator<T>(
  validator: (options: unknown) => options is T,
  errorMessage: string,
): OptionsValidator<T> {
  return (options: unknown): Result<T, PluginError> => {
    if (validator(options)) {
      return { success: true, data: options };
    }
    return {
      success: false,
      error: new PluginError(errorMessage, { code: "INVALID_OPTIONS" }),
    };
  };
}

/**
 * Schema extension definition
 */
export interface SchemaExtension {
  readonly targetSchema: string;
  readonly fields?: Record<string, FieldDefinition>;
  readonly removeFields?: readonly string[];
  readonly modifyFields?: Record<string, Partial<FieldDefinition>>;
  readonly indexes?: readonly IndexDefinition[];
}

/**
 * Schema modifier function
 */
export type SchemaModifier = (schema: SchemaDefinition) => {
  readonly fields?: Record<string, FieldDefinition>;
  readonly indexes?: readonly IndexDefinition[];
  readonly removeFields?: readonly string[];
  readonly modifyFields?: Record<string, Partial<FieldDefinition>>;
};

/**
 * Schema pattern for filtering
 */
export interface SchemaPattern {
  readonly names?: readonly string[];
  readonly prefix?: string;
  readonly suffix?: string;
  readonly exclude?: readonly string[];
  readonly custom?: (schema: SchemaDefinition) => boolean;
}

/**
 * Schema extension context
 */
export interface SchemaExtensionContext {
  readonly schemas: ReadonlyArray<SchemaDefinition>;

  extendAll(modifier: SchemaModifier): SchemaExtension[];

  extendWhere(
    predicate: (schema: SchemaDefinition) => boolean,
    modifier: SchemaModifier,
  ): SchemaExtension[];

  extendByPattern(
    pattern: SchemaPattern,
    modifier: SchemaModifier,
  ): SchemaExtension[];
}
