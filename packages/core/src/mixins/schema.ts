/**
 * Schema Helpers Mixin
 *
 * Provides convenient access to schema registry and schema metadata.
 */

import { SchemaRegistry, SchemaDefinition } from "forja-types/core/schema";

/**
 * Schema Helpers Class
 *
 * Provides convenient methods for accessing and querying schemas.
 */
export class SchemaHelpers {
	constructor(private readonly schemas: SchemaRegistry) {}

	/**
	 * Get a specific schema by name
	 *
	 * @param name - Schema name
	 * @returns Schema definition or null if not found
	 *
	 * @example
	 * ```ts
	 * const userSchema = schema.get('User');
	 * if (userSchema) {
	 *   console.log(userSchema.fields);
	 * }
	 * ```
	 */
	get(name: string): SchemaDefinition | null {
		return this.schemas.get(name) ?? null;
	}

	/**
	 * Get all registered schemas
	 *
	 * @returns Array of all schema definitions
	 *
	 * @example
	 * ```ts
	 * const allSchemas = schema.getAll();
	 * allSchemas.forEach(s => console.log(s.name));
	 * ```
	 */
	getAll(): readonly SchemaDefinition[] {
		return this.schemas.getAll();
	}

	/**
	 * Check if a schema exists
	 *
	 * @param name - Schema name
	 * @returns True if schema is registered
	 *
	 * @example
	 * ```ts
	 * if (schema.has('User')) {
	 *   // User schema exists
	 * }
	 * ```
	 */
	has(name: string): boolean {
		return this.schemas.has(name);
	}

	/**
	 * Get number of registered schemas
	 *
	 * @returns Total count of schemas
	 *
	 * @example
	 * ```ts
	 * console.log(`Total schemas: ${schema.count()}`);
	 * ```
	 */
	count(): number {
		return this.schemas.size;
	}

	/**
	 * Get schema names
	 *
	 * @returns Array of all schema names
	 *
	 * @example
	 * ```ts
	 * const names = schema.names();
	 * // ['User', 'Post', 'Comment']
	 * ```
	 */
	names(): string[] {
		return this.getAll().map((s) => s.name);
	}

	/**
	 * Find schemas by criteria
	 *
	 * @param predicate - Filter function
	 * @returns Matching schemas
	 *
	 * @example
	 * ```ts
	 * // Find schemas with timestamps enabled
	 * const withTimestamps = schema.find(s => s.timestamps === true);
	 * ```
	 */
	find(
		predicate: (schema: SchemaDefinition) => boolean,
	): readonly SchemaDefinition[] {
		return this.getAll().filter(predicate);
	}
}
