# Migration System

> Migration operation handling for database adapters.

---

## Overview

Adapters execute migration operations to evolve database schema. Migrations consist of up (forward) and down (rollback) operations.

---

## Migration Structure

```typescript
interface Migration {
  readonly name: string
  readonly version: string
  readonly up: readonly MigrationOperation[]
  readonly down: readonly MigrationOperation[]
  readonly timestamp: number
}
```

---

## Migration Operations

```typescript
type MigrationOperation =
  | CreateTableOperation
  | DropTableOperation
  | AddColumnOperation
  | RemoveColumnOperation
  | ModifyColumnOperation
  | RenameTableOperation
  | AddIndexOperation
  | RemoveIndexOperation
  | RawSQLOperation
```

---

## Operation Types

### CreateTableOperation

```typescript
{
  type: 'createTable',
  schema: SchemaDefinition
}
```

**SQL (PostgreSQL):**
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### DropTableOperation

```typescript
{
  type: 'dropTable',
  tableName: 'users'
}
```

**SQL:** `DROP TABLE users;`

### AddColumnOperation

```typescript
{
  type: 'addColumn',
  tableName: 'users',
  column: {
    name: 'age',
    field: { type: 'number', min: 0 }
  }
}
```

**SQL (PostgreSQL):** `ALTER TABLE users ADD COLUMN age INTEGER CHECK (age >= 0);`

### RemoveColumnOperation

```typescript
{
  type: 'removeColumn',
  tableName: 'users',
  columnName: 'age'
}
```

**SQL:** `ALTER TABLE users DROP COLUMN age;`

### ModifyColumnOperation

```typescript
{
  type: 'modifyColumn',
  tableName: 'users',
  columnName: 'email',
  newField: { type: 'string', maxLength: 500 }
}
```

**SQL (PostgreSQL):** `ALTER TABLE users ALTER COLUMN email TYPE VARCHAR(500);`

### RenameTableOperation

```typescript
{
  type: 'renameTable',
  oldName: 'users',
  newName: 'accounts'
}
```

**SQL:** `ALTER TABLE users RENAME TO accounts;`

### AddIndexOperation

```typescript
{
  type: 'addIndex',
  tableName: 'users',
  index: {
    fields: ['email'],
    unique: true
  }
}
```

**SQL:** `CREATE UNIQUE INDEX idx_users_email ON users (email);`

### RemoveIndexOperation

```typescript
{
  type: 'removeIndex',
  tableName: 'users',
  indexName: 'idx_users_email'
}
```

**SQL:** `DROP INDEX idx_users_email;`

### RawSQLOperation

```typescript
{
  type: 'rawSQL',
  sql: 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
}
```

**SQL:** Executed as-is

---

## Execution

Adapters implement `executeMigration()`:

```typescript
async executeMigration(
  migration: Migration,
  direction: MigrationDirection
): Promise<void> {
  const operations = direction === 'up' ? migration.up : migration.down;

  for (const operation of operations) {
    await this.executeMigrationOperation(operation);
  }
}

private async executeMigrationOperation(operation: MigrationOperation): Promise<void> {
  switch (operation.type) {
    case 'createTable':
      await this.createTable(operation.schema);
      break;
    case 'dropTable':
      await this.dropTable(operation.tableName);
      break;
    case 'addColumn':
      await this.addColumn(operation.tableName, operation.column);
      break;
    // ... handle all operation types
  }
}
```

---

## Migration History

Track applied migrations:

```typescript
interface MigrationHistoryRecord {
  readonly version: string
  readonly name: string
  readonly appliedAt: Date
  readonly executionTime: number
  readonly status: 'success' | 'failed'
}
```

**Schema:**
```sql
CREATE TABLE forja_migrations (
  version VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at TIMESTAMP NOT NULL,
  execution_time INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL
);
```

---

## Field Type Mapping

Map Forja field types to database types:

```typescript
// PostgreSQL
type: 'string'  → VARCHAR
type: 'number'  → INTEGER / DECIMAL
type: 'boolean' → BOOLEAN
type: 'date'    → TIMESTAMP
type: 'json'    → JSONB

// MySQL
type: 'string'  → VARCHAR
type: 'number'  → INT / DECIMAL
type: 'boolean' → TINYINT(1)
type: 'date'    → DATETIME
type: 'json'    → JSON
```

---

## Constraints

Handle field constraints:

```typescript
// Required
required: true → NOT NULL

// Unique
unique: true → UNIQUE

// Default
default: 'value' → DEFAULT 'value'

// Min/Max (number)
min: 0, max: 100 → CHECK (field >= 0 AND field <= 100)

// MinLength/MaxLength (string)
maxLength: 255 → VARCHAR(255)
```

---

## Transactions

Execute migrations in transaction:

```typescript
async executeMigration(migration: Migration, direction: MigrationDirection): Promise<void> {
  const client = await this.pool.connect();

  try {
    await client.query('BEGIN');

    const operations = direction === 'up' ? migration.up : migration.down;

    for (const operation of operations) {
      await this.executeMigrationOperation(operation, client);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

---

## Error Handling

Handle migration errors:

```typescript
async executeMigration(migration: Migration, direction: MigrationDirection): Promise<void> {
  try {
    // Execute migration
  } catch (error) {
    // Log error
    console.error(`Migration ${migration.name} failed:`, error);

    // Record failure in history
    await this.recordMigrationFailure(migration, error);

    // Re-throw
    throw new MigrationError(
      `Migration ${migration.name} failed`,
      error
    );
  }
}
```

---

## Best Practices

**1. Use transactions**
```typescript
// ✅ All operations in transaction
BEGIN;
CREATE TABLE users (...);
CREATE INDEX ...;
COMMIT;

// ❌ No transaction
CREATE TABLE users (...);
CREATE INDEX ...;  // If this fails, table already created
```

**2. Generate reversible migrations**
```typescript
// ✅ Can rollback
up: [{ type: 'addColumn', ... }]
down: [{ type: 'removeColumn', ... }]

// ❌ Cannot rollback
up: [{ type: 'rawSQL', sql: '...' }]
down: [{ type: 'rawSQL', sql: '-- TODO' }]
```

**3. Handle idempotency**
```typescript
// ✅ Check table exists
IF NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users')
THEN
  CREATE TABLE users (...);
END IF;

// ❌ Always create
CREATE TABLE users (...);  // Fails if exists
```

**4. Validate operations**
```typescript
// Validate before executing
if (operation.type === 'addColumn') {
  const tableExists = await this.tableExists(operation.tableName);
  if (!tableExists) {
    throw new Error(`Table ${operation.tableName} does not exist`);
  }
}
```

---

## Reference

**Source Code:**
- Migration types - `packages/types/src/migration.ts`
- Migration differ - `packages/core/src/migration/differ.ts`
- Migration generator - `packages/core/src/migration/generator.ts`
- Migration runner - `packages/core/src/migration/runner.ts`
- Migration history - `packages/core/src/migration/history.ts`

**Example Implementation:**
- PostgreSQL migrations - `packages/adapters/postgres/src/migration.ts`

**Related:**
- [Schema System](./schema-system.md)
- [Getting Started](./getting-started.md)
