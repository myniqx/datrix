# Indexes

> Configure database indexes for performance optimization.

---

## Overview

Indexes improve query performance by creating efficient lookup structures. Define indexes in schema definitions for automatic creation during migrations.

---

## Basic Index

```typescript
const userSchema = {
  name: 'User',
  fields: {
    email: { type: 'string', required: true }
  },
  indexes: [
    {
      fields: ['email'],
      unique: true
    }
  ]
};
```

---

## Index Structure

```typescript
interface IndexDefinition {
  readonly fields: readonly string[]
  readonly unique?: boolean
  readonly name?: string
}
```

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `fields` | `string[]` | - | Required. Fields to index |
| `unique` | `boolean` | `false` | Unique constraint |
| `name` | `string` | Auto-generated | Custom index name |

---

## Single Field Index

```typescript
indexes: [
  {
    fields: ['email']
  }
]
```

**Generated SQL (PostgreSQL):**
```sql
CREATE INDEX idx_users_email ON users (email);
```

---

## Unique Index

```typescript
indexes: [
  {
    fields: ['email'],
    unique: true
  }
]
```

**Generated SQL (PostgreSQL):**
```sql
CREATE UNIQUE INDEX idx_users_email ON users (email);
```

---

## Composite Index

Index on multiple fields:

```typescript
indexes: [
  {
    fields: ['category', 'status']
  }
]
```

**Generated SQL (PostgreSQL):**
```sql
CREATE INDEX idx_users_category_status ON users (category, status);
```

**Note:** Field order matters for query optimization.

---

## Custom Index Name

```typescript
indexes: [
  {
    fields: ['email'],
    unique: true,
    name: 'unique_user_email'
  }
]
```

**Generated SQL (PostgreSQL):**
```sql
CREATE UNIQUE INDEX unique_user_email ON users (email);
```

---

## Multiple Indexes

```typescript
const productSchema = {
  name: 'Product',
  fields: {
    sku: { type: 'string', required: true },
    name: { type: 'string', required: true },
    category: { type: 'string' },
    status: { type: 'string' }
  },
  indexes: [
    {
      fields: ['sku'],
      unique: true
    },
    {
      fields: ['category', 'status']
    },
    {
      fields: ['name']
    }
  ]
};
```

---

## Index on Foreign Keys

Always index foreign key fields for join performance:

```typescript
const postSchema = {
  name: 'Post',
  fields: {
    authorId: { type: 'string', required: true },
    categoryId: { type: 'string' }
  },
  indexes: [
    {
      fields: ['authorId']  // FK to users table
    },
    {
      fields: ['categoryId']  // FK to categories table
    }
  ]
};
```

---

## Unique Constraints

Unique indexes enforce data uniqueness at database level:

```typescript
const userSchema = {
  name: 'User',
  fields: {
    email: { type: 'string', required: true },
    username: { type: 'string', required: true }
  },
  indexes: [
    {
      fields: ['email'],
      unique: true
    },
    {
      fields: ['username'],
      unique: true
    }
  ]
};
```

**Note:** Unique constraints in field definitions vs indexes:
- `unique: true` in field definition → documented intent
- `unique: true` in index → enforced by database

Always use both for clarity.

---

## Composite Unique Index

Ensure combination of fields is unique:

```typescript
const postTagSchema = {
  name: 'PostTag',
  fields: {
    postId: { type: 'string', required: true },
    tagId: { type: 'string', required: true }
  },
  indexes: [
    {
      fields: ['postId', 'tagId'],
      unique: true  // Prevent duplicate post-tag relations
    }
  ]
};
```

---

## Index Naming Convention

**Auto-generated names:**
- Pattern: `idx_{table}_{field1}_{field2}`
- Example: `idx_users_email`
- Example: `idx_posts_category_status`

**Custom names:**
- Use descriptive names
- Include `idx_` or `unique_` prefix
- Example: `unique_user_email`
- Example: `idx_posts_published_date`

---

## Performance Considerations

**When to add indexes:**
- Foreign key fields (always)
- Fields used in WHERE clauses frequently
- Fields used in ORDER BY
- Fields used in JOIN conditions
- Unique constraints

**When NOT to add indexes:**
- Fields rarely queried
- Small tables (<1000 rows)
- Fields with low cardinality (few unique values)
- Write-heavy tables (indexes slow INSERT/UPDATE)

---

## Best Practices

**1. Index all foreign keys**
```typescript
// ✅ Good
fields: {
  authorId: { type: 'string', required: true }
},
indexes: [
  { fields: ['authorId'] }
]

// ❌ Bad - FK without index
fields: {
  authorId: { type: 'string', required: true }
}
```

**2. Use composite indexes for common query patterns**
```typescript
// If queries often filter by category AND status together
indexes: [
  { fields: ['category', 'status'] }
]

// More efficient than separate indexes for combined queries
```

**3. Order fields in composite indexes by selectivity**
```typescript
// ✅ Good - most selective field first
{ fields: ['userId', 'status'] }  // userId is more selective

// ❌ Bad - less selective field first
{ fields: ['status', 'userId'] }  // status has few unique values
```

**4. Don't over-index**
```typescript
// ❌ Bad - too many indexes on small table
indexes: [
  { fields: ['email'] },
  { fields: ['name'] },
  { fields: ['age'] },
  { fields: ['city'] },
  { fields: ['country'] }
]
```

---

## Limitations

- Maximum fields per index: Database-specific (typically 32)
- Index name length: Database-specific (PostgreSQL: 63 chars)
- Total indexes per table: No hard limit, but impacts write performance

---

## Reference

**Source Code:**
- Index types - `packages/types/src/schema.ts`
- Migration generation - `packages/core/src/migration/generator.ts`

**Related:**
- [Defining Schemas](./defining-schemas.md)
- [Relations](./relations.md)
- [Migration System](../adapter-developer/migration-system.md)
