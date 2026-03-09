/**
 * Abstract Base Plugin
 *
 * Provides a base implementation for plugins with common functionality.
 * Plugins can extend this class instead of implementing ForjaPlugin from scratch.
 */

import { QueryObject } from "forja-types/core/query-builder";
import {
	SchemaRegistry,
	SchemaDefinition,
	ForjaEntry,
} from "forja-types/core/schema";
import {
	ForjaPlugin,
	PluginContext,
	PluginError,
	SchemaExtensionContext,
	SchemaExtension,
	QueryContext,
} from "forja-types/plugin";

/**
 * Abstract base plugin class
 *
 * Provides default implementations for optional hooks.
 * Subclasses must implement init() and destroy() methods.
 */
export abstract class BasePlugin<
	TOptions = Record<string, unknown>,
> implements ForjaPlugin<TOptions> {
	abstract readonly name: string;
	abstract readonly version: string;
	readonly options: TOptions;

	protected context: PluginContext | undefined;

	constructor(options: TOptions) {
		this.options = options;
	}

	/**
	 * Initialize the plugin
	 *
	 * Must be implemented by subclasses
	 */
	abstract init(context: PluginContext): Promise<void>;

	/**
	 * Destroy the plugin and cleanup resources
	 *
	 * Must be implemented by subclasses
	 */
	abstract destroy(): Promise<void>;

	/**
	 * Get plugin schemas
	 *
	 * Default implementation returns empty array
	 */
	async getSchemas(): Promise<SchemaDefinition[]> {
		return [];
	}

	/**
	 * Extend existing schemas
	 *
	 * Default implementation returns empty array
	 */
	async extendSchemas(
		_context: SchemaExtensionContext,
	): Promise<SchemaExtension[]> {
		return [];
	}

	/**
	 * Hook called when schemas are loaded
	 *
	 * Default implementation does nothing
	 */
	async onSchemaLoad(_schemas: SchemaRegistry): Promise<void> {
		// Default: no-op
	}

	/**
	 * Hook called before query execution
	 *
	 * Default implementation returns query unchanged
	 */
	async onBeforeQuery<T extends ForjaEntry>(
		query: QueryObject<T>,
		_context: QueryContext,
	): Promise<QueryObject<T>> {
		return query;
	}

	/**
	 * Hook called after query execution
	 *
	 * Default implementation returns result unchanged
	 */
	async onAfterQuery<TResult extends ForjaEntry>(
		result: TResult,
		_context: QueryContext,
	): Promise<TResult> {
		return result;
	}

	/**
	 * Hook called when creating query context
	 *
	 * Default implementation returns context unchanged
	 */
	async onCreateQueryContext(context: QueryContext): Promise<QueryContext> {
		return context;
	}

	/**
	 * Validate plugin options
	 *
	 * Helper method for subclasses to implement options validation
	 */
	protected validateOptions(
		validator: (options: unknown) => options is TOptions,
		errorMessage: string,
	): TOptions {
		if (validator(this.options)) {
			return this.options;
		}

		throw new PluginError(errorMessage, {
			code: "INVALID_OPTIONS",
			pluginName: this.name,
			details: this.options,
		});
	}

	/**
	 * Check if plugin is initialized
	 *
	 * Helper method to ensure init() was called
	 */
	protected isInitialized(): this is this & {
		context: PluginContext;
	} {
		return this.context !== undefined;
	}

	/**
	 * Get context or return error
	 *
	 * Helper method to safely access context
	 */
	protected getContext(): PluginContext {
		if (this.context === undefined) {
			throw new PluginError(`Plugin ${this.name} not initialized`, {
				code: "PLUGIN_NOT_INITIALIZED",
				pluginName: this.name,
			});
		}
		return this.context;
	}

	/**
	 * Create a plugin error
	 *
	 * Helper method to create properly formatted errors
	 */
	protected createError(
		message: string,
		code: string,
		details?: unknown,
	): PluginError {
		return new PluginError(message, {
			code,
			pluginName: this.name,
			details,
		});
	}
}
