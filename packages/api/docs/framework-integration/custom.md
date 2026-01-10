# Custom Framework Integration

> Integrating forja-api with any HTTP framework

---

## Handler Context Interface

forja-api handlers expect a `HandlerContext` object:

```typescript
interface HandlerContext {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params: Record<string, string>;       // URL parameters { id: '123' }
  query: Record<string, unknown>;       // Query string parsed
  body: unknown;                        // Request body
  headers: Record<string, string>;      // Request headers
  user?: unknown;                       // Optional: Set by auth middleware
  [key: string]: unknown;               // Custom context properties
}
```

---

## Basic Integration Pattern

```typescript
import { createUnifiedHandler } from 'forja-api';

const userHandler = createUnifiedHandler({
  schema: userSchema,
  adapter: postgresAdapter
});

// In your framework's request handler:
async function handleRequest(frameworkRequest) {
  // 1. Build context from framework request
  const context: HandlerContext = {
    method: frameworkRequest.method,
    params: frameworkRequest.urlParams,
    query: frameworkRequest.queryParams,
    body: frameworkRequest.body,
    headers: frameworkRequest.headers
  };

  // 2. Call forja handler
  const response = await userHandler(context);

  // 3. Send framework response
  sendResponse(response.status, response.body);
}
```

---

## Example: Hono Integration

```typescript
import { Hono } from 'hono';
import { createUnifiedHandler } from 'forja-api';

const app = new Hono();

const userHandler = createUnifiedHandler({
  schema: userSchema,
  adapter: postgresAdapter
});

app.all('/api/users/:id?', async (c) => {
  const response = await userHandler({
    method: c.req.method as any,
    params: c.req.param(),
    query: c.req.query(),
    body: await c.req.json().catch(() => undefined),
    headers: Object.fromEntries(c.req.raw.headers)
  });

  return c.json(response.body, response.status);
});
```

---

## Example: Koa Integration

```typescript
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { createUnifiedHandler } from 'forja-api';

const app = new Koa();
const router = new Router();

app.use(bodyParser());

const userHandler = createUnifiedHandler({
  schema: userSchema,
  adapter: postgresAdapter
});

router.all('/api/users/:id?', async (ctx) => {
  const response = await userHandler({
    method: ctx.method as any,
    params: ctx.params,
    query: ctx.query,
    body: ctx.request.body,
    headers: ctx.headers as any
  });

  ctx.status = response.status;
  ctx.body = response.body;
});

app.use(router.routes());
```

---

## Example: Bun HTTP Server

```typescript
import { createUnifiedHandler } from 'forja-api';

const userHandler = createUnifiedHandler({
  schema: userSchema,
  adapter: postgresAdapter
});

Bun.serve({
  port: 3000,
  async fetch(request) {
    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/^\/api\/users\/?([\w-]+)?$/);

    if (!pathMatch) {
      return new Response('Not Found', { status: 404 });
    }

    const body = request.method !== 'GET'
      ? await request.json().catch(() => undefined)
      : undefined;

    const response = await userHandler({
      method: request.method as any,
      params: { id: pathMatch[1] },
      query: Object.fromEntries(url.searchParams),
      body,
      headers: Object.fromEntries(request.headers)
    });

    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
```

---

## Example: Deno HTTP Server

```typescript
import { createUnifiedHandler } from 'forja-api';

const userHandler = createUnifiedHandler({
  schema: userSchema,
  adapter: postgresAdapter
});

Deno.serve({ port: 3000 }, async (request) => {
  const url = new URL(request.url);
  const pathMatch = url.pathname.match(/^\/api\/users\/?([\w-]+)?$/);

  if (!pathMatch) {
    return new Response('Not Found', { status: 404 });
  }

  const body = request.method !== 'GET'
    ? await request.json().catch(() => undefined)
    : undefined;

  const response = await userHandler({
    method: request.method as any,
    params: { id: pathMatch[1] },
    query: Object.fromEntries(url.searchParams),
    body,
    headers: Object.fromEntries(request.headers)
  });

  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' }
  });
});
```

---

## Response Format

Handlers return a `HandlerResponse` object:

```typescript
interface HandlerResponse {
  status: number;                       // HTTP status code
  body: {
    data?: unknown;                     // Success response data
    meta?: {                            // Pagination meta (find all)
      page: number;
      pageSize: number;
      pageCount: number;
      total: number;
    };
    error?: {                           // Error response
      status: number;
      code: string;
      message: string;
      details?: unknown;
    };
  };
  headers?: Record<string, string>;     // Optional response headers
}
```

---

## Separate Method Handlers

If your framework supports separate method handlers (like Next.js App Router):

```typescript
import { createHandlers } from 'forja-api';

const { GET, POST, PUT, DELETE } = createHandlers({
  schema: userSchema,
  adapter: postgresAdapter
});

// In your framework:
framework.get('/api/users/:id?', async (req) => {
  const response = await GET({ ...buildContext(req) });
  return sendResponse(response);
});

framework.post('/api/users', async (req) => {
  const response = await POST({ ...buildContext(req) });
  return sendResponse(response);
});
```

---

## Context Builder Helper

Create a reusable context builder for your framework:

```typescript
function buildForjaContext(frameworkRequest): HandlerContext {
  return {
    method: frameworkRequest.method,
    params: extractParams(frameworkRequest),
    query: extractQuery(frameworkRequest),
    body: extractBody(frameworkRequest),
    headers: extractHeaders(frameworkRequest)
  };
}

// Usage:
const response = await userHandler(buildForjaContext(req));
```

---

## Testing Custom Integration

```typescript
import { describe, it, expect } from 'vitest';

describe('Custom Framework Integration', () => {
  it('should handle GET request', async () => {
    const mockRequest = {
      method: 'GET',
      params: {},
      query: {},
      body: undefined,
      headers: {}
    };

    const response = await userHandler(mockRequest);

    expect(response.status).toBe(200);
    expect(response.body.data).toBeInstanceOf(Array);
  });

  it('should handle POST request', async () => {
    const mockRequest = {
      method: 'POST',
      params: {},
      query: {},
      body: { name: 'Test', email: 'test@example.com' },
      headers: {}
    };

    const response = await userHandler(mockRequest);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      name: 'Test',
      email: 'test@example.com'
    });
  });
});
```

---

## Reference

**Source:** `packages/api/src/handler/factory.ts`
