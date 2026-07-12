# Datrix PostgreSQL Adapter Core

Driver-agnostic PostgreSQL adapter core for the Datrix framework. Provides full CRUD, relation population, migration support, and native referential integrity enforcement — without depending on `pg` or any specific driver.

## Installation

```bash
pnpm add @datrix/adapter-postgres-core
```

This package never imports `pg`. You provide a `PostgresCoreConfig` that wraps whatever PostgreSQL client you want to use (`pg`, `postgres.js`, the Neon serverless driver, etc.). If you just want a ready-to-use `pg`-based adapter, use `@datrix/adapter-postgres` instead, which wraps this package with a `pg` driver.

## Configuration

Implement `PostgresCoreConfig` (see `src/driver.ts`) by wrapping your driver's pool/client:

```typescript
import { PostgresAdapter, PostgresCoreConfig } from "@datrix/adapter-postgres-core";
import { Pool } from "pg";

const pool = new Pool({ host: "localhost", database: "myapp" });

const config: PostgresCoreConfig = {
  runner: {
    query: async (sql, params) => {
      const result = await pool.query(sql, params as unknown[]);
      return { rows: result.rows, rowCount: result.rowCount };
    },
  },
  connect: async () => {
    const client = await pool.connect();
    return {
      query: async (sql, params) => {
        const result = await client.query(sql, params as unknown[]);
        return { rows: result.rows, rowCount: result.rowCount };
      },
      release: () => client.release(),
    };
  },
  ping: async () => {
    const client = await pool.connect();
    client.release();
  },
  end: async () => pool.end(),
};

const adapter = new PostgresAdapter(config);
```

## Requirements

- **PostgreSQL 12+** — The adapter uses `json_agg()`, `row_to_json()`, and `LATERAL` joins for efficient relation population.
- Native foreign key constraints are fully supported and automatically managed by the framework migrations.

## Architecture

```text
src/
├── adapter.ts                  # Main adapter logic & connection handling
├── driver.ts                   # Driver-agnostic contracts: PgRunner, PgConnection, PostgresCoreConfig
├── query-translator.ts         # Translates Datrix QueryObjects into raw SQL
├── pg-client.ts                # PgRunner wrapper with debug logging and error mapping
├── types.ts                    # PostgreSQL-specific type mappings and query types
├── index.ts                    # Public package exports
└── populate/
    ├── index.ts
    ├── populator.ts            # Strategy selection and batched recursive fetching
    ├── aggregation-builder.ts  # Generates json_agg() / row_to_json() subqueries
    ├── join-builder.ts         # Dynamic JOIN string constructor
    └── result-processor.ts     # JSON field parsing and final data formatting
```

## Populate Strategies

Three strategies are employed dynamically based on query depth and complexity:

- **JSON Aggregation** — Default for single-level relations. Uses `json_agg()` and `row_to_json()` in a single efficient query. Groups by primary key and produces fully populated JSON in the database—no extra round-trips.

- **LATERAL Joins** — Used when populate options include `limit`, `offset`, `where`, or `orderBy`. Generates a `LEFT JOIN LATERAL (...)` subquery per relation, allowing per-relation constraints while remaining within a single SQL query.

- **Batched IN Queries** — Fallback for deep nesting (depth > 1) or high cardinality. Collects parent IDs and issues targeted `WHERE id = ANY($1)` queries, stitching results in Node.js memory. Supports recursive nested population.

## Migration

Migration operations map directly to native PostgreSQL DDL commands (`CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`, etc.). Since PostgreSQL supports transactional DDL, migrations are fully rollback-safe — all structural changes can be reverted if a migration fails partway.

## Known Limitations

- **No partial or expression indexes.** Only simple field indexes with an optional unique constraint.
- **`NUMERIC`/`BIGINT` values are coerced to JS `number`.** PostgreSQL drivers return `NUMERIC` (used when a number field sets `precision`) and `BIGINT` as strings to avoid precision loss. The adapter converts them back to `number` via `Number(v)` because the framework assumes JS numbers end-to-end. Values with more than 2^53 of integer precision (or more decimal digits than a float64 can hold) lose precision silently. If you need exact arbitrary-precision values, store them in a `string` field instead.
- **Auto-increment IDs are not gap-free.** Counter increments are atomic but failed inserts do not reclaim IDs.
- **`json_agg` on empty sets returns `null`**, not an empty array `[]`. The `ResultProcessor` handles this and normalizes the value to `[]`.

## Testing

This package has no tests of its own — it is exercised through `@datrix/adapter-postgres`, which wraps it with a `pg` driver and runs the full integration suite against a real PostgreSQL instance.
