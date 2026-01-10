# Schema Module API Reference

> Complete API reference for schema module.

---

## Classes

### SchemaRegistry

Central registry for schema definitions.

```typescript
class SchemaRegistry {
  constructor(config?: SchemaRegistryConfig)

  // Registration
  register(schema: SchemaDefinition): Result<void, SchemaRegistryError>
  registerMany(schemas: readonly SchemaDefinition[]): Result<void, SchemaRegistryError>

  // Retrieval
  get(name: string): SchemaDefinition | undefined
  has(name: string): boolean
  getAll(): readonly SchemaDefinition[]
  getNames(): readonly string[]
  get size(): number

  // Metadata
  getMetadata(name: string): SchemaMetadata | undefined
  getAllMetadata(): readonly SchemaMetadata[]

  // Relations
  getSchemasWithRelations(): readonly SchemaDefinition[]
  getRelatedSchemas(schemaName: string): readonly string[]
  getReferencingSchemas(schemaName: string): readonly string[]
  findByFieldType(fieldType: string): readonly SchemaDefinition[]
  validateRelations(): Result<void, SchemaRegistryError>

  // Management
  clear(): void
  remove(name: string): boolean
  lock(): void
  unlock(): void
  isLocked(): boolean

  // Serialization
  toJSON(): Record<string, SchemaDefinition>
  fromJSON(data: Record<string, SchemaDefinition>): Result<void, SchemaRegistryError>
}
```

### SchemaRegistryError

```typescript
class SchemaRegistryError extends Error {
  readonly code: string
  readonly schemaName?: string
  readonly details?: unknown
}
```

---

## Type Inference Functions

```typescript
// Field type inference
function inferFieldType(field: FieldDefinition): string
function isFieldRequired(field: FieldDefinition): boolean
function isFieldOptional(field: FieldDefinition): boolean
function hasDefaultValue(field: FieldDefinition): boolean
function getFieldTypeName(field: FieldDefinition): string

// Type guards
function isRelationField(field: FieldDefinition): field is RelationField
function isArrayField(field: FieldDefinition): field is ArrayField
function isEnumField(field: FieldDefinition): field is EnumField

// Field information
function getEnumValues(field: FieldDefinition): readonly string[] | undefined
function getRelationTarget(field: FieldDefinition): string | undefined
function getRelationKind(field: FieldDefinition): RelationKind | undefined
function getDefaultValue(field: FieldDefinition): unknown | undefined
function getFieldDescription(field: FieldDefinition): string | undefined
```

---

## Schema Analysis Functions

```typescript
// Schema structure
function inferSchemaTypeString(schema: SchemaDefinition): string
function getRequiredFields(schema: SchemaDefinition): readonly string[]
function getOptionalFields(schema: SchemaDefinition): readonly string[]
function getFieldsByType(schema: SchemaDefinition, type: string): readonly string[]
function getRelationFields(schema: SchemaDefinition): Record<string, RelationField>
function getScalarFields(schema: SchemaDefinition): Record<string, FieldDefinition>

// Schema flags
function hasRelations(schema: SchemaDefinition): boolean
function hasTimestamps(schema: SchemaDefinition): boolean
function hasSoftDelete(schema: SchemaDefinition): boolean

// Field access
function getTableName(schema: SchemaDefinition): string
function getFieldNames(schema: SchemaDefinition): readonly string[]
function getField(schema: SchemaDefinition, fieldName: string): FieldDefinition | undefined
function hasField(schema: SchemaDefinition, fieldName: string): boolean
function isValidFieldName(schema: SchemaDefinition, fieldName: string): boolean
```

---

## Metadata Functions

```typescript
function extractFieldMetadata(
  fieldName: string,
  field: FieldDefinition
): FieldMetadata

function extractAllFieldMetadata(
  schema: SchemaDefinition
): Record<string, FieldMetadata>

function generateTypeScriptInterface(
  schema: SchemaDefinition,
  interfaceName?: string
): string
```

---

## Global Registry

```typescript
function getGlobalRegistry(): SchemaRegistry
function setGlobalRegistry(registry: SchemaRegistry): void
function resetGlobalRegistry(): void
```

---

## Types

```typescript
interface SchemaRegistryConfig {
  readonly strict?: boolean            // Default: true
  readonly allowOverwrite?: boolean    // Default: false
  readonly validateRelations?: boolean // Default: true
}

interface SchemaMetadata {
  readonly name: string
  readonly tableName: string
  readonly fieldCount: number
  readonly relationCount: number
  readonly indexCount: number
  readonly hasTimestamps: boolean
  readonly hasSoftDelete: boolean
  readonly registeredAt: Date
}

interface FieldMetadata {
  readonly name: string
  readonly type: string
  readonly typeName: string
  readonly required: boolean
  readonly optional: boolean
  readonly hasDefault: boolean
  readonly defaultValue: unknown
  readonly isRelation: boolean
  readonly isArray: boolean
  readonly isEnum: boolean
  readonly description?: string
  readonly enumValues?: readonly string[]
  readonly relationTarget?: string
  readonly relationKind?: 'hasOne' | 'hasMany' | 'belongsTo' | 'manyToMany'
}
```

---

## Source

- Schema registry - `packages/core/src/schema/registry.ts`
- Inference utilities - `packages/core/src/schema/inference.ts`
- Schema types - `packages/types/src/schema.ts`
