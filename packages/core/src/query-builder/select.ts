/**
 * SELECT Utilities
 *
 * All SELECT-related operations: merging, validation, normalization.
 */

import type { QuerySelect, SelectClause } from "../types/core/query-builder";
import type {
	DatrixEntry,
	SchemaDefinition,
	ISchemaRegistry,
} from "../types/core/schema";
import { throwInvalidFields, throwRelationInSelect } from "./error-helper";

/**
 * Normalize and validate SELECT arrays
 *
 * Complete SELECT processing pipeline:
 * 1. Merge multiple .select() calls into one
 * 2. Deduplicate using Set
 * 3. If any is "*", expand to cached fields from registry
 * 4. Validate fields exist and are not relations
 * 5. Add reserved fields (id, createdAt, updatedAt)
 * 6. Always return array (never "*")
 *
 * @param selects - Array of select clauses from multiple .select() calls
 * @param schema - Schema definition for validation
 * @param modelName - Model name for error messages and cache lookup
 * @param registry - Schema registry for wildcard expansion
 * @returns Normalized, validated field array with reserved fields
 *
 * @example
 * ```ts
 * // Multiple selects
 * normalizeSelect([['name'], ['price'], ['name']], schema, 'Product', registry)
 * // → ['name', 'price', 'id', 'createdAt', 'updatedAt']
 *
 * // Wildcard expansion
 * normalizeSelect([['name'], '*'], schema, 'Product', registry)
 * // → ['id', 'name', 'price', 'stock', 'createdAt', 'updatedAt'] (from cache)
 *
 * // Validation errors
 * normalizeSelect([['invalidField']], schema, 'Product', registry)
 * // → throws DatrixQueryBuilderError
 *
 * normalizeSelect([['category']], schema, 'Product', registry)
 * // → throws DatrixQueryBuilderError (relation field)
 * ```
 */
export function normalizeSelect<T extends DatrixEntry>(
	selects: SelectClause<T>[] | undefined,
	schema: SchemaDefinition,
	registry: ISchemaRegistry,
): QuerySelect<T> {
	// If no selects provided, return cached fields for "*"
	if (!selects || selects.length === 0) {
		return registry.getCachedSelectFields<T>(schema.name);
	}

	// 1. Flatten and deduplicate using Set (preserves insertion order)
	const allFields = new Set<keyof T>();
	for (const select of selects) {
		if (Array.isArray(select)) {
			select.forEach((field) => allFields.add(field));
		}
	}

	const fieldArray = Array.from(allFields);

	// 2. Validate fields (BEFORE wildcard check)
	// This ensures invalid fields are caught even if wildcard is present
	const invalidFields: string[] = [];
	const relationFields: string[] = [];

	for (const fieldName of fieldArray) {
		const field = schema.fields[fieldName as string];

		// Field doesn't exist in schema
		if (!field) {
			invalidFields.push(fieldName as string);
			continue;
		}

		// Field is a relation type
		if (field.type === "relation") {
			relationFields.push(fieldName as string);
		}
	}

	// Throw if validation failed
	if (invalidFields.length > 0) {
		const availableFields = Object.keys(schema.fields).filter(
			(name) => schema.fields[name]?.type !== "relation",
		);
		throwInvalidFields("select", invalidFields, availableFields);
	}

	if (relationFields.length > 0) {
		throwRelationInSelect(relationFields, schema.name);
	}

	// 3. Check for wildcard AFTER validation
	// If any select is "*", return cached fields
	if (selects.some((s) => s === "*")) {
		return registry.getCachedSelectFields<T>(schema.name);
	}

	// 4. Add reserved fields
	allFields.add("id" as keyof T);
	allFields.add("createdAt" as keyof T);
	allFields.add("updatedAt" as keyof T);

	return Array.from(allFields) as QuerySelect<T>;
}
