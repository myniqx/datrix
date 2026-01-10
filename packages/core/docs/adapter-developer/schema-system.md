# Schema System

> Schema utilities and metadata for adapters.

---

## Overview

Adapters use schema definitions to generate database structures. Core provides utilities for schema analysis and metadata extraction.

---

## Schema Utilities

All utilities are in `forja-core/schema`:

```typescript
import {
  getTableName,
  getFieldNames,
  getRequiredFields,
  getRelationFields,
  hasTimestamps,
  extractFieldMetadata
} from 'forja-core';
```

---

## Table Names

### getTableName()

Get database table name (pluralized):

```typescript
const schema = {
  name: 'User',
  fields: { ... }
};

const tableName = getTableName(schema);
// 'users'
```

**Custom table name:**
```typescript
const schema = {
  name: 'User',
  tableName: 'user_accounts',
  fields: { ... }
};

const tableName = getTableName(schema);
// 'user_accounts'
```

**Pluralization rules:**
- User → users
- Post → posts
- Category → categories
- Person → people (irregular)
- Child → children (irregular)

---

## Field Access

### getFieldNames()

Get all field names:

```typescript
const fieldNames = getFieldNames(schema);
// ['id', 'email', 'name', 'createdAt', 'updatedAt']
```

### getField()

Get specific field definition:

```typescript
const emailField = getField(schema, 'email');
// { type: 'string', required: true, unique: true }
```

### hasField()

Check if field exists:

```typescript
if (hasField(schema, 'email')) {
  // Field exists
}
```

---

## Field Filtering

### getRequiredFields()

Get required field names:

```typescript
const required = getRequiredFields(schema);
// ['email', 'name']
```

### getOptionalFields()

Get optional field names:

```typescript
const optional = getOptionalFields(schema);
// ['age', 'bio']
```

### getFieldsByType()

Get fields of specific type:

```typescript
const stringFields = getFieldsByType(schema, 'string');
// ['email', 'name', 'bio']

const relationFields = getFieldsByType(schema, 'relation');
// ['posts', 'comments']
```

### getRelationFields()

Get all relation fields:

```typescript
const relations = getRelationFields(schema);
// {
//   posts: { type: 'relation', model: 'Post', kind: 'hasMany', ... },
//   profile: { type: 'relation', model: 'Profile', kind: 'hasOne', ... }
// }
```

### getScalarFields()

Get non-relation fields:

```typescript
const scalars = getScalarFields(schema);
// {
//   id: { type: 'string', ... },
//   email: { type: 'string', ... },
//   name: { type: 'string', ... }
// }
```

---

## Schema Flags

### hasTimestamps()

Check if schema has timestamps:

```typescript
if (hasTimestamps(schema)) {
  // Add createdAt, updatedAt columns
}
```

### hasSoftDelete()

Check if schema has soft delete:

```typescript
if (hasSoftDelete(schema)) {
  // Add deletedAt column
}
```

### hasRelations()

Check if schema has any relations:

```typescript
if (hasRelations(schema)) {
  // Handle foreign keys
}
```

---

## Field Metadata

### extractFieldMetadata()

Get detailed field metadata:

```typescript
const metadata = extractFieldMetadata('email', schema.fields.email);

// {
//   name: 'email',
//   type: 'string',
//   typeName: 'string',
//   required: true,
//   optional: false,
//   hasDefault: false,
//   defaultValue: undefined,
//   isRelation: false,
//   isArray: false,
//   isEnum: false
// }
```

### extractAllFieldMetadata()

Get metadata for all fields:

```typescript
const allMetadata = extractAllFieldMetadata(schema);

// {
//   email: { name: 'email', type: 'string', ... },
//   age: { name: 'age', type: 'number', ... }
// }
```

---

## Type Inference

### inferFieldType()

Get human-readable field type:

```typescript
const fieldType = inferFieldType(schema.fields.email);
// 'string'

const arrayType = inferFieldType({ type: 'array', items: { type: 'string' } });
// 'string[]'

const enumType = inferFieldType({ type: 'enum', values: ['a', 'b'] });
// '"a" | "b"'
```

### generateTypeScriptInterface()

Generate TypeScript interface from schema:

```typescript
const tsInterface = generateTypeScriptInterface(schema, 'User');

// Output:
// interface User {
//   email: string;
//   age?: number;
//   role?: 'user' | 'admin';
// }
```

---

## Type Guards

### isRelationField()

Check if field is relation:

```typescript
if (isRelationField(field)) {
  // field is RelationField
  const { model, kind, foreignKey } = field;
}
```

### isArrayField()

Check if field is array:

```typescript
if (isArrayField(field)) {
  // field is ArrayField
  const { items, minItems, maxItems } = field;
}
```

### isEnumField()

Check if field is enum:

```typescript
if (isEnumField(field)) {
  // field is EnumField
  const { values, default } = field;
}
```

---

## Common Patterns

### Generate CREATE TABLE

```typescript
function generateCreateTableSQL(schema: SchemaDefinition): string {
  const tableName = getTableName(schema);
  const columns: string[] = [];

  // Add scalar fields
  const scalars = getScalarFields(schema);
  for (const [name, field] of Object.entries(scalars)) {
    const columnDef = generateColumnDefinition(name, field);
    columns.push(columnDef);
  }

  // Add timestamps
  if (hasTimestamps(schema)) {
    columns.push('created_at TIMESTAMP DEFAULT NOW()');
    columns.push('updated_at TIMESTAMP DEFAULT NOW()');
  }

  // Add soft delete
  if (hasSoftDelete(schema)) {
    columns.push('deleted_at TIMESTAMP NULL');
  }

  return `CREATE TABLE ${tableName} (\n  ${columns.join(',\n  ')}\n);`;
}
```

### Generate Column Definition

```typescript
function generateColumnDefinition(name: string, field: FieldDefinition): string {
  let def = `${name} ${mapFieldTypeToSQL(field)}`;

  if (isFieldRequired(field)) {
    def += ' NOT NULL';
  }

  if (hasDefaultValue(field)) {
    const defaultValue = getDefaultValue(field);
    def += ` DEFAULT ${formatDefaultValue(defaultValue)}`;
  }

  if (field.type === 'string' && field.unique) {
    def += ' UNIQUE';
  }

  return def;
}
```

### Validate Foreign Keys

```typescript
function validateForeignKeys(schema: SchemaDefinition, registry: SchemaRegistry): void {
  const relations = getRelationFields(schema);

  for (const [name, relation] of Object.entries(relations)) {
    // Check target schema exists
    const targetSchema = registry.get(relation.model);
    if (!targetSchema) {
      throw new Error(`Relation ${name} references non-existent schema ${relation.model}`);
    }

    // Check foreign key field exists
    if (relation.foreignKey && !hasField(schema, relation.foreignKey)) {
      throw new Error(`Foreign key ${relation.foreignKey} not found in schema`);
    }
  }
}
```

---

## Reference

**Source Code:**
- Schema inference - `packages/core/src/schema/inference.ts`
- Schema registry - `packages/core/src/schema/registry.ts`
- Schema types - `packages/types/src/schema.ts`

**Related:**
- [Migration System](./migration-system.md)
- [Query Builder](./query-builder.md)
- [Schema Definition Guide](../user-guide/defining-schemas.md)
