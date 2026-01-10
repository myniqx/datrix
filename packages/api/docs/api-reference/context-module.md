# Context Module API Reference

> Complete API reference for request context building

---

## buildContextFromNextRequest

Build handler context from Next.js request.

```typescript
function buildContextFromNextRequest(
  request: NextRequest,
  params?: Record<string, string>
): HandlerContext
```

**App Router:**
```typescript
import { buildContextFromNextRequest } from 'forja-api/context';

export async function GET(request: NextRequest, { params }) {
  const context = buildContextFromNextRequest(request, params);
  const response = await handler(context);
  return Response.json(response.body, { status: response.status });
}
```

**Source:** `packages/api/src/context/nextjs.ts`

---

## buildContextFromExpressRequest

Build handler context from Express request.

```typescript
function buildContextFromExpressRequest(
  req: express.Request
): HandlerContext
```

**Express:**
```typescript
import { buildContextFromExpressRequest } from 'forja-api/context';

app.all('/api/users/:id?', async (req, res) => {
  const context = buildContextFromExpressRequest(req);
  const response = await handler(context);
  res.status(response.status).json(response.body);
});
```

**Source:** `packages/api/src/context/express.ts`

---

## buildContextFromFastifyRequest

Build handler context from Fastify request.

```typescript
function buildContextFromFastifyRequest(
  request: FastifyRequest
): HandlerContext
```

**Fastify:**
```typescript
import { buildContextFromFastifyRequest } from 'forja-api/context';

fastify.all('/api/users/:id?', async (request, reply) => {
  const context = buildContextFromFastifyRequest(request);
  const response = await handler(context);
  reply.status(response.status).send(response.body);
});
```

**Source:** `packages/api/src/context/fastify.ts`

---

## buildGenericContext

Build handler context from generic HTTP parameters.

```typescript
function buildGenericContext(options: {
  method: string;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
}): HandlerContext
```

**Custom Framework:**
```typescript
import { buildGenericContext } from 'forja-api/context';

const context = buildGenericContext({
  method: req.method,
  params: req.params,
  query: req.query,
  body: req.body,
  headers: req.headers
});

const response = await handler(context);
```

**Source:** `packages/api/src/context/generic.ts`

---

## HandlerContext

Context object structure.

```typescript
interface HandlerContext {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params: Record<string, string>;       // { id: '123' }
  query: Record<string, unknown>;       // Parsed query string
  body: unknown;                        // Request body
  headers: Record<string, string>;      // Request headers
  user?: unknown;                       // Set by auth middleware
  [key: string]: unknown;               // Custom properties
}
```

**Source:** `packages/api/src/context/types.ts`

---

## Reference

**Source:** `packages/api/src/context/`
