# Forja

TypeScript-first database management framework. Provides flexible REST API query capabilities without being a standalone application — integrate it into your existing project, keep your own server and framework.

**Documentation:** [tryforja.com](https://tryforja.com)

---

## What it is

Forja gives you:

- **Schema-driven data layer** — define your models once, get validation, migrations, and type-safe queries for free
- **Database-agnostic CRUD** — same query API across PostgreSQL, MySQL, MongoDB, and a JSON adapter for local dev
- **Optional REST API** — add `@forja/api` as a plugin to auto-generate CRUD routes, JWT/session auth, and RBAC permissions
- **File uploads** — add `@forja/api-upload` for storage-agnostic file handling with image conversion and variants
- **Migrations** — schema diff engine that detects changes and generates DDL — run via CLI or programmatically

---

## Packages

### Core

| Package | Description |
| ------- | ----------- |
| [`@forja/core`](./packages/core/README.md) | Schema definition, validation, query building, CRUD dispatcher, migration engine, plugin system |
| [`@forja/types`](./packages/types/) | Shared TypeScript types used across all packages — adapters, plugins, API, upload |

### Adapters

| Package | Description |
| ------- | ----------- |
| [`@forja/adapter-postgres`](./packages/adapter-postgres/README.md) | PostgreSQL adapter — full CRUD, native FK constraints, three populate strategies, transactional migrations |
| [`@forja/adapter-mysql`](./packages/adapter-mysql/README.md) | MySQL / MariaDB adapter — full CRUD, native FK constraints, relation population, migration support |
| [`@forja/adapter-mongodb`](./packages/adapter-mongodb/README.md) | MongoDB adapter — full CRUD, manual referential integrity, migration support |
| [`@forja/adapter-json`](./packages/adapter-json/README.md) | File-based JSON adapter — for development, testing, and small-scale use. No database required |

### API & Upload

| Package | Description |
| ------- | ----------- |
| [`@forja/api`](./packages/api/README.md) | HTTP REST API plugin — auto-generated CRUD routes, JWT/session auth, RBAC permissions, Node.js adapter helpers |
| [`@forja/api-upload`](./packages/api-upload/README.md) | File upload extension — Local and S3 storage, image format conversion, resolution variants, URL injection |

### Tooling

| Package | Description |
| ------- | ----------- |
| [`@forja/cli`](./packages/cli/) | CLI tools — `forja migrate`, `forja generate types`, `forja dev` |

---

## Quick start

```bash
pnpm add @forja/core @forja/adapter-postgres
```

```typescript
// forja.config.ts
import { defineConfig, defineSchema } from "@forja/core"
import { PostgresAdapter } from "@forja/adapter-postgres"

const userSchema = defineSchema({
  name: "user",
  fields: {
    name:  { type: "string", required: true },
    email: { type: "string", required: true, unique: true },
    role:  { type: "enum", values: ["admin", "user"] as const, default: "user" },
  },
})

export default defineConfig(() => ({
  adapter: new PostgresAdapter({
    host: "localhost", port: 5432,
    database: "mydb", user: "postgres", password: process.env.DB_PASSWORD,
  }),
  schemas: [userSchema],
}))
```

```typescript
// anywhere in your app
import getForja from "./forja.config"

const forja = await getForja()

const users = await forja.findMany("user", {
  where:   { role: "admin" },
  orderBy: { createdAt: "desc" },
  limit:   10,
})

const user = await forja.create("user", {
  name: "Alice", email: "alice@example.com",
})
```

## Adding the REST API

```bash
pnpm add @forja/api
```

```typescript
import { ApiPlugin } from "@forja/api"
import { handleRequest } from "@forja/api"

export default defineConfig(() => ({
  adapter,
  schemas,
  plugins: [
    new ApiPlugin({
      auth: {
        roles: ["admin", "user"] as const,
        defaultRole: "user",
        jwt: { secret: process.env.JWT_SECRET, expiresIn: "7d" },
      },
    }),
  ],
}))

// Next.js App Router — catch-all route
export async function GET(request: Request) {
  return handleRequest(await getForja(), request)
}
```

See [`@forja/api`](./packages/api/README.md) for full setup, auth, and permission docs.

## Adding file uploads

```bash
pnpm add @forja/api-upload
```

```typescript
import { Upload, LocalStorageProvider } from "@forja/api-upload"

new ApiPlugin({
  upload: new Upload({
    provider: new LocalStorageProvider({
      basePath: "./uploads",
      baseUrl:  "https://example.com/uploads",
    }),
    format:  "webp",
    quality: 80,
    resolutions: {
      thumbnail: { width: 150, height: 150, fit: "cover" },
    },
  }),
})
```

See [`@forja/api-upload`](./packages/api-upload/README.md) for storage providers, format conversion, and variant docs.

---

## Development

```bash
pnpm install       # install all dependencies
pnpm type-check    # type check all packages
pnpm build         # build all packages
pnpm test          # run all tests
```

Tests are in `packages/*/tests/`. Run a specific test file from the root:

```bash
pnpm vitest run packages/api/tests/crud-basic.test.ts
```

---

## Architecture

```text
packages/
├── core/              # Schema, validation, query builder, CRUD, migration, plugin base
├── types/             # Shared TypeScript types (no runtime code)
├── adapter-postgres/  # PostgreSQL adapter
├── adapter-mysql/     # MySQL / MariaDB adapter
├── adapter-mongodb/   # MongoDB adapter
├── adapter-json/      # JSON file adapter (dev/test)
├── api/               # REST API plugin — auth, CRUD routes, permissions
├── api-upload/        # File upload extension — providers, image processing
└── cli/               # CLI — migrate, generate, dev
```

Dependencies flow inward: adapters and plugins depend on `core` and `types`, never on each other. The API plugin depends on `core` but not on any specific adapter.
