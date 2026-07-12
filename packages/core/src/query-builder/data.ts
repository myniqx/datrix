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
	DatrixEntry,
	ISchemaRegistry,
	AnyRelationInputObject,
} from "../types/core/schema";
import type {
	NormalizedNestedData,
	NormalizedRelationOperations,
	NormalizedRelationUpdate,
	QueryRelations,
	WhereClause,
} from "../types/core/query-builder";
import { throwInvalidField, throwInvalidValue } from "./error-helper";
import { normalizeWhere } from "./where";

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
 * IDs are numeric end-to-end (auto-increment PK policy): anything that
 * does not resolve to a valid integer id throws instead of silently
 * producing NaN/0.
 *
 * @param value - Input value (number, {id}, array of numbers/objects)
 * @param fieldName - Relation field name (for error messages)
 * @returns Array of numbers
 * @throws {DatrixQueryBuilderError} If any item is not a usable numeric id
 *
 * @example
 * ```ts
 * extractIds(5, 'tags')                          // [5]
 * extractIds([1, 2, 3], 'tags')                  // [1, 2, 3]
 * extractIds([{id: 1}, {id: 2}], 'tags')         // [1, 2]
 * extractIds({id: 5}, 'tags')                    // [5]
 * extractIds("abc", 'tags')                      // throws
 * ```
 */
function extractIds(value: unknown, fieldName: string): number[] {
	const toId = (item: unknown): number => {
		if (typeof item === "number") {
			if (!Number.isInteger(item)) {
				throwInvalidValue("data", fieldName, item, "integer id");
			}
			return item;
		}
		if (typeof item === "string") {
			const num = Number(item);
			if (item.trim() === "" || Number.isNaN(num) || !Number.isInteger(num)) {
				throwInvalidValue("data", fieldName, item, "numeric id");
			}
			return num;
		}
		if (typeof item === "object" && item !== null && "id" in item) {
			return toId((item as { id: unknown }).id);
		}
		throwInvalidValue("data", fieldName, item, "numeric id or { id } object");
	};

	if (Array.isArray(value)) {
		return value.map(toId);
	}

	return [toId(value)];
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
export function processData<T extends DatrixEntry>(
	data: Partial<T>,
	schema: SchemaDefinition,
	registry: ISchemaRegistry,
	depth: number = 0,
	visitedModels: ReadonlySet<string> = new Set(),
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

	// Check redundant nested creation (e.g. Author → Post → Author)
	if (visitedModels.has(schema.name)) {
		throwInvalidValue(
			"data",
			"redundant nested create/update",
			`${[...visitedModels, schema.name].join(" → ")}`,
			`use 'connect' instead of nesting back to '${schema.name}' — creating the same model in a nested chain is redundant`,
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

		// Case 0: null value - clear/disconnect relation
		if (value === null) {
			if (field.kind === "belongsTo") {
				// belongsTo: FK is on owner, disconnect triggers inlining FK = null
				normalized = { disconnect: [] };
			} else if (field.kind === "hasOne") {
				// hasOne: FK is on target, use set: [] to clear the relation
				normalized = { set: [] };
			} else {
				// hasMany/manyToMany: null is not allowed (prevent accidental mass deletion)
				throwInvalidValue(
					"data",
					`relation ${key}`,
					"null",
					"`[]` or `{ set: [] }` to clear all relations",
				);
			}
		}
		// Case 1: Direct ID shortcut (category: 5)
		else if (typeof value === "number" || typeof value === "string") {
			normalized = { set: extractIds(value, key) };
		}
		// Case 2: Array shortcut (tags: [1, 2, 3] or [{id: 1}, {id: 2}])
		else if (Array.isArray(value)) {
			const isRawIdArray =
				value.length === 0 || !isRelationInputObject(value[0]);
			if (isRawIdArray) {
				normalized = { set: extractIds(value, key) };
			} else {
				// Array of RelationInput objects is ambiguous — reject explicitly
				// instead of silently dropping the operations
				throwInvalidValue(
					"data",
					key,
					value,
					"an array of ids/{ id } refs, or a single relation-operations object ({ connect, set, create, ... })",
				);
			}
		}
		// Case 3: RelationInput object - normalize each operation to number arrays
		else if (typeof value === "object") {
			const relInput = value as AnyRelationInputObject;
			normalized = {};

			// Normalize connect to number array
			if (relInput.connect !== undefined) {
				normalized = {
					...normalized,
					connect: extractIds(relInput.connect, key),
				};
			}

			// Normalize disconnect to number array
			// Special case: disconnect: true for hasOne/belongsTo means "clear this relation"
			if (relInput.disconnect !== undefined) {
				if (relInput.disconnect === true) {
					if (field.kind === "hasOne") {
						normalized = { ...normalized, set: [] };
					} else {
						normalized = { ...normalized, disconnect: [] };
					}
				} else {
					normalized = {
						...normalized,
						disconnect: extractIds(relInput.disconnect, key),
					};
				}
			}

			// Normalize set to number array
			if (relInput.set !== undefined) {
				normalized = { ...normalized, set: extractIds(relInput.set, key) };
			}

			// Normalize delete to number array
			if (relInput.delete !== undefined) {
				normalized = {
					...normalized,
					delete: extractIds(relInput.delete, key),
				};
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

				const nextVisited = new Set([...visitedModels, schema.name]);

				// Handle array of creates
				if (Array.isArray(relInput.create)) {
					normalized = {
						...normalized,
						create: relInput.create.map((item) =>
							processData<T>(
								item as Partial<T>,
								targetSchema,
								registry,
								depth + 1,
								nextVisited,
							),
						),
					};
				} else {
					// Single create
					normalized = {
						...normalized,
						create: [
							processData(
								relInput.create as Partial<T>,
								targetSchema,
								registry,
								depth + 1,
								nextVisited,
							),
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

				const nextVisited = new Set([...visitedModels, schema.name]);

				// Validate + normalize the nested where against the TARGET schema —
				// it flows to the adapter and must never carry raw field names
				const normalizeUpdateWhere = (whereClause: unknown): WhereClause<T> => {
					if (
						typeof whereClause !== "object" ||
						whereClause === null ||
						Object.keys(whereClause).length === 0
					) {
						throwInvalidValue(
							"data",
							`relation ${key}.update.where`,
							whereClause,
							"a non-empty where clause",
						);
					}
					return normalizeWhere(
						[whereClause as WhereClause<T>],
						targetSchema,
						registry,
					)!;
				};

				const updateItems = Array.isArray(relInput.update)
					? relInput.update
					: [relInput.update];

				normalized = {
					...normalized,
					update: updateItems.map((item) => {
						const whereClause = normalizeUpdateWhere(item.where);
						const updateData = item.data as Partial<T>;
						const processed = processData<T>(
							updateData,
							targetSchema,
							registry,
							depth + 1,
							nextVisited,
						);
						return {
							where: whereClause,
							...processed,
						} satisfies NormalizedRelationUpdate<T>;
					}),
				};
			}
		} else {
			// Fallback (shouldn't happen)
			normalized = {};
		}

		// Singular relations (belongsTo/hasOne) can only reference one record total
		if (field.kind === "belongsTo" || field.kind === "hasOne") {
			const totalRefs =
				(normalized.connect?.length ?? 0) +
				(normalized.set?.length ?? 0) +
				(normalized.create?.length ?? 0);

			if (totalRefs > 1) {
				throwInvalidValue(
					"data",
					`relation ${key} (${field.kind})`,
					`${totalRefs} references`,
					`a single reference — ${field.kind} can only reference one record`,
				);
			}
		}

		// Inline foreign keys for belongsTo only
		// hasOne FK is on TARGET table, not on owner - cannot inline into owner's scalars
		if (field.kind === "belongsTo") {
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
		} else if (field.kind === "hasOne") {
			// hasOne: FK is on TARGET table
			// User cannot directly set the relation by passing ID to owner
			// Instead, target record must be created/updated with owner's ID
			// Keep as async relation for create/update operations
			normalizedRelations[key] = normalized;
		} else {
			// hasMany or manyToMany - cannot inline, always async
			normalizedRelations[key] = normalized;
		}
	}

	return {
		data: scalars as Partial<T>,
		relations:
			Object.keys(normalizedRelations).length > 0
				? (normalizedRelations as unknown as QueryRelations<T>)
				: undefined,
	};
}
