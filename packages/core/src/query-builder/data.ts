/**
 * Data Normalization and Splitting for Query Builder
 *
 * This module handles:
 * 1. Single-pass field separation (scalars vs relations)
 * 2. Field existence validation
 * 3. Relation shortcut normalization (5 → { connect: [{ id: 5 }] })
 * 4. Foreign key inlining (belongsTo/hasOne)
 * 5. Recursive create/update normalization (with depth limit)
 *
 * These functions are used in QueryBuilder.build() to process INSERT/UPDATE data.
 */

import {
	SchemaDefinition,
	RelationField,
	RelationInput,
	ForjaEntry,
	SchemaRegistry,
} from "forja-types/core/schema";
import type {
	NormalizedNestedData,
	NormalizedRelationOperations,
	NormalizedRelationUpdate,
} from "forja-types/core/query-builder";
import { throwInvalidField, throwInvalidValue } from "./error-helper";

/**
 * Maximum depth for nested create/update operations
 * Prevents infinite recursion and stack overflow
 */
const MAX_NESTED_DEPTH = 5;

/**
 * Check if value is a RelationInput object (has connect/disconnect/set/etc)
 * vs a raw ID reference
 *
 * @param value - Value to check
 * @returns True if value is a RelationInput object
 *
 * @example
 * ```ts
 * isRelationInputObject({ connect: { id: 5 } })  // true
 * isRelationInputObject({ id: 5 })               // false (raw ref)
 * isRelationInputObject(5)                       // false
 * ```
 */
function isRelationInputObject(value: unknown): boolean {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	// If it has 'id' property directly, it's a raw { id } ref, not RelationInput
	if ("id" in value && !("connect" in value || "set" in value)) {
		return false;
	}
	// Check for RelationInput keys
	return (
		"connect" in value ||
		"disconnect" in value ||
		"set" in value ||
		"create" in value ||
		"update" in value ||
		"delete" in value
	);
}

/**
 * Extract IDs from various formats and convert to number array
 *
 * @param value - Input value (number, {id}, array of numbers/objects)
 * @returns Array of numbers
 *
 * @example
 * ```ts
 * extractIds(5)                          // [5]
 * extractIds([1, 2, 3])                  // [1, 2, 3]
 * extractIds([{id: 1}, {id: 2}])         // [1, 2]
 * extractIds({id: 5})                    // [5]
 * ```
 */
function extractIds(value: unknown): number[] {
	// Single number
	if (typeof value === "number") {
		return [value];
	}

	// Single string (convert to number)
	if (typeof value === "string") {
		return [Number(value)];
	}

	// Single object with id
	if (typeof value === "object" && value !== null && "id" in value) {
		const id = (value as { id: string | number }).id;
		return [typeof id === "number" ? id : Number(id)];
	}

	// Array
	if (Array.isArray(value)) {
		return value.map((item) => {
			if (typeof item === "number") {
				return item;
			}
			if (typeof item === "string") {
				return Number(item);
			}
			if (typeof item === "object" && item !== null && "id" in item) {
				const id = (item as { id: string | number }).id;
				return typeof id === "number" ? id : Number(id);
			}
			return 0; // Fallback
		});
	}

	return [];
}

/**
 * Process data for INSERT/UPDATE operations
 *
 * Single-pass optimized algorithm:
 * 1. Loop through data keys once
 * 2. Accumulate: scalars, relations, invalid fields
 * 3. Throw if any invalid fields found
 * 4. Normalize relations (shortcuts → RelationInput with number arrays)
 * 5. Recursively process create/update operations (with depth limit)
 * 6. Inline belongsTo/hasOne foreign keys into scalars
 * 7. Return separated data
 *
 * @param data - Raw data from user
 * @param schema - Schema definition
 * @param modelName - Model name (for error messages)
 * @param registry - Schema registry (for recursive processing of create/update)
 * @param depth - Current recursion depth (internal, default 0)
 * @returns Processed data with separated scalars and relations
 *
 * @example
 * ```ts
 * const result = processData(
 *   { name: 'Post 1', author: 5, tags: [1, 2, 3], invalidField: 'x' },
 *   postSchema,
 *   'Post',
 *   registry
 * );
 * // Throws: Invalid field 'invalidField' in data clause
 *
 * const result2 = processData(
 *   { name: 'Post 1', author: 5, tags: [1, 2, 3] },
 *   postSchema,
 *   'Post',
 *   registry
 * );
 * // Result:
 * // {
 * //   data: { name: 'Post 1', authorId: 5 },
 * //   relations: { tags: { set: [1, 2, 3] } }
 * // }
 *
 * const result3 = processData(
 *   {
 *     name: 'Post 1',
 *     author: {
 *       create: { name: 'John', company: { create: { name: 'Acme' } } }
 *     }
 *   },
 *   postSchema,
 *   'Post',
 *   registry
 * );
 * // Result (recursive processing):
 * // {
 * //   data: { name: 'Post 1' },
 * //   relations: {
 * //     author: {
 * //       create: {
 * //         data: { name: 'John' },
 * //         relations: {
 * //           company: {
 * //             create: { data: { name: 'Acme' }, relations: undefined }
 * //           }
 * //         }
 * //       }
 * //     }
 * //   }
 * // }
 * ```
 */
export function processData<T extends ForjaEntry>(
	data: Partial<T>,
	schema: SchemaDefinition,
	registry: SchemaRegistry,
	depth: number = 0,
): NormalizedNestedData<T> {
	// Check max depth
	if (depth > MAX_NESTED_DEPTH) {
		throwInvalidValue(
			"data",
			"nested depth",
			depth,
			`maximum ${MAX_NESTED_DEPTH} levels of nesting`,
		);
	}
	const scalars: Record<string, unknown> = {};
	const rawRelations: Record<string, unknown> = {};
	const invalidFields: string[] = [];

	// STEP 1: Single-pass separation (scalars vs relations) + collect invalid fields
	for (const [key, value] of Object.entries(data)) {
		const field = schema.fields[key];

		// Unknown field
		if (!field) {
			invalidFields.push(key);
			continue;
		}

		// Relation field
		if (field.type === "relation") {
			rawRelations[key] = value;
		} else {
			// Scalar field
			scalars[key] = value;
		}
	}

	// STEP 2: Throw if any invalid fields found
	if (invalidFields.length > 0) {
		const availableFields = Object.keys(schema.fields);
		throwInvalidField("data", invalidFields[0]!, availableFields);
	}

	// STEP 3: Normalize relations and inline foreign keys
	const normalizedRelations: Record<
		string,
		NormalizedRelationOperations<T>
	> = {};

	for (const [key, value] of Object.entries(rawRelations)) {
		const field = schema.fields[key] as RelationField;

		// Normalize relation shortcuts to NormalizedRelationOperations
		let normalized: NormalizedRelationOperations<T>;

		// Case 1: Direct ID shortcut (category: 5)
		if (typeof value === "number" || typeof value === "string") {
			normalized = { set: extractIds(value) };
		}
		// Case 2: Array shortcut (tags: [1, 2, 3] or [{id: 1}, {id: 2}])
		else if (Array.isArray(value)) {
			const isRawIdArray =
				value.length === 0 || !isRelationInputObject(value[0]);
			if (isRawIdArray) {
				normalized = { set: extractIds(value) };
			} else {
				// Already RelationInput array, needs processing
				normalized = {};
			}
		}
		// Case 3: RelationInput object - normalize each operation to number arrays
		else if (typeof value === "object" && value !== null) {
			const relInput = value as RelationInput<T>;
			normalized = {};

			// Normalize connect to number array
			if (relInput.connect !== undefined) {
				normalized = { ...normalized, connect: extractIds(relInput.connect) };
			}

			// Normalize disconnect to number array
			if (relInput.disconnect !== undefined) {
				normalized = {
					...normalized,
					disconnect: extractIds(relInput.disconnect),
				};
			}

			// Normalize set to number array
			if (relInput.set !== undefined) {
				normalized = { ...normalized, set: extractIds(relInput.set) };
			}

			// Normalize delete to number array
			if (relInput.delete !== undefined) {
				normalized = { ...normalized, delete: extractIds(relInput.delete) };
			}

			// Recursively process create operations
			if (relInput.create !== undefined) {
				const targetSchema = registry.get(field.model);
				if (!targetSchema) {
					throwInvalidValue(
						"data",
						`relation ${key}`,
						field.model,
						"valid model",
					);
				}

				// Handle array of creates
				if (Array.isArray(relInput.create)) {
					normalized = {
						...normalized,
						create: relInput.create.map((item) =>
							processData(item, targetSchema, registry, depth + 1),
						),
					};
				} else {
					// Single create
					normalized = {
						...normalized,
						create: [
							processData(relInput.create, targetSchema, registry, depth + 1),
						],
					};
				}
			}

			// Recursively process update operations
			if (relInput.update !== undefined) {
				const targetSchema = registry.get(field.model);
				if (!targetSchema) {
					throwInvalidValue(
						"data",
						`relation ${key}`,
						field.model,
						"valid model",
					);
				}

				// Handle array of updates
				if (Array.isArray(relInput.update)) {
					normalized = {
						...normalized,
						update: relInput.update.map((item) => {
							const whereClause = item.where;
							const updateData = item.data;
							const processed = processData(
								updateData,
								targetSchema,
								registry,
								depth + 1,
							);
							return {
								where: whereClause,
								...processed,
							} satisfies NormalizedRelationUpdate<T>;
						}),
					};
				} else {
					// Single update
					const whereClause = relInput.update.where;
					const updateData = relInput.update.data;
					const processed = processData(
						updateData,
						targetSchema,
						registry,
						depth + 1,
					);
					normalized = {
						...normalized,
						update: [
							{
								where: whereClause,
								...processed,
							} satisfies NormalizedRelationUpdate<T>,
						],
					};
				}
			}
		} else {
			// Fallback (shouldn't happen)
			normalized = {};
		}

		// Inline foreign keys for belongsTo/hasOne
		if (field.kind === "belongsTo" || field.kind === "hasOne") {
			const foreignKey = field.foreignKey!;
			let inlinedId: number | null | undefined = undefined;

			if (normalized.connect) {
				const ids = normalized.connect;
				inlinedId = ids[0] ?? null;
			} else if (normalized.set) {
				const ids = normalized.set;
				inlinedId = ids[0] ?? null;
			} else if (normalized.disconnect) {
				inlinedId = null;
			}

			if (inlinedId !== undefined) {
				// Inline FK into scalars
				scalars[foreignKey] = inlinedId;

				// Keep in relations only if there are other operations (create/update/delete)
				const hasOtherOps =
					normalized.create || normalized.update || normalized.delete;
				if (hasOtherOps) {
					normalizedRelations[key] = normalized;
				}
				// Otherwise, skip (FK already inlined, no async work needed)
			} else {
				// Cannot inline (e.g., only create/update/delete), keep as async relation
				normalizedRelations[key] = normalized;
			}
		} else {
			// hasMany or manyToMany - cannot inline, always async
			normalizedRelations[key] = normalized;
		}
	}

	return {
		data: scalars as Partial<T>,
		relations:
			Object.keys(normalizedRelations).length > 0
				? normalizedRelations
				: undefined,
	};
}
