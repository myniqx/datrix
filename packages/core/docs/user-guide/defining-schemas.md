# Defining Schemas

> Create database schemas with TypeScript type safety.

---

## Overview

Schemas define your database structure: tables, fields, relations, and indexes. Forja uses these definitions to generate migrations, validate data, and build queries.

---

## Basic Schema

```typescript
const userSchema = {
  name: 'User',
  fields: {
    email: {
      type: 'string',
      required: true,
      unique: true
    },
    age: {
      type: 'number',
      min: 18
    }
  }
};
```

---

## Schema Structure

```typescript
interface SchemaDefinition {
  readonly name: string
  readonly tableName?: string
  readonly fields: Record<string, FieldDefinition>
  readonly indexes?: readonly IndexDefinition[]
  readonly timestamps?: boolean
  readonly softDelete?: boolean
  readonly description?: string
}
```

### Required Fields

**`name`** - Schema name (PascalCase recommended)
- Used for registry lookup
- Referenced in relations
- Example: `'User'`, `'BlogPost'`, `'ProductCategory'`

**`fields`** - Field definitions
- Object with field names as keys
- Each value is a `FieldDefinition`
- See [Field Types](./field-types.md) for all types

### Optional Fields

**`tableName`** - Custom table name
- Default: Pluralized lowercase `name` (User → users)
- Override for custom names
- Example: `'user_accounts'`, `'blog_posts'`

**`indexes`** - Database indexes
- Array of index definitions
- See [Indexes](./indexes.md) for details

**`timestamps`** - Auto-managed timestamp fields
- Default: `false`
- When `true`, adds `createdAt` and `updatedAt` fields
- Automatically updated by adapters

**`softDelete`** - Soft delete support
- Default: `false`
- When `true`, adds `deletedAt` field
- Requires Soft Delete plugin

**`description`** - Schema documentation
- Optional description string
- Not used by core, helpful for documentation

---

## Table Name Pluralization

Forja automatically pluralizes schema names:

```typescript
User → users
Post → posts
Category → categories
Person → people (irregular plural)
Child → children (irregular plural)
```

**Override:**
```typescript
const schema = {
  name: 'User',
  tableName: 'user_accounts'  // Custom table name
};
```

---

## Timestamps

Enable automatic timestamp fields:

```typescript
const postSchema = {
  name: 'Post',
  fields: {
    title: { type: 'string', required: true }
  },
  timestamps: true  // Adds createdAt, updatedAt
};
```

**Generated fields:**
```typescript
createdAt: {
  type: 'date',
  required: true,
  default: () => new Date()
}

updatedAt: {
  type: 'date',
  required: true,
  default: () => new Date()
}
```

Adapters automatically update `updatedAt` on modifications.

---

## Soft Delete

Enable soft delete functionality:

```typescript
const userSchema = {
  name: 'User',
  fields: {
    email: { type: 'string', required: true }
  },
  softDelete: true  // Adds deletedAt field
};
```

**Generated field:**
```typescript
deletedAt: {
  type: 'date',
  required: false,
  default: null
}
```

Requires Soft Delete plugin to intercept delete operations.

---

## Multiple Schemas

```typescript
const userSchema = {
  name: 'User',
  fields: {
    email: { type: 'string', required: true }
  }
};

const postSchema = {
  name: 'Post',
  fields: {
    title: { type: 'string', required: true },
    authorId: { type: 'string', required: true }
  }
};

const commentSchema = {
  name: 'Comment',
  fields: {
    content: { type: 'string', required: true },
    postId: { type: 'string', required: true }
  }
};
```

---

## Schema Registry

Register schemas with the global registry:

```typescript
import { SchemaRegistry } from 'forja-core';

const registry = new SchemaRegistry({
  strict: true,
  validateRelations: true
});

// Register single schema
const result = registry.register(userSchema);

// Register multiple schemas
const result = registry.registerMany([
  userSchema,
  postSchema,
  commentSchema
]);

// Retrieve schema
const schema = registry.get('User');

// Check existence
if (registry.has('User')) {
  // Schema exists
}
```

See [Schema Access](../plugin-developer/schema-access.md) for full registry API.

---

## TypeScript Type Inference

Schemas automatically infer TypeScript types:

```typescript
const userSchema = {
  name: 'User',
  fields: {
    email: { type: 'string', required: true },
    age: { type: 'number' },
    role: { type: 'enum', values: ['user', 'admin'] as const }
  }
} as const;

// Inferred type:
type User = {
  email: string;
  age?: number;
  role?: 'user' | 'admin';
}
```

**Note:** Use `as const` for proper type inference.

---

## Validation

Schemas are validated when registered:

```typescript
const registry = new SchemaRegistry({ strict: true });

// Invalid schema (duplicate name)
registry.register({ name: 'User', fields: {} });
registry.register({ name: 'User', fields: {} }); // Error!

// Invalid relation (target schema doesn't exist)
const postSchema = {
  name: 'Post',
  fields: {
    author: {
      type: 'relation',
      model: 'NonExistent',  // Error!
      kind: 'belongsTo'
    }
  }
};
```

---

## Best Practices

**1. Use PascalCase for schema names**
```typescript
// ✅ Good
name: 'User'
name: 'BlogPost'

// ❌ Bad
name: 'user'
name: 'blog_post'
```

**2. Use `as const` for type inference**
```typescript
// ✅ Good
const schema = { ... } as const;

// ❌ Bad (loses type inference)
const schema = { ... };
```

**3. Keep fields flat (no nested objects)**
```typescript
// ✅ Good
address: { type: 'json' }

// ❌ Bad (not supported)
address: {
  street: { type: 'string' },
  city: { type: 'string' }
}
```

**4. Use relations instead of foreign key fields**
```typescript
// ✅ Good
author: {
  type: 'relation',
  model: 'User',
  kind: 'belongsTo',
  foreignKey: 'authorId'
}

// ❌ Bad (define relation, not just FK)
authorId: { type: 'string' }
```

---

## Reference

**Source Code:**
- Schema types - `packages/types/src/schema.ts`
- Schema registry - `packages/core/src/schema/registry.ts`
- Schema utilities - `packages/core/src/schema/inference.ts`

**Related:**
- [Field Types](./field-types.md) - All field type definitions
- [Relations](./relations.md) - Relation configuration
- [Indexes](./indexes.md) - Index configuration
- [Schema Access](../plugin-developer/schema-access.md) - Registry API
