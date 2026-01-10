# Handler Module API Reference

> Complete API reference for request handlers

---

## createHandlers

Create separate HTTP method handlers for Next.js App Router.

```typescript
function createHandlers<TSchema extends Schema>(
  config: HandlerConfig<TSchema>
): {
  GET: Handler;
  POST: Handler;
  PUT: Handler;
  DELETE: Handler;
}

type Handler = (context: HandlerContext) => Promise<HandlerResponse>;
```

**Source:** `packages/api/src/handler/factory.ts`

---

## createUnifiedHandler

Create single handler for all HTTP methods (Express, Fastify).

```typescript
function createUnifiedHandler<TSchema extends Schema>(
  config: HandlerConfig<TSchema>
): Handler

type Handler = (context: HandlerContext) => Promise<HandlerResponse>;
```

**Source:** `packages/api/src/handler/factory.ts`

---

## HandlerConfig

Configuration object for handler creation.

```typescript
interface HandlerConfig<TSchema extends Schema> {
  schema: TSchema;
  adapter: DatabaseAdapter;
  middleware?: Middleware[];
  permissions?: PermissionConfig;
  hooks?: HooksConfig;
  options?: HandlerOptions;
}
```

**Source:** `packages/api/src/handler/types.ts`

---

## HandlerContext

Request context passed to handlers and middleware.

```typescript
interface HandlerContext {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  headers: Record<string, string>;
  user?: unknown;
  [key: string]: unknown;
}
```

**Source:** `packages/api/src/handler/types.ts`

---

## HandlerResponse

Response returned by handlers.

```typescript
interface HandlerResponse {
  status: number;
  body: {
    data?: unknown;
    meta?: PaginationMeta;
    error?: ErrorResponse;
  };
  headers?: Record<string, string>;
}

interface PaginationMeta {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
}

interface ErrorResponse {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}
```

**Source:** `packages/api/src/handler/types.ts`

---

## Middleware

Middleware function signature.

```typescript
type Middleware = (
  context: HandlerContext,
  next: () => Promise<HandlerResponse>
) => Promise<HandlerResponse>;
```

**Source:** `packages/api/src/handler/middleware.ts`

---

## PermissionConfig

Permission configuration for CRUD operations.

```typescript
interface PermissionConfig {
  read?: PermissionRule;
  create?: PermissionRule;
  update?: PermissionRule;
  delete?: PermissionRule;
}

type PermissionRule =
  | boolean
  | string[]
  | ((context: HandlerContext) => boolean | Promise<boolean>);
```

**Source:** `packages/api/src/handler/permissions.ts`

---

## HooksConfig

Lifecycle hooks configuration.

```typescript
interface HooksConfig {
  beforeCreate?: (ctx: HandlerContext, data: unknown) => Promise<unknown>;
  afterCreate?: (ctx: HandlerContext, created: unknown) => Promise<unknown>;
  beforeUpdate?: (ctx: HandlerContext, data: unknown) => Promise<unknown>;
  afterUpdate?: (ctx: HandlerContext, updated: unknown) => Promise<unknown>;
  beforeDelete?: (ctx: HandlerContext, id: string | number) => Promise<void>;
  afterDelete?: (ctx: HandlerContext, id: string | number) => Promise<void>;
  afterFind?: (ctx: HandlerContext, data: unknown) => Promise<unknown>;
}
```

**Source:** `packages/api/src/handler/hooks.ts`

---

## HandlerOptions

Handler behavior options.

```typescript
interface HandlerOptions {
  // Pagination
  maxPageSize?: number;
  defaultPageSize?: number;

  // Populate
  maxPopulateDepth?: number;
  allowedPopulates?: string[];

  // Query
  maxWhereDepth?: number;
  allowedFilters?: string[];
  allowedSorts?: string[];

  // Response
  serializeRelations?: boolean;
  includeTimestamps?: boolean;
  includeMeta?: boolean;
}
```

**Defaults:**
```typescript
{
  maxPageSize: 100,
  defaultPageSize: 25,
  maxPopulateDepth: 5,
  maxWhereDepth: 10,
  serializeRelations: true,
  includeTimestamps: true,
  includeMeta: true
}
```

**Source:** `packages/api/src/handler/types.ts`

---

## Reference

**Source:** `packages/api/src/handler/`
