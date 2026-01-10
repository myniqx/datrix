# Field Types Reference

> Complete reference for all field types supported in Forja schemas.

---

## String

Text data: emails, usernames, descriptions, URLs.

```typescript
email: {
  type: 'string',
  required: true,
  unique: true,
  pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
}
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | `'string'` | - | Required |
| `required` | `boolean` | `false` | Field is required |
| `default` | `string` | - | Default value |
| `minLength` | `number` | - | Minimum length |
| `maxLength` | `number` | - | Maximum length |
| `pattern` | `RegExp` | - | Validation regex |
| `unique` | `boolean` | `false` | Database unique constraint |

**Common Patterns:**

```typescript
// Email
pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// URL
pattern: /^https?:\/\/.+/

// Slug
pattern: /^[a-z0-9-]+$/

// UUID
pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
```

**Notes:**
- `unique` creates database constraint (not validated by core)
- `pattern` is case-sensitive
- Empty string `""` passes `minLength` unless `required: true`

---

## Number

Numeric data: age, price, quantity, ratings.

```typescript
age: {
  type: 'number',
  required: true,
  min: 18,
  max: 120,
  integer: true
}
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | `'number'` | - | Required |
| `required` | `boolean` | `false` | Field is required |
| `default` | `number` | - | Default value |
| `min` | `number` | - | Minimum value (inclusive) |
| `max` | `number` | - | Maximum value (inclusive) |
| `integer` | `boolean` | `false` | Must be integer |

**Examples:**

```typescript
// Price
price: {
  type: 'number',
  min: 0
}

// Rating (1-5)
rating: {
  type: 'number',
  min: 1,
  max: 5
}

// Stock count
stock: {
  type: 'number',
  min: 0,
  integer: true,
  default: 0
}
```

**Notes:**
- `min`/`max` are inclusive
- No automatic string → number coercion
- `Infinity`, `-Infinity`, `NaN` are invalid

---

## Boolean

Binary flags: active/inactive, verified, enabled.

```typescript
isActive: {
  type: 'boolean',
  default: true
}
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | `'boolean'` | - | Required |
| `required` | `boolean` | `false` | Field is required |
| `default` | `boolean` | - | Default value |

**Examples:**

```typescript
emailVerified: {
  type: 'boolean',
  required: true,
  default: false
}
```

**Notes:**
- No truthy/falsy conversion (only `true`/`false`)
- `1`, `0`, `"true"` are invalid

---

## Date

Temporal data: timestamps, birth dates, deadlines.

```typescript
birthDate: {
  type: 'date',
  required: true,
  min: new Date('1900-01-01'),
  max: new Date()
}
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | `'date'` | - | Required |
| `required` | `boolean` | `false` | Field is required |
| `default` | `Date` | - | Default value |
| `min` | `Date` | - | Minimum date (inclusive) |
| `max` | `Date` | - | Maximum date (inclusive) |

**Examples:**

```typescript
// Event date
eventDate: {
  type: 'date',
  required: true,
  min: new Date()  // Future dates only
}

// Created timestamp
createdAt: {
  type: 'date',
  default: () => new Date()
}
```

**Notes:**
- Accepts `Date` objects, not ISO strings
- Adapters handle database-specific serialization

---

## Enum

Fixed set of values: status, role, category.

```typescript
role: {
  type: 'enum',
  values: ['user', 'admin', 'moderator'],
  default: 'user'
}
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | `'enum'` | - | Required |
| `values` | `string[]` | - | Required. Allowed values |
| `required` | `boolean` | `false` | Field is required |
| `default` | `string` | - | Default (must be in `values`) |

**TypeScript Type Safety:**

```typescript
const USER_ROLES = ['user', 'admin', 'moderator'] as const;

role: {
  type: 'enum',
  values: USER_ROLES,
  default: 'user'
}

type UserRole = typeof USER_ROLES[number]; // 'user' | 'admin' | 'moderator'
```

**Notes:**
- Case-sensitive
- Only string values (no number enums)
- `default` must exist in `values`

---

## JSON

Structured data: metadata, settings, config.

```typescript
metadata: {
  type: 'json',
  default: {}
}
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | `'json'` | - | Required |
| `required` | `boolean` | `false` | Field is required |
| `default` | `object \| array` | - | Default value |

**Examples:**

```typescript
settings: {
  type: 'json',
  default: {
    theme: 'dark',
    notifications: true
  }
}

tags: {
  type: 'json',
  default: []
}
```

**Notes:**
- Accepts any JSON-serializable value
- Database-specific storage (JSONB in PostgreSQL, JSON in MySQL)

---

## Array

Collections: tags, IDs, attachments.

```typescript
tags: {
  type: 'array',
  items: { type: 'string' },
  minItems: 1,
  maxItems: 10,
  unique: true
}
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | `'array'` | - | Required |
| `items` | `FieldDefinition` | - | Required. Item type |
| `required` | `boolean` | `false` | Field is required |
| `default` | `unknown[]` | - | Default value |
| `minItems` | `number` | - | Minimum length |
| `maxItems` | `number` | - | Maximum length |
| `unique` | `boolean` | `false` | All items must be unique |

**Examples:**

```typescript
// String array
tags: {
  type: 'array',
  items: { type: 'string' },
  maxItems: 10
}

// Number array
scores: {
  type: 'array',
  items: { type: 'number', min: 0, max: 100 },
  default: []
}
```

**Notes:**
- Max nesting depth: 10 levels
- `unique` checks item equality (strict)

---

## Relation

Database relations: foreign keys, joins.

```typescript
posts: {
  type: 'relation',
  model: 'Post',
  kind: 'hasMany',
  foreignKey: 'authorId'
}
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | `'relation'` | - | Required |
| `model` | `string` | - | Required. Target schema name |
| `kind` | `RelationKind` | - | Required. Relation type |
| `foreignKey` | `string` | - | Foreign key field |
| `through` | `string` | - | Junction table (manyToMany) |

**Relation Kinds:**

```typescript
// One-to-one
profile: {
  type: 'relation',
  model: 'Profile',
  kind: 'hasOne',
  foreignKey: 'userId'
}

// One-to-many
posts: {
  type: 'relation',
  model: 'Post',
  kind: 'hasMany',
  foreignKey: 'authorId'
}

// Many-to-one
author: {
  type: 'relation',
  model: 'User',
  kind: 'belongsTo',
  foreignKey: 'authorId'
}

// Many-to-many
tags: {
  type: 'relation',
  model: 'Tag',
  kind: 'manyToMany',
  through: 'PostTags'
}
```

**Notes:**
- Relations are not stored in database (virtual fields)
- Loaded via `populate` in queries
- See: [Relations Guide](./relations.md)

---

## File

File uploads: images, documents, attachments.

```typescript
avatar: {
  type: 'file',
  allowedTypes: ['image/jpeg', 'image/png'],
  maxSize: 5 * 1024 * 1024  // 5MB
}
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | `'file'` | - | Required |
| `required` | `boolean` | `false` | Field is required |
| `allowedTypes` | `string[]` | - | MIME types |
| `maxSize` | `number` | - | Max file size (bytes) |

**Examples:**

```typescript
// Image upload
avatar: {
  type: 'file',
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxSize: 2 * 1024 * 1024  // 2MB
}

// Document upload
document: {
  type: 'file',
  allowedTypes: ['application/pdf', 'application/msword'],
  maxSize: 10 * 1024 * 1024  // 10MB
}
```

**Notes:**
- Requires Upload plugin for actual storage
- Stores file metadata (URL, size, MIME type)
- Validation happens at upload time

---

## Type Inference

Forja automatically infers TypeScript types:

```typescript
const schema = {
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

---

## Reference

**Source Code:**
- Field definitions: `packages/types/src/schema.ts`
- Validation: `packages/core/src/validator/`
- Type inference: `packages/core/src/schema/inference.ts`

**Related:**
- [Schema Definition Guide](./defining-schemas.md)
- [Relations Guide](./relations.md)
- [Indexes Guide](./indexes.md)
