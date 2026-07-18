/**
 * OrderBy Normalizer
 *
 * Converts OrderByClause input formats to normalized QueryOrderBy.
 *
 * Supported input formats:
 * 1. Full format: [{ field: "age", direction: "asc", nulls: "last" }]
 * 2. Object shortcut: { age: "asc" }
 * 3. String array: ["age", "-name"] (- prefix = desc)
 */

import type {
	OrderByClause,
	QueryOrderBy,
	OrderByItem,
	OrderDirection,
	FallbackOrderByItem,
} from "../types/core/query-builder";
import type { DatrixEntry, SchemaDefinition } from "../types/core/schema";
import { throwInvalidField, throwInvalidValue } from "./error-helper";

/**
 * Check if input is already normalized (array of OrderByItem)
 */
function isQueryOrderBy(input: unknown): boolean {
	if (!Array.isArray(input)) return false;
	if (input.length === 0) return true;

	const first = input[0];
	return (
		typeof first === "object" &&
		first !== null &&
		"field" in first &&
		"direction" in first
	);
}

/**
 * Check if input is object shortcut format
 * { age: "asc", name: "desc" }
 */
function isObjectShortcut(input: unknown): boolean {
	if (Array.isArray(input)) return false;
	if (typeof input !== "object" || input === null) return false;

	const values = Object.values(input);
	return values.every((v) => v === "asc" || v === "desc");
}

/**
 * Check if input is string array format
 * ["age", "-name"]
 */
function isStringArray(input: unknown): boolean {
	if (!Array.isArray(input)) return false;
	if (input.length === 0) return false;

	return input.every((item) => typeof item === "string");
}

/**
 * Normalize OrderByClause to QueryOrderBy
 *
 * @param input - OrderByClause in any supported format
 * @returns Normalized QueryOrderBy array
 *
 * @example
 * ```ts
 * // Full format (passthrough)
 * normalizeOrderBy([{ field: "age", direction: "asc" }])
 * // → [{ field: "age", direction: "asc" }]
 *
 * // Object shortcut
 * normalizeOrderBy({ age: "asc" })
 * // → [{ field: "age", direction: "asc" }]
 *
 * // String array
 * normalizeOrderBy(["age", "-name"])
 * // → [{ field: "age", direction: "asc" }, { field: "name", direction: "desc" }]
 * ```
 */
export function normalizeOrderBy<T extends DatrixEntry>(
	input: OrderByClause<T> | undefined,
): QueryOrderBy<T> | undefined {
	if (input === undefined || input === null) {
		return undefined;
	}

	// Already normalized
	if (isQueryOrderBy(input)) {
		return input as QueryOrderBy<T>;
	}

	// Object shortcut: { age: "asc" }
	if (isObjectShortcut(input)) {
		const result: OrderByItem<T>[] = [];
		for (const [field, direction] of Object.entries(input)) {
			result.push({
				field: field as keyof T,
				direction: direction as OrderDirection,
			});
		}
		return result as QueryOrderBy<T>;
	}

	// String array: ["age", "-name"]
	if (isStringArray(input)) {
		return (input as string[]).map((item) => {
			const str = item as string;
			if (str.startsWith("-")) {
				return {
					field: str.slice(1) as keyof T,
					direction: "desc" as OrderDirection,
				};
			}
			return {
				field: str as keyof T,
				direction: "asc" as OrderDirection,
			};
		}) as QueryOrderBy<T>;
	}

	// Unknown format, return as-is (validateOrderBy will reject it)
	return input as QueryOrderBy<T>;
}

/**
 * Validate a normalized orderBy against the schema
 *
 * Field names are SQL identifiers that adapters cannot parameterize,
 * so every field must be whitelisted against the schema here.
 *
 * @param orderBy - Normalized orderBy (output of normalizeOrderBy)
 * @param schema - Schema definition to validate fields against
 * @throws {DatrixQueryBuilderError} If an item is malformed or references
 *   an unknown/relation field
 */
export function validateOrderBy<T extends DatrixEntry>(
	orderBy: QueryOrderBy<T> | undefined,
	schema: SchemaDefinition,
): void {
	if (orderBy === undefined) {
		return;
	}

	if (!Array.isArray(orderBy)) {
		throwInvalidValue(
			"orderBy",
			"orderBy",
			orderBy,
			"array of { field, direction } items",
		);
	}

	for (const item of orderBy) {
		if (
			typeof item !== "object" ||
			item === null ||
			typeof (item as FallbackOrderByItem).field !== "string"
		) {
			throwInvalidValue(
				"orderBy",
				"orderBy",
				item,
				"{ field, direction } object",
			);
		}

		const { field, direction, nulls } = item as FallbackOrderByItem;
		const fieldDef = schema.fields[field];

		if (!fieldDef) {
			const availableFields = Object.keys(schema.fields).filter(
				(name) => schema.fields[name]?.type !== "relation",
			);
			throwInvalidField("orderBy", field, availableFields);
		}

		if (fieldDef.type === "relation") {
			throwInvalidValue(
				"orderBy",
				field,
				"relation field",
				"a scalar field — ordering by a relation is not supported",
			);
		}

		if (direction !== "asc" && direction !== "desc") {
			throwInvalidValue("orderBy", field, direction, '"asc" | "desc"');
		}

		if (nulls !== undefined && nulls !== "first" && nulls !== "last") {
			throwInvalidValue("orderBy", field, nulls, '"first" | "last"');
		}
	}
}
