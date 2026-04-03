/**
 * Fields Parser
 *
 * Parses fields query params into SelectClause.
 * Examples:
 *   ?fields[0]=name&fields[1]=email
 *   ?fields=name,email
 */

import type { RawQueryParams } from "@forja/types/api/parser";
import {
	MAX_ARRAY_INDEX,
	validateFieldName,
} from "@forja/types/core/constants";
import { fieldsError } from "./errors";

/**
 * Parse fields parameter
 * Throws ParserError on validation failure
 *
 * @param params - Raw query parameters
 * @returns SelectClause (string[] | '*' | undefined)
 * @throws {ParserError} When validation fails
 */
export function parseFields(
	params: RawQueryParams,
): string[] | "*" | undefined {
	// Check for suspicious parameters (fields[extra], fields_injection, etc.)
	const suspiciousParams = Object.keys(params).filter(
		(key) =>
			key.startsWith("fields") &&
			key !== "fields" &&
			!key.match(/^fields\[\d+\]$/), // Allow fields[0], fields[1], etc.
	);

	if (suspiciousParams.length > 0) {
		fieldsError.suspiciousParams(suspiciousParams, []);
	}

	// Handle array format: fields[0]=name&fields[2]=email (sparse arrays allowed)
	const arrayFields = extractArrayFields(params);
	if (arrayFields.length > 0) {
		return validateAndReturn(arrayFields);
	}

	// Check for fields parameter
	const fieldsParam = params["fields"];

	if (fieldsParam === undefined) {
		// No fields specified, return wildcard (will select all)
		return "*";
	}

	// Handle wildcard
	if (fieldsParam === "*") {
		return "*";
	}

	// Handle comma-separated format: fields=name,email
	if (typeof fieldsParam === "string") {
		const fields = fieldsParam
			.split(",")
			.map((f) => f.trim())
			.filter(Boolean);

		// Reject if all fields are empty after trimming
		if (fields.length === 0) {
			fieldsError.emptyValue([]);
		}

		return validateAndReturn(fields);
	}

	// Handle array (from frameworks that parse query strings into arrays)
	if (Array.isArray(fieldsParam)) {
		const fields = fieldsParam.map((f) => String(f).trim()).filter(Boolean);

		// Reject if all fields are empty after trimming
		if (fields.length === 0) {
			fieldsError.emptyValue([]);
		}

		return validateAndReturn(fields);
	}

	// Invalid format
	fieldsError.invalidFormat([]);

	return undefined;
}

/**
 * Extract fields from array-style parameters
 * Handles sparse arrays: fields[0]=name&fields[2]=email (fields[1] can be missing)
 *
 * This allows UI checkboxes where users select specific fields,
 * resulting in non-sequential indices.
 */
function extractArrayFields(params: RawQueryParams): string[] {
	const fields: string[] = [];

	// Find all fields[N] parameters
	for (const key in params) {
		const match = key.match(/^fields\[(\d+)\]$/);
		if (!match) continue;

		const index = parseInt(match[1]!, 10);

		// Prevent DoS attacks with extremely large indices
		if (index >= MAX_ARRAY_INDEX) {
			continue; // Skip invalid indices
		}

		const value = params[key];
		if (typeof value === "string") {
			fields.push(value.trim());
		} else if (Array.isArray(value)) {
			// Framework might parse duplicate params as array
			fields.push(...value.map((v) => String(v).trim()));
		}
	}

	return fields;
}

/**
 * Validate field names and return result
 */
function validateAndReturn(fields: readonly string[]): string[] | "*" {
	if (fields.length === 0) {
		return "*";
	}

	// Validate field names (alphanumeric, underscores, dots for nested fields)
	const invalidFieldsWithReasons: Array<{ field: string; reason: string }> = [];

	for (const field of fields) {
		const validation = validateFieldName(field);
		if (!validation.valid) {
			invalidFieldsWithReasons.push({ field, reason: validation.reason });
		}
	}

	if (invalidFieldsWithReasons.length > 0) {
		const invalidFields = invalidFieldsWithReasons.map((item) => item.field);
		const reasons = invalidFieldsWithReasons.map((item) => item.reason);

		fieldsError.invalidFieldNames(invalidFields, [], {
			validationReasons: reasons,
		});
	}

	return fields as string[];
}
