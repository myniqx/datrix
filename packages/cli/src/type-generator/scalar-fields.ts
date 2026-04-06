/**
 * Scalar field type generation utilities
 *
 * Generates TypeScript type strings for non-relation fields.
 */

import type { ArrayField, EnumField, FieldDefinition } from "@forja/core/types";

/**
 * Generate TypeScript type string for a scalar field
 */
export function scalarFieldToTypeString(field: FieldDefinition): string {
	switch (field.type) {
		case "string":
			return "string";
		case "number":
			return "number";
		case "boolean":
			return "boolean";
		case "date":
			return "Date";
		case "json":
			return "Record<string, unknown>";
		case "file": {
			const fileField = field as { type: "file"; multiple?: boolean };
			return fileField.multiple ? "string[]" : "string";
		}
		case "enum": {
			const enumField = field as EnumField;
			return enumField.values.map((v) => `"${v}"`).join(" | ");
		}
		case "array": {
			const arrayField = field as ArrayField;
			const itemType = scalarFieldToTypeString(arrayField.items);
			return `${itemType}[]`;
		}
		case "relation":
			return "never";
		default:
			return "unknown";
	}
}

/**
 * Check if field is a scalar (non-relation) field
 */
export function isScalarField(field: FieldDefinition): boolean {
	return field.type !== "relation";
}

/**
 * Check if field should be excluded from Base interface:
 * - hidden fields (auto-generated FK columns)
 * - reserved fields (id, createdAt, updatedAt) - already in ForjaEntry
 */
export function isExcludedFromBase(
	fieldName: string,
	field: FieldDefinition,
): boolean {
	const RESERVED = ["id", "createdAt", "updatedAt"] as const;
	if ((RESERVED as readonly string[]).includes(fieldName)) return true;
	if ((field as { hidden?: boolean }).hidden === true) return true;
	return false;
}
