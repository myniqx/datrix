# Relations

> Configure database relations between schemas.

---

## Overview

Relations define how schemas connect to each other. Forja supports four relation types: hasOne, hasMany, belongsTo, and manyToMany.

Relations are virtual fields - they don't store data directly but define how to load related records.

---

## Relation Types

### hasOne (One-to-One)

One record has exactly one related record.

```typescript
const userSchema = {
  name: 'User',
  fields: {
    profile: {
      type: 'relation',
      model: 'Profile',
      kind: 'hasOne',
      foreignKey: 'userId'
    }
  }
};

const profileSchema = {
  name: 'Profile',
  fields: {
    userId: { type: 'string', required: true },
    bio: { type: 'string' }
  }
};
```

**Database structure:**
```
users table: id, email
profiles table: id, userId (FK), bio
```

### hasMany (One-to-Many)

One record has multiple related records.

```typescript
const userSchema = {
  name: 'User',
  fields: {
    posts: {
      type: 'relation',
      model: 'Post',
      kind: 'hasMany',
      foreignKey: 'authorId'
    }
  }
};

const postSchema = {
  name: 'Post',
  fields: {
    authorId: { type: 'string', required: true },
    title: { type: 'string', required: true }
  }
};
```

**Database structure:**
```
users table: id, email
posts table: id, authorId (FK), title
```

### belongsTo (Many-to-One)

Multiple records belong to one parent record.

```typescript
const postSchema = {
  name: 'Post',
  fields: {
    authorId: { type: 'string', required: true },
    author: {
      type: 'relation',
      model: 'User',
      kind: 'belongsTo',
      foreignKey: 'authorId'
    }
  }
};
```

**Database structure:**
```
posts table: id, authorId (FK), title
users table: id, email
```

### manyToMany (Many-to-Many)

Multiple records relate to multiple other records via junction table.

```typescript
const postSchema = {
  name: 'Post',
  fields: {
    tags: {
      type: 'relation',
      model: 'Tag',
      kind: 'manyToMany',
      through: 'PostTags'
    }
  }
};

const tagSchema = {
  name: 'Tag',
  fields: {
    name: { type: 'string', required: true }
  }
};
```

**Database structure:**
```
posts table: id, title
tags table: id, name
post_tags table: postId (FK), tagId (FK)
```

---

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | `'relation'` | Yes | Field type |
| `model` | `string` | Yes | Target schema name (PascalCase) |
| `kind` | `RelationKind` | Yes | Relation type |
| `foreignKey` | `string` | Conditional | FK field (required for hasOne, hasMany, belongsTo) |
| `through` | `string` | Conditional | Junction table (required for manyToMany) |

---

## Bidirectional Relations

Define relations on both sides:

```typescript
// User side
const userSchema = {
  name: 'User',
  fields: {
    posts: {
      type: 'relation',
      model: 'Post',
      kind: 'hasMany',
      foreignKey: 'authorId'
    }
  }
};

// Post side
const postSchema = {
  name: 'Post',
  fields: {
    authorId: { type: 'string', required: true },
    author: {
      type: 'relation',
      model: 'User',
      kind: 'belongsTo',
      foreignKey: 'authorId'
    }
  }
};
```

---

## Foreign Keys

Foreign key fields must be defined separately:

```typescript
// ✅ Correct
fields: {
  authorId: { type: 'string', required: true },  // FK field
  author: {                                       // Relation
    type: 'relation',
    model: 'User',
    kind: 'belongsTo',
    foreignKey: 'authorId'
  }
}

// ❌ Incorrect - missing FK field
fields: {
  author: {
    type: 'relation',
    model: 'User',
    kind: 'belongsTo',
    foreignKey: 'authorId'  // authorId field doesn't exist!
  }
}
```

---

## Junction Tables (Many-to-Many)

For manyToMany relations, create a junction table schema:

```typescript
const postTagsSchema = {
  name: 'PostTag',
  tableName: 'post_tags',
  fields: {
    postId: {
      type: 'string',
      required: true
    },
    tagId: {
      type: 'string',
      required: true
    }
  },
  indexes: [
    {
      fields: ['postId', 'tagId'],
      unique: true
    }
  ]
};
```

---

## Nested Relations

Relations can reference other relations (up to 5 levels deep):

```typescript
const userSchema = {
  name: 'User',
  fields: {
    posts: {
      type: 'relation',
      model: 'Post',
      kind: 'hasMany',
      foreignKey: 'authorId'
    }
  }
};

const postSchema = {
  name: 'Post',
  fields: {
    authorId: { type: 'string', required: true },
    comments: {
      type: 'relation',
      model: 'Comment',
      kind: 'hasMany',
      foreignKey: 'postId'
    }
  }
};

const commentSchema = {
  name: 'Comment',
  fields: {
    postId: { type: 'string', required: true },
    content: { type: 'string', required: true }
  }
};

// Can populate: User → Posts → Comments (3 levels)
```

---

## Loading Relations

Relations are loaded via `populate` in queries (handled by API layer):

```typescript
// This is handled by API layer, not directly by users
GET /api/users?populate[posts][populate][comments]=*
```

See adapter documentation for populate implementation details.

---

## Validation

Schema registry validates relations when `validateRelations: true`:

```typescript
const registry = new SchemaRegistry({
  validateRelations: true
});

// ❌ Error - target schema doesn't exist
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

registry.register(postSchema);
```

---

## Best Practices

**1. Always define foreign key fields**
```typescript
// ✅ Good
authorId: { type: 'string', required: true },
author: { type: 'relation', model: 'User', kind: 'belongsTo', foreignKey: 'authorId' }

// ❌ Bad
author: { type: 'relation', model: 'User', kind: 'belongsTo', foreignKey: 'authorId' }
```

**2. Use consistent FK naming**
```typescript
// ✅ Good - consistent pattern
authorId, postId, categoryId

// ❌ Bad - inconsistent
author_id, post, catId
```

**3. Define bidirectional relations**
```typescript
// ✅ Good - both sides defined
User.posts (hasMany)
Post.author (belongsTo)

// ⚠️ Acceptable but less convenient
User.posts (hasMany)
// Post.author missing
```

**4. Add unique indexes to manyToMany junction tables**
```typescript
// ✅ Good
indexes: [
  { fields: ['postId', 'tagId'], unique: true }
]

// ❌ Bad - allows duplicate relations
// No index
```

---

## Reference

**Source Code:**
- Relation types - `packages/types/src/schema.ts`
- Relation validation - `packages/core/src/schema/registry.ts`
- Relation utilities - `packages/core/src/schema/inference.ts`

**Related:**
- [Defining Schemas](./defining-schemas.md)
- [Field Types](./field-types.md)
- [Indexes](./indexes.md)
- [Populate (Query Builder)](../adapter-developer/query-builder.md#populate-clause-relations)
