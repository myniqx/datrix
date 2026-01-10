# Query Builder Module API Reference

> Complete API reference for query builder module.

---

## Classes

### ForjaQueryBuilder

```typescript
class ForjaQueryBuilder<TSchema = Record<string, unknown>> implements QueryBuilder<TSchema> {
  constructor(schema?: SchemaDefinition)

  // Basic Configuration
  type(queryType: QueryType): this
  table(name: string): this

  // SELECT
  select(fields: SelectClause): this
  distinct(enabled?: boolean): this

  // WHERE
  where(conditions: WhereClause): this
  andWhere(conditions: WhereClause): this
  orWhere(conditions: WhereClause): this

  // RELATIONS/POPULATE
  populate(relations: PopulateClause): this

  // ORDERING
  orderBy(field: string, direction?: OrderDirection): this

  // PAGINATION
  limit(count: number): this
  offset(count: number): this

  // DATA (INSERT/UPDATE)
  data(values: Record<string, unknown>): this
  returning(fields: SelectClause): this

  // GROUPING
  groupBy(fields: readonly string[]): this
  having(conditions: WhereClause): this

  // BUILD
  build(): Result<QueryObject, QueryBuilderError>

  // UTILITIES
  clone(): QueryBuilder<TSchema>
  reset(): this
}
```

### QueryBuilderError

```typescript
class QueryBuilderError extends Error {
  readonly code: string
  readonly details?: {
    field?: string
    value?: unknown
  }
}
```

---

## Factory Functions

```typescript
function createQueryBuilder<TSchema = Record<string, unknown>>(
  schema?: SchemaDefinition
): ForjaQueryBuilder<TSchema>

function selectFrom<TSchema = Record<string, unknown>>(
  table: string,
  schema?: SchemaDefinition
): ForjaQueryBuilder<TSchema>

function insertInto<TSchema = Record<string, unknown>>(
  table: string,
  data: Record<string, unknown>,
  schema?: SchemaDefinition
): ForjaQueryBuilder<TSchema>

function updateTable<TSchema = Record<string, unknown>>(
  table: string,
  data: Record<string, unknown>,
  schema?: SchemaDefinition
): ForjaQueryBuilder<TSchema>

function deleteFrom<TSchema = Record<string, unknown>>(
  table: string,
  schema?: SchemaDefinition
): ForjaQueryBuilder<TSchema>

function countFrom<TSchema = Record<string, unknown>>(
  table: string,
  schema?: SchemaDefinition
): ForjaQueryBuilder<TSchema>
```

---

## WHERE Clause Utilities

```typescript
function mergeWhereClauses(
  ...clauses: readonly (WhereClause | undefined)[]
): WhereClause | undefined

function validateWhereClause(
  where: WhereClause,
  schema: SchemaDefinition,
  depth?: number
): Result<void, WhereBuilderError>

function isComparisonOperators(
  value: unknown
): value is ComparisonOperators

function isLogicalOperator(key: string): boolean

function createEqualityCondition(
  field: string,
  value: QueryPrimitive
): WhereClause

function createComparisonCondition(
  field: string,
  operator: keyof ComparisonOperators,
  value: unknown
): WhereClause

function createInCondition(
  field: string,
  values: readonly QueryPrimitive[]
): WhereClause

function createLikeCondition(
  field: string,
  pattern: string,
  caseSensitive?: boolean
): WhereClause

function createAndCondition(
  ...conditions: readonly WhereClause[]
): WhereClause

function createOrCondition(
  ...conditions: readonly WhereClause[]
): WhereClause

function createNotCondition(
  condition: WhereClause
): WhereClause

function isEmptyWhereClause(
  where?: WhereClause
): boolean
```

---

## SELECT Clause Utilities

```typescript
function normalizeSelectClause(
  select: SelectClause
): SelectClause

function validateSelectFields(
  select: SelectClause,
  schema: SchemaDefinition
): Result<void, SelectBuilderError>

function parseSelectClause(
  input: unknown
): Result<SelectClause, SelectBuilderError>

function mergeSelectClauses(
  ...selects: readonly SelectClause[]
): SelectClause

function expandSelectClause(
  select: SelectClause,
  schema: SchemaDefinition
): readonly string[]

function isFieldSelected(
  field: string,
  select: SelectClause
): boolean

function createSelectClause(
  fields: readonly string[] | '*'
): SelectClause

function excludeFields(
  select: SelectClause,
  schema: SchemaDefinition,
  excludeList: readonly string[]
): SelectClause
```

---

## Populate Clause Utilities

```typescript
function mergePopulateClauses(
  ...clauses: readonly (PopulateClause | undefined)[]
): PopulateClause

function parsePopulateClause(
  input: unknown
): Result<PopulateClause, PopulateBuilderError>

function validatePopulateClause(
  populate: PopulateClause,
  schema: SchemaDefinition,
  getSchema: (name: string) => SchemaDefinition | undefined,
  depth?: number
): Result<void, PopulateBuilderError>

function getRelationFields(
  schema: SchemaDefinition
): Record<string, RelationField>

function hasRelation(
  schema: SchemaDefinition,
  relationName: string
): boolean

function getRelationField(
  schema: SchemaDefinition,
  relationName: string
): Result<RelationField, PopulateBuilderError>

function createSimplePopulate(
  ...relations: readonly string[]
): PopulateClause

function createPopulateWithOptions(
  relation: string,
  options: PopulateOptions
): PopulateClause

function createNestedPopulate(
  relation: string,
  select?: SelectClause,
  nestedPopulate?: PopulateClause
): PopulateClause

function isEmptyPopulateClause(
  populate?: PopulateClause
): boolean

function getPopulateDepth(
  populate: PopulateClause,
  currentDepth?: number
): number
```

---

## Pagination Utilities

```typescript
function calculatePagination(
  page: number,
  pageSize: number,
  config?: PaginationConfig
): Result<PaginationParams, PaginationBuilderError>

function calculatePaginationFromLimitOffset(
  limit: number,
  offset: number,
  config?: PaginationConfig
): Result<PaginationParams, PaginationBuilderError>

function parsePaginationParams(
  params: {
    page?: unknown
    pageSize?: unknown
    limit?: unknown
    offset?: unknown
  },
  config?: PaginationConfig
): Result<PaginationParams, PaginationBuilderError>

function createPaginationMeta(
  params: PaginationParams,
  total: number
): PaginationMeta
```

---

## Types

```typescript
interface PaginationConfig {
  readonly defaultPageSize: number  // Default: 25
  readonly maxPageSize: number      // Default: 100
  readonly defaultPage: number      // Default: 1
}

interface PaginationParams {
  readonly limit: number
  readonly offset: number
  readonly page: number
  readonly pageSize: number
}

interface PaginationMeta {
  readonly page: number
  readonly pageSize: number
  readonly pageCount: number
  readonly total: number
}

const DEFAULT_PAGINATION_CONFIG: PaginationConfig
```

---

## Constants

```typescript
const MAX_WHERE_DEPTH = 10
const MAX_POPULATE_DEPTH = 5
```

---

## Source

- Query builder - `packages/core/src/query-builder/builder.ts`
- WHERE utilities - `packages/core/src/query-builder/where/`
- SELECT utilities - `packages/core/src/query-builder/select/`
- Populate utilities - `packages/core/src/query-builder/populate/`
- Pagination - `packages/core/src/query-builder/pagination/`
- Query types - `packages/types/src/query-builder.ts`
