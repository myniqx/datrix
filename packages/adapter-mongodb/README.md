# Datrix MongoDB Adapter

MongoDB adapter for the Datrix framework. Provides full CRUD, relation population, migration support, and manual referential integrity enforcement since MongoDB lacks native FK constraints and JOINs.

## Installation

```bash
pnpm add @datrix/adapter-mongodb
```

Requires `mongodb` driver as a peer dependency.

## Configuration

```typescript
import { createMongoDBAdapter } from "@datrix/adapter-mongodb";

const adapter = createMongoDBAdapter({
  uri: "mongodb://localhost:27017",
  database: "myapp",
  maxPoolSize: 10,
  minPoolSize: 2,
  connectTimeoutMS: 10000,
  serverSelectionTimeoutMS: 5000,
  appName: "myapp",
  // Optional
  replicaSet: "rs0",
  authSource: "admin",
  tls: false,
  tlsCAFile: "/path/to/ca.pem",
});
```

## Requirements

- MongoDB 6.0+
- **Replica set required** for transaction support. Standalone MongoDB instances cannot use multi-document transactions, which are needed for migration operations.

## Architecture

```
src/
├── adapter.ts           # Main adapter + MongoDBTransaction implementation
├── query-translator.ts  # QueryObject → MongoDB operation descriptors
├── mongo-client.ts      # Db wrapper with debug logging and error handling
├── helpers.ts           # Auto-increment ID generation, error mapping
├── types.ts             # Type definitions for translated operations
├── fk-validator.ts      # Manual FK reference validation on insert/update
├── on-delete.ts         # Manual ON DELETE actions (restrict/setNull/cascade)
├── nested-where.ts      # Cross-collection relation WHERE resolution
├── test-utils.ts        # Test database setup helpers
├── index.ts             # Public exports
└── populate/
    ├── index.ts
    └── populator.ts     # Relation population ($lookup + batched strategies)
```

## Migration

Migration operations are split into 3 phases due to MongoDB not supporting DDL inside transactions:

1. **Pre-transaction** — `createTable` (collection creation)
2. **Transaction** — `alterTable`, `dataTransfer`, `createIndex`, `dropIndex`
3. **Post-transaction** — `dropTable`, `renameTable`

This split is handled by the core migration runner and applies to all adapters, but is specifically designed around MongoDB's limitations. SQL adapters are unaffected since their DDL is transaction-safe.

On failure during phase 2, tables created in phase 1 may remain as empty leftovers. No data loss occurs.

## Populate Strategies

Two strategies are used depending on relation depth:

- **$lookup aggregation** — Used for depth-1 relations. Performs a server-side join via aggregation pipeline. Handles belongsTo, hasOne, hasMany, and manyToMany (with double $lookup through junction table).

- **Batched $in queries** — Used for depth 2+. Collects IDs from parent rows, queries the target collection with `{ id: { $in: [...] } }`, then stitches results in memory. Supports nested populate recursively.

FK columns needed for belongsTo relations (e.g. `authorId`) are automatically injected into projections even when not explicitly selected, to ensure population works correctly.

## Known Limitations

- **Transaction rollback does not undo DDL.** If a migration fails after `createTable` (phase 1), the created collection remains. This is a MongoDB limitation.
- **No partial indexes or expression indexes.** Only simple field indexes with optional unique constraint.
- **Auto-increment IDs are not gap-free.** Counter increments are atomic but failed inserts do not reclaim IDs.
- **`limit(0)` returns empty.** MongoDB treats `cursor.limit(0)` as unlimited; the adapter intercepts this and returns an empty result to match SQL behavior.
