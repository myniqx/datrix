/**
 * Schema type generation
 *
 * For each schema, generates:
 *   - UserBase extends DatrixEntry    (scalar fields only)
 *   - UserRelation                   (read-mode nested types)
 *   - UserRelationUpdate             (write-mode Relation<T> types)
 *   - type User = UserBase & UserRelation
 *   - type CreateUserInput = Omit<UserBase, keyof DatrixEntry> & UserRelationUpdate
 *   - type UpdateUserInput = Partial<Omit<UserBase, keyof DatrixEntry>> & UserRelationUpdate
 */

import {
	DATRIX_META_MODEL,
	type RelationField,
	type SchemaDefinition,
} from "@datrix/core";
import { toPascalCase } from "../utils/templates";
import {
	scalarFieldToTypeString,
	isScalarField,
	isExcludedFromBase,
} from "./scalar-fields";
import { relationReadType, relationWriteType } from "./relation-fields";

/**
 * Collect all relation targets across all schemas so we can detect
 * which types are referenced and need to be imported / co-defined.
 */
export function collectRelationTargets(
	schemas: readonly SchemaDefinition[],
): Set<string> {
	const targets = new Set<string>();
	for (const schema of schemas) {
		for (const field of Object.values(schema.fields)) {
			if (field.type === "relation") {
				targets.add(toPascalCase(field.model));
			}
		}
	}
	return targets;
}

/**
 * Generate the UserBase interface (scalar fields + DatrixEntry)
 */
function generateBase(schema: SchemaDefinition, name: string): string {
	const lines: string[] = [];
	lines.push(`export interface ${name}Base extends DatrixEntry {`);

	for (const [fieldName, field] of Object.entries(schema.fields)) {
		if (!isScalarField(field)) continue;
		if (isExcludedFromBase(fieldName, field)) continue;
		const optional = !field.required ? "?" : "";
		const typeStr = scalarFieldToTypeString(field);
		lines.push(`  ${fieldName}${optional}: ${typeStr};`);
	}

	lines.push("}");
	return lines.join("\n");
}

/**
 * Generate the UserRelation interface (read-mode nested types)
 */
function generateRelationRead(schema: SchemaDefinition, name: string): string {
	const relationEntries = Object.entries(schema.fields).filter(
		([, field]) => field.type === "relation",
	) as [string, RelationField][];

	if (relationEntries.length === 0) {
		return `export interface ${name}Relation {}`;
	}

	const lines: string[] = [];
	lines.push(`export interface ${name}Relation {`);

	for (const [fieldName, field] of relationEntries) {
		const typeStr = relationReadType(field);
		lines.push(`  ${fieldName}?: ${typeStr};`);
	}

	lines.push("}");
	return lines.join("\n");
}

/**
 * Generate the UserRelationUpdate interface (write-mode Relation<T> types)
 */
function generateRelationWrite(schema: SchemaDefinition, name: string): string {
	const relationEntries = Object.entries(schema.fields).filter(
		([, field]) => field.type === "relation",
	) as [string, RelationField][];

	if (relationEntries.length === 0) {
		return `export interface ${name}RelationUpdate {}`;
	}

	const lines: string[] = [];
	lines.push(`export interface ${name}RelationUpdate {`);

	for (const [fieldName, field] of relationEntries) {
		const typeStr = relationWriteType(field);
		lines.push(`  ${fieldName}?: ${typeStr};`);
	}

	lines.push("}");
	return lines.join("\n");
}

/**
 * Generate all type aliases for a schema
 */
function generateTypeAliases(name: string): string {
	return [
		`export type ${name} = ${name}Base & ${name}Relation;`,
		`export type Create${name}Input = Omit<${name}Base, keyof DatrixEntry> & ${name}RelationUpdate;`,
		`export type Update${name}Input = Partial<Omit<${name}Base, keyof DatrixEntry>> & ${name}RelationUpdate;`,
	].join("\n");
}

/**
 * Internal schema names that should be excluded from generated types
 */
const INTERNAL_SCHEMA_NAMES = ["_datrix_migration", DATRIX_META_MODEL] as const;

/**
 * Check if schema should be excluded from type generation
 */
function isInternalSchema(schema: SchemaDefinition): boolean {
	if (schema._isJunctionTable) return true;
	if ((INTERNAL_SCHEMA_NAMES as readonly string[]).includes(schema.name))
		return true;
	return false;
}

/**
 * Generate schema block comment
 */
function generateSchemaComment(schema: SchemaDefinition, name: string): string {
	const relationFields = Object.entries(schema.fields).filter(
		([, f]) => f.type === "relation",
	) as [string, RelationField][];

	const lines = [
		`// ─────────────────────────────────────────`,
		`// ${name}  (table: ${schema.tableName ?? schema.name})`,
	];

	if (relationFields.length > 0) {
		const relSummary = relationFields
			.map(([fieldName, f]) => `${fieldName} → ${f.kind}(${f.model})`)
			.join(", ");
		lines.push(`// relations: ${relSummary}`);
	}

	lines.push(`// ─────────────────────────────────────────`);
	return lines.join("\n");
}

/**
 * Generate all types for a single schema
 */
function generateSchemaTypes(schema: SchemaDefinition): string {
	const name = toPascalCase(schema.name);

	const parts = [
		generateSchemaComment(schema, name),
		generateBase(schema, name),
		generateRelationRead(schema, name),
		generateRelationWrite(schema, name),
		generateTypeAliases(name),
	];

	return parts.join("\n\n");
}

/**
 * Generate the file header with imports
 */
function generateHeader(): string {
	return [
		"// This file is auto-generated by datrix generate types",
		"// Do not edit manually - regenerate with: datrix generate types",
		"",
		"import type {",
		"  DatrixEntry,",
		"  RelationBelongsTo,",
		"  RelationHasOne,",
		"  RelationHasMany,",
		"  RelationManyToMany,",
		'} from "@datrix/core";',
	].join("\n");
}

/**
 * Generate the full TypeScript file content for all schemas
 */
export function generateTypesFile(
	schemas: readonly SchemaDefinition[],
): string {
	const header = generateHeader();
	const userSchemas = schemas.filter((s) => !isInternalSchema(s));
	const schemaBlocks = userSchemas.map(generateSchemaTypes);

	return [header, "", ...schemaBlocks].join("\n\n") + "\n";
}
