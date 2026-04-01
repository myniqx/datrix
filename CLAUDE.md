# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build all packages
pnpm build

# Development (watch mode)
pnpm dev

# Type checking
pnpm type-check

# Linting & formatting
pnpm lint
pnpm format
pnpm format:check

# Tests
pnpm test                  # Unit + integration
pnpm test:unit
pnpm test:integration
pnpm test:watch
pnpm test:coverage         # Requires 80% coverage threshold

# Run a single test file
pnpm vitest run packages/core/tests/dispatcher.test.ts

# Clean build artifacts
pnpm clean
```

## Architecture

Forja is a TypeScript-first database management framework designed as a plugin for existing projects. It is a **pnpm workspace monorepo**.

### Package Dependency Flow

```
@forja/types  ←  @forja/core  ←  @forja/adapter-*
                              ←  @forja/api
                              ←  @forja/api-upload
                              ←  @forja/cli
```

No circular dependencies. Adapters and plugins depend on core and types, never the reverse.

### Validation Layer Model

Three layers with strict separation of responsibilities:

1. **Query Builder** (`packages/core/src/query-builder/`) — Structural validation: schema existence, field existence, operator validity, type coercion, depth limits. Does NOT validate data values.

2. **Executor** (`packages/core/src/query-executor/`) — Data validation: required fields, types, min/max, patterns, enums, arrays, custom validators. Injects timestamps automatically.

3. **Adapters** (`packages/adapter-*/`) — SQL translation only: translate `QueryObject` → SQL, parameterized queries (SQL injection prevention), type conversion (JS → DB types). **Never validate data** — the Executor already did it.

### Key Packages

- **`@forja/types`** — Zero runtime code. Pure TypeScript definitions shared across all packages.
- **`@forja/core`** — Schema registry, query builder, executor, validator, migration engine, plugin base class.
- **`@forja/adapter-*`** — Database-specific SQL generation. Postgres supports three populate strategies: JSON aggregation, LATERAL joins, batched IN queries.
- **`@forja/api`** — Auto-generated REST CRUD routes. JWT/session auth, RBAC, adapters for Next.js/Express/Fastify/Koa.
- **`@forja/cli`** — `forja migrate`, `forja generate types`, `forja dev` commands. Export/import via zip-based data transfer.

### Schema System

- `defineSchema()` and `defineConfig()` are the public API entry points in `@forja/core`.
- Reserved auto-managed fields: `id` (auto-increment PK), `createdAt`, `updatedAt` — cannot be set manually.
- Relations: `belongsTo`, `hasOne`, `hasMany`, `manyToMany` — FK and junction tables are handled automatically.

### Plugin System

Plugins extend `BasePlugin` and hook into schema lifecycles: `beforeCreate`, `afterCreate`, `beforeFind`, `afterFind`, `beforeDelete`, `afterDelete`. Query-level hooks: `onBeforeQuery`, `onAfterQuery`.

## Code Conventions

- **Strict TypeScript** — all strict checks enabled including `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`.
- **Formatting** — Prettier with tabs (width 2), double quotes, trailing commas, LF line endings, print width 80.
- **Commit style** — Conventional Commits: `fix(package):`, `feat(package):`, `refactor(package):`, `chore:`.
- **Build output** — CommonJS + ESM with declaration files via tsup. Target ES2022. External: `pg`, `mysql2`, `mongodb`.
- **Tests** — Located in `packages/*/tests/`. 86 test files total. Coverage threshold: 80% lines/functions/branches/statements.

## packages/core/CLAUDE.md

Contains detailed documentation on the validation layer model, query builder validations, executor data flow, and critical rules for adapter development. Read it before modifying core or writing a new adapter.
