# Query Builder - Adapter Developer Guide

> **Hedef Kitle:** Database adapter yazanlar (QueryObject → SQL/NoSQL çeviren developerlar)

Bu dokümanda `QueryObject` yapısını ve adapter'da nasıl kullanacağınızı açıklıyoruz.

---

## Genel Bakış

Query Builder, database-agnostic `QueryObject` üretir. Adapter'ınız bu objeyi kendi database diline çevirir:

```typescript
// Kullanıcı bunu yapar (API layer üzerinden)
const query = selectFrom('users')
  .where({ role: 'admin' })
  .build();

// Adapter bunu alır
interface QueryObject {
  type: 'select',
  table: 'users',
  where: { role: 'admin' }
}

// Adapter bunu çevirir
// PostgreSQL → "SELECT * FROM users WHERE role = $1"
// MySQL      → "SELECT * FROM users WHERE role = ?"
// MongoDB    → db.users.find({ role: 'admin' })
```

---

## QueryObject Type

```typescript
interface QueryObject {
  readonly type: QueryType                      // 'select' | 'insert' | 'update' | 'delete' | 'count'
  readonly table: string                        // Tablo adı
  readonly select?: SelectClause                // SELECT fields
  readonly where?: WhereClause                  // WHERE conditions
  readonly populate?: PopulateClause            // Relations (JOIN)
  readonly orderBy?: readonly OrderByItem[]     // ORDER BY
  readonly limit?: number                       // LIMIT
  readonly offset?: number                      // OFFSET
  readonly data?: Record<string, unknown>       // INSERT/UPDATE data
  readonly returning?: SelectClause             // RETURNING (PostgreSQL)
  readonly distinct?: boolean                   // SELECT DISTINCT
  readonly groupBy?: readonly string[]          // GROUP BY
  readonly having?: WhereClause                 // HAVING
  readonly meta?: QueryMetadata                 // Metadata (performans tracking vb)
}
```

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

**PostgreSQL çevirisi:**
```sql
SELECT id, email, name
FROM users
WHERE role = $1
ORDER BY "createdAt" DESC
LIMIT 25 OFFSET 0
-- Params: ['admin']
```

### INSERT

```typescript
{
  type: 'insert',
  table: 'users',
  data: {
    email: 'user@example.com',
    name: 'John Doe',
    role: 'user'
  },
  returning: ['id', 'email']
}
```

**PostgreSQL çevirisi:**
```sql
INSERT INTO users (email, name, role)
VALUES ($1, $2, $3)
RETURNING id, email
-- Params: ['user@example.com', 'John Doe', 'user']
```

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

**PostgreSQL çevirisi:**
```sql
UPDATE users
SET role = $1
WHERE id = $2
RETURNING *
-- Params: ['admin', '123']
```

### DELETE

```typescript
{
  type: 'delete',
  table: 'users',
  where: { id: '123' }
}
```

**PostgreSQL çevirisi:**
```sql
DELETE FROM users WHERE id = $1
-- Params: ['123']
```

### COUNT

```typescript
{
  type: 'count',
  table: 'users',
  where: { role: 'admin' }
}
```

**PostgreSQL çevirisi:**
```sql
SELECT COUNT(*) FROM users WHERE role = $1
-- Params: ['admin']
```

---

## WHERE Clause

### Basit Eşitlik

```typescript
where: {
  role: 'admin',
  status: 'active'
}
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

**Tüm operatörler:**
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

**SQL:**
```sql
WHERE email LIKE $1 AND name ILIKE $2
-- PostgreSQL: ILIKE (case-insensitive)
-- MySQL: LIKE ... COLLATE utf8_general_ci
```

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

### Implementation Example

```typescript
function translateWhere(
  where: WhereClause,
  params: unknown[],
  paramIndex: number
): string {
  const conditions: string[] = [];

  for (const [key, value] of Object.entries(where)) {
    if (key === '$and') {
      const nested = (value as WhereClause[])
        .map(w => translateWhere(w, params, paramIndex))
        .join(' AND ');
      conditions.push(`(${nested})`);
    } else if (key === '$or') {
      const nested = (value as WhereClause[])
        .map(w => translateWhere(w, params, paramIndex))
        .join(' OR ');
      conditions.push(`(${nested})`);
    } else if (typeof value === 'object' && value !== null) {
      // Comparison operators
      for (const [op, val] of Object.entries(value)) {
        params.push(val);
        const placeholder = `$${paramIndex++}`;
        conditions.push(`${key} ${operatorMap[op]} ${placeholder}`);
      }
    } else {
      // Simple equality
      params.push(value);
      conditions.push(`${key} = $${paramIndex++}`);
    }
  }

  return conditions.join(' AND ');
}
```

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

**SQL (JOIN):**
```sql
SELECT
  posts.*,
  author.id AS "author.id",
  author.name AS "author.name",
  author.email AS "author.email"
FROM posts
LEFT JOIN users AS author ON posts.authorId = author.id
```

**Not:** Comments gibi hasMany ilişkiler ayrı sorgu gerektirir (N+1 problem).

### Implementation Strategy

**Option 1: JOIN (hasOne, belongsTo)**
```typescript
if (relation.kind === 'hasOne' || relation.kind === 'belongsTo') {
  sql += ` LEFT JOIN ${relation.table} AS ${alias} ON ${joinCondition}`;
}
```

**Option 2: Separate Query (hasMany, manyToMany)**
```typescript
if (relation.kind === 'hasMany') {
  // Ana sorguyu çalıştır
  const posts = await executeQuery(mainQuery);

  // Relation sorgusu çalıştır
  const comments = await executeQuery({
    type: 'select',
    table: 'comments',
    where: { postId: { $in: posts.map(p => p.id) } }
  });

  // Sonuçları birleştir
  posts.forEach(post => {
    post.comments = comments.filter(c => c.postId === post.id);
  });
}
```

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

---

## GROUP BY & HAVING

```typescript
{
  select: ['category', 'COUNT(*) as count'],
  groupBy: ['category'],
  having: {
    count: { $gte: 10 }
  }
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

## Adapter Implementation Checklist

### Gerekli Metodlar

```typescript
class PostgresAdapter implements DatabaseAdapter {
  // Query execution
  async executeQuery<T>(query: QueryObject): Promise<T> {
    const { sql, params } = this.translate(query);
    return await this.client.query(sql, params);
  }

  // Query translation
  private translate(query: QueryObject): { sql: string; params: unknown[] } {
    switch (query.type) {
      case 'select': return this.translateSelect(query);
      case 'insert': return this.translateInsert(query);
      case 'update': return this.translateUpdate(query);
      case 'delete': return this.translateDelete(query);
      case 'count': return this.translateCount(query);
    }
  }

  private translateSelect(query: QueryObject): { sql: string; params: unknown[] } {
    // Implementation
  }

  // ... diğer metodlar
}
```

### Handle Edge Cases

```typescript
// 1. WHERE clause olmadan DELETE (tehlikeli!)
if (query.type === 'delete' && !query.where) {
  throw new Error('DELETE without WHERE is not allowed');
}

// 2. Populate depth limit
if (this.getPopulateDepth(query.populate) > 5) {
  throw new Error('Populate depth exceeds limit (5)');
}

// 3. LIMIT validation
if (query.limit && query.limit > 1000) {
  throw new Error('Limit exceeds maximum (1000)');
}

// 4. SQL injection prevention
// ALWAYS use parameterized queries, NEVER string concatenation
const sql = `SELECT * FROM ${query.table}`; // ❌ YANLIŞ
const sql = `SELECT * FROM users WHERE id = ${userId}`; // ❌ TEHLİKELİ

const sql = `SELECT * FROM users WHERE id = $1`; // ✅ DOĞRU
const params = [userId];
```

---

## Utility Functions

Core package bu yardımcı fonksiyonları sağlar:

```typescript
import {
  mergeWhereClauses,
  validateWhereClause,
  validateSelectFields,
  validatePopulateClause,
  calculatePagination
} from '@forja/core';

// WHERE clause merge
const merged = mergeWhereClauses(
  { status: 'active' },
  { role: 'admin' }
);
// { status: 'active', role: 'admin' }

// Validation
const result = validateWhereClause(where, schema);
if (!result.success) {
  throw new Error('Invalid WHERE clause');
}

// Pagination
const { limit, offset } = calculatePagination(2, 25);
// { limit: 25, offset: 25, page: 2, pageSize: 25 }
```

---

## Performance Considerations

### 1. Parameterized Queries
```typescript
// ❌ String concatenation (SQL injection risk + no query plan caching)
const sql = `SELECT * FROM users WHERE email = '${email}'`;

// ✅ Parameterized (safe + database can cache query plan)
const sql = `SELECT * FROM users WHERE email = $1`;
const params = [email];
```

### 2. Connection Pooling
```typescript
// ✅ Use connection pool
const pool = new Pool({ max: 20 });

// ❌ Don't create new connection per query
const client = new Client();
await client.connect();
```

### 3. Populate Optimization
```typescript
// N+1 problem için batch loading kullan
const posts = await loadPosts();
const authorIds = [...new Set(posts.map(p => p.authorId))];
const authors = await loadAuthors({ id: { $in: authorIds } });

// Sonuçları map'le
const authorsMap = new Map(authors.map(a => [a.id, a]));
posts.forEach(p => p.author = authorsMap.get(p.authorId));
```

---

## Error Handling

```typescript
async executeQuery<T>(query: QueryObject): Promise<T> {
  try {
    const { sql, params } = this.translate(query);
    const result = await this.client.query(sql, params);
    return this.parseResult(result);
  } catch (error) {
    // Database errors → MigrationSystemError veya custom error
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

```typescript
describe('PostgresAdapter', () => {
  it('should translate simple SELECT', () => {
    const query: QueryObject = {
      type: 'select',
      table: 'users',
      where: { role: 'admin' }
    };

    const { sql, params } = adapter.translate(query);

    expect(sql).toBe('SELECT * FROM users WHERE role = $1');
    expect(params).toEqual(['admin']);
  });

  it('should handle complex WHERE with operators', () => {
    const query: QueryObject = {
      type: 'select',
      table: 'users',
      where: {
        age: { $gte: 18, $lte: 65 },
        status: { $in: ['active', 'pending'] }
      }
    };

    const { sql, params } = adapter.translate(query);

    expect(sql).toContain('age >= $1');
    expect(sql).toContain('age <= $2');
    expect(sql).toContain('status IN ($3, $4)');
    expect(params).toEqual([18, 65, 'active', 'pending']);
  });
});
```

---

## Referans

**Type Definitions:**
- `QueryObject` - `forja-types/query-builder.ts`
- `WhereClause` - `forja-types/query-builder.ts`
- `PopulateClause` - `forja-types/query-builder.ts`

**Utility Functions:**
- `mergeWhereClauses()` - `@forja/core/query-builder`
- `validateWhereClause()` - `@forja/core/query-builder`
- `calculatePagination()` - `@forja/core/query-builder`

**Example Implementation:**
- PostgreSQL Adapter - `@forja/adapters/postgres`

---

## Özet

Adapter yazarken:
- ✅ `QueryObject` → SQL/NoSQL çevirisi yap
- ✅ Parameterized queries kullan (SQL injection önleme)
- ✅ WHERE clause recursive parse et (nested $and/$or)
- ✅ Populate için JOIN veya separate query stratejisi
- ✅ Edge cases handle et (WHERE'siz DELETE vb)
- ✅ Connection pooling kullan
- ✅ Hataları yakala ve anlamlı error throw et
