/**
 * Schema Type Definitions
 *
 * This file defines the core schema types used throughout Forja.
 * Schemas are defined as plain TypeScript objects with full type inference.
 */

import type { SchemaPermission, FieldPermission } from "./permission";

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
export const RESERVED_FIELDS = ['id', 'createdAt', 'updatedAt'] as const;

/**
 * Type for reserved field names
 */
export type ReservedFieldName = typeof RESERVED_FIELDS[number];

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
  readonly validator?: (value: number) => true | string;
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
  readonly autoCreate?: boolean; // Auto-set on creation
  readonly autoUpdate?: boolean; // Auto-update on modification
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
 * Relation field definition
 */
export interface RelationField<
  TRoles extends string = string,
> extends BaseFieldDefinition<TRoles> {
  readonly type: "relation";
  readonly model: string; // Target model name
  readonly kind: RelationKind;
  readonly foreignKey: string; // Foreign key field name (REQUIRED for JOIN operations)
  readonly through?: string; // Join table for manyToMany
  readonly onDelete?: "cascade" | "setNull" | "restrict";
  readonly onUpdate?: "cascade" | "restrict";
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

/**
 * Lifecycle hooks
 */
export interface LifecycleHooks<T = Record<string, unknown>> {
  readonly beforeCreate?: (data: Partial<T>) => Promise<Partial<T>> | Partial<T>;
  readonly afterCreate?: (data: T) => Promise<T> | T;
  readonly beforeUpdate?: (data: Partial<T>) => Promise<Partial<T>> | Partial<T>;
  readonly afterUpdate?: (data: T) => Promise<T> | T;
  readonly beforeDelete?: (id: string) => Promise<void> | void;
  readonly afterDelete?: (id: string) => Promise<void> | void;
  readonly beforeFind?: (query: unknown) => Promise<unknown> | unknown;
  readonly afterFind?: (results: T | T[]) => Promise<T | T[]> | T | T[];
}

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
}

/**
 * Infer TypeScript type from field definition
 */
export type InferFieldType<F extends FieldDefinition<string>> =
  F extends (
    {
      type: "string";
    }
  ) ?
  string
  : F extends { type: "number" } ? number
  : F extends { type: "boolean" } ? boolean
  : F extends { type: "date" } ? Date
  : F extends { type: "json" } ? Record<string, unknown>
  : F extends EnumField<infer T, string> ? T[number]
  : F extends { type: "array"; items: infer I extends FieldDefinition<string> } ?
  Array<InferFieldType<I>>
  : F extends { type: "relation"; model: string } ?
  string // Just the ID for relations
  : F extends { type: "file" } ?
  string // File URL/path
  : never;

/**
 * Infer TypeScript type from schema definition
 */
export type InferSchemaType<S extends SchemaDefinition<string>> = {
  [K in keyof S["fields"]]: S["fields"][K] extends { required: true } ?
  InferFieldType<S["fields"][K]>
  : InferFieldType<S["fields"][K]> | undefined;
};

/**
 * Type brand symbol (compile-time only, no runtime overhead)
 */
declare const __typeBrand: unique symbol;

/**
 * Schema with inferred type (branded for type safety)
 */
export interface TypedSchema<
  T,
  TRoles extends string = string,
> extends SchemaDefinition<TRoles> {
  readonly [__typeBrand]?: T; // Optional phantom type, no runtime cost
}

/**
 * Define schema with type inference
 *
 * @example
 * ```ts
 * const roles = ['admin', 'editor', 'user'] as const;
 * type Roles = typeof roles[number];
 *
 * const postSchema = defineSchema<Roles>({
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
export function defineSchema<const T extends SchemaDefinition>(
  schema: T,
): TypedSchema<InferSchemaType<T>> {
  // No runtime transformation needed - type brand is compile-time only
  return schema as TypedSchema<InferSchemaType<T>>;
}

/**
 * Schema registry interface
 *
 * Defines the contract for schema storage and retrieval.
 * Implementation is in packages/core/src/schema/registry.ts
 */
export interface SchemaRegistry {
  /** Register a schema */
  register(schema: SchemaDefinition): { success: boolean; error?: Error };
  /** Get schema by name */
  get(name: string): SchemaDefinition | undefined;
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
 * Extract field metadata from definition
 */
export function getFieldMetadata(
  name: string,
  field: FieldDefinition,
): FieldMetadata {
  return {
    name,
    type: field.type,
    required: field.required ?? false,
    unique: "unique" in field ? (field.unique ?? false) : false,
    hasDefault: field.default !== undefined,
    isRelation: field.type === "relation",
    isArray: field.type === "array",
  };
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

      // Check foreignKey for belongsTo
      if (
        fieldDef.kind === "belongsTo" &&
        (!fieldDef.foreignKey || fieldDef.foreignKey.trim() === "")
      ) {
        errors.push({
          field: fieldName,
          message: 'Relation with kind "belongsTo" must specify a foreignKey',
          code: "MISSING_FOREIGN_KEY",
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
