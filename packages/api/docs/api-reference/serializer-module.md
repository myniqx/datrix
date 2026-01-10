# Serializer Module API Reference

> Complete API reference for response serialization

---

## serializeCollection

Serialize array of records with pagination metadata.

```typescript
function serializeCollection(
  data: unknown[],
  options: SerializerOptions
): SerializedCollection

interface SerializedCollection {
  data: unknown[];
  meta: {
    page: number;
    pageSize: number;
    pageCount: number;
    total: number;
  };
}
```

**Source:** `packages/api/src/serializer/collection.ts`

---

## serializeSingle

Serialize single record.

```typescript
function serializeSingle(
  data: unknown,
  options: SerializerOptions
): SerializedSingle

interface SerializedSingle {
  data: unknown;
}
```

**Source:** `packages/api/src/serializer/single.ts`

---

## serializeError

Serialize error response.

```typescript
function serializeError(
  error: Error | ValidationError,
  status?: number
): SerializedError

interface SerializedError {
  error: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  };
}
```

**Source:** `packages/api/src/serializer/error.ts`

---

## populateRelations

Populate relations in record(s).

```typescript
function populateRelations(
  data: unknown | unknown[],
  populate: PopulateClause,
  adapter: DatabaseAdapter
): Promise<unknown | unknown[]>
```

**Source:** `packages/api/src/serializer/relations.ts`

---

## selectFields

Select specific fields from record(s).

```typescript
function selectFields(
  data: unknown | unknown[],
  fields: string[]
): unknown | unknown[]
```

**Source:** `packages/api/src/serializer/fields.ts`

---

## SerializerOptions

Options for serialization.

```typescript
interface SerializerOptions {
  fields?: string[];
  populate?: PopulateClause;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
  };
  includeTimestamps?: boolean;
  serializeRelations?: boolean;
}
```

**Source:** `packages/api/src/serializer/types.ts`

---

## Types

```typescript
interface SerializedCollection {
  data: unknown[];
  meta: {
    page: number;
    pageSize: number;
    pageCount: number;
    total: number;
  };
}

interface SerializedSingle {
  data: unknown;
}

interface SerializedError {
  error: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  };
}

interface PopulateClause {
  [relation: string]: {
    fields?: string[];
    where?: WhereClause;
    populate?: PopulateClause;
  };
}
```

**Source:** `packages/api/src/serializer/types.ts`

---

## Reference

**Source:** `packages/api/src/serializer/`
