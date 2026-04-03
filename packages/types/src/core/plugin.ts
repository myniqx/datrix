/**
 * Plugin Interface
 *
 * This file defines the standard interface that ALL plugins must implement.
 * Plugins extend Forja's core functionality with features like auth, upload, hooks, etc.
 */

import type {
	ISchemaRegistry,
	SchemaDefinition,
	FieldDefinition,
	IndexDefinition,
	ForjaEntry,
} from "./schema";
import type { DatabaseAdapter } from "../adapter";
import type { ForjaConfig } from "../config";
import { QueryObject } from "./query-builder";
import { QueryContext } from "./query-context";

export type { SchemaDefinition } from "./schema";

/**
 * Plugin context (provided during initialization)
 */
export interface PluginContext {
	readonly adapter: DatabaseAdapter;
	readonly schemas: ISchemaRegistry;
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
	init(context: PluginContext): Promise<void>;
	destroy(): Promise<void>;

	// Schema hooks
	getSchemas?(): Promise<SchemaDefinition[]>;
	extendSchemas?(context: SchemaExtensionContext): Promise<SchemaExtension[]>;

	// Query hooks
	onSchemaLoad?(schemas: ISchemaRegistry): Promise<void>;
	onCreateQueryContext?(context: QueryContext): Promise<QueryContext>;
	onBeforeQuery?<T extends ForjaEntry>(
		query: QueryObject<T>,
		context: QueryContext,
	): Promise<QueryObject<T>>;
	onAfterQuery?<TResult extends ForjaEntry>(
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
 * Auth plugin types
 */

// Permission types are now in core/permission.ts
// Re-export for backwards compatibility
export type {
	PermissionAction,
	SchemaPermission,
	FieldPermission,
	PermissionValue,
	PermissionContext,
	PermissionFn,
} from "./permission";

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

	upload(file: UploadFile): Promise<UploadResult>;
	delete(key: string): Promise<void>;
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
 * Plugin registry
 */
export class PluginRegistry {
	private readonly plugins: Map<string, ForjaPlugin> = new Map();

	register(plugin: ForjaPlugin): void {
		if (this.plugins.has(plugin.name)) {
			throw new PluginError(`Plugin already registered: ${plugin.name}`, {
				code: "DUPLICATE_PLUGIN",
			});
		}
		this.plugins.set(plugin.name, plugin);
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

	async initAll(context: PluginContext): Promise<void> {
		for (const plugin of this.plugins.values()) {
			await plugin.init(context);
		}
	}

	async destroyAll(): Promise<void> {
		for (const plugin of this.plugins.values()) {
			await plugin.destroy();
		}
	}
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
