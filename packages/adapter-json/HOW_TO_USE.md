# JsonAdapter - Standalone Usage Guide

This guide covers using JsonAdapter **without** Datrix framework. For Datrix integration, see [README.md](./README.md).

## Table of Contents

1. [Setup & Basic Operations](#1-setup--basic-operations)
2. [Relations & Populate](#2-relations--populate)
3. [Query Operations](#3-query-operations)
4. [Foreign Key Constraints & onDelete](#4-foreign-key-constraints--ondelete)
5. [Transactions](#5-transactions)
6. [Schema Management](#6-schema-management)
7. [Best Practices](#7-best-practices)

---

## 1. Setup & Basic Operations

### Connection

```typescript
import { JsonAdapter } from "@datrix/adapter-json";

const adapter = new JsonAdapter({
  root: "./data",
  standalone: true, // auto-creates _datrix metadata table
  cache: true,      // enable mtime-based caching (default: true)
  readLock: false,   // lock on reads too (default: false)
  lockTimeout: 5000, // ms to wait for lock (default: 5000)
  staleTimeout: 30000, // ms before lock is considered stale (default: 30000)
});

// Connect (creates root directory if needed)
await adapter.connect();

// Always disconnect when done
await adapter.disconnect();
```

### CRUD Operations

```typescript
// Create table first
await adapter.createTable({
  name: "user",
  tableName: "users",
  fields: {
    name: { type: "string", required: true },
    email: { type: "string", required: true, unique: true },
    age: { type: "number" },
  },
});

// INSERT
const insertResult = await adapter.executeQuery({
  type: "insert",
  table: "users",
  data: [{ name: "Alice", email: "alice@example.com", age: 30 }],
});
console.log("Inserted ID:", insertResult.rows[0].id);

// SELECT
const selectResult = await adapter.executeQuery({
  type: "select",
  table: "users",
  where: { age: { $gte: 18 } },
});
console.log("Users:", selectResult.rows);

// UPDATE
await adapter.executeQuery({
  type: "update",
  table: "users",
  where: { id: { $eq: 1 } },
  data: { age: 31 },
});

// DELETE
await adapter.executeQuery({
  type: "delete",
  table: "users",
  where: { id: { $eq: 1 } },
});

// COUNT
const countResult = await adapter.executeQuery({
  type: "count",
  table: "users",
  where: { age: { $gte: 18 } },
});
console.log("Count:", countResult.metadata.count);
```

### Error Handling

All operations throw `DatrixAdapterError` on failure:

```typescript
import { DatrixAdapterError } from "@datrix/core";

try {
  const result = await adapter.executeQuery({
    type: "select",
    table: "users",
  });
  console.log(result.rows);
} catch (error) {
  if (error instanceof DatrixAdapterError) {
    console.error("Code:", error.code);
    console.error("Message:", error.message);
  }
}
```

---

## 2. Relations & Populate

### Relation Types Overview

| Type           | Example          | FK Location    | Populate Result       | Use Case                       |
| -------------- | ---------------- | -------------- | --------------------- | ------------------------------ |
| **belongsTo**  | Post → User      | `Post.authorId`| Single object or null | Many posts belong to one user  |
| **hasMany**    | User → Posts     | `Post.authorId`| Array (can be empty)  | One user has many posts        |
| **hasOne**     | User → Profile   | `Profile.userId`| Single object or null | One user has one profile      |
| **manyToMany** | Post ↔ Category  | Junction table | Array (can be empty)  | Many posts, many categories    |

### Populate Syntax

```typescript
// Simple populate - all fields
populate: { author: "*" }

// With field selection
populate: {
  author: {
    select: ["name", "email"],
  },
}

// Nested populate (multi-level)
populate: {
  author: {
    select: ["name"],
    populate: {
      profile: "*",
    },
  },
}

// Multiple relations
populate: {
  author: "*",
  comments: { select: ["text"] },
  tags: "*",
}
```

### belongsTo Example

```typescript
// Schema definitions
await adapter.createTable({
  name: "user",
  tableName: "users",
  fields: {
    name: { type: "string", required: true },
    email: { type: "string", required: true },
  },
});

await adapter.createTable({
  name: "post",
  tableName: "posts",
  fields: {
    title: { type: "string", required: true },
    author: {
      type: "relation",
      kind: "belongsTo",
      model: "user",
      foreignKey: "authorId",
    },
    authorId: {
      type: "number",
      hidden: true,
      references: {
        table: "users",
        column: "id",
        onDelete: "setNull",
      },
    },
  },
});

// Insert data
await adapter.executeQuery({
  type: "insert",
  table: "users",
  data: [{ name: "Alice", email: "alice@example.com" }],
});

await adapter.executeQuery({
  type: "insert",
  table: "posts",
  data: [{ title: "Hello World", authorId: 1 }],
});

// Query with populate
const result = await adapter.executeQuery({
  type: "select",
  table: "posts",
  populate: {
    author: { select: ["name", "email"] },
  },
});

// Result:
// {
//   id: 1,
//   title: "Hello World",
//   author: { name: "Alice", email: "alice@example.com" }
// }
```

### hasMany Example

```typescript
await adapter.createTable({
  name: "user",
  tableName: "users",
  fields: {
    name: { type: "string", required: true },
    posts: {
      type: "relation",
      kind: "hasMany",
      model: "post",
      foreignKey: "authorId",
    },
  },
});

// Query with populate
const result = await adapter.executeQuery({
  type: "select",
  table: "users",
  populate: {
    posts: { select: ["title"] },
  },
});

// Result:
// {
//   id: 1,
//   name: "Alice",
//   posts: [
//     { title: "Post 1" },
//     { title: "Post 2" }
//   ]
// }
```

### hasOne Example

```typescript
await adapter.createTable({
  name: "profile",
  tableName: "profiles",
  fields: {
    bio: { type: "string" },
    userId: {
      type: "number",
      required: true,
      references: { table: "users", column: "id", onDelete: "cascade" },
    },
  },
});

// Add relation to user schema
// user.fields.profile = {
//   type: "relation", kind: "hasOne", model: "profile", foreignKey: "userId"
// }

const result = await adapter.executeQuery({
  type: "select",
  table: "users",
  where: { id: { $eq: 1 } },
  populate: { profile: "*" },
});

// Result:
// {
//   id: 1,
//   name: "Alice",
//   profile: { id: 1, bio: "Developer", userId: 1 }
// }
```

### manyToMany Example

Junction table FK naming follows `{modelName}Id` (camelCase) convention.

```typescript
await adapter.createTable({
  name: "post",
  tableName: "posts",
  fields: {
    title: { type: "string", required: true },
    categories: {
      type: "relation",
      kind: "manyToMany",
      model: "category",
    },
  },
});

await adapter.createTable({
  name: "category",
  tableName: "categories",
  fields: {
    name: { type: "string", required: true },
  },
});

// Junction table — FK names: {modelName}Id
await adapter.createTable({
  name: "category_post",
  tableName: "category_post",
  fields: {
    postId: {
      type: "number",
      required: true,
      references: { table: "posts", column: "id", onDelete: "cascade" },
    },
    categoryId: {
      type: "number",
      required: true,
      references: { table: "categories", column: "id", onDelete: "cascade" },
    },
  },
});

// Insert junction records
await adapter.executeQuery({
  type: "insert",
  table: "category_post",
  data: [
    { postId: 1, categoryId: 1 },
    { postId: 1, categoryId: 2 },
  ],
});

// Query with populate
const result = await adapter.executeQuery({
  type: "select",
  table: "posts",
  populate: {
    categories: { select: ["name"] },
  },
});

// Result:
// {
//   id: 1,
//   title: "Hello World",
//   categories: [
//     { name: "Technology" },
//     { name: "Programming" }
//   ]
// }
```

---

## 3. Query Operations

### WHERE Clauses

```typescript
// Simple equality
where: { name: { $eq: "Alice" } }

// Multiple operators
where: {
  age: { $gte: 18, $lt: 65 },
  name: { $like: "Ali%" },
  status: { $in: ["active", "pending"] },
}

// Logical operators
where: {
  $and: [
    { age: { $gte: 18 } },
    { status: { $eq: "active" } },
  ],
}

where: {
  $or: [
    { role: { $eq: "admin" } },
    { role: { $eq: "moderator" } },
  ],
}

where: {
  $not: { status: { $eq: "deleted" } },
}

// Nested logical operators
where: {
  $and: [
    { age: { $gte: 18 } },
    {
      $or: [
        { role: { $eq: "admin" } },
        { verified: { $eq: true } },
      ],
    },
  ],
}
```

### Operators Reference

| Operator       | Description              | Example                                |
| -------------- | ------------------------ | -------------------------------------- |
| `$eq`          | Equal                    | `{ age: { $eq: 30 } }`                |
| `$ne`          | Not equal                | `{ status: { $ne: "deleted" } }`      |
| `$gt`          | Greater than             | `{ age: { $gt: 18 } }`                |
| `$gte`         | Greater than or equal    | `{ age: { $gte: 18 } }`               |
| `$lt`          | Less than                | `{ age: { $lt: 65 } }`                |
| `$lte`         | Less than or equal       | `{ age: { $lte: 65 } }`               |
| `$in`          | In array                 | `{ role: { $in: ["admin", "mod"] } }` |
| `$nin`         | Not in array             | `{ status: { $nin: ["banned"] } }`    |
| `$like`        | SQL LIKE pattern         | `{ name: { $like: "Ali%" } }`         |
| `$ilike`       | Case-insensitive LIKE    | `{ email: { $ilike: "%@gmail%" } }`   |
| `$contains`    | Contains substring       | `{ name: { $contains: "li" } }`       |
| `$icontains`   | Case-insensitive contains| `{ name: { $icontains: "li" } }`      |
| `$notContains` | Does not contain         | `{ name: { $notContains: "test" } }`  |
| `$startsWith`  | Starts with              | `{ name: { $startsWith: "A" } }`      |
| `$endsWith`    | Ends with                | `{ name: { $endsWith: "ce" } }`       |
| `$regex`       | Regular expression       | `{ name: { $regex: "^[A-Z]" } }`      |
| `$exists`      | Field exists             | `{ phone: { $exists: true } }`        |
| `$null`        | Is null                  | `{ deletedAt: { $null: true } }`      |
| `$notNull`     | Is not null              | `{ email: { $notNull: true } }`       |
| `$and`         | Logical AND              | `{ $and: [{ ... }, { ... }] }`        |
| `$or`          | Logical OR               | `{ $or: [{ ... }, { ... }] }`         |
| `$not`         | Logical NOT              | `{ $not: { status: { $eq: "x" } } }`  |

### SELECT, ORDER BY, LIMIT, OFFSET

```typescript
const result = await adapter.executeQuery({
  type: "select",
  table: "users",
  select: ["id", "name", "email"],
  where: { age: { $gte: 18 } },
  orderBy: [
    { field: "name", direction: "asc" },
    { field: "createdAt", direction: "desc" },
  ],
  limit: 10,
  offset: 20,
  distinct: true,
  populate: {
    posts: { select: ["title"], limit: 5 },
  },
});
```

---

## 4. Foreign Key Constraints & onDelete

JsonAdapter enforces foreign key constraints and supports `onDelete` actions, mimicking SQL behavior.

### Defining FK References

```typescript
await adapter.createTable({
  name: "post",
  tableName: "posts",
  fields: {
    title: { type: "string", required: true },
    author: {
      type: "relation",
      kind: "belongsTo",
      model: "user",
      foreignKey: "authorId",
    },
    authorId: {
      type: "number",
      hidden: true,
      references: {
        table: "users",
        column: "id",
        onDelete: "setNull", // "cascade" | "setNull" | "restrict"
      },
    },
  },
});
```

### onDelete Behaviors

| Action       | Behavior                                                    |
| ------------ | ----------------------------------------------------------- |
| `restrict`   | Prevents deletion if referenced rows exist. Throws error.   |
| `setNull`    | Sets FK column to `null` in referencing rows on delete.      |
| `cascade`    | Deletes all referencing rows when parent is deleted.         |

Default is `setNull` when not specified.

### FK Constraint Validation

On insert and update, the adapter validates that referenced records exist:

```typescript
// This will throw if user with id 999 doesn't exist
await adapter.executeQuery({
  type: "insert",
  table: "posts",
  data: [{ title: "Test", authorId: 999 }],
});
// → DatrixAdapterError: Foreign key constraint failed: user with id '999' does not exist
```

### Unique Constraints

Fields with `unique: true` are enforced on insert and update:

```typescript
await adapter.createTable({
  name: "user",
  tableName: "users",
  fields: {
    email: { type: "string", required: true, unique: true },
  },
});

// Inserting duplicate email throws:
// → DatrixAdapterError: Duplicate value 'alice@example.com' for unique field 'email'
```

---

## 5. Transactions

JsonAdapter supports transactions with full isolation:

```typescript
const tx = await adapter.beginTransaction();

try {
  await tx.executeQuery({
    type: "insert",
    table: "users",
    data: [{ name: "Alice", email: "alice@example.com" }],
  });

  await tx.executeQuery({
    type: "insert",
    table: "posts",
    data: [{ title: "First Post", authorId: 1 }],
  });

  // All changes written to disk atomically
  await tx.commit();
} catch (error) {
  // All changes discarded
  await tx.rollback();
  throw error;
}
```

Transaction guarantees:
- Lock is held for the entire duration (no concurrent writes)
- Reads within the transaction see uncommitted changes (read-your-writes)
- Commit writes all modified tables to disk
- Rollback discards all changes without touching disk
- Schema operations (createTable, alterTable, dropTable) are supported within transactions

---

## 6. Schema Management

### Creating Tables

```typescript
await adapter.createTable({
  name: "user",
  tableName: "users",
  fields: {
    name: { type: "string", required: true },
    email: { type: "string", required: true, unique: true },
    age: { type: "number", default: 0 },
    role: { type: "string" },
    posts: {
      type: "relation",
      kind: "hasMany",
      model: "post",
      foreignKey: "authorId",
    },
  },
  indexes: [{ fields: ["email"], unique: true }],
});
```

### Altering Tables

```typescript
// Add column
await adapter.alterTable("users", [
  {
    type: "addColumn",
    column: "phone",
    definition: { type: "string" },
  },
]);

// Drop column
await adapter.alterTable("users", [
  { type: "dropColumn", column: "phone" },
]);

// Rename column
await adapter.alterTable("users", [
  { type: "renameColumn", from: "phone", to: "phoneNumber" },
]);

// Modify column
await adapter.alterTable("users", [
  {
    type: "modifyColumn",
    column: "age",
    newDefinition: { type: "number", required: true },
  },
]);
```

### Indexes

```typescript
// Add index
await adapter.addIndex("users", {
  fields: ["email"],
  unique: true,
});

// Drop index
await adapter.dropIndex("users", "idx_users_email");
```

### Other Operations

```typescript
// Drop table
await adapter.dropTable("users");

// Rename table
await adapter.renameTable("users", "members");

// List tables
const tables = await adapter.getTables();
console.log(tables); // ["users", "posts", "categories"]

// Check if table exists
const exists = await adapter.tableExists("users");
```

---

## 7. Best Practices

### Naming Conventions

**Schema name:** lowercase singular (`user`, `post`, `category`)

**Table name:** lowercase plural or snake_case (`users`, `posts`, `post_categories`)

**Foreign keys:** `{modelName}Id` camelCase (`authorId`, `categoryId`, `userId`)

```typescript
// ✅ Correct
{ name: "user", tableName: "users" }
{ name: "post", tableName: "posts" }
// FK: authorId, categoryId, postId

// ❌ Incorrect
{ name: "User", tableName: "Users" }
// FK: UserId, PostId (wrong case)
```

### Performance Tips

1. **Keep caching enabled** — Default `cache: true` dramatically improves read performance.

2. **Use SELECT to reduce data size**
```typescript
// Only fetch needed fields
select: ["id", "name"]
```

3. **Populate selectively**
```typescript
// Only needed relations with field selection
populate: { author: { select: ["name"] } }
```

4. **Use batch inserts**
```typescript
// Single query with multiple records
await adapter.executeQuery({
  type: "insert",
  table: "users",
  data: [
    { name: "Alice", email: "alice@example.com" },
    { name: "Bob", email: "bob@example.com" },
  ],
});
```

### When to Use / Not Use

**Use JsonAdapter for:**
- Development and testing
- Prototyping and POCs
- Static sites and small apps (<10k records per table)
- CI/CD test suites (zero infrastructure)

**Switch to PostgreSQL/MySQL for:**
- Production applications
- >10k records per table
- High concurrency (>100 writes/sec)
- Multi-server deployments

### Testing Setup

```typescript
import { describe, it, beforeEach, afterEach } from "vitest";
import { JsonAdapter } from "@datrix/adapter-json";
import fs from "node:fs/promises";

describe("My Tests", () => {
  let adapter: JsonAdapter;
  const testRoot = "./tmp_test";

  beforeEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
    adapter = new JsonAdapter({ root: testRoot, standalone: true });
    await adapter.connect();
  });

  afterEach(async () => {
    await adapter.disconnect();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it("should create and query users", async () => {
    await adapter.createTable({
      name: "user",
      tableName: "users",
      fields: {
        name: { type: "string", required: true },
      },
    });

    await adapter.executeQuery({
      type: "insert",
      table: "users",
      data: [{ name: "Test User" }],
    });

    const result = await adapter.executeQuery({
      type: "select",
      table: "users",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe("Test User");
  });
});
```

---

## File Structure

```
data/
├── _datrix.json          # Schema metadata (auto-managed)
├── users.json           # User table
├── posts.json           # Post table
├── categories.json      # Category table
└── category_post.json   # Junction table (manyToMany)
```

Each table file:

```json
{
  "meta": {
    "version": 1,
    "name": "user",
    "lastInsertId": 3,
    "updatedAt": "2026-01-27T10:30:00.000Z"
  },
  "data": [
    { "id": 1, "name": "Alice", "email": "alice@example.com" },
    { "id": 2, "name": "Bob", "email": "bob@example.com" }
  ]
}
```

---

For Datrix integration, see [README.md](./README.md).
