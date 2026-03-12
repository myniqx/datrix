# Forja PostgreSQL Adapter

PostgreSQL adapter for the Forja framework. Provides full CRUD, relation population, migration support, and native referential integrity enforcement.

## Installation

```bash
pnpm add forja-adapter-postgres
```

Requires `pg` (node-postgres) driver as a peer dependency.

## Configuration

```typescript
import { PostgresAdapter } from "forja-adapter-postgres";

const adapter = new PostgresAdapter({
  host: "localhost",
  port: 5432,
  user: "forja",
  password: "forja",
  database: "myapp",
  max: 10,
  min: 2,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  applicationName: "myapp",
  // Optional
  ssl: { rejectUnauthorized: false },
});
```

## Requirements

- **PostgreSQL 12+** — The adapter uses `json_agg()`, `row_to_json()`, and `LATERAL` joins for efficient relation population.
- Native foreign key constraints are fully supported and automatically managed by the framework migrations.

## Architecture

```text
src/
├── adapter.ts                  # Main adapter logic & connection pool handling
├── query-translator.ts         # Translates Forja QueryObjects into raw SQL
├── pg-client.ts                # Pool/PoolClient wrapper with debug logging and error mapping
├── types.ts                    # PostgreSQL-specific type mappings and query types
├── test-utils.ts               # Test database setup helpers
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
- **Auto-increment IDs are not gap-free.** Counter increments are atomic but failed inserts do not reclaim IDs.
- **`json_agg` on empty sets returns `null`**, not an empty array `[]`. The `ResultProcessor` handles this and normalizes the value to `[]`.

## Testing

```bash
# PostgreSQL (default port 5432)
ADAPTER=postgres pnpm test
```

Docker setup for test database:

```bash
docker run -d --name postgres-test \
  -e POSTGRES_USER=forja \
  -e POSTGRES_PASSWORD=forja \
  -e POSTGRES_DB=forja \
  -p 5432:5432 \
  postgres:16
```
