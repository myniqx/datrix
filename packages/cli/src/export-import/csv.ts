/**
 * CSV encoding/decoding utilities.
 *
 * Format:
 * - RFC 4180 compliant
 * - Header row with column names
 * - null values represented as unquoted \N (a literal string "\N" is quoted)
 * - Strings wrapped in double quotes, internal quotes escaped as ""
 * - Boolean: true / false
 * - Number: raw number
 * - JSON/array: stringified, wrapped in quotes
 */

import type { SchemaDefinition } from "@datrix/core";

const NULL_TOKEN = "\\N";

/**
 * A parsed CSV cell. Quoted-ness matters: only an UNQUOTED \N is null;
 * a quoted "\N" is the literal string.
 */
export interface CsvCell {
	readonly value: string;
	readonly quoted: boolean;
}

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

	// String: wrap in quotes and escape internal quotes.
	// A string equal to NULL_TOKEN must be quoted so it does not decode to null.
	const str = String(value);
	if (
		str === NULL_TOKEN ||
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
 * Split CSV file content into records, breaking only on newlines that are
 * outside quoted cells (quoted cells may contain literal newlines).
 * Blank records are skipped.
 */
export function splitRecords(content: string): string[] {
	const records: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < content.length; i++) {
		const ch = content[i];

		if (ch === '"') {
			// Escaped quotes ("") toggle twice, so net state stays correct
			inQuotes = !inQuotes;
			current += ch;
		} else if ((ch === "\n" || ch === "\r") && !inQuotes) {
			if (ch === "\r" && content[i + 1] === "\n") {
				i++;
			}
			if (current.trim() !== "") {
				records.push(current);
			}
			current = "";
		} else {
			current += ch;
		}
	}

	if (current.trim() !== "") {
		records.push(current);
	}

	return records;
}

/**
 * Parse a single CSV record into cells, preserving quoted-ness per cell
 */
export function parseLine(line: string): CsvCell[] {
	const cells: CsvCell[] = [];
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

			cells.push({ value: cell, quoted: true });

			// skip comma
			if (line[i] === ",") i++;
		} else {
			// Unquoted field
			const end = line.indexOf(",", i);
			if (end === -1) {
				cells.push({ value: line.slice(i), quoted: false });
				break;
			} else {
				cells.push({ value: line.slice(i, end), quoted: false });
				i = end + 1;
			}
		}
	}

	return cells;
}

/**
 * Decode a cell to a typed value based on schema field type
 */
function decodeValue(
	cell: CsvCell,
	fieldType: string | undefined,
	fieldName: string,
): unknown {
	const raw = cell.value;

	// Only an unquoted \N is null — quoting protects the literal string
	if (!cell.quoted && raw === NULL_TOKEN) {
		return null;
	}

	if (fieldType === "boolean") {
		return raw === "true";
	}

	if (fieldType === "number") {
		const result = Number(raw);
		if (Number.isNaN(result)) {
			throw new Error(
				`Corrupt CSV data: expected a number for column '${fieldName}', got '${raw}'`,
			);
		}
		return result;
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

	// Auto-detect ISO 8601 date strings ONLY when there is no schema type
	// info — a typed string column must round-trip as a string.
	if (
		fieldType === undefined &&
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw)
	) {
		return new Date(raw);
	}

	return raw;
}

/**
 * Decode a CSV record to a typed row using schema
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
		const cell = cells[i] ?? { value: NULL_TOKEN, quoted: false };
		const fieldType = schema?.fields[header]?.type;
		row[header] = decodeValue(cell, fieldType, header);
	}

	return row;
}
