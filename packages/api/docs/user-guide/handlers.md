# Handlers

> CRUD handlers configuration and customization

---

## Overview

Handlers are the core of forja-api, providing CRUD operations for your schemas. They are framework-agnostic and can be integrated with Next.js, Express, Fastify, or any custom HTTP framework.

---

## Creating Handlers

### Next.js (Separate Methods)

```typescript
import { createHandlers } from 'forja-api';

export const { GET, POST, PUT, DELETE } = createHandlers({
  schema: userSchema,
  adapter: postgresAdapter
});
```

Creates separate handlers for each HTTP method.

### Unified Handler (Express, Fastify)

```typescript
import { createUnifiedHandler } from 'forja-api';

const userHandler = createUnifiedHandler({
  schema: userSchema,
  adapter: postgresAdapter
});

// Express
app.all('/api/users/:id?', async (req, res) => {
  const response = await userHandler(req);
  res.status(response.status).json(response.body);
});
```

Creates a single handler that routes based on HTTP method.

---

## Configuration

### Basic Configuration

```typescript
createHandlers({
  schema: userSchema,
  adapter: postgresAdapter
});
```

### Full Configuration

```typescript
createHandlers({
  schema: userSchema,
  adapter: postgresAdapter,

  middleware: [authMiddleware, loggingMiddleware],

  permissions: {
    read: ['user', 'admin'],
    create: ['admin'],
    update: (ctx) => ctx.user?.id === ctx.params.id,
    delete: ['admin']
  },

  hooks: {
    beforeCreate: async (ctx, data) => ({ ...data, createdAt: new Date() }),
    afterFind: async (ctx, data) => data
  },

  options: {
    maxPageSize: 100,
    defaultPageSize: 25,
    maxPopulateDepth: 5
  }
});
```

---

## Handler Options

### Pagination Options

```typescript
options: {
  maxPageSize: 100,        // Maximum records per page (default: 100)
  defaultPageSize: 25,     // Default records per page (default: 25)
}
```

### Populate Options

```typescript
options: {
  maxPopulateDepth: 5,     // Maximum nested populate depth (default: 5)
  allowedPopulates: ['posts', 'comments'] // Restrict which relations can be populated
}
```

### Query Options

```typescript
options: {
  maxWhereDepth: 10,       // Maximum nested where depth (default: 10)
  allowedFilters: ['status', 'role'], // Restrict which fields can be filtered
  allowedSorts: ['createdAt', 'name']  // Restrict which fields can be sorted
}
```

### Response Options

```typescript
options: {
  serializeRelations: true, // Populate relations in response (default: true)
  includeTimestamps: true,  // Include createdAt/updatedAt (default: true)
  includeMeta: true         // Include pagination meta (default: true)
}
```

---

## CRUD Operations

### Find All (GET /resource)

Returns paginated collection of records.

**Request:**
```bash
GET /api/users?page=1&pageSize=25
```

**Response:**
```json
{
  "data": [
    { "id": 1, "name": "John Doe", "email": "john@example.com" }
  ],
  "meta": {
    "page": 1,
    "pageSize": 25,
    "pageCount": 1,
    "total": 1
  }
}
```

### Find One (GET /resource/:id)

Returns single record by ID.

**Request:**
```bash
GET /api/users/1
```

**Response:**
```json
{
  "data": { "id": 1, "name": "John Doe", "email": "john@example.com" }
}
```

### Create (POST /resource)

Creates new record.

**Request:**
```bash
POST /api/users
Content-Type: application/json

{
  "name": "Jane Doe",
  "email": "jane@example.com"
}
```

**Response:**
```json
{
  "data": { "id": 2, "name": "Jane Doe", "email": "jane@example.com" }
}
```

### Update (PUT /resource/:id)

Updates existing record.

**Request:**
```bash
PUT /api/users/1
Content-Type: application/json

{
  "name": "John Smith"
}
```

**Response:**
```json
{
  "data": { "id": 1, "name": "John Smith", "email": "john@example.com" }
}
```

### Delete (DELETE /resource/:id)

Deletes record by ID.

**Request:**
```bash
DELETE /api/users/1
```

**Response:**
```json
{
  "data": { "id": 1, "deleted": true }
}
```

### Count (GET /resource/count)

Returns count of matching records.

**Request:**
```bash
GET /api/users/count?where[status]=active
```

**Response:**
```json
{
  "data": 42
}
```

---

## Context Object

Every handler receives a context object with request information:

```typescript
interface HandlerContext {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params: Record<string, string>;      // URL parameters
  query: Record<string, unknown>;       // Query string
  body: unknown;                        // Request body
  headers: Record<string, string>;      // Request headers
  user?: unknown;                       // User from authentication
  [key: string]: unknown;               // Custom context data
}
```

### Adding Custom Context

```typescript
const authMiddleware: Middleware = async (context, next) => {
  context.user = await verifyToken(context.headers?.authorization);
  context.requestId = generateRequestId();
  return await next();
};
```

---

## Error Handling

### Validation Errors

```json
{
  "error": {
    "status": 400,
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "email": ["Email is required"]
    }
  }
}
```

### Not Found

```json
{
  "error": {
    "status": 404,
    "code": "NOT_FOUND",
    "message": "Record not found"
  }
}
```

### Permission Denied

```json
{
  "error": {
    "status": 403,
    "code": "FORBIDDEN",
    "message": "Insufficient permissions"
  }
}
```

### Custom Errors

```typescript
const middleware: Middleware = async (context, next) => {
  if (!context.headers?.authorization) {
    return {
      status: 401,
      body: {
        error: {
          status: 401,
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      }
    };
  }
  return await next();
};
```

---

## Custom Handlers

### Read-Only Handler

```typescript
export const { GET } = createHandlers({
  schema: userSchema,
  adapter: postgresAdapter
});
// Only exposes GET method
```

### Custom Method Handler

```typescript
import { createHandler } from 'forja-api';

const customHandler = createHandler({
  schema: userSchema,
  adapter: postgresAdapter,

  handler: async (context) => {
    // Custom logic
    const users = await adapter.executeQuery({
      operation: 'find',
      collection: 'users',
      where: { /* custom where */ }
    });

    return {
      status: 200,
      body: { data: users }
    };
  }
});
```

---

## Multiple Schemas

```typescript
// users handler
export const usersHandler = createUnifiedHandler({
  schema: userSchema,
  adapter: postgresAdapter
});

// posts handler
export const postsHandler = createUnifiedHandler({
  schema: postSchema,
  adapter: postgresAdapter
});

// Express
app.all('/api/users/:id?', async (req, res) => {
  const response = await usersHandler(req);
  res.status(response.status).json(response.body);
});

app.all('/api/posts/:id?', async (req, res) => {
  const response = await postsHandler(req);
  res.status(response.status).json(response.body);
});
```

---

## Performance

### Caching

```typescript
const cache = new Map();

const cacheMiddleware: Middleware = async (context, next) => {
  if (context.method === 'GET') {
    const key = JSON.stringify(context.query);
    if (cache.has(key)) {
      return { status: 200, body: cache.get(key) };
    }

    const response = await next();
    if (response.status === 200) {
      cache.set(key, response.body);
    }
    return response;
  }
  return await next();
};
```

### Database Connection Pooling

```typescript
// Use connection pooling in adapter
const adapter = new PostgresAdapter({
  pool: {
    min: 2,
    max: 10
  }
});
```

---

## Testing

```typescript
import { describe, it, expect } from 'vitest';
import { createHandlers } from 'forja-api';

describe('User Handlers', () => {
  const { GET, POST } = createHandlers({
    schema: userSchema,
    adapter: mockAdapter
  });

  it('should find all users', async () => {
    const response = await GET({ query: {}, params: {} });
    expect(response.status).toBe(200);
    expect(response.body.data).toBeInstanceOf(Array);
  });

  it('should create user', async () => {
    const response = await POST({
      body: { name: 'Test', email: 'test@example.com' },
      params: {}
    });
    expect(response.status).toBe(201);
  });
});
```

---

## Reference

**Source:**
- Handler factory - `packages/api/src/handler/factory.ts`
- CRUD operations - `packages/api/src/handler/crud.ts`
- Context types - `packages/api/src/handler/types.ts`
