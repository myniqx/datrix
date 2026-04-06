# @datrix/core

The heart of Datrix. Handles schema definition, validation, query building, relation processing, and database migrations — without being tied to a specific database engine.

## Installation

```bash
pnpm add @datrix/core
```

## Setup

Two functions are the entry point to every Datrix project: `defineSchema` and `defineConfig`.

### defineSchema

Validates your schema object against `SchemaDefinition` at the TypeScript level. At runtime it returns the object as-is — it is a type helper, not a factory.

```typescript
import { defineSchema } from "@datrix/core"

export const postSchema = defineSchema({
  name: "post",
  fields: {
    title:   { type: "string", required: true },
    status:  { type: "enum", values: ["draft", "published"] as const, default: "draft" },
    author:  { type: "relation", kind: "belongsTo", model: "user" },
  },
  indexes: [
    { fields: ["status"] },
  ],
})
```

### defineConfig

Creates the Datrix instance factory. Calling the returned function initializes the instance once — subsequent calls return the cached instance.

```typescript
import { defineConfig } from "@datrix/core"
import { PostgresAdapter } from "@datrix/adapter-postgres"
import { postSchema, userSchema } from "./schemas"

const getDatrix = defineConfig(() => ({
  adapter: new PostgresAdapter({
    host:     "localhost",
    port:     5432,
    database: "mydb",
    user:     "postgres",
    password: process.env.DB_PASSWORD,
  }),
  schemas: [userSchema, postSchema],
  plugins: [],
  migration: {
    auto:      false,
    directory: "./migrations",
  },
  dev: {
    logging: false,
  },
}))

export default getDatrix
```

## CRUD

```typescript
const datrix = await getDatrix()

// Read
const posts    = await datrix.findMany("post", { where: { status: "published" }, limit: 10 })
const post     = await datrix.findOne("post", { slug: "hello-world" })
const byId     = await datrix.findById("post", 1)
const total    = await datrix.count("post", { status: "draft" })

// Write
const created  = await datrix.create("post", { title: "Hello", status: "draft", author: 1 })
const updated  = await datrix.update("post", created.id, { status: "published" })
const deleted  = await datrix.delete("post", created.id)

// Bulk
const many     = await datrix.createMany("post", [{ title: "A" }, { title: "B" }])
const updated2 = await datrix.updateMany("post", { status: "draft" }, { status: "archived" })
const deleted2 = await datrix.deleteMany("post", { status: "archived" })
```

Every record automatically includes `id`, `createdAt`, and `updatedAt` — these cannot be defined manually.

### raw

Use `datrix.raw` to bypass plugin hooks (`onBeforeQuery` / `onAfterQuery`). Method signatures are identical — the only difference is that schema lifecycle hooks and plugin hooks do not fire.

```typescript
await datrix.raw.create("post", { title: "Silent insert" })
```

## Field types

| Type       | Key options                                                           |
| ---------- | --------------------------------------------------------------------- |
| `string`   | `required`, `minLength`, `maxLength`, `unique`, `pattern`, `default`, `validator` |
| `number`   | `required`, `min`, `max`, `integer`, `unique`, `default`, `validator` |
| `boolean`  | `required`, `default`                                                 |
| `date`     | `required`, `min`, `max`, `default`                                   |
| `enum`     | `values` (required), `default`                                        |
| `array`    | `items` (field def), `minItems`, `maxItems`, `unique`                 |
| `json`     | `required`, `default`                                                 |
| `file`     | `allowedTypes`, `maxSize`, `multiple`                                 |
| `relation` | `kind`, `model`, `foreignKey`, `through`, `onDelete`, `onUpdate`      |

## Relations

Datrix manages foreign keys and junction tables automatically — you never define them manually.

| Kind          | FK location       | Use when                             |
| ------------- | ----------------- | ------------------------------------ |
| `belongsTo`   | Current schema    | This record owns the FK (N:1)        |
| `hasOne`      | Target schema     | Target owns the FK (1:1)             |
| `hasMany`     | Target schema     | Target owns the FK (1:N)             |
| `manyToMany`  | Junction table    | Junction auto-created unless `through` is set |

```typescript
// belongsTo — adds `authorId` to posts table
author: { type: "relation", kind: "belongsTo", model: "user", onDelete: "restrict" }

// hasMany — adds `postId` to comments table
comments: { type: "relation", kind: "hasMany", model: "comment" }

// manyToMany — creates post_tag junction table
tags: { type: "relation", kind: "manyToMany", model: "tag" }
```

## Querying

### Filtering

```typescript
// Comparison operators
await datrix.findMany("user", {
  where: {
    age:   { $gte: 18, $lte: 65 },
    email: { $like: "%@example.com" },
    role:  { $in: ["admin", "editor"] },
  },
})

// Logical operators
await datrix.findMany("post", {
  where: { $or: [{ status: "published" }, { featured: true }] },
})

// Nested relation filter
await datrix.findMany("post", {
  where: { author: { verified: true } },
})
```

All comparison operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$like`, `$ilike`, `$startsWith`, `$endsWith`, `$contains`, `$null`, `$notNull`, `$exists`.

### Populate

```typescript
// All relations
await datrix.findMany("post", { populate: "*" })

// Specific relations with options
await datrix.findMany("post", {
  populate: {
    author:   { select: ["id", "name"] },
    comments: { where: { approved: true }, limit: 5, orderBy: { createdAt: "desc" } },
  },
})
```

### Sorting and pagination

```typescript
await datrix.findMany("post", {
  orderBy: [{ field: "createdAt", direction: "desc", nulls: "last" }],
  limit:   20,
  offset:  40,
})
```

## Lifecycle hooks

Hooks run on every non-raw query. They fire after plugin hooks. Every `before` hook must return the (optionally modified) value.

`ctx.metadata` is a mutable object shared between the `before` and `after` hook of the same operation.

```typescript
defineSchema({
  name: "post",
  fields: { ... },
  hooks: {
    beforeCreate: async (data, ctx) => {
      return { ...data, slug: data.title?.toLowerCase().replace(/ /g, "-") }
    },
    afterCreate: async (record, ctx) => {
      return record
    },
    beforeFind: async (query, ctx) => {
      return { ...query, where: { ...query.where, status: "published" } }
    },
    afterFind: async (results, ctx) => {
      return results
    },
    beforeDelete: async (id, ctx) => id,
    afterDelete:  async (id, ctx) => {},
  },
})
```

## Permissions

Schema and field permissions are defined in the schema and enforced by `@datrix/api`. The core package carries the config — enforcement is in the API layer.

```typescript
defineSchema({
  name: "post",
  permission: {
    create: ["admin", "editor"],
    read:   true,
    update: (ctx) => ctx.user?.id === ctx.record?.authorId,
    delete: ["admin"],
  },
  fields: {
    email: {
      type: "string",
      permission: {
        read:  ["admin"],  // stripped from response for other roles
        write: ["admin"],  // 403 for other roles on create/update
      },
    },
  },
})
```

## Migration

Migrations are managed through the Datrix CLI. The core package exposes `beginMigrate()` which the CLI uses internally.

```bash
datrix migrate   # diff schemas against DB, prompt for ambiguous changes, apply
```

Direct API use is possible but not the intended workflow:

```typescript
const session = await datrix.beginMigrate()

if (session.hasAmbiguous) {
  // Resolve rename vs. drop+add for each ambiguous change
  session.resolveAmbiguous("user.name->lastname", "rename")
}

await session.apply()
```

## Architecture

```text
src/
├── index.ts              # Public exports (defineSchema, defineConfig)
├── datrix.ts              # Datrix class — instance factory, CRUD dispatcher
├── schema-registry.ts    # SchemaRegistry — schema storage and lookup
├── initializer.ts        # Startup sequence — schema finalization, plugin init
├── mixins/
│   └── crud.ts           # CRUD method implementations
├── query/
│   ├── builder.ts        # QueryBuilder — constructs QueryObject from options
│   └── executor.ts       # QueryExecutor — routes QueryObject to the adapter
├── validation/
│   └── validator.ts      # Field-level validation before writes
├── migration/
│   ├── migrator.ts       # MigrationSession — diff and apply logic
│   └── planner.ts        # Change detection and plan generation
└── plugin/
    └── plugin.ts         # BasePlugin — base class for all Datrix plugins
```
