# Query Builder - Adapter Developer Reference

> Technical reference for implementing database adapters. Covers `QueryObject` structure and translation patterns.

---

## Overview

Query Builder produces database-agnostic `QueryObject` structures. Adapters translate these to SQL/NoSQL.

```typescript
// Input (from API layer)
const query = selectFrom('users')
  .where({ role: 'admin' })
  .build();

// QueryObject
{
  type: 'select',
  table: 'users',
  where: { role: 'admin' }
}

// Adapter output
PostgreSQL: SELECT * FROM users WHERE role = $1
MySQL:      SELECT * FROM users WHERE role = ?
MongoDB:    db.users.find({ role: 'admin' })
```

---

## QueryObject Type

```typescript
interface QueryObject {
  readonly type: QueryType                      // 'select' | 'insert' | 'update' | 'delete' | 'count'
  readonly table: string                        // Table name
  readonly select?: SelectClause                // Fields to select
  readonly where?: WhereClause                  // Filter conditions
  readonly populate?: PopulateClause            // Relations (JOIN)
  readonly orderBy?: readonly OrderByItem[]     // Sorting
  readonly limit?: number                       // Pagination limit
  readonly offset?: number                      // Pagination offset
  readonly data?: Record<string, unknown>       // INSERT/UPDATE data
  readonly returning?: SelectClause             // RETURNING clause (PostgreSQL)
  readonly distinct?: boolean                   // SELECT DISTINCT
  readonly groupBy?: readonly string[]          // GROUP BY fields
  readonly having?: WhereClause                 // HAVING clause
  readonly meta?: QueryMetadata                 // Metadata (optional)
}
```

**Source:** `packages/types/src/query-builder.ts`

---

## Query Types

### SELECT

```typescript
{
  type: 'select',
  table: 'users',
  select: ['id', 'email', 'name'],
  where: { role: 'admin' },
  orderBy: [{ field: 'createdAt', direction: 'desc' }],
  limit: 25,
  offset: 0
}
```

**SQL:** `SELECT id, email, name FROM users WHERE role = $1 ORDER BY "createdAt" DESC LIMIT 25 OFFSET 0`

### INSERT

```typescript
{
  type: 'insert',
  table: 'users',
  data: { email: 'user@example.com', name: 'John' },
  returning: ['id', 'email']
}
```

**SQL:** `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id, email`

### UPDATE

```typescript
{
  type: 'update',
  table: 'users',
  data: { role: 'admin' },
  where: { id: '123' },
  returning: '*'
}
```

**SQL:** `UPDATE users SET role = $1 WHERE id = $2 RETURNING *`

### DELETE

```typescript
{
  type: 'delete',
  table: 'users',
  where: { id: '123' }
}
```

**SQL:** `DELETE FROM users WHERE id = $1`

### COUNT

```typescript
{
  type: 'count',
  table: 'users',
  where: { role: 'admin' }
}
```

**SQL:** `SELECT COUNT(*) FROM users WHERE role = $1`

---

## WHERE Clause

### Simple Equality

```typescript
where: { role: 'admin', status: 'active' }
```

**SQL:** `WHERE role = $1 AND status = $2`

### Comparison Operators

```typescript
where: {
  age: { $gte: 18, $lte: 65 },
  status: { $ne: 'deleted' }
}
```

**SQL:** `WHERE age >= $1 AND age <= $2 AND status != $3`

**Operators:**
- `$eq` → `=`
- `$ne` → `!=`
- `$gt` → `>`
- `$gte` → `>=`
- `$lt` → `<`
- `$lte` → `<=`

### Array Operators

```typescript
where: {
  role: { $in: ['admin', 'moderator'] },
  status: { $nin: ['deleted', 'banned'] }
}
```

**SQL:** `WHERE role IN ($1, $2) AND status NOT IN ($3, $4)`

### String Operators

```typescript
where: {
  email: { $like: '%@example.com' },
  name: { $ilike: '%john%' }
}
```

**SQL (PostgreSQL):** `WHERE email LIKE $1 AND name ILIKE $2`

**Operators:**
- `$like` → `LIKE` (case-sensitive)
- `$ilike` → `ILIKE` (case-insensitive, PostgreSQL only)
- `$contains` → `LIKE '%value%'`
- `$icontains` → `ILIKE '%value%'`
- `$regex` → Implementation-specific

### Logical Operators

```typescript
where: {
  $or: [
    { role: 'admin' },
    { role: 'moderator' }
  ]
}
```

**SQL:** `WHERE (role = $1 OR role = $2)`

**Nested:**
```typescript
where: {
  $and: [
    { status: 'active' },
    {
      $or: [
        { role: 'admin' },
        { verified: true }
      ]
    }
  ]
}
```

**SQL:** `WHERE status = $1 AND (role = $2 OR verified = $3)`

**Operators:**
- `$and` → `AND`
- `$or` → `OR`
- `$not` → `NOT`

---

## POPULATE Clause (Relations)

```typescript
populate: {
  author: {
    select: ['id', 'name', 'email']
  },
  comments: {
    select: ['id', 'content'],
    where: { approved: true },
    limit: 10
  }
}
```

**Translation Strategy:**

**hasOne/belongsTo:** Use JOIN
```sql
SELECT posts.*, author.id, author.name, author.email
FROM posts
LEFT JOIN users AS author ON posts.authorId = author.id
```

**hasMany/manyToMany:** Separate queries (avoid N+1)
```typescript
// 1. Main query
const posts = await executeQuery(mainQuery);

// 2. Batch load relations
const authorIds = [...new Set(posts.map(p => p.authorId))];
const authors = await executeQuery({
  type: 'select',
  table: 'users',
  where: { id: { $in: authorIds } }
});

// 3. Map results
const authorsMap = new Map(authors.map(a => [a.id, a]));
posts.forEach(p => p.author = authorsMap.get(p.authorId));
```

**Constraints:**
- Max populate depth: 5 levels
- Validated by `validatePopulateClause()` utility

---

## SELECT Clause

```typescript
select: ['id', 'email', 'name']  // Specific fields
select: '*'                      // All fields
```

**SQL:**
```sql
SELECT id, email, name FROM users  -- Specific
SELECT * FROM users                -- All
```

---

## ORDER BY

```typescript
orderBy: [
  { field: 'createdAt', direction: 'desc' },
  { field: 'name', direction: 'asc' }
]
```

**SQL:** `ORDER BY "createdAt" DESC, name ASC`

---

## Pagination

```typescript
limit: 25
offset: 50
```

**SQL:** `LIMIT 25 OFFSET 50`
**MongoDB:** `.skip(50).limit(25)`

**Constraints:**
- Default limit: 25
- Max limit: 100 (configurable)

---

## GROUP BY & HAVING

```typescript
{
  select: ['category', 'COUNT(*) as count'],
  groupBy: ['category'],
  having: { count: { $gte: 10 } }
}
```

**SQL:**
```sql
SELECT category, COUNT(*) as count
FROM products
GROUP BY category
HAVING count >= $1
```

---

## Adapter Implementation

### Required Method

```typescript
class PostgresAdapter implements DatabaseAdapter {
  async executeQuery<T>(query: QueryObject): Promise<T> {
    const { sql, params } = this.translate(query);
    return await this.client.query(sql, params);
  }

  private translate(query: QueryObject): { sql: string; params: unknown[] } {
    switch (query.type) {
      case 'select': return this.translateSelect(query);
      case 'insert': return this.translateInsert(query);
      case 'update': return this.translateUpdate(query);
      case 'delete': return this.translateDelete(query);
      case 'count': return this.translateCount(query);
    }
  }
}
```

### Critical: SQL Injection Prevention

```typescript
// ❌ NEVER - String concatenation
const sql = `SELECT * FROM ${query.table} WHERE id = ${userId}`;

// ✅ ALWAYS - Parameterized queries
const sql = `SELECT * FROM users WHERE id = $1`;
const params = [userId];
```

### Edge Cases to Handle

```typescript
// 1. DELETE without WHERE
if (query.type === 'delete' && !query.where) {
  throw new Error('DELETE without WHERE is not allowed');
}

// 2. Populate depth
if (getPopulateDepth(query.populate) > 5) {
  throw new Error('Populate depth exceeds limit');
}

// 3. LIMIT validation
if (query.limit && query.limit > 1000) {
  throw new Error('Limit exceeds maximum');
}
```

---

## Utility Functions

Core provides validation and helper utilities:

```typescript
import {
  mergeWhereClauses,
  validateWhereClause,
  validateSelectFields,
  validatePopulateClause,
  calculatePagination
} from 'forja-core';

// Merge WHERE clauses
const merged = mergeWhereClauses(
  { status: 'active' },
  { role: 'admin' }
);

// Validate against schema
const result = validateWhereClause(where, schema);
if (!result.success) {
  throw new Error('Invalid WHERE clause');
}

// Pagination helpers
const { limit, offset } = calculatePagination(2, 25);
// { limit: 25, offset: 25, page: 2, pageSize: 25 }
```

**Source:** `packages/core/src/query-builder/`

---

## Performance

### Connection Pooling

```typescript
// ✅ Use pool
const pool = new Pool({ max: 20 });

// ❌ Don't create new connection per query
const client = new Client();
await client.connect();
```

### Batch Loading (N+1 Prevention)

```typescript
// Load related data in batch
const userIds = [...new Set(posts.map(p => p.authorId))];
const users = await executeQuery({
  type: 'select',
  table: 'users',
  where: { id: { $in: userIds } }
});

// Map to original records
const usersMap = new Map(users.map(u => [u.id, u]));
posts.forEach(p => p.author = usersMap.get(p.authorId));
```

---

## Error Handling

```typescript
async executeQuery<T>(query: QueryObject): Promise<T> {
  try {
    const { sql, params } = this.translate(query);
    return await this.client.query(sql, params);
  } catch (error) {
    // Map database errors to Forja errors
    if (error.code === '23505') {
      throw new UniqueConstraintError(error.detail);
    }
    if (error.code === '23503') {
      throw new ForeignKeyConstraintError(error.detail);
    }
    throw new DatabaseError('Query execution failed', error);
  }
}
```

---

## Testing

See [Testing Guidelines](../../../tests/CLAUDE.md) for test strategy.

**Example test structure:**

```typescript
describe('PostgresAdapter - translateSelect', () => {
  it('translates simple WHERE clause', () => {
    const query: QueryObject = {
      type: 'select',
      table: 'users',
      where: { role: 'admin' }
    };

    const { sql, params } = adapter.translate(query);

    expect(sql).toBe('SELECT * FROM users WHERE role = $1');
    expect(params).toEqual(['admin']);
  });
});
```

---

## Reference

**Type Definitions:**
- `QueryObject` - `packages/types/src/query-builder.ts`
- `WhereClause` - `packages/types/src/query-builder.ts`
- `PopulateClause` - `packages/types/src/query-builder.ts`

**Utilities:**
- WHERE validation - `packages/core/src/query-builder/where/`
- SELECT validation - `packages/core/src/query-builder/select/`
- Populate validation - `packages/core/src/query-builder/populate/`
- Pagination - `packages/core/src/query-builder/pagination/`

**Example Implementation:**
- PostgreSQL Adapter - `packages/adapters/postgres/src/translator.ts`

**Related:**
- [Schema System](./schema-system.md)
- [Migration System](./migration-system.md)
- [Testing Guidelines](../../../tests/CLAUDE.md)
