/**
 * Row Type Conversion
 *
 * Part 3 of packages/adapter-postgres-core/issue.md: the driver (or
 * `row_to_json`/`jsonb_agg` for populated relations) does not reliably return
 * JS-native types for every field. Known offenders:
 * - Dates inside populated relations arrive as ISO strings (row_to_json has no
 *   knowledge of the schema, so it never produces a JS Date).
 * - NUMERIC/DECIMAL columns (used when a number field has `precision` set) are
 *   returned as strings by `pg` to avoid silent precision loss; this adapter
 *   accepts the precision loss (see README "Known Limitations") and coerces
 *   them back to `number`.
 * - json/array fields can arrive as unparsed JSON strings depending on the
 *   driver/aggregation path.
 *
 * `convertRowTypes` walks a schema's fields and coerces string values on a
 * single row (non-recursive — the caller is responsible for recursing into
 * relations, since that requires resolving the target schema per relation).
 *
 * `schemaNeedsConversion` precomputes whether a schema has any field that
 * could need this pass at all, so callers can skip the per-row walk entirely
 * for schemas built only from strings/booleans/etc.
 */
import type { FieldDefinition, SchemaDefinition } from "@datrix/core";

/**
 * Cache of schema -> "needs conversion" flag, keyed by the schema object
 * itself. Schema objects are stable for the lifetime of the registry, so a
 * WeakMap avoids recomputing the field scan on every row/query.
 */
const needsConversionCache = new WeakMap<SchemaDefinition, boolean>();

function fieldNeedsConversion(field: FieldDefinition): boolean {
	return (
		field.type === "date" ||
		field.type === "number" ||
		field.type === "json" ||
		field.type === "array"
	);
}

/**
 * Whether `schema` has at least one field that `convertRowTypes` would ever
 * touch (date, number, json, or array). Result is cached per schema object.
 */
export function schemaNeedsConversion(schema: SchemaDefinition): boolean {
	const cached = needsConversionCache.get(schema);
	if (cached !== undefined) {
		return cached;
	}

	let needs = false;
	for (const field of Object.values(schema.fields)) {
		if (fieldNeedsConversion(field)) {
			needs = true;
			break;
		}
	}

	needsConversionCache.set(schema, needs);
	return needs;
}

/**
 * Coerce a single field's runtime value in-place-equivalent (returns the
 * coerced value; caller assigns it back onto the row).
 *
 * - `date` field, string value -> `new Date(value)`. An unparseable string
 *   (`Invalid Date`) is NOT produced silently: the original string is left
 *   untouched so callers never see a corrupt Date where a string was at
 *   least inspectable.
 * - `number` field, string value -> `Number(value)`. Precision loss beyond
 *   2^53 for NUMERIC/BIGINT-backed fields is accepted (documented in README).
 *   An unparseable string (`NaN`) is left as the original string.
 * - `json` / `array` field, string value -> `JSON.parse(value)`. Invalid JSON
 *   is left as the original string.
 * - Any other case (already correct type, null, undefined) passes through
 *   unchanged.
 */
function convertFieldValue(field: FieldDefinition, value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}

	if (field.type === "date") {
		const converted = new Date(value);
		return Number.isNaN(converted.getTime()) ? value : converted;
	}

	if (field.type === "number") {
		const converted = Number(value);
		return Number.isNaN(converted) ? value : converted;
	}

	if (field.type === "json" || field.type === "array") {
		try {
			return JSON.parse(value);
		} catch {
			return value;
		}
	}

	return value;
}

/**
 * Coerce DB-string values on `row` to their JS-native types according to
 * `schema`'s field definitions. Mutates and returns `row`.
 *
 * Only scans the schema's own scalar fields — relation fields have no direct
 * column and are skipped (the populate machinery recurses into related rows
 * with their own target schema separately).
 *
 * Callers should guard with `schemaNeedsConversion(schema)` first to skip the
 * pass entirely for schemas with no date/number/json/array fields.
 */
export function convertRowTypes<T extends Record<string, unknown>>(
	row: T,
	schema: SchemaDefinition,
): T {
	for (const [fieldName, field] of Object.entries(schema.fields)) {
		if (field.type === "relation") continue;
		if (!fieldNeedsConversion(field)) continue;

		const value = row[fieldName];
		if (value === null || value === undefined) continue;

		row[fieldName as keyof T] = convertFieldValue(field, value) as T[keyof T];
	}

	return row;
}
