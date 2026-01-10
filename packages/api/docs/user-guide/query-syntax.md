# Query Syntax

> Complete reference for Strapi-style query parameters

---

## Overview

forja-api uses Strapi-inspired query syntax that's parsed from URL query strings and converted to database queries.

```bash
GET /api/users?where[status]=active&populate[posts][fields]=title&page=2&pageSize=50
```

---

## Field Selection

### Select Specific Fields

```bash
GET /api/users?fields=id,name,email
```

Returns only `id`, `name`, and `email` fields.

### Select All Fields

```bash
GET /api/users?fields=*
```

Returns all fields (default behavior).

### Array Syntax

```bash
GET /api/users?fields[0]=name&fields[1]=email
```

Alternative syntax for field selection.

---

## Filtering (WHERE Clause)

### Equality

```bash
GET /api/users?where[status]=active
GET /api/users?where[role]=admin
```

### Comparison Operators

#### $eq (Equal)
```bash
GET /api/users?where[age][$eq]=25
```

#### $ne (Not Equal)
```bash
GET /api/users?where[status][$ne]=deleted
```

#### $gt (Greater Than)
```bash
GET /api/users?where[age][$gt]=18
```

#### $gte (Greater Than or Equal)
```bash
GET /api/users?where[age][$gte]=18
```

#### $lt (Less Than)
```bash
GET /api/users?where[age][$lt]=65
```

#### $lte (Less Than or Equal)
```bash
GET /api/users?where[age][$lte]=65
```

### Array Operators

#### $in (In Array)
```bash
GET /api/users?where[role][$in][0]=admin&where[role][$in][1]=moderator
```

#### $nin (Not In Array)
```bash
GET /api/users?where[status][$nin][0]=banned&where[status][$nin][1]=deleted
```

### String Operators

#### $like (SQL LIKE, case-sensitive)
```bash
GET /api/users?where[name][$like]=%john%
```

#### $ilike (SQL ILIKE, case-insensitive)
```bash
GET /api/users?where[email][$ilike]=%@gmail.com
```

#### $contains (Contains substring)
```bash
GET /api/users?where[name][$contains]=john
```

#### $startsWith (Starts with)
```bash
GET /api/users?where[email][$startsWith]=admin
```

#### $endsWith (Ends with)
```bash
GET /api/users?where[email][$endsWith]=@company.com
```

### Null Checks

#### $null (Is Null)
```bash
GET /api/users?where[deletedAt][$null]=true
GET /api/users?where[email][$null]=false
```

### Date Operators

#### $between (Between two values)
```bash
GET /api/users?where[createdAt][$between][0]=2024-01-01&where[createdAt][$between][1]=2024-12-31
```

### Logical Operators

#### $and (AND condition)
```bash
GET /api/users?where[$and][0][age][$gte]=18&where[$and][1][status]=active
```

#### $or (OR condition)
```bash
GET /api/users?where[$or][0][role]=admin&where[$or][1][role]=moderator
```

#### $not (NOT condition)
```bash
GET /api/users?where[$not][status]=banned
```

### Complex Queries

```bash
GET /api/users?where[$and][0][$or][0][role]=admin&where[$and][0][$or][1][role]=moderator&where[$and][1][status]=active
```

Equivalent to: `(role = 'admin' OR role = 'moderator') AND status = 'active'`

---

## Populate (Relations)

### Simple Populate

```bash
GET /api/users?populate=posts
```

Populates `posts` relation with all fields.

### Populate with Field Selection

```bash
GET /api/users?populate[posts][fields]=title,content
```

Populates `posts` but only returns `title` and `content` fields.

### Multiple Relations

```bash
GET /api/users?populate[posts]=*&populate[comments]=*
```

### Nested Populate

```bash
GET /api/users?populate[posts][populate][author][fields]=name
```

Populates `posts`, then populates `author` within each post.

### Populate with Filters

```bash
GET /api/users?populate[posts][where][status]=published
```

Only populate posts where `status = 'published'`.

### Array Syntax

```bash
GET /api/users?populate[0]=posts&populate[1]=comments
```

---

## Pagination

### Page-Based

```bash
GET /api/users?page=2&pageSize=50
```

**Default:**
- `page`: 1
- `pageSize`: 25
- `maxPageSize`: 100

### Offset-Based

```bash
GET /api/users?limit=50&offset=100
```

**Equivalent to:**
```bash
GET /api/users?page=3&pageSize=50
```

---

## Sorting

### Single Field

```bash
GET /api/users?sort=name
```

Ascending order.

### Descending Order

```bash
GET /api/users?sort=-createdAt
```

Prefix with `-` for descending.

### Multiple Fields

```bash
GET /api/users?sort=-createdAt,name
```

Sort by `createdAt` descending, then `name` ascending.

### Array Syntax

```bash
GET /api/users?sort[0]=-createdAt&sort[1]=name
```

---

## Count

Get total count of matching records:

```bash
GET /api/users/count?where[status]=active
```

Response:
```json
{
  "data": 42
}
```

---

## Combined Example

```bash
GET /api/users?where[status]=active&where[age][$gte]=18&populate[posts][fields]=title,publishedAt&populate[posts][where][status]=published&fields=id,name,email&sort=-createdAt&page=2&pageSize=25
```

Breaks down to:
- Only active users aged 18+
- Include user's id, name, email
- Populate published posts with title and publishedAt
- Sort by createdAt descending
- Page 2 with 25 results per page

---

## Parsing in Code

### Direct Parser Usage

```typescript
import { parseQuery } from 'forja-api';

const result = parseQuery({
  'fields[0]': 'name',
  'where[status]': 'active',
  'populate[posts]': '*',
  'page': '2'
});

if (result.success) {
  const { select, where, populate, pagination } = result.data;
}
```

### Handler Parsing (Automatic)

```typescript
// Handlers automatically parse query strings
const handlers = createHandlers({
  schema: userSchema,
  adapter: postgresAdapter
});

// Query string is parsed automatically
export const { GET } = handlers;
```

---

## Operator Reference

| Operator | Description | Example |
|----------|-------------|---------|
| `$eq` | Equal | `where[age][$eq]=25` |
| `$ne` | Not equal | `where[status][$ne]=deleted` |
| `$gt` | Greater than | `where[age][$gt]=18` |
| `$gte` | Greater than or equal | `where[age][$gte]=18` |
| `$lt` | Less than | `where[age][$lt]=65` |
| `$lte` | Less than or equal | `where[age][$lte]=65` |
| `$in` | In array | `where[role][$in][0]=admin` |
| `$nin` | Not in array | `where[status][$nin][0]=banned` |
| `$like` | SQL LIKE (case-sensitive) | `where[name][$like]=%john%` |
| `$ilike` | SQL ILIKE (case-insensitive) | `where[email][$ilike]=%gmail%` |
| `$contains` | Contains substring | `where[name][$contains]=john` |
| `$startsWith` | Starts with | `where[email][$startsWith]=admin` |
| `$endsWith` | Ends with | `where[email][$endsWith]=@company.com` |
| `$null` | Is null / not null | `where[deletedAt][$null]=true` |
| `$between` | Between two values | `where[age][$between][0]=18` |
| `$and` | AND condition | `where[$and][0][age][$gte]=18` |
| `$or` | OR condition | `where[$or][0][role]=admin` |
| `$not` | NOT condition | `where[$not][status]=banned` |

---

## Limits and Defaults

```typescript
{
  maxPageSize: 100,        // Maximum records per page
  defaultPageSize: 25,     // Default records per page
  maxPopulateDepth: 5,     // Maximum nested populate depth
  maxWhereDepth: 10        // Maximum nested where depth
}
```

Override in handler configuration:

```typescript
createHandlers({
  schema: userSchema,
  adapter: postgresAdapter,
  options: {
    maxPageSize: 200,
    defaultPageSize: 50
  }
});
```

---

## Reference

**Source:**
- Query parser - `packages/api/src/parser/query.ts`
- WHERE parser - `packages/api/src/parser/where.ts`
- Populate parser - `packages/api/src/parser/populate.ts`
- Pagination - `packages/api/src/parser/pagination.ts`
