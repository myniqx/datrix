/**
 * Schema Type Inference Utilities
 *
 * Utilities for inferring TypeScript types from schema definitions.
 * Enables full type safety from schema to API.
 */

import type {
	ArrayField,
	EnumField,
	FieldDefinition,
	RelationField,
	SchemaDefinition,
} from "@forja/core/types/core/schema";

/**
 * Infer type from field definition at runtime
 */
export function inferFieldType(field: FieldDefinition): string {
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
		case "enum": {
			const enumField = field as EnumField;
			return enumField.values.map((v) => `'${v}'`).join(" | ");
		}
		case "array": {
			const arrayField = field as ArrayField;
			const itemType = inferFieldType(arrayField.items);
			return `Array<${itemType}>`;
		}
		case "relation":
			return "string"; // Relation ID
		case "file":
			return "string"; // File URL
		default:
			return "unknown";
	}
}

/**
 * Check if field is required
 */
export function isFieldRequired(field: FieldDefinition): boolean {
	return field.required ?? false;
}

/**
 * Check if field is optional
 */
export function isFieldOptional(field: FieldDefinition): boolean {
	return !isFieldRequired(field);
}

/**
 * Check if field has default value
 */
export function hasDefaultValue(field: FieldDefinition): boolean {
	return field.default !== undefined;
}

/**
 * Get field type name
 */
export function getFieldTypeName(field: FieldDefinition): string {
	return field.type;
}

/**
 * Check if field is a relation
 */
export function isRelationField(
	field: FieldDefinition,
): field is RelationField {
	return field.type === "relation";
}

/**
 * Check if field is an array
 */
export function isArrayField(field: FieldDefinition): field is ArrayField {
	return field.type === "array";
}

/**
 * Check if field is an enum
 */
export function isEnumField<T extends readonly string[]>(
	field: FieldDefinition,
): field is EnumField<T> {
	return field.type === "enum";
}

/**
 * Get enum values
 */
export function getEnumValues(
	field: FieldDefinition,
): readonly string[] | undefined {
	if (isEnumField(field)) {
		return field.values;
	}
	return undefined;
}

/**
 * Get relation target model
 */
export function getRelationTarget(field: FieldDefinition): string | undefined {
	if (isRelationField(field)) {
		return field.model;
	}
	return undefined;
}

/**
 * Get relation kind
 */
export function getRelationKind(
	field: FieldDefinition,
): "hasOne" | "hasMany" | "belongsTo" | "manyToMany" | undefined {
	if (isRelationField(field)) {
		return field.kind;
	}
	return undefined;
}

/**
 * Infer schema type representation as string
 */
export function inferSchemaTypeString(schema: SchemaDefinition): string {
	const fields = Object.entries(schema.fields);

	const fieldStrings = fields.map(([name, field]) => {
		const type = inferFieldType(field);
		const optional = isFieldOptional(field) ? "?" : "";
		return `  ${name}${optional}: ${type};`;
	});

	return `{\n${fieldStrings.join("\n")}\n}`;
}

/**
 * Get required fields from schema
 */
export function getRequiredFields(schema: SchemaDefinition): readonly string[] {
	return Object.entries(schema.fields)
		.filter(([, field]) => isFieldRequired(field))
		.map(([name]) => name);
}

/**
 * Get optional fields from schema
 */
export function getOptionalFields(schema: SchemaDefinition): readonly string[] {
	return Object.entries(schema.fields)
		.filter(([, field]) => isFieldOptional(field))
		.map(([name]) => name);
}

/**
 * Get fields by type
 */
export function getFieldsByType(
	schema: SchemaDefinition,
	type: string,
): readonly string[] {
	return Object.entries(schema.fields)
		.filter(([, field]) => field.type === type)
		.map(([name]) => name);
}

/**
 * Get relation fields
 */
export function getRelationFields(
	schema: SchemaDefinition,
): Record<string, RelationField> {
	const relations: Record<string, RelationField> = {};

	for (const [name, field] of Object.entries(schema.fields)) {
		if (isRelationField(field)) {
			relations[name] = field;
		}
	}

	return relations;
}

/**
 * Get scalar fields (non-relation fields)
 */
export function getScalarFields(
	schema: SchemaDefinition,
): Record<string, FieldDefinition> {
	const scalars: Record<string, FieldDefinition> = {};

	for (const [name, field] of Object.entries(schema.fields)) {
		if (!isRelationField(field)) {
			scalars[name] = field;
		}
	}

	return scalars;
}

/**
 * Check if schema has relations
 */
export function hasRelations(schema: SchemaDefinition): boolean {
	return Object.values(schema.fields).some((field) => isRelationField(field));
}

/**
 * Check if schema has timestamps
 */
export function hasTimestamps(schema: SchemaDefinition): boolean {
	return schema.timestamps ?? false;
}

/**
 * Check if schema has soft delete
 */
export function hasSoftDelete(schema: SchemaDefinition): boolean {
	return schema.softDelete ?? false;
}

/**
 * Get table name for schema
 */
export function getTableName(schema: SchemaDefinition): string {
	return schema.tableName ?? pluralize(schema.name.toLowerCase());
}

/**
 * Simple pluralization helper
 */
function pluralize(word: string): string {
	if (word.endsWith("s")) return word;
	if (word.endsWith("y")) return word.slice(0, -1) + "ies";
	if (word.endsWith("ch") || word.endsWith("sh") || word.endsWith("x")) {
		return word + "es";
	}
	return word + "s";
}

/**
 * Get all field names from schema
 */
export function getFieldNames(schema: SchemaDefinition): readonly string[] {
	return Object.keys(schema.fields);
}

/**
 * Get field definition by name
 */
export function getField(
	schema: SchemaDefinition,
	fieldName: string,
): FieldDefinition | undefined {
	return schema.fields[fieldName];
}

/**
 * Check if schema has field
 */
export function hasField(schema: SchemaDefinition, fieldName: string): boolean {
	return fieldName in schema.fields;
}

/**
 * Validate field name against schema
 */
export function isValidFieldName(
	schema: SchemaDefinition,
	fieldName: string,
): boolean {
	// Allow ID field
	if (fieldName === "id") return true;

	// Allow timestamp fields if enabled
	if (hasTimestamps(schema)) {
		if (fieldName === "createdAt" || fieldName === "updatedAt") {
			return true;
		}
	}

	// Allow soft delete field if enabled
	if (hasSoftDelete(schema) && fieldName === "deletedAt") {
		return true;
	}

	// Check if field exists in schema
	return hasField(schema, fieldName);
}

/**
 * Get default value for field
 */
export function getDefaultValue(field: FieldDefinition): unknown | undefined {
	return field.default;
}

/**
 * Check if field accepts null
 */
export function acceptsNull(field: FieldDefinition): boolean {
	return !isFieldRequired(field);
}

/**
 * Get field description
 */
export function getFieldDescription(
	field: FieldDefinition,
): string | undefined {
	return field.description;
}

/**
 * Create field metadata object
 */
export interface FieldMetadata {
	readonly name: string;
	readonly type: string;
	readonly typeName: string;
	readonly required: boolean;
	readonly optional: boolean;
	readonly hasDefault: boolean;
	readonly defaultValue: unknown;
	readonly isRelation: boolean;
	readonly isArray: boolean;
	readonly isEnum: boolean;
	readonly description: string | undefined;
	readonly enumValues: readonly string[] | undefined;
	readonly relationTarget: string | undefined;
	readonly relationKind:
		| "hasOne"
		| "hasMany"
		| "belongsTo"
		| "manyToMany"
		| undefined;
}

/**
 * Extract complete field metadata
 */
export function extractFieldMetadata(
	fieldName: string,
	field: FieldDefinition,
): FieldMetadata {
	return {
		name: fieldName,
		type: field.type,
		typeName: inferFieldType(field),
		required: isFieldRequired(field),
		optional: isFieldOptional(field),
		hasDefault: hasDefaultValue(field),
		defaultValue: getDefaultValue(field),
		isRelation: isRelationField(field),
		isArray: isArrayField(field),
		isEnum: isEnumField(field),
		description: getFieldDescription(field),
		enumValues: getEnumValues(field),
		relationTarget: getRelationTarget(field),
		relationKind: getRelationKind(field),
	};
}

/**
 * Extract metadata for all fields in schema
 */
export function extractAllFieldMetadata(
	schema: SchemaDefinition,
): Record<string, FieldMetadata> {
	const metadata: Record<string, FieldMetadata> = {};

	for (const [fieldName, field] of Object.entries(schema.fields)) {
		metadata[fieldName] = extractFieldMetadata(fieldName, field);
	}

	return metadata;
}

/**
 * Generate TypeScript interface string from schema
 */
export function generateTypeScriptInterface(
	schema: SchemaDefinition,
	interfaceName?: string,
): string {
	const name = interfaceName ?? schema.name;
	const typeString = inferSchemaTypeString(schema);

	return `export interface ${name} ${typeString}`;
}
