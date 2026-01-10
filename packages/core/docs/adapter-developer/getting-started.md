# Adapter Development - Getting Started

> Overview of database adapter architecture and implementation requirements.

---

## Overview

Database adapters translate Forja's database-agnostic structures (QueryObject, SchemaDefinition, Migration) to database-specific operations (SQL, NoSQL, etc).

---

## Adapter Interface

```typescript
interface DatabaseAdapter<TConfig = Record<string, unknown>> {
  readonly name: string
  readonly config: TConfig

  // Connection management
  connect(): Promise<void>
  disconnect(): Promise<void>

  // Query execution
  executeQuery<TResult>(query: QueryObject): Promise<TResult>

  // Schema operations
  tableExists(tableName: string): Promise<boolean>
  createTable(schema: SchemaDefinition): Promise<void>
  dropTable(tableName: string): Promise<void>

  // Migration operations
  executeMigration(migration: Migration, direction: MigrationDirection): Promise<void>
}
```

---

## Core Responsibilities

### 1. Query Translation

Translate `QueryObject` to database queries:

```typescript
QueryObject → SQL / NoSQL
```

**Example (PostgreSQL):**
```typescript
// Input
{
  type: 'select',
  table: 'users',
  where: { role: 'admin' }
}

// Output
SELECT * FROM users WHERE role = $1
Params: ['admin']
```

See: [Query Builder Reference](./query-builder.md)

### 2. Schema Operations

Create/modify/drop tables based on `SchemaDefinition`:

```typescript
SchemaDefinition → CREATE TABLE / ALTER TABLE / DROP TABLE
```

See: [Schema System Reference](./schema-system.md)

### 3. Migration Execution

Execute migration operations:

```typescript
MigrationOperation[] → Database changes
```

See: [Migration System Reference](./migration-system.md)

---

## Implementation Steps

### 1. Define Configuration

```typescript
interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
}
```

### 2. Implement Adapter Class

```typescript
import { DatabaseAdapter } from 'forja-types';
import { Pool } from 'pg';

class PostgresAdapter implements DatabaseAdapter<PostgresConfig> {
  readonly name = 'postgres';
  readonly config: PostgresConfig;
  private pool: Pool;

  constructor(config: PostgresConfig) {
    this.config = config;
    this.pool = new Pool(config);
  }

  async connect(): Promise<void> {
    await this.pool.connect();
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  async executeQuery<TResult>(query: QueryObject): Promise<TResult> {
    const { sql, params } = this.translateQuery(query);
    const result = await this.pool.query(sql, params);
    return this.parseResult(result) as TResult;
  }

  // Implement other methods...
}
```

### 3. Implement Query Translator

```typescript
private translateQuery(query: QueryObject): { sql: string; params: unknown[] } {
  switch (query.type) {
    case 'select': return this.translateSelect(query);
    case 'insert': return this.translateInsert(query);
    case 'update': return this.translateUpdate(query);
    case 'delete': return this.translateDelete(query);
    case 'count': return this.translateCount(query);
  }
}
```

### 4. Implement Schema Operations

```typescript
async createTable(schema: SchemaDefinition): Promise<void> {
  const sql = this.generateCreateTableSQL(schema);
  await this.pool.query(sql);
}
```

### 5. Implement Migration Support

```typescript
async executeMigration(migration: Migration, direction: MigrationDirection): Promise<void> {
  const operations = direction === 'up' ? migration.up : migration.down;

  for (const operation of operations) {
    await this.executeMigrationOperation(operation);
  }
}
```

---

## Critical Requirements

### SQL Injection Prevention

**Always use parameterized queries:**

```typescript
// ❌ NEVER - String concatenation
const sql = `SELECT * FROM ${table} WHERE id = ${id}`;

// ✅ ALWAYS - Parameterized
const sql = `SELECT * FROM users WHERE id = $1`;
const params = [id];
await this.pool.query(sql, params);
```

### Error Handling

Map database errors to Forja errors:

```typescript
async executeQuery<TResult>(query: QueryObject): Promise<TResult> {
  try {
    // Execute query
  } catch (error) {
    if (error.code === '23505') {
      throw new UniqueConstraintError(error.detail);
    }
    if (error.code === '23503') {
      throw new ForeignKeyConstraintError(error.detail);
    }
    throw new DatabaseError('Query failed', error);
  }
}
```

### Connection Pooling

Use connection pools for performance:

```typescript
// ✅ Connection pool
const pool = new Pool({ max: 20, min: 2 });

// ❌ New connection per query
const client = new Client();
await client.connect();
```

---

## Testing

Test adapters with real database:

```typescript
describe('PostgresAdapter', () => {
  let adapter: PostgresAdapter;

  beforeAll(async () => {
    adapter = new PostgresAdapter(testConfig);
    await adapter.connect();
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  it('executes SELECT query', async () => {
    const query: QueryObject = {
      type: 'select',
      table: 'users',
      where: { role: 'admin' }
    };

    const result = await adapter.executeQuery(query);
    expect(result).toBeDefined();
  });
});
```

See: [Testing Guidelines](../../../../tests/CLAUDE.md)

---

## Database-Specific Considerations

### PostgreSQL
- Use `$1, $2, $3` placeholders
- RETURNING clause support
- JSONB for JSON fields
- Array support
- Case-sensitive identifiers (quote with `"`)

### MySQL
- Use `?` placeholders
- No RETURNING (use separate SELECT)
- JSON for JSON fields
- No native array support
- Backtick identifiers

### MongoDB
- No SQL translation
- Filter objects instead of WHERE clauses
- Aggregation pipeline for JOINs
- Document-based operations

---

## Performance Optimization

### Batch Operations

```typescript
// ✅ Batch insert
INSERT INTO users (email, name) VALUES ($1, $2), ($3, $4), ($5, $6)

// ❌ Multiple inserts
INSERT INTO users (email, name) VALUES ($1, $2)
INSERT INTO users (email, name) VALUES ($1, $2)
INSERT INTO users (email, name) VALUES ($1, $2)
```

### Populate Strategy

**hasOne/belongsTo:** Use JOIN
```sql
SELECT users.*, profile.bio
FROM users
LEFT JOIN profiles AS profile ON users.id = profile.userId
```

**hasMany/manyToMany:** Separate queries + batch loading
```typescript
// Avoid N+1: Load all related records in one query
const userIds = posts.map(p => p.authorId);
const users = await executeQuery({
  type: 'select',
  table: 'users',
  where: { id: { $in: userIds } }
});
```

---

## Example Implementation

See PostgreSQL adapter for reference:
- `packages/adapters/postgres/src/adapter.ts`
- `packages/adapters/postgres/src/translator.ts`
- `packages/adapters/postgres/src/schema.ts`

---

## Next Steps

- [Query Builder](./query-builder.md) - QueryObject translation reference
- [Migration System](./migration-system.md) - Migration execution reference
- [Schema System](./schema-system.md) - Schema utilities reference

---

## Reference

**Source Code:**
- Adapter interface - `packages/types/src/adapter.ts`
- Query types - `packages/types/src/query-builder.ts`
- Schema types - `packages/types/src/schema.ts`
- Migration types - `packages/types/src/migration.ts`

**Example Adapter:**
- PostgreSQL - `packages/adapters/postgres/`

**Related:**
- [Testing Guidelines](../../../../tests/CLAUDE.md)
