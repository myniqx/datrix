/**
 * Schema Extension Context Implementation
 *
 * Provides helper methods for plugins to extend schemas in bulk.
 */

import type {
	SchemaDefinition,
	SchemaExtension,
	SchemaExtensionContext,
	SchemaModifier,
	SchemaPattern,
} from "@forja/types/plugin";

export class SchemaExtensionContextImpl implements SchemaExtensionContext {
	constructor(public readonly schemas: ReadonlyArray<SchemaDefinition>) {}

	extendAll(modifier: SchemaModifier): SchemaExtension[] {
		return this.schemas.map((schema) => ({
			targetSchema: schema.name,
			...modifier(schema),
		}));
	}

	extendWhere(
		predicate: (schema: SchemaDefinition) => boolean,
		modifier: SchemaModifier,
	): SchemaExtension[] {
		return this.schemas.filter(predicate).map((schema) => ({
			targetSchema: schema.name,
			...modifier(schema),
		}));
	}

	extendByPattern(
		pattern: SchemaPattern,
		modifier: SchemaModifier,
	): SchemaExtension[] {
		return this.schemas
			.filter((schema) => this.matchesPattern(schema, pattern))
			.map((schema) => ({
				targetSchema: schema.name,
				...modifier(schema),
			}));
	}

	private matchesPattern(
		schema: SchemaDefinition,
		pattern: SchemaPattern,
	): boolean {
		if (pattern.names && !pattern.names.includes(schema.name)) {
			return false;
		}

		if (pattern.prefix && !schema.name.startsWith(pattern.prefix)) {
			return false;
		}

		if (pattern.suffix && !schema.name.endsWith(pattern.suffix)) {
			return false;
		}

		if (pattern.exclude?.includes(schema.name)) {
			return false;
		}

		if (pattern.custom && !pattern.custom(schema)) {
			return false;
		}

		return true;
	}
}
