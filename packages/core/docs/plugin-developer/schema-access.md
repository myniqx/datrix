# Schema Access

> SchemaRegistry API for plugins.

---

## Overview

Plugins access registered schemas via `SchemaRegistry`. Available in plugin context and `onSchemaLoad()` hook.

---

## Accessing Registry

```typescript
class MyPlugin extends BasePlugin {
  async init(context: PluginContext): Promise<Result<void, PluginError>> {
    // Access from context
    const registry = context.schemas;

    // Get schema
    const userSchema = registry.get('User');

    return { success: true, data: undefined };
  }

  async onSchemaLoad(schemas: SchemaRegistry): Promise<void> {
    // Direct access in hook
    const postSchema = schemas.get('Post');
  }
}
```

---

## Registry Methods

### get()

Retrieve schema by name.

```typescript
const schema = registry.get('User');

if (schema) {
  // Schema exists
  const { name, fields, indexes } = schema;
}
```

Returns `undefined` if schema doesn't exist.

### has()

Check if schema exists.

```typescript
if (registry.has('User')) {
  const schema = registry.get('User');
}
```

### getAll()

Get all registered schemas.

```typescript
const allSchemas = registry.getAll();

for (const schema of allSchemas) {
  console.log(schema.name);
}
```

### getNames()

Get all schema names.

```typescript
const names = registry.getNames();
// ['User', 'Post', 'Comment']
```

### size

Number of registered schemas.

```typescript
const count = registry.size;
console.log(`${count} schemas registered`);
```

---

## Metadata Access

### getMetadata()

Get schema metadata.

```typescript
const metadata = registry.getMetadata('User');

if (metadata) {
  const {
    name,           // 'User'
    tableName,      // 'users'
    fieldCount,     // 5
    relationCount,  // 2
    indexCount,     // 1
    hasTimestamps,  // true
    hasSoftDelete,  // false
    registeredAt    // Date
  } = metadata;
}
```

### getAllMetadata()

Get metadata for all schemas.

```typescript
const allMetadata = registry.getAllMetadata();

for (const meta of allMetadata) {
  console.log(`${meta.name}: ${meta.fieldCount} fields`);
}
```

---

## Relation Queries

### getSchemasWithRelations()

Get schemas that have relation fields.

```typescript
const schemasWithRelations = registry.getSchemasWithRelations();

for (const schema of schemasWithRelations) {
  // Schema has at least one relation field
}
```

### getRelatedSchemas()

Get names of schemas referenced by a schema's relations.

```typescript
const relatedSchemas = registry.getRelatedSchemas('Post');
// ['User', 'Comment', 'Tag']
```

### getReferencingSchemas()

Get schemas that reference this schema.

```typescript
const referencingSchemas = registry.getReferencingSchemas('User');
// ['Post', 'Comment']  (schemas with relations to User)
```

---

## Field Queries

### findByFieldType()

Find schemas with specific field type.

```typescript
const schemasWithFiles = registry.findByFieldType('file');
// All schemas with file upload fields

const schemasWithRelations = registry.findByFieldType('relation');
// All schemas with relations
```

---

## Validation

### validateRelations()

Validate all relations reference existing schemas.

```typescript
const result = registry.validateRelations();

if (!result.success) {
  console.error('Invalid relations:', result.error);
}
```

---

## Locking

Registry can be locked to prevent modifications:

```typescript
registry.lock();

// ❌ These will throw
registry.register(newSchema);
registry.remove('User');

// Check lock status
if (registry.isLocked()) {
  // Registry is locked
}

// Unlock (usually not needed in plugins)
registry.unlock();
```

**Note:** Registry is typically locked after initialization. Plugins should not modify schemas.

---

## Common Patterns

### Validate Plugin Requirements

```typescript
async init(context: PluginContext): Promise<Result<void, PluginError>> {
  // Check required schemas exist
  if (!context.schemas.has('User')) {
    return {
      success: false,
      error: this.createError(
        'User schema required for auth plugin',
        'MISSING_SCHEMA'
      )
    };
  }

  return { success: true, data: undefined };
}
```

### Cache Schema Metadata

```typescript
private schemaMetadata: Map<string, SchemaMetadata> = new Map();

async onSchemaLoad(schemas: SchemaRegistry): Promise<void> {
  // Cache metadata for performance
  for (const name of schemas.getNames()) {
    const metadata = schemas.getMetadata(name);
    if (metadata) {
      this.schemaMetadata.set(name, metadata);
    }
  }
}
```

### Find Schemas with Specific Fields

```typescript
async onSchemaLoad(schemas: SchemaRegistry): Promise<void> {
  // Find all schemas with deletedAt field
  const softDeleteSchemas = schemas.getAll().filter(schema =>
    'deletedAt' in schema.fields
  );

  // Store for later use
  this.softDeleteTables = softDeleteSchemas.map(s =>
    schemas.getMetadata(s.name)?.tableName
  );
}
```

---

## Best Practices

**1. Don't modify schemas**
```typescript
// ❌ Don't do this
async onSchemaLoad(schemas: SchemaRegistry): Promise<void> {
  const schema = schemas.get('User')!;
  schema.fields.newField = { type: 'string' };  // Mutation!
}

// ✅ Read-only access
async onSchemaLoad(schemas: SchemaRegistry): Promise<void> {
  const schema = schemas.get('User');
  const fieldNames = Object.keys(schema?.fields || {});
}
```

**2. Check schema existence**
```typescript
// ❌ Unsafe
const schema = registry.get('User')!;  // Might be undefined

// ✅ Safe
const schema = registry.get('User');
if (!schema) {
  return { success: false, error: ... };
}
```

**3. Cache expensive queries**
```typescript
// ✅ Cache in onSchemaLoad
private relationSchemas: Set<string> = new Set();

async onSchemaLoad(schemas: SchemaRegistry): Promise<void> {
  this.relationSchemas = new Set(
    schemas.getSchemasWithRelations().map(s => s.name)
  );
}

// Use cache in hooks
async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
  if (this.relationSchemas.has(query.table)) {
    // Has relations
  }
}
```

---

## Reference

**Source Code:**
- SchemaRegistry class - `packages/core/src/schema/registry.ts`
- Schema types - `packages/types/src/schema.ts`
- Metadata extraction - `packages/core/src/schema/inference.ts`

**Related:**
- [Getting Started](./getting-started.md)
- [Hooks](./hooks.md)
- [Defining Schemas](../user-guide/defining-schemas.md)
