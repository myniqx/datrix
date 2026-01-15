/**
 * Schema Registry Implementation
 *
 * Manages schema registration, retrieval, and validation.
 * Central store for all schemas in the application.
 */

import type { RelationField, SchemaDefinition, SchemaValidationError } from 'forja-types/core/schema';
import { validateSchemaDefinition } from 'forja-types/core/schema';
import type { Result } from 'forja-types/utils';

/**
 * Schema registry error
 */
export class SchemaRegistryError extends Error {
  readonly code: string;
  readonly schemaName: string | undefined;
  readonly details: unknown | undefined;

  constructor(
    message: string,
    options?: {
      code?: string;
      schemaName?: string;
      details?: unknown;
    }
  ) {
    super(message);
    this.name = 'SchemaRegistryError';
    this.code = options?.code ?? 'UNKNOWN';
    this.schemaName = options?.schemaName;
    this.details = options?.details;
  }
}

/**
 * Schema registry configuration
 */
export interface SchemaRegistryConfig {
  readonly strict: boolean | undefined; // Validate schemas on registration
  readonly allowOverwrite: boolean | undefined; // Allow overwriting existing schemas
  readonly validateRelations: boolean | undefined; // Validate relation references
}

/**
 * Schema metadata
 */
export interface SchemaMetadata {
  readonly name: string;
  readonly tableName: string;
  readonly fieldCount: number;
  readonly relationCount: number;
  readonly indexCount: number;
  readonly hasTimestamps: boolean;
  readonly hasSoftDelete: boolean;
  readonly registeredAt: Date;
}

/**
 * Performance cache for expensive operations
 */
interface RegistryCache {
  relatedSchemas: Map<string, readonly string[]>;
  referencingSchemas: Map<string, readonly string[]>;
  fieldTypeIndex: Map<string, readonly SchemaDefinition[]>;
}

/**
 * Schema registry implementation
 */
export class SchemaRegistry {
  private readonly schemas: Map<string, SchemaDefinition> = new Map();
  private readonly metadata: Map<string, SchemaMetadata> = new Map();
  private readonly config: Required<SchemaRegistryConfig>;
  private locked = false;
  private cache: RegistryCache = {
    relatedSchemas: new Map(),
    referencingSchemas: new Map(),
    fieldTypeIndex: new Map()
  };

  constructor(config?: SchemaRegistryConfig) {
    this.config = {
      strict: config?.strict ?? true,
      allowOverwrite: config?.allowOverwrite ?? false,
      validateRelations: config?.validateRelations ?? true
    };
  }

  /**
   * Invalidate performance cache
   */
  private invalidateCache(): void {
    this.cache.relatedSchemas.clear();
    this.cache.referencingSchemas.clear();
    this.cache.fieldTypeIndex.clear();
  }

  /**
   * Register a schema
   */
  register(schema: SchemaDefinition): Result<SchemaDefinition, SchemaRegistryError> {
    if (this.locked) {
      return {
        success: false,
        error: new SchemaRegistryError('Registry is locked', {
          code: 'REGISTRY_LOCKED'
        })
      };
    }

    // Validate schema name
    if (!schema.name || schema.name.trim() === '') {
      return {
        success: false,
        error: new SchemaRegistryError('Schema name is required', {
          code: 'INVALID_SCHEMA_NAME'
        })
      };
    }

    // Check if already registered
    if (this.schemas.has(schema.name) && !this.config.allowOverwrite) {
      return {
        success: false,
        error: new SchemaRegistryError(
          `Schema already registered: ${schema.name}`,
          {
            code: 'DUPLICATE_SCHEMA',
            schemaName: schema.name
          }
        )
      };
    }

    // Validate schema if strict mode
    if (this.config.strict) {
      const validation = validateSchemaDefinition(schema);
      if (!validation.valid) {
        return {
          success: false,
          error: new SchemaRegistryError(
            `Schema validation failed: ${schema.name}`,
            {
              code: 'VALIDATION_FAILED',
              schemaName: schema.name,
              details: validation.errors
            }
          )
        };
      }
    }

    const finalSchema = {
      ...schema,
      tableName: schema.tableName ?? this.pluralize(schema.name.toLowerCase())
    };

    // Store schema
    this.schemas.set(schema.name, finalSchema);

    // Store metadata
    const metadata = this.createMetadata(finalSchema);
    this.metadata.set(schema.name, metadata);

    // Invalidate cache
    this.invalidateCache();

    return { success: true, data: finalSchema };
  }

  /**
   * Register multiple schemas
   */
  registerMany(
    schemas: readonly SchemaDefinition[]
  ): Result<void, SchemaRegistryError> {
    for (const schema of schemas) {
      const result = this.register(schema);
      if (!result.success) {
        return result;
      }
    }

    // Validate relations if enabled
    if (this.config.validateRelations) {
      const validation = this.validateRelations();
      if (!validation.success) {
        return validation;
      }
    }

    return { success: true, data: undefined };
  }

  /**
   * Get schema by name
   */
  get(name: string): SchemaDefinition | undefined {
    return this.schemas.get(name);
  }

  /**
   * Check if schema exists
   */
  has(name: string): boolean {
    return this.schemas.has(name);
  }

  /**
   * Get all schemas
   */
  getAll(): readonly SchemaDefinition[] {
    return Array.from(this.schemas.values());
  }

  /**
   * Get schema names
   */
  getNames(): readonly string[] {
    return Array.from(this.schemas.keys());
  }

  /**
   * Get schema count
   */
  get size(): number {
    return this.schemas.size;
  }

  /**
   * Get schema metadata
   */
  getMetadata(name: string): SchemaMetadata | undefined {
    return this.metadata.get(name);
  }

  /**
   * Get all metadata
   */
  getAllMetadata(): readonly SchemaMetadata[] {
    return Array.from(this.metadata.values());
  }

  /**
   * Find model name by table name
   *
   * @param tableName - Table name to search for
   * @returns Model name if found, null otherwise
   *
   * @example
   * ```ts
   * const modelName = registry.findModelByTableName('categories');
   * // Returns: 'category'
   * ```
   */
  findModelByTableName(tableName: string | null): string | null {
    if (!tableName) return null;
    for (const [modelName, metadata] of this.metadata.entries()) {
      if (metadata.tableName === tableName) {
        return modelName;
      }
    }
    return null;
  }

  /**
   * Get schemas with relations
   */
  getSchemasWithRelations(): readonly SchemaDefinition[] {
    return this.getAll().filter((schema) =>
      Object.values(schema.fields).some((field) => field.type === 'relation')
    );
  }

  /**
   * Get related schemas for a given schema (cached)
   */
  getRelatedSchemas(schemaName: string): readonly string[] {
    // Check cache first
    const cached = this.cache.relatedSchemas.get(schemaName);
    if (cached) {
      return cached;
    }

    const schema = this.get(schemaName);
    if (!schema) return [];

    const related: string[] = [];

    for (const field of Object.values(schema.fields)) {
      if (field.type === 'relation') {
        const relationField = field as RelationField;
        if (!related.includes(relationField.model)) {
          related.push(relationField.model);
        }
      }
    }

    // Cache the result
    this.cache.relatedSchemas.set(schemaName, related);

    return related;
  }

  /**
   * Get schemas that reference a given schema (cached)
   */
  getReferencingSchemas(schemaName: string): readonly string[] {
    // Check cache first
    const cached = this.cache.referencingSchemas.get(schemaName);
    if (cached) {
      return cached;
    }

    const referencing: string[] = [];

    for (const [name, schema] of this.schemas.entries()) {
      for (const field of Object.values(schema.fields)) {
        if (field.type === 'relation') {
          const relationField = field as RelationField;
          if (relationField.model === schemaName) {
            referencing.push(name);
            break;
          }
        }
      }
    }

    // Cache the result
    this.cache.referencingSchemas.set(schemaName, referencing);

    return referencing;
  }

  /**
   * Find schemas by field type (cached)
   */
  findByFieldType(fieldType: string): readonly SchemaDefinition[] {
    // Check cache first
    const cached = this.cache.fieldTypeIndex.get(fieldType);
    if (cached) {
      return cached;
    }

    const result = this.getAll().filter((schema) =>
      Object.values(schema.fields).some((field) => field.type === fieldType)
    );

    // Cache the result
    this.cache.fieldTypeIndex.set(fieldType, result);

    return result;
  }

  /**
   * Validate all relations
   */
  validateRelations(): Result<void, SchemaRegistryError> {
    const errors: SchemaValidationError[] = [];

    for (const [, schema] of this.schemas.entries()) {
      for (const [fieldName, field] of Object.entries(schema.fields)) {
        if (field.type === 'relation') {
          const relationField = field as RelationField;

          // Check if target model exists
          if (!this.has(relationField.model)) {
            errors.push({
              field: fieldName,
              message: `Relation target not found: ${relationField.model}`,
              code: 'INVALID_RELATION_TARGET'
            });
          }
        }
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        error: new SchemaRegistryError('Relation validation failed', {
          code: 'INVALID_RELATIONS',
          details: errors
        })
      };
    }

    return { success: true, data: undefined };
  }

  /**
   * Clear all schemas
   */
  clear(): void {
    if (this.locked) {
      throw new SchemaRegistryError('Cannot clear locked registry', {
        code: 'REGISTRY_LOCKED'
      });
    }
    this.schemas.clear();
    this.metadata.clear();
    this.invalidateCache();
  }

  /**
   * Remove schema by name
   */
  remove(name: string): boolean {
    if (this.locked) {
      throw new SchemaRegistryError('Cannot remove from locked registry', {
        code: 'REGISTRY_LOCKED'
      });
    }

    const removed = this.schemas.delete(name);
    if (removed) {
      this.metadata.delete(name);
      this.invalidateCache();
    }
    return removed;
  }

  /**
   * Lock registry (prevent modifications)
   */
  lock(): void {
    this.locked = true;
  }

  /**
   * Unlock registry
   */
  unlock(): void {
    this.locked = false;
  }

  /**
   * Check if registry is locked
   */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * Create metadata for schema
   */
  private createMetadata(schema: SchemaDefinition): SchemaMetadata {
    const fields = Object.values(schema.fields);
    const relationCount = fields.filter((f) => f.type === 'relation').length;

    return {
      name: schema.name,
      tableName: schema.tableName ?? this.pluralize(schema.name.toLowerCase()),
      fieldCount: fields.length,
      relationCount,
      indexCount: schema.indexes?.length ?? 0,
      hasTimestamps: schema.timestamps ?? false,
      hasSoftDelete: schema.softDelete ?? false,
      registeredAt: new Date()
    };
  }

  /**
   * Enhanced pluralization with common English rules
   */
  private pluralize(word: string): string {
    // Irregular plurals (common cases)
    const irregulars: Record<string, string> = {
      person: 'people',
      child: 'children',
      man: 'men',
      woman: 'women',
      tooth: 'teeth',
      foot: 'feet',
      mouse: 'mice',
      goose: 'geese',
      ox: 'oxen',
      datum: 'data',
      index: 'indices',
      vertex: 'vertices',
      matrix: 'matrices',
      status: 'statuses',
      quiz: 'quizzes'
    };

    const lower = word.toLowerCase();
    const irregular = irregulars[lower];
    if (irregular) {
      // Preserve original casing pattern
      const firstChar = word.charAt(0);
      return firstChar === firstChar.toUpperCase()
        ? irregular.charAt(0).toUpperCase() + irregular.slice(1)
        : irregular;
    }

    // Already plural or uncountable
    if (
      word.endsWith('ss') ||
      lower === 'data' ||
      lower === 'information' ||
      lower === 'equipment'
    ) {
      return word;
    }

    // Words ending in consonant + y -> ies
    if (word.endsWith('y') && word.length > 1) {
      const beforeY = word[word.length - 2];
      if (beforeY && !'aeiou'.includes(beforeY.toLowerCase())) {
        return word.slice(0, -1) + 'ies';
      }
    }

    // Words ending in f or fe -> ves
    if (word.endsWith('f')) {
      return word.slice(0, -1) + 'ves';
    }
    if (word.endsWith('fe')) {
      return word.slice(0, -2) + 'ves';
    }

    // Words ending in o (preceded by consonant) -> oes
    if (word.endsWith('o') && word.length > 1) {
      const beforeO = word[word.length - 2];
      if (beforeO && !'aeiou'.includes(beforeO.toLowerCase())) {
        return word + 'es';
      }
    }

    // Words ending in ch, sh, s, ss, x, z -> es
    if (
      word.endsWith('ch') ||
      word.endsWith('sh') ||
      word.endsWith('s') ||
      word.endsWith('ss') ||
      word.endsWith('x') ||
      word.endsWith('z')
    ) {
      return word + 'es';
    }

    // Default: just add s
    return word + 's';
  }

  /**
   * Export schemas as JSON
   */
  toJSON(): Record<string, SchemaDefinition> {
    return Object.fromEntries(this.schemas.entries());
  }

  /**
   * Import schemas from JSON
   */
  fromJSON(
    data: Record<string, SchemaDefinition>
  ): Result<void, SchemaRegistryError> {
    const schemas = Object.values(data);
    return this.registerMany(schemas);
  }
}

/**
 * Global schema registry instance
 */
let globalRegistry: SchemaRegistry | undefined;

/**
 * Get global registry instance
 */
export function getGlobalRegistry(): SchemaRegistry {
  if (!globalRegistry) {
    globalRegistry = new SchemaRegistry();
  }
  return globalRegistry;
}

/**
 * Set global registry instance
 */
export function setGlobalRegistry(registry: SchemaRegistry): void {
  globalRegistry = registry;
}

/**
 * Reset global registry
 */
export function resetGlobalRegistry(): void {
  globalRegistry = undefined;
}
