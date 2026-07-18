/**
 * MySQL Adapter Helper Functions
 *
 * Standalone utilities that don't depend on Datrix singleton or class state.
 */

import { throwQueryError } from "@datrix/core";
import type { OrderByItem, DatrixEntry } from "@datrix/core";

const VALID_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const MAX_IDENTIFIER_LENGTH = 64;

/**
 * Escape a MySQL identifier (table name, column name, etc.)
 * Wraps in backticks and escapes any backticks within the identifier.
 */
export function escapeIdentifier(identifier: string): string {
	if (identifier === "*") {
		return "*";
	}

	if (!VALID_IDENTIFIER_PATTERN.test(identifier)) {
		throwQueryError({
			adapter: "mysql",
			message: `Invalid identifier '${identifier}': must start with letter or underscore, contain only alphanumeric characters and underscores`,
		});
	}

	if (identifier.length > MAX_IDENTIFIER_LENGTH) {
		throwQueryError({
			adapter: "mysql",
			message: `Invalid identifier '${identifier}': exceeds MySQL maximum length of ${MAX_IDENTIFIER_LENGTH} characters`,
		});
	}

	return `\`${identifier.replace(/`/g, "``")}\``;
}

/**
 * Escape a value for use in SQL literals.
 * Handles strings, numbers, booleans, dates, arrays, and objects.
 */
export function escapeValue(value: unknown): string {
	if (value === null || value === undefined) {
		return "NULL";
	}

	if (typeof value === "string") {
		return `'${value.replace(/'/g, "''").replace(/\\/g, "\\\\")}'`;
	}

	if (typeof value === "number") {
		return String(value);
	}

	if (typeof value === "boolean") {
		return value ? "1" : "0";
	}

	if (value instanceof Date) {
		return `'${value.toISOString().slice(0, 23).replace("T", " ")}'`;
	}

	if (Array.isArray(value)) {
		return `JSON_ARRAY(${value.map((v) => escapeValue(v)).join(", ")})`;
	}

	return `CAST('${JSON.stringify(value).replace(/'/g, "''")}' AS JSON)`;
}

/**
 * Escape LIKE metacharacters in a user value that the adapter wraps in `%`.
 * Used for $startsWith/$endsWith/$contains/$icontains/$notContains — the
 * pattern must be combined with an explicit `ESCAPE '\\'` clause in SQL.
 */
export function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, (m) => "\\" + m);
}

const REFERENTIAL_ACTION_MAP: Record<string, string> = {
	cascade: "CASCADE",
	restrict: "RESTRICT",
	setNull: "SET NULL",
	noAction: "NO ACTION",
	setDefault: "SET DEFAULT",
};

/**
 * Map a datrix referential action (camelCase) to its SQL form.
 */
export function mapReferentialAction(action: string): string {
	const mapped = REFERENTIAL_ACTION_MAP[action];
	if (!mapped) {
		throwQueryError({
			adapter: "mysql",
			message: `Unknown referential action '${action}'`,
		});
	}
	return mapped;
}

/**
 * Clamp a generated identifier (constraint/index name) to MySQL's 64-char
 * limit, keeping it deterministic via a short hash suffix.
 */
export function clampGeneratedIdentifier(name: string): string {
	if (name.length <= MAX_IDENTIFIER_LENGTH) {
		return name;
	}
	let hash = 5381;
	for (let i = 0; i < name.length; i++) {
		hash = ((hash << 5) + hash + name.charCodeAt(i)) >>> 0;
	}
	const suffix = `_${hash.toString(16)}`;
	return name.slice(0, MAX_IDENTIFIER_LENGTH - suffix.length) + suffix;
}

/**
 * Build an ORDER BY clause with MySQL's CASE workaround for NULLS FIRST/LAST
 * (MySQL has no native NULLS FIRST/LAST syntax).
 *
 * @param qualifier - Optional unescaped table name or alias to prefix columns with
 */
export function buildOrderByClause(
	orderBy: readonly OrderByItem<DatrixEntry>[],
	qualifier?: string,
): string {
	const prefix = qualifier ? `${escapeIdentifier(qualifier)}.` : "";
	return orderBy
		.map((item) => {
			const field = `${prefix}${escapeIdentifier(item.field as string)}`;
			const direction = item.direction.toUpperCase();

			if (item.nulls) {
				const nullsFirst = item.nulls.toUpperCase() === "FIRST";
				return `CASE WHEN ${field} IS NULL THEN ${nullsFirst ? 0 : 1} ELSE ${nullsFirst ? 1 : 0} END, ${field} ${direction}`;
			}

			return `${field} ${direction}`;
		})
		.join(", ");
}
