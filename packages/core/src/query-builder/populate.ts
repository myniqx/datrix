/**
 * POPULATE Utilities
 *
 * All POPULATE-related operations: normalization, validation.
 * Handles relation loading, nested populates, dot notation, wildcard expansion.
 */

import type {
	PopulateClause,
	PopulateOptions,
	QueryPopulate,
} from "../types/core/query-builder";
import type {
	DatrixEntry,
	RelationField,
	SchemaDefinition,
	ISchemaRegistry,
} from "../types/core/schema";
import { throwInvalidField, throwInvalidValue } from "./error-helper";
import { normalizeSelect } from "./select";

/**
 * Maximum nesting depth for populate clauses to prevent stack overflow
 */
const MAX_POPULATE_DEPTH = 5;

/**
 * Normalize and validate POPULATE clause
 *
 * Complete POPULATE processing pipeline:
 * 1. Handle wildcard '*' → expand to all relations
 * 2. Handle dot notation array → convert to nested object
 * 3. Handle object format → validate and normalize
 * 4. Recursively process nested populates
 * 5. Validate relation fields exist
 * 6. Check max depth limit
 *
 * @param populate - Raw POPULATE clause from user
 * @param modelName - Model name
 * @param registry - Schema registry for field expansion and validation
 * @returns Normalized POPULATE clause
 * @throws {Error} If validation fails
 *
 * @example
 * ```ts
 * // Wildcard or true - all relations (both are equivalent)
 * normalizePopulate('*', 'Post', registry)
 * normalizePopulate(true, 'Post', registry)
 * // → { author: { select: [...] }, category: { select: [...] } }
 *
 * // Dot notation array
 * normalizePopulate(['category', 'author.company'], 'Post', registry)
 * // → {
 * //   category: { select: [...] },
 * //   author: { populate: { company: { select: [...] } } }
 * // }
 *
 * // Object notation with true or '*' (both are equivalent)
 * normalizePopulate({ author: true }, 'Post', registry)
 * normalizePopulate({ author: '*' }, 'Post', registry)
 * // → { author: { select: ['id', 'name', ...] } }
 *
 * // Validation errors
 * normalizePopulate({ invalidField: true }, 'Post', registry)
 * // → throws Error: Field 'invalidField' does not exist
 *
 * normalizePopulate({ title: true }, 'Post', registry)
 * // → throws Error: Cannot populate non-relation field 'title'
 * ```
 */
export function normalizePopulate<T extends DatrixEntry>(
	populate: PopulateClause<T> | undefined,
	modelName: string,
	registry: ISchemaRegistry,
	depth = 0,
): PopulateClause<T> | undefined {
	if (!populate) {
		return undefined;
	}

	if (depth > MAX_POPULATE_DEPTH) {
		throwInvalidValue(
			"populate",
			modelName,
			depth,
			`maximum nesting depth of ${MAX_POPULATE_DEPTH}`,
		);
	}

	const schema = registry.get(modelName);
	if (!schema) {
		throwInvalidValue("populate", "modelName", modelName, "valid model name");
	}

	// Handle wildcard '*' or true - populate all first-level relations
	if (populate === "*" || populate === true) {
		const allRelations: Record<string, object> = {};
		for (const [fieldName, field] of Object.entries(schema.fields)) {
			if (field.type === "relation") {
				const relationField = field as RelationField;
				allRelations[fieldName] = {
					select: registry.getCachedSelectFields(relationField.model),
				};
			}
		}
		return allRelations as PopulateClause<T>;
	}

	// Handle array format - dot notation ['category', 'author.company']
	if (Array.isArray(populate)) {
		return normalizePopulateDotNotation(populate, schema, modelName, registry);
	}

	// Handle object format
	const result: Record<string, object> = {};

	for (const [relationName, value] of Object.entries(populate)) {
		const field = schema.fields[relationName];

		// Field doesn't exist - throw error (typo detection)
		if (!field) {
			const availableRelations = Object.entries(schema.fields)
				.filter(([_, f]) => f.type === "relation")
				.map(([name]) => name);

			throwInvalidField("populate", relationName, availableRelations);
		}

		// Field exists but is not a relation - throw error
		if (field.type !== "relation") {
			throwInvalidValue("populate", relationName, field.type, "relation");
		}

		const relationField = field as RelationField;
		const targetModel = relationField.model;

		if (typeof value === "boolean" || value === "*") {
			// populate[category]=true or populate[category]='*' → convert to { select: [...] }
			result[relationName] = {
				select: registry.getCachedSelectFields(targetModel),
			};
		} else if (typeof value === "object" && value !== null) {
			// populate[category]={ select: [...], populate: {...} }
			result[relationName] = {
				...value,
				// Normalize select for this level (if provided)
				select: normalizeSelect(
					value.select !== undefined ? [value.select] : undefined,
					registry.get(targetModel)!,
					registry,
				),
				// Recursively process nested populate
				populate: value.populate
					? normalizePopulate(value.populate, targetModel, registry, depth + 1)
					: undefined,
			};
		} else {
			throwInvalidValue(
				"populate",
				relationName,
				value,
				"boolean | object | '*'",
			);
		}
	}

	return result as PopulateClause<T>;
}

/**
 * Normalize array-based populate with dot notation
 *
 * Internal helper for normalizePopulate.
 * Converts ['category', 'author.company', 'author.posts'] to nested object format.
 *
 * @param paths - Array of relation paths (dot notation)
 * @param schema - Current schema
 * @param modelName - Model name for error messages
 * @param registry - Schema registry
 * @returns Normalized populate object
 */
function normalizePopulateDotNotation<T extends DatrixEntry>(
	paths: readonly string[],
	schema: SchemaDefinition,
	_modelName: string,
	registry: ISchemaRegistry,
): PopulateClause<T> {
	const result: Record<string, any> = {};

	for (const path of paths) {
		const parts = path.split(".");
		const firstPart = parts[0]!;

		// Validate that first part is a relation field
		const field = schema.fields[firstPart];

		// Field doesn't exist
		if (!field) {
			const availableRelations = Object.entries(schema.fields)
				.filter(([_, f]) => f.type === "relation")
				.map(([name]) => name);

			throwInvalidField("populate", firstPart, availableRelations);
		}

		// Field exists but is not a relation
		if (field.type !== "relation") {
			throwInvalidValue("populate", firstPart, field.type, "relation");
		}

		const relationField = field as RelationField;
		const targetModel = relationField.model;

		if (parts.length === 1) {
			// Simple path: 'category' → { category: { select: [...] } }
			result[firstPart] = {
				select: registry.getCachedSelectFields(targetModel),
			};
		} else {
			// Nested path: 'author.company' → { author: { populate: { company: { select: [...] } } } }
			const nestedPath = parts.slice(1).join(".");

			if (!result[firstPart]) {
				result[firstPart] = {
					select: registry.getCachedSelectFields(targetModel),
					populate: {},
				};
			}

			if (!result[firstPart].populate) {
				result[firstPart].populate = {};
			}

			// Recursively normalize the nested path
			const targetSchema = registry.get(targetModel);
			if (targetSchema) {
				const nested = normalizePopulateDotNotation(
					[nestedPath],
					targetSchema,
					targetModel,
					registry,
				);
				// Merge nested populate
				Object.assign(result[firstPart].populate, nested);
			}
		}
	}

	return result;
}

/**
 * Normalize and merge POPULATE arrays
 *
 * Complete POPULATE processing pipeline for multiple .populate() calls:
 * 1. Normalize each populate clause (expand wildcards, validate, etc.)
 * 2. Merge all normalized results
 *
 * @param populates - Array of populate clauses from multiple .populate() calls
 * @param modelName - Model name for validation and normalization
 * @param registry - Schema registry
 * @returns Final normalized and merged populate clause
 *
 * @example
 * ```ts
 * // Multiple populate calls accumulated in array
 * const populates = [
 *   { author: true },
 *   { category: { select: ['name'] } }
 * ];
 *
 * const normalized = normalizePopulateArray(populates, 'Post', registry);
 * // → { author: { select: [...] }, category: { select: ['name'] } }
 * ```
 */
export function normalizePopulateArray<T extends DatrixEntry>(
	populates: PopulateClause<T>[] | undefined,
	modelName: string,
	registry: ISchemaRegistry,
): QueryPopulate<T> | undefined {
	if (!populates || populates.length === 0) {
		return undefined;
	}

	// Normalize each populate clause
	const normalized: PopulateClause<T>[] = [];
	for (const populate of populates) {
		const result = normalizePopulate(populate, modelName, registry);
		if (result) {
			normalized.push(result);
		}
	}

	// Merge all normalized populates
	if (normalized.length === 0) {
		return undefined;
	}

	return mergePopulateClauses(...normalized) as QueryPopulate<T>;
}

/**
 * Merge populate clauses
 *
 * Used internally by normalizePopulateArray when merging multiple .populate() calls.
 */
export function mergePopulateClauses<T extends DatrixEntry>(
	...clauses: readonly (PopulateClause<T> | undefined)[]
): QueryPopulate<T> {
	const merged: Record<string, PopulateOptions<T> | "*" | true> = {};

	for (const clause of clauses) {
		if (!clause) continue;

		for (const [relation, options] of Object.entries(clause)) {
			// If either is '*' or true, use it
			if (
				options === "*" ||
				options === true ||
				merged[relation] === "*" ||
				merged[relation] === true
			) {
				merged[relation] = options === true ? true : "*";
			} else if (merged[relation]) {
				// Merge options (both are objects)
				const existing = merged[relation] as PopulateOptions<T>;
				const newOptions = options as PopulateOptions<T>;
				const mergedOptions = {
					...(newOptions.select !== undefined || existing.select !== undefined
						? { select: newOptions.select || existing.select }
						: {}),
					...(newOptions.where !== undefined || existing.where !== undefined
						? { where: newOptions.where || existing.where }
						: {}),
					...(newOptions.populate !== undefined ||
					existing.populate !== undefined
						? {
								populate: newOptions.populate
									? mergePopulateClauses(existing.populate, newOptions.populate)
									: existing.populate,
							}
						: {}),
					...(newOptions.limit !== undefined || existing.limit !== undefined
						? { limit: newOptions.limit ?? existing.limit }
						: {}),
					...(newOptions.offset !== undefined || existing.offset !== undefined
						? { offset: newOptions.offset ?? existing.offset }
						: {}),
					...(newOptions.orderBy !== undefined || existing.orderBy !== undefined
						? { orderBy: newOptions.orderBy || existing.orderBy }
						: {}),
				};
				merged[relation] = mergedOptions as PopulateOptions<T>;
			} else {
				merged[relation] = options;
			}
		}
	}

	return merged as QueryPopulate<T>;
}
