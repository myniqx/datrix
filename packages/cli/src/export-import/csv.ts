/**
 * CSV encoding/decoding utilities.
 *
 * Format:
 * - RFC 4180 compliant
 * - Header row with column names
 * - null values represented as \N
 * - Strings wrapped in double quotes, internal quotes escaped as ""
 * - Boolean: true / false
 * - Number: raw number
 * - JSON/array: stringified, wrapped in quotes
 */

import type { SchemaDefinition } from "@forja/core/types/core/schema";

const NULL_TOKEN = "\\N";

/**
 * Encode a single value to CSV cell string
 */
function encodeValue(value: unknown): string {
	if (value === null || value === undefined) {
		return NULL_TOKEN;
	}

	if (typeof value === "boolean") {
		return value ? "true" : "false";
	}

	if (typeof value === "number") {
		return String(value);
	}

	if (value instanceof Date) {
		return value.toISOString();
	}

	if (typeof value === "object" || Array.isArray(value)) {
		// Serialize to JSON string, then treat it as a regular string (quoted + escaped)
		const str = JSON.stringify(value);
		return `"${str.replace(/"/g, '""')}"`;
	}

	// String: wrap in quotes and escape internal quotes
	const str = String(value);
	if (
		str.includes('"') ||
		str.includes(",") ||
		str.includes("\n") ||
		str.includes("\r")
	) {
		return `"${str.replace(/"/g, '""')}"`;
	}

	return str;
}

/**
 * Encode a row of values to a CSV line
 */
export function encodeRow(
	headers: string[],
	row: Record<string, unknown>,
): string {
	return headers.map((h) => encodeValue(row[h])).join(",");
}

/**
 * Encode header row
 */
export function encodeHeader(headers: string[]): string {
	return headers.map((h) => encodeValue(h)).join(",");
}

/**
 * Parse a single CSV line into cell strings (handles quoted fields)
 */
function parseLine(line: string): string[] {
	const cells: string[] = [];
	let i = 0;

	while (i < line.length) {
		if (line[i] === '"') {
			// Quoted field
			let cell = "";
			i++; // skip opening quote

			while (i < line.length) {
				if (line[i] === '"') {
					if (line[i + 1] === '"') {
						cell += '"';
						i += 2;
					} else {
						i++; // skip closing quote
						break;
					}
				} else {
					cell += line[i];
					i++;
				}
			}

			cells.push(cell);

			// skip comma
			if (line[i] === ",") i++;
		} else {
			// Unquoted field
			const end = line.indexOf(",", i);
			if (end === -1) {
				cells.push(line.slice(i));
				break;
			} else {
				cells.push(line.slice(i, end));
				i = end + 1;
			}
		}
	}

	return cells;
}

/**
 * Decode a cell string to a typed value based on schema field type
 */
function decodeValue(raw: string, fieldType?: string): unknown {
	if (raw === NULL_TOKEN) {
		return null;
	}

	if (fieldType === "boolean") {
		return raw === "true";
	}

	if (fieldType === "number") {
		return Number(raw);
	}

	if (fieldType === "json" || fieldType === "array") {
		try {
			return JSON.parse(raw);
		} catch {
			return raw;
		}
	}

	if (fieldType === "date") {
		return new Date(raw);
	}

	// Auto-detect ISO 8601 date strings even without schema field type info
	if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw)) {
		return new Date(raw);
	}

	return raw;
}

/**
 * Decode a CSV line to a typed row using schema
 */
export function decodeLine(
	line: string,
	headers: string[],
	schema?: SchemaDefinition,
): Record<string, unknown> {
	const cells = parseLine(line);
	const row: Record<string, unknown> = {};

	for (let i = 0; i < headers.length; i++) {
		const header = headers[i]!;
		const raw = cells[i] ?? NULL_TOKEN;
		const fieldType = schema?.fields[header]?.type;
		row[header] = decodeValue(raw, fieldType);
	}

	return row;
}
