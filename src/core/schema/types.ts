/**
 * Schema Type Definitions
 *
 * This file defines the core schema types used throughout Forja.
 * Schemas are defined as plain TypeScript objects with full type inference.
 */

/**
 * Primitive field types
 */
export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'json'
  | 'enum'
  | 'array'
  | 'relation'
  | 'file';

/**
 * Base field definition (common properties)
 */
interface BaseFieldDefinition {
  readonly required?: boolean;
  readonly default?: unknown;
  readonly description?: string;
}

/**
 * String field definition
 */
export interface StringField extends BaseFieldDefinition {
  readonly type: 'string';
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
export interface NumberField extends BaseFieldDefinition {
  readonly type: 'number';
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
  readonly unique?: boolean;
  readonly validator?: (value: number) => true | string;
}

/**
 * Boolean field definition
 */
export interface BooleanField extends BaseFieldDefinition {
  readonly type: 'boolean';
}

/**
 * Date field definition
 */
export interface DateField extends BaseFieldDefinition {
  readonly type: 'date';
  readonly min?: Date;
  readonly max?: Date;
  readonly autoCreate?: boolean; // Auto-set on creation
  readonly autoUpdate?: boolean; // Auto-update on modification
}

/**
 * JSON field definition
 */
export interface JsonField extends BaseFieldDefinition {
  readonly type: 'json';
  readonly schema?: Record<string, unknown>; // JSON schema validation
}

/**
 * Enum field definition
 */
export interface EnumField<T extends readonly string[] = readonly string[]>
  extends BaseFieldDefinition {
  readonly type: 'enum';
  readonly values: T;
}

/**
 * Array field definition
 */
export interface ArrayField extends BaseFieldDefinition {
  readonly type: 'array';
  readonly items: FieldDefinition;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly unique?: boolean; // All items must be unique
}

/**
 * Relation kinds
 */
export type RelationKind = 'hasOne' | 'hasMany' | 'belongsTo' | 'manyToMany';

/**
 * Relation field definition
 */
export interface RelationField extends BaseFieldDefinition {
  readonly type: 'relation';
  readonly model: string; // Target model name
  readonly kind: RelationKind;
  readonly foreignKey?: string; // Foreign key field name
  readonly through?: string; // Join table for manyToMany
  readonly onDelete?: 'cascade' | 'setNull' | 'restrict';
  readonly onUpdate?: 'cascade' | 'restrict';
}

/**
 * File field definition
 */
export interface FileField extends BaseFieldDefinition {
  readonly type: 'file';
  readonly allowedTypes?: readonly string[]; // MIME types
  readonly maxSize?: number; // In bytes
  readonly multiple?: boolean; // Allow multiple files
}

/**
 * Union of all field definitions
 */
export type FieldDefinition =
  | StringField
  | NumberField
  | BooleanField
  | DateField
  | JsonField
  | EnumField
  | ArrayField
  | RelationField
  | FileField;

/**
 * Index definition
 */
export interface IndexDefinition {
  readonly fields: readonly string[];
  readonly unique?: boolean;
  readonly name?: string;
}

/**
 * Lifecycle hooks
 */
export interface LifecycleHooks<T = Record<string, unknown>> {
  readonly beforeCreate?: (
    data: Partial<T>
  ) => Promise<Partial<T>> | Partial<T>;
  readonly afterCreate?: (data: T) => Promise<T> | T;
  readonly beforeUpdate?: (
    data: Partial<T>
  ) => Promise<Partial<T>> | Partial<T>;
  readonly afterUpdate?: (data: T) => Promise<T> | T;
  readonly beforeDelete?: (id: string) => Promise<void> | void;
  readonly afterDelete?: (id: string) => Promise<void> | void;
  readonly beforeFind?: (query: unknown) => Promise<unknown> | unknown;
  readonly afterFind?: (results: T | T[]) => Promise<T | T[]> | T | T[];
}

/**
 * Schema definition
 */
export interface SchemaDefinition<
  TFields extends Record<string, FieldDefinition> = Record<
    string,
    FieldDefinition
  >
> {
  readonly name: string;
  readonly fields: TFields;
  readonly indexes?: readonly IndexDefinition[];
  readonly hooks?: LifecycleHooks;
  readonly timestamps?: boolean; // Auto-add createdAt, updatedAt
  readonly softDelete?: boolean; // Add deletedAt field
  readonly tableName?: string; // Custom table name (defaults to pluralized name)
}

/**
 * Infer TypeScript type from field definition
 */
export type InferFieldType<F extends FieldDefinition> = F extends {
  type: 'string';
}
  ? string
  : F extends { type: 'number' }
  ? number
  : F extends { type: 'boolean' }
  ? boolean
  : F extends { type: 'date' }
  ? Date
  : F extends { type: 'json' }
  ? Record<string, unknown>
  : F extends EnumField<infer T>
  ? T[number]
  : F extends { type: 'array'; items: infer I extends FieldDefinition }
  ? Array<InferFieldType<I>>
  : F extends { type: 'relation'; model: string }
  ? string // Just the ID for relations
  : F extends { type: 'file' }
  ? string // File URL/path
  : never;

/**
 * Infer TypeScript type from schema definition
 */
export type InferSchemaType<S extends SchemaDefinition> = {
  [K in keyof S['fields']]: S['fields'][K] extends { required: true }
    ? InferFieldType<S['fields'][K]>
    : InferFieldType<S['fields'][K]> | undefined;
};

/**
 * Type brand symbol (compile-time only, no runtime overhead)
 */
declare const __typeBrand: unique symbol;

/**
 * Schema with inferred type (branded for type safety)
 */
export interface TypedSchema<T> extends SchemaDefinition {
  readonly [__typeBrand]?: T; // Optional phantom type, no runtime cost
}

/**
 * Define schema with type inference
 */
export function defineSchema<
  const T extends SchemaDefinition
>(schema: T): TypedSchema<InferSchemaType<T>> {
  // No runtime transformation needed - type brand is compile-time only
  return schema as TypedSchema<InferSchemaType<T>>;
}

/**
 * Schema registry
 */
export class SchemaRegistry {
  private readonly schemas: Map<string, SchemaDefinition> = new Map();

  register(schema: SchemaDefinition): void {
    this.schemas.set(schema.name, schema);
  }

  get(name: string): SchemaDefinition | undefined {
    return this.schemas.get(name);
  }

  has(name: string): boolean {
    return this.schemas.has(name);
  }

  getAll(): readonly SchemaDefinition[] {
    return Array.from(this.schemas.values());
  }

  get size(): number {
    return this.schemas.size;
  }

  clear(): void {
    this.schemas.clear();
  }
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
  field: FieldDefinition
): FieldMetadata {
  return {
    name,
    type: field.type,
    required: field.required ?? false,
    unique: 'unique' in field ? (field.unique ?? false) : false,
    hasDefault: field.default !== undefined,
    isRelation: field.type === 'relation',
    isArray: field.type === 'array'
  };
}

/**
 * Schema validation result
 */
export interface SchemaValidationResult {
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
  schema: SchemaDefinition
): SchemaValidationResult {
  const errors: SchemaValidationError[] = [];

  // Check name
  if (!schema.name || schema.name.trim() === '') {
    errors.push({
      message: 'Schema name is required',
      code: 'MISSING_NAME'
    });
  }

  // Check fields
  if (!schema.fields || Object.keys(schema.fields).length === 0) {
    errors.push({
      message: 'Schema must have at least one field',
      code: 'NO_FIELDS'
    });
  }

  // Validate each field
  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    // Check field name
    if (!fieldName || fieldName.trim() === '') {
      errors.push({
        message: 'Field name cannot be empty',
        code: 'INVALID_FIELD_NAME'
      });
    }

    // Check relation references
    if (fieldDef.type === 'relation') {
      if (!fieldDef.model || fieldDef.model.trim() === '') {
        errors.push({
          field: fieldName,
          message: 'Relation field must specify a model',
          code: 'MISSING_RELATION_MODEL'
        });
      }
    }

    // Check enum values
    if (fieldDef.type === 'enum') {
      if (!fieldDef.values || fieldDef.values.length === 0) {
        errors.push({
          field: fieldName,
          message: 'Enum field must have at least one value',
          code: 'EMPTY_ENUM'
        });
      }
    }

    // Check array items
    if (fieldDef.type === 'array') {
      if (!fieldDef.items) {
        errors.push({
          field: fieldName,
          message: 'Array field must specify items type',
          code: 'MISSING_ARRAY_ITEMS'
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
