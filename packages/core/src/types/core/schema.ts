/**
 * Schema Type Definitions
 *
 * This file defines the core schema types used throughout Forja.
 * Schemas are defined as plain TypeScript objects with full type inference.
 */

import type { SchemaPermission, FieldPermission } from "./permission";
import { QuerySelect } from "./query-builder";
import type { ForjaEntry } from "./entry";
import type { LifecycleHooks } from "./hooks";

// Re-export permission types for convenience
export type {
	SchemaPermission,
	FieldPermission,
	PermissionValue,
	PermissionAction,
	FieldPermissionAction,
	PermissionContext,
	PermissionFn,
	DefaultPermission,
	PermissionCheckResult,
	FieldPermissionCheckResult,
} from "./permission";

export {
	isPermissionFn,
	isRoleArray,
	isMixedPermissionArray,
	validatePermissionRoles,
	validateFieldPermissionRoles,
} from "./permission";

/**
 * Reserved field names that are automatically added to all schemas
 * and cannot be defined manually by users
 */
export const RESERVED_FIELDS = ["id", "createdAt", "updatedAt"] as const;

/**
 * Type for reserved field names
 */
export type ReservedFieldName = (typeof RESERVED_FIELDS)[number];

export type { ForjaEntry, ForjaRecord, FallbackValue } from "./entry";

/**
 * Primitive field types
 */
export type FieldType =
	| "string"
	| "number"
	| "boolean"
	| "date"
	| "json"
	| "enum"
	| "array"
	| "relation"
	| "file";

/**
 * Base field definition (common properties)
 *
 * @template TRoles - Union type of valid role names for permission checks
 */
interface BaseFieldDefinition<TRoles extends string = string> {
	readonly required?: boolean;
	readonly default?: unknown;
	readonly description?: string;
	/**
	 * If true, field is excluded from SELECT queries by default
	 * Used for auto-generated fields like foreign keys that shouldn't appear in responses
	 * @internal
	 */
	readonly hidden?: boolean;
	/**
	 * Field-level permission configuration
	 * - `read`: If denied, field is stripped from response
	 * - `write`: If denied, returns 403 error
	 */
	readonly permission?: FieldPermission<TRoles>;
}

/**
 * String field definition
 */
export interface StringField<
	TRoles extends string = string,
> extends BaseFieldDefinition<TRoles> {
	readonly type: "string";
	readonly minLength?: number;
	readonly maxLength?: number;
	readonly pattern?: RegExp;
	readonly unique?: boolean;
	readonly validator?: (value: string) => true | string;
	readonly errorMessage?: string;
}

/**
 * Foreign key reference definition
 * Used by NumberField.references to generate FOREIGN KEY constraints in adapters
 */
export interface ForeignKeyReference {
	readonly table: string;
	readonly column?: string; // defaults to "id"
	readonly onDelete?: "cascade" | "setNull" | "restrict" | undefined;
	readonly onUpdate?: "cascade" | "restrict" | undefined;
}

/**
 * Number field definition
 */
export interface NumberField<
	TRoles extends string = string,
> extends BaseFieldDefinition<TRoles> {
	readonly type: "number";
	readonly min?: number;
	readonly max?: number;
	readonly integer?: boolean;
	readonly unique?: boolean;
	readonly autoIncrement?: boolean;
	readonly validator?: (value: number) => true | string;
	readonly references?: ForeignKeyReference;
}

/**
 * Boolean field definition
 */
export interface BooleanField<
	TRoles extends string = string,
> extends BaseFieldDefinition<TRoles> {
	readonly type: "boolean";
}

/**
 * Date field definition
 */
export interface DateField<
	TRoles extends string = string,
> extends BaseFieldDefinition<TRoles> {
	readonly type: "date";
	readonly min?: Date;
	readonly max?: Date;
}

/**
 * JSON field definition
 */
export interface JsonField<
	TRoles extends string = string,
> extends BaseFieldDefinition<TRoles> {
	readonly type: "json";
	readonly schema?: Record<string, unknown>; // JSON schema validation
}

/**
 * Enum field definition
 */
export interface EnumField<
	T extends readonly string[] = readonly string[],
	TRoles extends string = string,
> extends BaseFieldDefinition<TRoles> {
	readonly type: "enum";
	readonly values: T;
}

/**
 * Array field definition
 */
export interface ArrayField<
	TRoles extends string = string,
> extends BaseFieldDefinition<TRoles> {
	readonly type: "array";
	readonly items: FieldDefinition<TRoles>;
	readonly minItems?: number;
	readonly maxItems?: number;
	readonly unique?: boolean; // All items must be unique
}

/**
 * Relation kinds
 */
export type RelationKind = "hasOne" | "hasMany" | "belongsTo" | "manyToMany";

/**
 * File options carried on a RelationField that was converted from a FileField.
 * When defined, the relation is a file upload relation.
 * Used by the upload handler — core ignores this.
 */
export interface FileFieldOptions {
	readonly allowedTypes?: readonly string[]; // MIME types e.g. ["image/*", "application/pdf"]
	readonly maxSize?: number; // In bytes
}

/**
 * Relation field definition
 */
export interface RelationField<
	TRoles extends string = string,
> extends BaseFieldDefinition<TRoles> {
	readonly type: "relation";
	readonly model: string; // Target model name
	readonly kind: RelationKind;
	readonly foreignKey?: string; // Optional - defaults to fieldName + "Id"
	readonly through?: string; // Join table for manyToMany (optional - auto-generated)
	readonly onDelete?: "cascade" | "setNull" | "restrict";
	readonly onUpdate?: "cascade" | "restrict";
	/**
	 * Present only when this relation was converted from a FileField.
	 * Upload handler reads this to validate uploaded files.
	 */
	readonly fileOptions?: FileFieldOptions;
}

/**
 * Flexible ID reference for relations
 * Accepts: number, string, or object with id property
 *
 * @example
 * ```ts
 * // All valid:
 * 5
 * "uuid-123"
 * { id: 5 }
 * { id: "uuid-123", name: "Test" } // extra fields ignored, id extracted
 * ```
 */
export type RelationIdRef = number | { id: number };

/**
 * Flexible ID references (single or array)
 * Accepts any combination of RelationIdRef
 *
 * @example
 * ```ts
 * // All valid:
 * 5
 * [1, 2, 3]
 * { id: 5 }
 * [{ id: 1 }, { id: 2 }]
 * [1, { id: 2 }, "uuid-3"] // mixed
 * ```
 */
export type RelationIdRefs = RelationIdRef | RelationIdRef[];

/**
 * belongsTo (N:1) and hasOne (1:1) relation input - write operations
 *
 * Singular relations: only one record can be referenced at a time.
 * Shortcuts: pass ID directly or null to disconnect.
 *
 * @example
 * ```ts
 * // Shortcuts
 * author: 5
 * author: { id: 5 }
 * author: null           // disconnect
 *
 * // Explicit object form
 * author: { connect: 5 }
 * author: { connect: { id: 5 } }
 * author: { set: 5 }
 * author: { disconnect: true }
 * author: { create: { name: 'John' } }
 * author: { update: { where: { id: 5 }, data: { name: 'John' } } }
 * ```
 */
export type RelationBelongsTo<T extends ForjaEntry> =
	| RelationIdRef
	| null
	| {
			connect?: RelationIdRef;
			set?: RelationIdRef;
			disconnect?: true;
			create?: Partial<T>;
			update?: { where: { id: number }; data: Partial<T> };
			delete?: RelationIdRef;
	  };

/**
 * hasOne (1:1) relation input - write operations
 * Same constraints as belongsTo (singular).
 */
export type RelationHasOne<T extends ForjaEntry> = RelationBelongsTo<T>;

/**
 * hasMany (1:N) relation input - write operations
 *
 * Plural relations: multiple records can be referenced.
 * Shortcuts: single ID or array of IDs.
 *
 * @example
 * ```ts
 * // Shortcuts
 * tags: 5
 * tags: { id: 5 }
 * tags: [1, 2, 3]
 * tags: [{ id: 1 }, { id: 2 }]
 *
 * // Explicit object form
 * tags: { connect: [1, 2] }
 * tags: { disconnect: [3] }
 * tags: { set: [1, 2, 3] }
 * tags: { create: [{ name: 'Tag A' }, { name: 'Tag B' }] }
 * tags: { delete: [4, 5] }
 * ```
 */
export type RelationHasMany<T extends ForjaEntry> =
	| RelationIdRefs
	| {
			connect?: RelationIdRefs;
			disconnect?: RelationIdRefs;
			set?: RelationIdRefs;
			create?: Partial<T> | Partial<T>[];
			update?:
				| { where: { id: number }; data: Partial<T> }
				| { where: { id: number }; data: Partial<T> }[];
			delete?: RelationIdRefs;
	  };

/**
 * manyToMany (N:N) relation input - write operations
 * Same constraints as hasMany (plural).
 */
export type RelationManyToMany<T extends ForjaEntry> = RelationHasMany<T>;

/**
 * Union of all relation input types.
 * Used internally by the query builder and validator.
 */
export type RelationInput<T extends ForjaEntry> =
	| RelationBelongsTo<T>
	| RelationHasMany<T>;

/**
 * Relation input without generic — for use in untyped/fallback contexts.
 * Covers ID-based operations only (no nested create/update).
 * Provides intellisense for connect/set/disconnect/delete without requiring a model type.
 *
 * @example
 * ```ts
 * // Shortcuts
 * author: 5
 * tags: [1, 2, 3]
 *
 * // Explicit
 * author: { connect: 5 }
 * tags: { set: [1, 2, 3] }
 * tags: { disconnect: [3] }
 * ```
 */
export type AnyRelationInput = RelationIdRefs | null | AnyRelationInputObject;

export type AnyRelationInputObject = {
	connect?: RelationIdRefs;
	disconnect?: RelationIdRefs | true;
	set?: RelationIdRefs;
	delete?: RelationIdRefs;
	create?: Record<string, unknown> | Record<string, unknown>[];
	update?:
		| { where: { id: number }; data: Record<string, unknown> }
		| { where: { id: number }; data: Record<string, unknown> }[];
};

/**
 * Normalized relation ID (always { id } format)
 */
export type NormalizedRelationId = { id: string | number };

/**
 * Normalize a single RelationIdRef to { id } format
 *
 * @param ref - ID reference (number, string, or object with id)
 * @returns Normalized { id } object
 *
 * @example
 * ```ts
 * normalizeRelationId(5)           // { id: 5 }
 * normalizeRelationId("uuid")      // { id: "uuid" }
 * normalizeRelationId({ id: 5 })   // { id: 5 }
 * normalizeRelationId({ id: 5, name: "Test" }) // { id: 5 }
 * ```
 */
export function normalizeRelationId(ref: RelationIdRef): NormalizedRelationId {
	if (typeof ref === "number" || typeof ref === "string") {
		return { id: ref };
	}
	return { id: ref.id };
}

/**
 * Normalize RelationIdRefs to array of { id } format
 *
 * @param refs - Single or array of ID references
 * @returns Array of normalized { id } objects
 *
 * @example
 * ```ts
 * normalizeRelationIds(5)                    // [{ id: 5 }]
 * normalizeRelationIds([1, 2])               // [{ id: 1 }, { id: 2 }]
 * normalizeRelationIds({ id: 5 })            // [{ id: 5 }]
 * normalizeRelationIds([1, { id: 2 }])       // [{ id: 1 }, { id: 2 }]
 * ```
 */
export function normalizeRelationIds(
	refs: RelationIdRefs,
): NormalizedRelationId[] {
	if (Array.isArray(refs)) {
		return refs.map(normalizeRelationId);
	}
	return [normalizeRelationId(refs)];
}

/**
 * Check if value is a valid RelationIdRef
 */
export function isRelationIdRef(value: unknown): value is RelationIdRef {
	if (typeof value === "number" || typeof value === "string") {
		return true;
	}
	if (
		typeof value === "object" &&
		value !== null &&
		"id" in value &&
		(typeof (value as { id: unknown }).id === "number" ||
			typeof (value as { id: unknown }).id === "string")
	) {
		return true;
	}
	return false;
}

/**
 * Check if value is valid RelationIdRefs
 */
export function isRelationIdRefs(value: unknown): value is RelationIdRefs {
	if (isRelationIdRef(value)) {
		return true;
	}
	if (Array.isArray(value) && value.every(isRelationIdRef)) {
		return true;
	}
	return false;
}

/**
 * File field definition
 */
export interface FileField<
	TRoles extends string = string,
> extends BaseFieldDefinition<TRoles> {
	readonly type: "file";
	readonly allowedTypes?: readonly string[]; // MIME types
	readonly maxSize?: number; // In bytes
	readonly multiple?: boolean; // Allow multiple files
}

/**
 * Union of all field definitions
 *
 * @template TRoles - Union type of valid role names for permission checks
 */
export type FieldDefinition<TRoles extends string = string> =
	| StringField<TRoles>
	| NumberField<TRoles>
	| BooleanField<TRoles>
	| DateField<TRoles>
	| JsonField<TRoles>
	| EnumField<readonly string[], TRoles>
	| ArrayField<TRoles>
	| RelationField<TRoles>
	| FileField<TRoles>;

/**
 * Index definition
 */
export interface IndexDefinition {
	readonly name?: string;
	readonly fields: readonly string[];
	readonly unique?: boolean;
	readonly type?: "btree" | "hash" | "gist" | "gin";
}

export type { LifecycleHooks } from "./hooks";

/**
 * Schema definition
 *
 * @template TRoles - Union type of valid role names for permission checks
 * @template TFields - Record of field names to field definitions
 *
 * @example
 * ```ts
 * const roles = ['admin', 'editor', 'user'] as const;
 * type Roles = typeof roles[number];
 *
 * const postSchema = defineSchema<Roles>()({
 *   name: 'post',
 *   fields: {
 *     title: { type: 'string', required: true },
 *     authorId: { type: 'string', required: true },
 *   },
 *   permission: {
 *     create: ['admin', 'editor'],
 *     read: true,
 *     update: ['admin', (ctx) => ctx.user?.id === ctx.record?.authorId],
 *     delete: ['admin'],
 *   }
 * });
 * ```
 */
export interface SchemaDefinition<
	TRoles extends string = string,
	TFields extends Record<string, FieldDefinition<TRoles>> = Record<
		string,
		FieldDefinition<TRoles>
	>,
> {
	readonly name: string;
	readonly fields: TFields;
	readonly indexes?: readonly IndexDefinition[];
	readonly hooks?: LifecycleHooks;
	readonly timestamps?: boolean; // Auto-add createdAt, updatedAt
	readonly softDelete?: boolean; // Add deletedAt field
	readonly tableName?: string; // Custom table name (defaults to pluralized name)
	/**
	 * Schema-level permission configuration
	 * Defines who can perform CRUD operations on this schema
	 */
	readonly permission?: SchemaPermission<TRoles>;
	/**
	 * Internal flag - marks auto-generated junction tables for manyToMany relations
	 * @internal
	 */
	readonly _isJunctionTable?: boolean;
}

/**
 * Relation brand symbol (compile-time only, zero runtime cost)
 * Used to distinguish relation fields from scalar fields in the type system
 */
declare const __relationBrand: unique symbol;

/**
 * Branded type for relation fields
 *
 * At runtime: Contains the ID (string | number)
 * At type level: Represents the full related entity
 *
 * This allows type-safe nested WHERE queries while keeping runtime simple.
 *
 * @template T - The related entity type
 *
 * @example
 * ```ts
 * type Post = {
 *   id: number;
 *   title: string;
 *   author: Relation<User>;  // Runtime: number, Type: User
 * };
 *
 * // Type-safe nested WHERE
 * const where: WhereClause<Post> = {
 *   author: {  // ✅ Knows this is User
 *     name: { $like: 'John%' }
 *   }
 * };
 * ```
 */
export type Relation<T extends ForjaEntry> = T & {
	readonly [__relationBrand]: true;
};

/**
 * Check if a type is a Relation brand
 * Utility type for conditional type logic
 */
export type IsRelation<T> = T extends Relation<infer _R> ? true : false;

/**
 * Extract the inner type from a Relation brand
 *
 * @example
 * ```ts
 * type AuthorRelation = Relation<User>;
 * type InnerType = UnwrapRelation<AuthorRelation>;  // User
 * ```
 */
export type UnwrapRelation<T> = T extends Relation<infer R> ? R : never;

/**
 * Define a schema definition.
 * Returns the schema as-is with const inference preserved.
 *
 * @example
 * ```ts
 * const postSchema = defineSchema({
 *   name: 'post',
 *   fields: {
 *     title: { type: 'string', required: true },
 *     content: { type: 'string' },
 *   },
 *   permission: {
 *     create: ['admin', 'editor'],
 *     read: true,
 *   }
 * });
 * ```
 */
export function defineSchema<const T extends SchemaDefinition>(schema: T): T {
	return schema;
}

/**
 * Schema registry interface
 *
 * Defines the contract for schema storage and retrieval.
 * Implementation is in packages/core/src/schema/registry.ts
 */
export interface ISchemaRegistry {
	/** Register a schema */
	register(schema: SchemaDefinition): SchemaDefinition;
	/** Get schema by name */
	get(name: string): SchemaDefinition | undefined;
	/** Get schema by model name with resolved table name */
	getWithTableName(
		modelName: string,
	): { schema: SchemaDefinition; tableName: string } | undefined;
	/** Get schema by table name with resolved table name */
	getByTableName(
		tableName: string,
	): { schema: SchemaDefinition; tableName: string } | undefined;
	/** Check if schema exists */
	has(name: string): boolean;
	/** Get all schemas */
	getAll(): readonly SchemaDefinition[];
	/** Get schema names */
	getNames(): readonly string[];
	/** Get schema count */
	readonly size: number;
	/** Find model name by table name */
	findModelByTableName(tableName: string | null): string | null;
	/** Get related schemas for a given schema */
	getRelatedSchemas(schemaName: string): readonly string[];
	/** Check if registry is locked */
	isLocked(): boolean;
	/** Get select fields for a model  */
	getCachedSelectFields<T extends ForjaEntry>(
		modelName: string,
	): QuerySelect<T>;
}

/**
 * Field metadata (runtime information)
 */
export interface FieldMetadata {
	readonly name: string;
	readonly type: FieldType;
	readonly required: boolean;
	readonly unique: boolean;
	readonly hasDefault: boolean;
	readonly isRelation: boolean;
	readonly isArray: boolean;
}

/**
 * Schema definition validation result
 */
export interface SchemaDefinitionValidationResult {
	readonly valid: boolean;
	readonly errors: readonly SchemaValidationError[];
}

/**
 * Schema validation error
 */
export interface SchemaValidationError {
	readonly field?: string;
	readonly message: string;
	readonly code: string;
}

/**
 * Validate schema definition
 */
export function validateSchemaDefinition(
	schema: SchemaDefinition,
): SchemaDefinitionValidationResult {
	const errors: SchemaValidationError[] = [];

	// Check name
	if (!schema.name || schema.name.trim() === "") {
		errors.push({
			message: "Schema name is required",
			code: "MISSING_NAME",
		});
	}

	// Check fields
	if (!schema.fields || Object.keys(schema.fields).length === 0) {
		errors.push({
			message: "Schema must have at least one field",
			code: "NO_FIELDS",
		});
	}

	// Validate each field
	for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
		// Check field name
		if (!fieldName || fieldName.trim() === "") {
			errors.push({
				message: "Field name cannot be empty",
				code: "INVALID_FIELD_NAME",
			});
		}

		// Check relation references
		if (fieldDef.type === "relation") {
			if (!fieldDef.model || fieldDef.model.trim() === "") {
				errors.push({
					field: fieldName,
					message: "Relation field must specify a model",
					code: "MISSING_RELATION_MODEL",
				});
			}
		}

		// Check enum values
		if (fieldDef.type === "enum") {
			if (!fieldDef.values || fieldDef.values.length === 0) {
				errors.push({
					field: fieldName,
					message: "Enum field must have at least one value",
					code: "EMPTY_ENUM",
				});
			}
		}

		// Check array items
		if (fieldDef.type === "array") {
			if (!fieldDef.items) {
				errors.push({
					field: fieldName,
					message: "Array field must specify items type",
					code: "MISSING_ARRAY_ITEMS",
				});
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

/**
 * Sort schemas by FK dependency order using Kahn's topological sort.
 * Referenced schemas (parents) come before schemas that reference them (children).
 * Circular/unresolved schemas are appended at the end unchanged.
 *
 * Used by SchemaRegistry.finalizeRegistry() and ZipExportWriter.finalize()
 * to guarantee consistent table creation order.
 */
export function sortSchemasByDependency(
	schemas: SchemaDefinition[],
): SchemaDefinition[] {
	const tableToSchema = new Map<string, SchemaDefinition>();
	for (const schema of schemas) {
		if (schema.tableName) tableToSchema.set(schema.tableName, schema);
	}

	const deps = new Map<string, Set<string>>();
	for (const schema of schemas) {
		if (schema.tableName) deps.set(schema.tableName, new Set());
	}

	for (const schema of schemas) {
		for (const field of Object.values(schema.fields)) {
			const ref = (field as { references?: { table: string } }).references;
			if (!ref) continue;
			const depTable = ref.table;
			if (depTable !== schema.tableName && tableToSchema.has(depTable)) {
				deps.get(schema.tableName!)!.add(depTable);
			}
		}
	}

	const inDegree = new Map<string, number>();
	for (const tableName of deps.keys()) {
		inDegree.set(tableName, 0);
	}
	for (const depSet of deps.values()) {
		for (const dep of depSet) {
			inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
		}
	}

	const queue: string[] = [];
	for (const [tableName, degree] of inDegree) {
		if (degree === 0) queue.push(tableName);
	}

	const sorted: string[] = [];
	while (queue.length > 0) {
		const current = queue.shift()!;
		sorted.push(current);
		for (const dep of deps.get(current) ?? []) {
			const newDegree = (inDegree.get(dep) ?? 1) - 1;
			inDegree.set(dep, newDegree);
			if (newDegree === 0) queue.push(dep);
		}
	}

	// Reverse: dependencies first (parents before children)
	sorted.reverse();

	const result: SchemaDefinition[] = [];
	for (const tableName of sorted) {
		const schema = tableToSchema.get(tableName);
		if (schema) result.push(schema);
	}
	// Append any schemas without tableName or in circular deps
	for (const schema of schemas) {
		if (!result.includes(schema)) result.push(schema);
	}

	return result;
}
