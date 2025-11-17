# Adapters Module - Development Guidelines

## 📖 Module Overview

The Adapters module provides database-specific implementations that translate Forja's query objects into native database operations. Each adapter MUST implement the `DatabaseAdapter` interface.

**Supported Databases:**
- PostgreSQL (Priority 1)
- MySQL/MariaDB (Priority 2)
- MongoDB (Priority 3)

---

## 🎯 Adapter Interface Contract

**ALL adapters MUST implement this interface** (defined in `src/adapters/base/types.ts`):

```typescript
interface DatabaseAdapter<TConfig = Record<string, unknown>> {
  // Metadata
  readonly name: string; // 'postgres', 'mysql', 'mongodb'
  readonly config: TConfig;

  // Connection management
  connect(): Promise<Result<void, ConnectionError>>;
  disconnect(): Promise<Result<void, ConnectionError>>;
  isConnected(): boolean;

  // Query execution
  executeQuery<TResult>(query: QueryObject): Promise<Result<TResult, QueryError>>;
  executeRawQuery<TResult>(
    sql: string,
    params: readonly unknown[]
  ): Promise<Result<TResult, QueryError>>;

  // Transaction support
  beginTransaction(): Promise<Result<Transaction, TransactionError>>;

  // Schema operations (for migrations)
  createTable(schema: SchemaDefinition): Promise<Result<void, MigrationError>>;
  dropTable(tableName: string): Promise<Result<void, MigrationError>>;
  alterTable(
    tableName: string,
    operations: readonly AlterOperation[]
  ): Promise<Result<void, MigrationError>>;
  addIndex(
    tableName: string,
    index: IndexDefinition
  ): Promise<Result<void, MigrationError>>;
  dropIndex(
    tableName: string,
    indexName: string
  ): Promise<Result<void, MigrationError>>;

  // Introspection
  getTables(): Promise<Result<readonly string[], QueryError>>;
  getTableSchema(tableName: string): Promise<Result<SchemaDefinition, QueryError>>;
}
```

---

## 🔧 Adapter Implementation Requirements

### 1. Type Safety
```typescript
// ❌ NEVER do this
class PostgresAdapter implements DatabaseAdapter {
  config: any; // NO!
  async executeQuery(query: any): Promise<any> { } // NO!
}

// ✅ ALWAYS do this
interface PostgresConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly ssl?: boolean;
  readonly pool?: {
    readonly min?: number;
    readonly max?: number;
  };
}

class PostgresAdapter implements DatabaseAdapter<PostgresConfig> {
  readonly name = 'postgres' as const;
  readonly config: PostgresConfig;

  async executeQuery<TResult>(
    query: QueryObject
  ): Promise<Result<TResult, QueryError>> {
    // Implementation
  }
}
```

### 2. Error Handling
```typescript
// Use Result pattern - NEVER throw
async function executeQuery<TResult>(
  query: QueryObject
): Promise<Result<TResult, QueryError>> {
  try {
    const sql = this.translateQuery(query);
    const result = await this.pool.query(sql);
    return { success: true, data: result.rows as TResult };
  } catch (error) {
    return {
      success: false,
      error: new QueryError(
        'Query execution failed',
        { query, originalError: error }
      )
    };
  }
}
```

### 3. Connection Pooling
```typescript
// Each adapter should manage its own connection pool
class PostgresAdapter implements DatabaseAdapter<PostgresConfig> {
  private pool: Pool | null = null;

  async connect(): Promise<Result<void, ConnectionError>> {
    if (this.pool !== null) {
      return { success: true, data: undefined };
    }

    try {
      this.pool = new Pool({
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        min: this.config.pool?.min ?? 2,
        max: this.config.pool?.max ?? 10
      });

      // Test connection
      await this.pool.query('SELECT 1');

      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: new ConnectionError('Failed to connect', { originalError: error })
      };
    }
  }

  async disconnect(): Promise<Result<void, ConnectionError>> {
    if (this.pool === null) {
      return { success: true, data: undefined };
    }

    try {
      await this.pool.end();
      this.pool = null;
      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: new ConnectionError('Failed to disconnect', { originalError: error })
      };
    }
  }

  isConnected(): boolean {
    return this.pool !== null;
  }
}
```

---

## 🔄 Query Translation

### Core Responsibility
Each adapter must translate Forja's `QueryObject` into database-specific queries.

### PostgreSQL Example:
```typescript
class QueryTranslator {
  translate(query: QueryObject): { sql: string; params: readonly unknown[] } {
    switch (query.type) {
      case 'select':
        return this.translateSelect(query);
      case 'insert':
        return this.translateInsert(query);
      case 'update':
        return this.translateUpdate(query);
      case 'delete':
        return this.translateDelete(query);
    }
  }

  private translateSelect(query: QueryObject): { sql: string; params: readonly unknown[] } {
    const parts: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    // SELECT clause
    const selectFields = query.select === '*'
      ? '*'
      : query.select?.join(', ') ?? '*';
    parts.push(`SELECT ${selectFields}`);

    // FROM clause
    parts.push(`FROM ${this.escapeIdentifier(query.table)}`);

    // WHERE clause
    if (query.where) {
      const { sql, params: whereParams } = this.translateWhere(query.where, paramIndex);
      parts.push(`WHERE ${sql}`);
      params.push(...whereParams);
      paramIndex += whereParams.length;
    }

    // ORDER BY clause
    if (query.orderBy) {
      const orderClauses = query.orderBy.map(
        ({ field, direction }) =>
          `${this.escapeIdentifier(field)} ${direction.toUpperCase()}`
      );
      parts.push(`ORDER BY ${orderClauses.join(', ')}`);
    }

    // LIMIT/OFFSET
    if (query.limit !== undefined) {
      parts.push(`LIMIT $${paramIndex}`);
      params.push(query.limit);
      paramIndex++;
    }

    if (query.offset !== undefined) {
      parts.push(`OFFSET $${paramIndex}`);
      params.push(query.offset);
    }

    return { sql: parts.join(' '), params };
  }

  private translateWhere(
    where: WhereClause,
    startIndex: number
  ): { sql: string; params: readonly unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = startIndex;

    for (const [field, value] of Object.entries(where)) {
      if (field === '$and' || field === '$or') {
        // Handle logical operators
        const operator = field === '$and' ? 'AND' : 'OR';
        const subconditions = (value as WhereClause[]).map(subWhere => {
          const result = this.translateWhere(subWhere, paramIndex);
          paramIndex += result.params.length;
          params.push(...result.params);
          return `(${result.sql})`;
        });
        conditions.push(`(${subconditions.join(` ${operator} `)})`);
      } else if (typeof value === 'object' && value !== null) {
        // Handle comparison operators
        for (const [op, opValue] of Object.entries(value)) {
          const sqlOp = this.translateOperator(op);
          conditions.push(`${this.escapeIdentifier(field)} ${sqlOp} $${paramIndex}`);
          params.push(opValue);
          paramIndex++;
        }
      } else {
        // Simple equality
        conditions.push(`${this.escapeIdentifier(field)} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    }

    return {
      sql: conditions.join(' AND '),
      params
    };
  }

  private translateOperator(op: string): string {
    const operatorMap: Record<string, string> = {
      $eq: '=',
      $ne: '!=',
      $gt: '>',
      $gte: '>=',
      $lt: '<',
      $lte: '<=',
      $in: 'IN',
      $nin: 'NOT IN'
    };
    return operatorMap[op] ?? '=';
  }

  private escapeIdentifier(identifier: string): string {
    // PostgreSQL uses double quotes
    return `"${identifier.replace(/"/g, '""')}"`;
  }
}
```

### MySQL Differences:
```typescript
// MySQL uses ? for parameters instead of $1, $2
private translateSelect(query: QueryObject): { sql: string; params: readonly unknown[] } {
  // ... similar to PostgreSQL but use ? instead of $1
  parts.push(`LIMIT ?`);
}

private escapeIdentifier(identifier: string): string {
  // MySQL uses backticks
  return `\`${identifier.replace(/`/g, '``')}\``;
}
```

### MongoDB Differences:
```typescript
// MongoDB uses filter objects instead of SQL
class MongoQueryTranslator {
  translateSelect(query: QueryObject): {
    filter: Record<string, unknown>;
    projection?: Record<string, 1>;
    options: Record<string, unknown>;
  } {
    const filter = this.translateWhere(query.where ?? {});

    const projection = query.select === '*'
      ? undefined
      : query.select?.reduce((acc, field) => ({ ...acc, [field]: 1 }), {});

    const options: Record<string, unknown> = {};
    if (query.limit) options.limit = query.limit;
    if (query.offset) options.skip = query.offset;
    if (query.orderBy) {
      options.sort = query.orderBy.reduce(
        (acc, { field, direction }) => ({
          ...acc,
          [field]: direction === 'asc' ? 1 : -1
        }),
        {}
      );
    }

    return { filter, projection, options };
  }

  private translateWhere(where: WhereClause): Record<string, unknown> {
    const filter: Record<string, unknown> = {};

    for (const [field, value] of Object.entries(where)) {
      if (field === '$and' || field === '$or') {
        filter[field] = (value as WhereClause[]).map(w => this.translateWhere(w));
      } else if (typeof value === 'object' && value !== null) {
        filter[field] = value; // MongoDB operators are already correct ($gt, $gte, etc.)
      } else {
        filter[field] = value;
      }
    }

    return filter;
  }
}
```

---

## 🗄️ Type Mapping

Each adapter must map Forja types to database types:

### PostgreSQL Type Mapping:
```typescript
const TYPE_MAP: Record<FieldType, string> = {
  string: 'TEXT',
  number: 'NUMERIC',
  boolean: 'BOOLEAN',
  date: 'TIMESTAMP WITH TIME ZONE',
  json: 'JSONB'
};

function getColumnDefinition(field: FieldDefinition): string {
  let def = TYPE_MAP[field.type];

  // Handle constraints
  if (field.required) def += ' NOT NULL';
  if (field.unique) def += ' UNIQUE';
  if (field.default !== undefined) def += ` DEFAULT ${this.escapeValue(field.default)}`;

  // String-specific
  if (field.type === 'string' && field.maxLength) {
    def = `VARCHAR(${field.maxLength})${field.required ? ' NOT NULL' : ''}`;
  }

  return def;
}
```

### MySQL Type Mapping:
```typescript
const TYPE_MAP: Record<FieldType, string> = {
  string: 'TEXT',
  number: 'DECIMAL(65, 30)', // MySQL doesn't have NUMERIC
  boolean: 'BOOLEAN',
  date: 'DATETIME',
  json: 'JSON'
};
```

### MongoDB Type Mapping:
```typescript
// MongoDB is schemaless, but we can use validation
function createValidationSchema(schema: SchemaDefinition): Record<string, unknown> {
  const properties: Record<string, unknown> = {};

  for (const [fieldName, field] of Object.entries(schema.fields)) {
    properties[fieldName] = {
      bsonType: this.getBsonType(field.type),
      ...(field.required && { required: true })
    };
  }

  return {
    $jsonSchema: {
      bsonType: 'object',
      required: Object.keys(schema.fields).filter(k => schema.fields[k]?.required),
      properties
    }
  };
}
```

---

## 🔄 Transaction Support

```typescript
interface Transaction {
  readonly id: string;

  query<TResult>(query: QueryObject): Promise<Result<TResult, QueryError>>;
  rawQuery<TResult>(
    sql: string,
    params: readonly unknown[]
  ): Promise<Result<TResult, QueryError>>;

  commit(): Promise<Result<void, TransactionError>>;
  rollback(): Promise<Result<void, TransactionError>>;
}

// PostgreSQL implementation
class PostgresTransaction implements Transaction {
  readonly id: string;
  private client: PoolClient;
  private committed = false;
  private rolledBack = false;

  constructor(client: PoolClient) {
    this.id = crypto.randomUUID();
    this.client = client;
  }

  async query<TResult>(query: QueryObject): Promise<Result<TResult, QueryError>> {
    if (this.committed || this.rolledBack) {
      return {
        success: false,
        error: new QueryError('Transaction already completed')
      };
    }

    // Execute query using this.client
  }

  async commit(): Promise<Result<void, TransactionError>> {
    if (this.committed || this.rolledBack) {
      return {
        success: false,
        error: new TransactionError('Transaction already completed')
      };
    }

    try {
      await this.client.query('COMMIT');
      this.client.release();
      this.committed = true;
      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: new TransactionError('Commit failed', { originalError: error })
      };
    }
  }

  async rollback(): Promise<Result<void, TransactionError>> {
    if (this.committed || this.rolledBack) {
      return {
        success: false,
        error: new TransactionError('Transaction already completed')
      };
    }

    try {
      await this.client.query('ROLLBACK');
      this.client.release();
      this.rolledBack = true;
      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: new TransactionError('Rollback failed', { originalError: error })
      };
    }
  }
}
```

---

## 📁 File Structure Per Adapter

```
adapters/
├── base/
│   ├── types.ts          # DatabaseAdapter interface
│   └── adapter.ts        # Abstract base class (optional helper)
├── postgres/
│   ├── adapter.ts        # PostgresAdapter class
│   ├── query-translator.ts  # QueryTranslator class
│   ├── transaction.ts    # PostgresTransaction class
│   ├── connection.ts     # Connection pool manager
│   └── types.ts          # Postgres-specific types
├── mysql/
│   └── ... (same structure)
└── mongodb/
    └── ... (same structure)
```

---

## ✅ Testing Requirements

### Tests Required For Each Adapter:
1. Connection/disconnection
2. Query translation (SELECT, INSERT, UPDATE, DELETE)
3. WHERE clause translation (all operators)
4. Transaction begin/commit/rollback
5. Schema operations (CREATE TABLE, ALTER TABLE, etc.)
6. Type mapping
7. Error handling

### Example Test:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgresAdapter } from './adapter';

describe('PostgresAdapter', () => {
  let adapter: PostgresAdapter;

  beforeAll(async () => {
    adapter = new PostgresAdapter({
      host: 'localhost',
      port: 5432,
      database: 'test',
      user: 'test',
      password: 'test'
    });
    const result = await adapter.connect();
    expect(result.success).toBe(true);
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  it('should execute SELECT query', async () => {
    const result = await adapter.executeQuery({
      type: 'select',
      table: 'users',
      select: ['id', 'email'],
      where: { role: 'admin' }
    });

    expect(result.success).toBe(true);
  });

  it('should handle WHERE operators', async () => {
    const result = await adapter.executeQuery({
      type: 'select',
      table: 'users',
      where: { age: { $gte: 18, $lt: 65 } }
    });

    expect(result.success).toBe(true);
  });
});
```

---

## 🎯 Implementation Priority

1. **PostgreSQL Adapter** (Priority 1)
2. **MySQL Adapter** (Priority 2)
3. **MongoDB Adapter** (Priority 3)

---

## 🔑 Key Principles

1. **Interface Compliance** - MUST implement DatabaseAdapter
2. **Type Safety** - No `any`, no assertions
3. **Result Pattern** - Never throw, always return Result
4. **SQL Injection Prevention** - Always use parameterized queries
5. **Connection Pooling** - Efficient resource management
6. **Error Context** - Include helpful error information

**Remember:** Adapters are the bridge between Forja's type-safe API and raw database operations. Security and reliability are paramount.
