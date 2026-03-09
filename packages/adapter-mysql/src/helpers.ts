/**
 * MySQL Adapter Helper Functions
 *
 * Standalone utilities that don't depend on Forja singleton or class state.
 */

import { throwQueryError } from "forja-types/errors/adapter";

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
