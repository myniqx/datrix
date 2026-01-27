# JsonAdapter - Standalone Usage Guide

This guide covers using JsonAdapter **without** Forja framework. For Forja integration, see [README.md](./README.md).

## Table of Contents

1. [Setup & Basic Operations](#1-setup--basic-operations)
2. [Relations & Populate](#2-relations--populate)
3. [Query Operations](#3-query-operations)
4. [Schema Management](#4-schema-management)
5. [Best Practices](#5-best-practices)

---

## 1. Setup & Basic Operations

### Connection

```typescript
import { JsonAdapter } from "forja-adapter-json";

const adapter = new JsonAdapter({
  root: "./data",
  cacheMaxAge: 5000 // optional, default: 5000ms
});

// Connect (creates root directory if needed)
await adapter.connect();

// Always disconnect when done
await adapter.disconnect();
```

### CRUD Operations

```typescript
// Create table first (standalone requires manual tableName)
await adapter.createTable({
  name: "User",
  tableName: "users",
  fields: {
    name: { type: "string", required: true },
    email: { type: "string", required: true },
    age: { type: "number", required: false }
  }
});

// INSERT
const insertResult = await adapter.executeQuery({
  type: "insert",
  table: "users",
  data: { name: "Alice", email: "alice@example.com", age: 30 }
});

if (insertResult.success) {
  console.log("Inserted ID:", insertResult.data.rows[0].id);
}

// SELECT
const selectResult = await adapter.executeQuery({
  type: "select",
  table: "users",
  where: { age: { $gte: 18 } }
});

if (selectResult.success) {
  console.log("Users:", selectResult.data.rows);
}

// UPDATE
await adapter.executeQuery({
  type: "update",
  table: "users",
  where: { id: 1 },
  data: { age: 31 }
});

// DELETE
await adapter.executeQuery({
  type: "delete",
  table: "users",
  where: { id: 1 }
});

// COUNT
const countResult = await adapter.executeQuery({
  type: "count",
  table: "users",
  where: { age: { $gte: 18 } }
});

console.log("Count:", countResult.data.count);
```

---

## 2. Relations & Populate

### Relation Types Overview

| Type | Example | FK Location | Populate Result | Use Case |
|------|---------|-------------|-----------------|----------|
| **belongsTo** | Post → User | `Post.authorId` | Single object or null | Many posts belong to one user |
| **hasMany** | User → Posts | `Post.authorId` | Array (can be empty) | One user has many posts |
| **hasOne** | User → Profile | `Profile.userId` | Single object or null | One user has one profile |
| **manyToMany** | Post ↔ Category | Junction table | Array (can be empty) | Many posts, many categories |

### Populate Syntax

```typescript
// Simple populate - all fields
populate: { author: "*" }

// With field selection
populate: {
  author: {
    select: ["name", "email"]
  }
}

// Nested populate (multi-level)
populate: {
  author: {
    select: ["name"],
    populate: {
      profile: "*"
    }
  }
}

// Multiple relations
populate: {
  author: "*",
  comments: "*",
  tags: { select: ["name"] }
}
```

### belongsTo Example

```typescript
// Schema definition
await adapter.createTable({
  name: "Post",
  tableName: "posts",
  fields: {
    title: { type: "string", required: true },
    authorId: { type: "number", required: true },
    author: {
      type: "relation",
      kind: "belongsTo",
      model: "User",
      foreignKey: "authorId"
    }
  }
});

// Query with populate
const result = await adapter.executeQuery({
  type: "select",
  table: "posts",
  populate: {
    author: {
      select: ["name", "email"]
    }
  }
});

// Result structure
{
  id: 1,
  title: "Hello World",
  authorId: 1,
  author: {
    name: "Alice",
    email: "alice@example.com"
  }
}
```

### hasMany Example

```typescript
// Schema definition
await adapter.createTable({
  name: "User",
  tableName: "users",
  fields: {
    name: { type: "string", required: true },
    posts: {
      type: "relation",
      kind: "hasMany",
      model: "Post",
      foreignKey: "authorId"
    }
  }
});

// Query with populate
const result = await adapter.executeQuery({
  type: "select",
  table: "users",
  populate: {
    posts: {
      select: ["title"],
      orderBy: [{ field: "createdAt", direction: "desc" }]
    }
  }
});

// Result structure
{
  id: 1,
  name: "Alice",
  posts: [
    { title: "Post 1" },
    { title: "Post 2" }
  ]
}
```

### hasOne Example

```typescript
// Schema definition
await adapter.createTable({
  name: "User",
  tableName: "users",
  fields: {
    name: { type: "string", required: true },
    profile: {
      type: "relation",
      kind: "hasOne",
      model: "Profile",
      foreignKey: "userId"
    }
  }
});

await adapter.createTable({
  name: "Profile",
  tableName: "profiles",
  fields: {
    bio: { type: "string", required: true },
    userId: { type: "number", required: true }
  }
});

// Query with populate
const result = await adapter.executeQuery({
  type: "select",
  table: "users",
  where: { id: 1 },
  populate: { profile: "*" }
});

// Result structure
{
  id: 1,
  name: "Alice",
  profile: {
    id: 1,
    bio: "Developer",
    userId: 1
  }
}
```

### manyToMany Example

**Important:** Foreign keys in junction table must follow `${schemaName}Id` format, where `schemaName` is the exact `name` field from the related schema definition.

```typescript
// Schema definitions
await adapter.createTable({
  name: "Post",
  tableName: "posts",
  fields: {
    title: { type: "string", required: true },
    categories: {
      type: "relation",
      kind: "manyToMany",
      model: "Category",
      through: "post_categories" // Junction table name
    }
  }
});

await adapter.createTable({
  name: "Category",
  tableName: "categories",
  fields: {
    name: { type: "string", required: true },
    posts: {
      type: "relation",
      kind: "manyToMany",
      model: "Post",
      through: "post_categories"
    }
  }
});

// Junction table
// Foreign key format: {schema.name}Id (exact match with schema name)
await adapter.createTable({
  name: "PostCategory",
  tableName: "post_categories",
  fields: {
    PostId: { type: "number", required: true },      // matches name: "Post"
    CategoryId: { type: "number", required: true }   // matches name: "Category"
  }
});

// Insert junction records
await adapter.executeQuery({
  type: "insert",
  table: "post_categories",
  data: { PostId: 1, CategoryId: 1 }
});

// Query with populate
const result = await adapter.executeQuery({
  type: "select",
  table: "posts",
  populate: {
    categories: {
      select: ["name"]
    }
  }
});

// Result structure
{
  id: 1,
  title: "Hello World",
  categories: [
    { name: "Technology" },
    { name: "Programming" }
  ]
}
```

### Nested Populate (3+ Levels)

```typescript
const result = await adapter.executeQuery({
  type: "select",
  table: "comments",
  populate: {
    post: {
      populate: {
        author: {
          populate: {
            profile: "*"
          }
        }
      }
    }
  }
});

// Result structure (4 levels deep)
{
  id: 1,
  text: "Great post!",
  post: {
    id: 1,
    title: "Hello World",
    author: {
      id: 1,
      name: "Alice",
      profile: {
        id: 1,
        bio: "Developer"
      }
    }
  }
}
```

---

## 3. Query Operations

### WHERE Clauses

```typescript
// Simple equality
where: { name: "Alice" }

// Operators
where: {
  age: { $gte: 18, $lt: 65 },
  name: { $like: "Ali%" },
  status: { $in: ["active", "pending"] }
}

// Logical operators
where: {
  $and: [
    { age: { $gte: 18 } },
    { status: "active" }
  ]
}

where: {
  $or: [
    { role: "admin" },
    { role: "moderator" }
  ]
}

where: {
  $not: { status: "deleted" }
}

// Nested logical operators
where: {
  $and: [
    { age: { $gte: 18 } },
    {
      $or: [
        { role: "admin" },
        { verified: true }
      ]
    }
  ]
}

// Relation WHERE (filter by related data)
where: {
  author: {
    name: "Alice"
  }
}
```

### Operators Reference

| Operator | Description | Example |
|----------|-------------|---------|
| `$eq` | Equal (default) | `{ age: { $eq: 30 } }` |
| `$ne` | Not equal | `{ status: { $ne: "deleted" } }` |
| `$gt` | Greater than | `{ age: { $gt: 18 } }` |
| `$gte` | Greater than or equal | `{ age: { $gte: 18 } }` |
| `$lt` | Less than | `{ age: { $lt: 65 } }` |
| `$lte` | Less than or equal | `{ age: { $lte: 65 } }` |
| `$in` | In array | `{ role: { $in: ["admin", "mod"] } }` |
| `$nin` | Not in array | `{ status: { $nin: ["banned"] } }` |
| `$like` | SQL LIKE pattern | `{ name: { $like: "Ali%" } }` |
| `$ilike` | Case-insensitive LIKE | `{ email: { $ilike: "%@gmail.com" } }` |
| `$regex` | Regular expression | `{ name: { $regex: "^[A-Z]" } }` |
| `$and` | Logical AND | `{ $and: [{ ... }, { ... }] }` |
| `$or` | Logical OR | `{ $or: [{ ... }, { ... }] }` |
| `$not` | Logical NOT | `{ $not: { status: "deleted" } }` |

### SELECT, ORDER BY, LIMIT, OFFSET

```typescript
const result = await adapter.executeQuery({
  type: "select",
  table: "users",

  // Select specific fields
  select: ["id", "name", "email"],

  // Filter
  where: { age: { $gte: 18 } },

  // Sort
  orderBy: [
    { field: "name", direction: "asc" },
    { field: "createdAt", direction: "desc" }
  ],

  // Pagination
  limit: 10,
  offset: 20,

  // Distinct
  distinct: true,

  // Populate
  populate: {
    posts: {
      select: ["title"],
      limit: 5
    }
  }
});
```

### DISTINCT

```typescript
// Get unique roles
const result = await adapter.executeQuery({
  type: "select",
  table: "users",
  select: ["role"],
  distinct: true
});

// Result: [{ role: "admin" }, { role: "user" }, { role: "moderator" }]
```

---

## 4. Schema Management

### Creating Tables

```typescript
await adapter.createTable({
  name: "User",           // Model name (PascalCase)
  tableName: "users",     // File name (snake_case or lowercase)
  fields: {
    name: {
      type: "string",
      required: true
    },
    email: {
      type: "string",
      required: true,
      unique: true
    },
    age: {
      type: "number",
      required: false,
      default: 0
    },
    role: {
      type: "string",
      required: true,
      enum: ["admin", "user", "moderator"]
    },
    posts: {
      type: "relation",
      kind: "hasMany",
      model: "Post",
      foreignKey: "authorId"
    }
  },
  indexes: [
    {
      name: "idx_email",
      fields: ["email"],
      unique: true
    }
  ]
});
```

### Altering Tables

```typescript
// Add column
await adapter.alterTable("users", [
  {
    type: "addColumn",
    column: "phone",
    definition: { type: "string", required: false }
  }
]);

// Drop column
await adapter.alterTable("users", [
  {
    type: "dropColumn",
    column: "phone"
  }
]);

// Rename column
await adapter.alterTable("users", [
  {
    type: "renameColumn",
    oldName: "phone",
    newName: "phoneNumber"
  }
]);

// Create index
await adapter.alterTable("users", [
  {
    type: "createIndex",
    index: {
      name: "idx_email",
      fields: ["email"],
      unique: true
    }
  }
]);

// Drop index
await adapter.alterTable("users", [
  {
    type: "dropIndex",
    indexName: "idx_email"
  }
]);
```

### Dropping Tables

```typescript
await adapter.dropTable("users");
```

### Getting Table List

```typescript
const result = await adapter.getTables();

if (result.success) {
  console.log(result.data); // ["users", "posts", "categories"]
}
```

---

## 5. Best Practices

### Naming Conventions

**✅ DO:**
```typescript
// Schema names: PascalCase (recommended)
name: "User"
name: "Post"
name: "PostCategory"

// Table names: snake_case or lowercase
tableName: "users"
tableName: "posts"
tableName: "post_categories"

// Foreign keys: {schemaName}Id (must match schema name exactly)
// If schema name is "Post" → foreign key is "PostId"
// If schema name is "User" → foreign key is "UserId"
PostId: { type: "number" }
CategoryId: { type: "number" }
UserId: { type: "number" }
```

**❌ DON'T:**
```typescript
// Wrong: FK naming doesn't match schema name
// Schema: name: "Post"
postId: { type: "number" }    // Wrong: doesn't match "Post"
post_id: { type: "number" }   // Wrong: snake_case
POST_ID: { type: "number" }   // Wrong: UPPER_SNAKE_CASE

// Only use this if schema name is actually "post" (not recommended)
```

**Why?** JsonAdapter generates FK names as `${schema.name}Id`. Your foreign keys must match the exact `name` field in the related schema, otherwise populate will fail.

### Error Handling

```typescript
const result = await adapter.executeQuery({
  type: "select",
  table: "users"
});

if (!result.success) {
  console.error("Error:", result.error.code);
  console.error("Message:", result.error.message);
  console.error("Details:", result.error.details);
  return;
}

// Safe to use result.data
const users = result.data.rows;
```

### Performance Tips

**1. Use caching effectively**
```typescript
const adapter = new JsonAdapter({
  root: "./data",
  cacheMaxAge: 10000 // Increase for read-heavy workloads
});
```

**2. Batch operations**
```typescript
// Bad: Multiple inserts (multiple file writes)
for (const user of users) {
  await adapter.executeQuery({
    type: "insert",
    table: "users",
    data: user
  });
}

// Good: Single transaction (if supported in future)
// For now, minimize separate writes
```

**3. Use SELECT to reduce data transfer**
```typescript
// Bad: Fetch all fields
const result = await adapter.executeQuery({
  type: "select",
  table: "users"
});

// Good: Only needed fields
const result = await adapter.executeQuery({
  type: "select",
  table: "users",
  select: ["id", "name"]
});
```

**4. Use populate selectively**
```typescript
// Bad: Populate everything
populate: {
  author: "*",
  comments: "*",
  tags: "*"
}

// Good: Only needed relations
populate: {
  author: { select: ["name"] }
}
```

### When NOT to Use JsonAdapter

**❌ Avoid if:**
- Production application with >100 concurrent users
- Tables with >10,000 records
- High write frequency (>100 writes/sec)
- Need for complex transactions
- Real-time features (WebSockets, live updates)
- Multi-server deployment (file sharing issues)

**✅ Use PostgreSQL/MySQL adapter instead for:**
- Production applications
- Large datasets
- High concurrency
- Complex transactions
- Performance-critical operations

### File Management

**Backup strategy:**
```bash
# Simple backup
cp -r ./data ./data_backup_$(date +%Y%m%d)

# Or use git
cd data && git init && git add . && git commit -m "Backup"
```

**File inspection:**
```bash
# Pretty print JSON
cat data/users.json | jq .

# Check file size
ls -lh data/

# Count records
cat data/users.json | jq '.data | length'
```

### Testing with JsonAdapter

```typescript
import { describe, it, beforeEach, afterEach } from "vitest";
import { JsonAdapter } from "forja-adapter-json";
import fs from "node:fs/promises";
import path from "node:path";

describe("My API", () => {
  let adapter: JsonAdapter;
  const testRoot = path.join(__dirname, "tmp_test");

  beforeEach(async () => {
    // Clean start for each test
    await fs.rm(testRoot, { recursive: true, force: true });
    adapter = new JsonAdapter({ root: testRoot });
    await adapter.connect();

    // Setup schema
    await adapter.createTable({
      name: "User",
      tableName: "users",
      fields: { /* ... */ }
    });
  });

  afterEach(async () => {
    await adapter.disconnect();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it("should create user", async () => {
    const result = await adapter.executeQuery({
      type: "insert",
      table: "users",
      data: { name: "Test User" }
    });

    expect(result.success).toBe(true);
  });
});
```

### Development to Production Migration

**Strategy 1: Export/Import**
```typescript
// Export from JsonAdapter (dev)
const users = await jsonAdapter.executeQuery({
  type: "select",
  table: "users"
});

// Import to PostgreSQL (production)
for (const user of users.data.rows) {
  await pgAdapter.executeQuery({
    type: "insert",
    table: "users",
    data: user
  });
}
```

**Strategy 2: Seed scripts**
```typescript
// seeds/users.json (from JsonAdapter data)
[
  { "name": "Alice", "email": "alice@example.com" },
  { "name": "Bob", "email": "bob@example.com" }
]

// seed.ts (for production DB)
const seedData = JSON.parse(await fs.readFile("seeds/users.json"));
for (const user of seedData) {
  await productionDB.insert("users", user);
}
```

---

## Summary

JsonAdapter is a powerful tool for:
- ✅ Development and testing environments
- ✅ Static sites and prototypes
- ✅ Small applications with <10k records
- ✅ Content management with relations

Remember:
- Always use `tableName` in standalone mode
- Follow `${ModelName}Id` naming for foreign keys
- Use populate syntax: `"*"` or `{ select: [...], populate: {...} }`
- Handle errors with `Result<T, E>` pattern
- Switch to production database for real applications

For Forja integration, see [README.md](./README.md).
