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
} from "forja-types/core/query-builder";
import type { ForjaEntry } from "forja-types/core/schema";

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
export function normalizeOrderBy<T extends ForjaEntry>(
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

	// Unknown format, return as-is (will fail validation later if invalid)
	return input as QueryOrderBy<T>;
}
