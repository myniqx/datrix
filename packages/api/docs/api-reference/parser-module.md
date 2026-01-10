# Parser Module API Reference

> Complete API reference for query string parsing

---

## parseQuery

Parse complete query string into structured query object.

```typescript
function parseQuery(
  query: Record<string, unknown>
): Result<ParsedQuery, ValidationError>

interface ParsedQuery {
  select?: string[];
  where?: WhereClause;
  populate?: PopulateClause;
  sort?: SortClause[];
  pagination?: { page: number; pageSize: number } | { limit: number; offset: number };
}
```

**Source:** `packages/api/src/parser/query.ts`

---

## parseWhere

Parse WHERE clause from query string.

```typescript
function parseWhere(
  where: unknown
): Result<WhereClause, ValidationError>

type WhereClause = {
  [field: string]:
    | string
    | number
    | boolean
    | { $eq?: unknown; $ne?: unknown; $gt?: unknown; /* ... */ };
};
```

**Supported operators:**
- `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`
- `$in`, `$nin`
- `$like`, `$ilike`, `$contains`, `$startsWith`, `$endsWith`
- `$null`, `$between`
- `$and`, `$or`, `$not`

**Source:** `packages/api/src/parser/where.ts`

---

## parsePopulate

Parse POPULATE clause for relation loading.

```typescript
function parsePopulate(
  populate: unknown,
  options?: { maxDepth?: number }
): Result<PopulateClause, ValidationError>

interface PopulateClause {
  [relation: string]: {
    fields?: string[];
    where?: WhereClause;
    populate?: PopulateClause;
  };
}
```

**Source:** `packages/api/src/parser/populate.ts`

---

## parsePagination

Parse pagination parameters.

```typescript
function parsePagination(
  query: Record<string, unknown>,
  options?: { maxPageSize?: number; defaultPageSize?: number }
): Result<Pagination, ValidationError>

type Pagination =
  | { page: number; pageSize: number }
  | { limit: number; offset: number };
```

**Source:** `packages/api/src/parser/pagination.ts`

---

## parseSort

Parse sort parameters.

```typescript
function parseSort(
  sort: unknown
): Result<SortClause[], ValidationError>

interface SortClause {
  field: string;
  order: 'ASC' | 'DESC';
}
```

**Source:** `packages/api/src/parser/sort.ts`

---

## parseFields

Parse field selection.

```typescript
function parseFields(
  fields: unknown
): Result<string[], ValidationError>
```

**Source:** `packages/api/src/parser/fields.ts`

---

## Types

```typescript
interface ParsedQuery {
  select?: string[];
  where?: WhereClause;
  populate?: PopulateClause;
  sort?: SortClause[];
  pagination?: Pagination;
}

type WhereClause = Record<string, unknown>;

interface PopulateClause {
  [relation: string]: {
    fields?: string[];
    where?: WhereClause;
    populate?: PopulateClause;
  };
}

interface SortClause {
  field: string;
  order: 'ASC' | 'DESC';
}

type Pagination =
  | { page: number; pageSize: number }
  | { limit: number; offset: number };
```

**Source:** `packages/api/src/parser/types.ts`

---

## Reference

**Source:** `packages/api/src/parser/`
