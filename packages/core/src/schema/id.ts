/**
 * ID utilities
 *
 * Single source of truth for the two primary key strategies (`int`, `uuid`):
 * - which strategy a schema uses (derived from its `id` field type)
 * - canonical form of an id value (number for int, lowercase string for uuid)
 * - UUID v7 generation (core generates uuid ids, never the database)
 */

import { randomFillSync } from "crypto";
import type { FieldDefinition, SchemaDefinition } from "../types/core/schema";
import type { IdValue } from "../types/core/entry";

/**
 * Canonical (lowercase, hyphenated) UUID format, any version/variant
 */
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Same as UUID_PATTERN but case-insensitive (accepted as input)
 */
const UUID_INPUT_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Storage kind of an id column
 */
export type IdKind = "uuid" | "number";

/**
 * Check whether a value is a canonical (lowercase) UUID string
 */
export function isCanonicalUuid(value: unknown): value is string {
	return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Normalize a UUID input to canonical lowercase form.
 * Returns `undefined` when the value is not a UUID.
 */
export function normalizeUuid(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!UUID_INPUT_PATTERN.test(trimmed)) return undefined;
	return trimmed.toLowerCase();
}

/**
 * Normalize an integer id input (number or numeric string).
 * Returns `undefined` when the value is not an integer.
 */
export function normalizeIntId(value: unknown): number | undefined {
	if (typeof value === "number") {
		return Number.isInteger(value) ? value : undefined;
	}
	if (typeof value === "string") {
		if (value.trim() === "") return undefined;
		const num = Number(value);
		return Number.isInteger(num) ? num : undefined;
	}
	return undefined;
}

/**
 * Normalize an id input to the canonical value for the given id kind.
 * Returns `undefined` when the value is not a valid id of that kind.
 */
export function normalizeIdValue(
	value: unknown,
	kind: IdKind,
): IdValue | undefined {
	return kind === "uuid" ? normalizeUuid(value) : normalizeIntId(value);
}

/**
 * Id kind of a field that stores ids (`id`, foreign keys, junction columns)
 */
export function getFieldIdKind(field: FieldDefinition | undefined): IdKind {
	return field?.type === "uuid" ? "uuid" : "number";
}

/**
 * Id kind of a schema's primary key
 */
export function getSchemaIdKind(schema: SchemaDefinition): IdKind {
	return getFieldIdKind(schema.fields["id"]);
}

/**
 * Assign core-generated ids to rows about to be inserted into `schema`.
 *
 * No-op for int schemas (the database assigns auto-increment ids). For uuid
 * schemas every row without an id gets a fresh UUID v7. Every core insert
 * path — executor creates, junction links, migration transfers — must pass
 * its rows through here, so adapters never generate ids themselves.
 */
export function assignIds<R extends Record<string, unknown>>(
	rows: readonly R[],
	schema: SchemaDefinition,
): R[] {
	if (getSchemaIdKind(schema) !== "uuid") return [...rows];
	return rows.map((row) =>
		row["id"] === undefined || row["id"] === null
			? { ...row, id: generateUuidV7() }
			: row,
	);
}

/**
 * Generate a UUID v7 (RFC 9562): 48-bit unix ms timestamp + random bits.
 *
 * Time-ordered, so `orderBy id` keeps creation order like auto-increment ids,
 * and inserts stay index-friendly.
 *
 * @param timestamp - Unix time in milliseconds (default: now). Passing a
 *   record's `createdAt` keeps the order when converting existing data.
 */
export function generateUuidV7(timestamp: number = Date.now()): string {
	const bytes = new Uint8Array(16);
	randomFillSync(bytes);

	const ms = Math.max(0, Math.floor(timestamp));
	// 48-bit big-endian timestamp (split to stay within safe integer math)
	const high = Math.floor(ms / 2 ** 16);
	const low = ms % 2 ** 16;
	bytes[0] = (high >>> 24) & 0xff;
	bytes[1] = (high >>> 16) & 0xff;
	bytes[2] = (high >>> 8) & 0xff;
	bytes[3] = high & 0xff;
	bytes[4] = (low >>> 8) & 0xff;
	bytes[5] = low & 0xff;

	// version 7
	bytes[6] = (bytes[6]! & 0x0f) | 0x70;
	// variant 10xx
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;

	let hex = "";
	for (const b of bytes) {
		hex += b.toString(16).padStart(2, "0");
	}
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
