# MySQL Adapter Implementation Plan

## Overview

MySQL/MariaDB adapter for Forja framework. Follows the same pattern as `adapter-postgres`.

**Target:** MySQL 5.7+ (MariaDB 10.2+)
**Driver:** `mysql2` (peer dependency)

---

## File Structure

```
packages/adapter-mysql/
├── src/
│   ├── index.ts              # Public exports
│   ├── adapter.ts            # MySQLAdapter class
│   ├── query-translator.ts   # MySQL-specific SQL translation
│   └── types.ts              # Config, type mappings
├── package.json
├── tsconfig.json
├── PLAN.md                   # This file
└── CLAUDE.md                 # AI instructions
```

---

## 1. Types (`types.ts`)

### MySQLConfig

```typescript
interface MySQLConfig {
  // Option 1: Individual parameters
  host?: string;
  port?: number;
  user: string;
  password: string;
  database: string;

  // Option 2: Connection string (mysql://user:pass@host:port/database)
  connectionString?: string;

  // Connection pool
  connectionLimit?: number;      // Default: 10
  queueLimit?: number;           // Default: 0 (unlimited)
  waitForConnections?: boolean;  // Default: true

  // Timeouts
  connectTimeout?: number;       // Default: 10000ms

  // SSL
  ssl?: boolean | {
    rejectUnauthorized?: boolean;
    ca?: string;
    cert?: string;
    key?: string;
  };

  // Other
  charset?: string;              // Default: utf8mb4
  timezone?: string;             // Default: local
}
```

### Type Mappings

| FieldType | MySQL Type |
|-----------|------------|
| string | TEXT |
| number | DOUBLE |
| boolean | TINYINT(1) |
| date | DATETIME |
| json | JSON |
| array | JSON |
| enum | VARCHAR(255) |
| file | TEXT |
| relation | INT |

---

## 2. Query Translator (`query-translator.ts`)

### TODO: BaseSQLTranslator Refactor

> **Future Work:** Extract common SQL logic into a `BaseSQLTranslator` class that can be shared between MySQL and SQLite adapters.
>
> **Location:** `packages/core/src/query-builder/base-sql-translator.ts` or new `packages/adapter-sql-base/`
>
> **Shared Logic (~80%):**
> - `translate()` - main dispatch (select/insert/update/delete)
> - `translateSelect()` - SELECT query building
> - `translateInsert()` - INSERT query building
> - `translateUpdate()` - UPDATE query building
> - `translateDelete()` - DELETE query building
> - `translateWhere()` - WHERE clause recursion
> - `translateWhereConditions()` - condition building
> - `translateOrderBy()` - ORDER BY clause
> - `translateSelectClause()` - field selection
> - `generateJoins()` - JOIN generation
>
> **Abstract Methods (override per dialect):**
> - `escapeIdentifier(name: string): string` - `"col"` vs `` `col` ``
> - `getParameterPlaceholder(index: number): string` - `$1` vs `?`
> - `escapeValue(value: unknown): string` - literal escaping
> - `translateILike(field: string, value: unknown): string` - native vs LOWER()
> - `translateRegex(field: string, value: unknown): string` - `~` vs `REGEXP`
> - `translateNullsOrder(direction: string, nulls: string): string` - NULLS FIRST/LAST handling
> - `supportsReturning(): boolean` - RETURNING clause support
> - `translateReturning(fields: string[]): string` - RETURNING or empty
>
> **Implementation Order:**
> 1. Implement MySQL adapter with standalone translator (current plan)
> 2. Implement SQLite adapter with standalone translator
> 3. Extract common logic into BaseSQLTranslator
> 4. Refactor both to extend base class

### MySQL-Specific Translations

| Feature | PostgreSQL | MySQL |
|---------|------------|-------|
| Identifier | `"column"` | `` `column` `` |
| Parameter | `$1, $2, $3` | `?, ?, ?` |
| ILIKE | `col ILIKE $1` | `LOWER(col) LIKE LOWER(?)` |
| RETURNING | `RETURNING id, name` | ❌ Not supported |
| Regex | `col ~ $1` | `col REGEXP ?` |
| Boolean | `TRUE/FALSE` | `1/0` or `TRUE/FALSE` |
| NULLS FIRST/LAST | Native | Workaround: `CASE WHEN col IS NULL THEN 0 ELSE 1 END` |

### Operator Support

All operators from PostgreSQL adapter will be supported:

- **Comparison:** `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`
- **Array:** `$in`, `$nin`
- **String:** `$like`, `$ilike`, `$contains`, `$startsWith`, `$endsWith`
- **Regex:** `$regex` (using MySQL `REGEXP`)
- **Null:** `$exists`, `$null`
- **Logical:** `$and`, `$or`, `$not`

---

## 3. Adapter (`adapter.ts`)

### Class: MySQLAdapter

Implements `DatabaseAdapter<MySQLConfig>` interface.

#### Connection

```typescript
class MySQLAdapter implements DatabaseAdapter<MySQLConfig> {
  private pool: mysql.Pool | undefined;
  private state: ConnectionState = 'disconnected';

  async connect(): Promise<Result<void, ConnectionError>> {
    // Parse connectionString if provided
    // Create pool with mysql2.createPool()
    // Test connection with pool.getConnection()
  }

  async disconnect(): Promise<Result<void, ConnectionError>> {
    // pool.end()
  }
}
```

#### Query Execution

```typescript
async executeQuery<T>(query: QueryObject): Promise<Result<QueryResult<T>, QueryError>> {
  // Translate query to SQL
  // Execute with pool.execute() (prepared statement)
  // Handle INSERT: use result.insertId instead of RETURNING
  // Map MySQL error codes to standardized errors
}
```

#### MySQL Error Codes

| MySQL Code | Forja Code |
|------------|------------|
| ER_DUP_ENTRY (1062) | UNIQUE_VIOLATION |
| ER_NO_REFERENCED_ROW_2 (1452) | FOREIGN_KEY_VIOLATION |
| ER_BAD_NULL_ERROR (1048) | NOT_NULL_VIOLATION |
| ER_NO_SUCH_TABLE (1146) | TABLE_NOT_FOUND |
| ER_BAD_FIELD_ERROR (1054) | COLUMN_NOT_FOUND |

#### Transactions

```typescript
async beginTransaction(): Promise<Result<Transaction, TransactionError>> {
  // Get connection from pool
  // connection.beginTransaction()
  // Return MySQLTransaction wrapper
}
```

#### Schema Operations

- `createTable(schema)` - CREATE TABLE with MySQL types
- `dropTable(name)` - DROP TABLE IF EXISTS
- `alterTable(name, ops)` - ALTER TABLE (ADD/DROP/MODIFY COLUMN)
- `addIndex(table, index)` - CREATE INDEX
- `dropIndex(table, name)` - DROP INDEX
- `getTables()` - Query information_schema.tables
- `getTableSchema(name)` - Query information_schema.columns
- `tableExists(name)` - Check existence

---

## 4. Connection String Parsing

Use mysql2's built-in URL parsing or simple custom parser:

```typescript
function parseConnectionString(url: string): Partial<MySQLConfig> {
  // mysql://user:password@host:port/database?charset=utf8mb4
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port) || 3306,
    user: parsed.username,
    password: parsed.password,
    database: parsed.pathname.slice(1),
    // Parse query params for additional options
  };
}
```

---

## 5. Implementation Order

1. **types.ts** - Config interface, type mappings, value converters
2. **query-translator.ts** - MySQL SQL generation
3. **adapter.ts** - Main adapter class
4. **index.ts** - Public exports
5. **Tests** - Unit and integration tests

---

## 6. Testing Strategy

### Unit Tests
- Query translator (all operators)
- Type mappings
- Connection string parsing
- Value conversion

### Integration Tests (requires MySQL instance)
- Connection/disconnection
- CRUD operations
- Transactions
- Schema operations
- Error handling

### Test Database
```bash
# Docker for local testing
docker run --name forja-mysql -e MYSQL_ROOT_PASSWORD=test -e MYSQL_DATABASE=forja_test -p 3306:3306 -d mysql:5.7
```

---

## 7. Differences from PostgreSQL Adapter

| Aspect | PostgreSQL | MySQL |
|--------|------------|-------|
| Driver | `pg` | `mysql2` |
| Pool | `new Pool()` | `createPool()` |
| Execute | `pool.query()` | `pool.execute()` |
| Params | `$1, $2` | `?, ?` |
| Insert ID | `RETURNING id` | `result.insertId` |
| Escape | Double quotes | Backticks |
| ILIKE | Native | Emulated |

---

## 8. Public API

```typescript
// Main export
export { MySQLAdapter, createMySQLAdapter } from './adapter';
export type { MySQLConfig, MySQLDataType } from './types';

// Usage
import { createMySQLAdapter } from 'forja-adapter-mysql';

const adapter = createMySQLAdapter({
  connectionString: 'mysql://root:pass@localhost:3306/mydb'
});

// Or with individual options
const adapter = createMySQLAdapter({
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'pass',
  database: 'mydb',
  connectionLimit: 20
});
```

---

## Notes

- mysql2 supports both callback and promise APIs - use promise API
- mysql2 has built-in prepared statement caching
- Connection pool handles reconnection automatically
- SSL configuration similar to PostgreSQL
