# Getting Started

> Quick start guide for building REST APIs with forja-api

---

## Installation

```bash
# pnpm
pnpm add forja-api forja-core

# yarn
yarn add forja-api forja-core

# npm
npm install forja-api forja-core
```

---

## First API Endpoint

### Next.js App Router

```typescript
// app/api/users/[...forja]/route.ts
import { createHandlers } from 'forja-api';
import { defineSchema } from 'forja-core';
import { postgresAdapter } from '@/lib/db';

const userSchema = defineSchema({
  name: 'user',
  fields: {
    email: { type: 'string', required: true },
    name: { type: 'string', required: true },
    role: { type: 'enum', values: ['user', 'admin'] as const }
  }
});

export const { GET, POST, PUT, DELETE } = createHandlers({
  schema: userSchema,
  adapter: postgresAdapter
});
```

### Express

```typescript
import express from 'express';
import { createUnifiedHandler } from 'forja-api';

const app = express();
app.use(express.json());

const userHandler = createUnifiedHandler({
  schema: userSchema,
  adapter: postgresAdapter
});

app.all('/api/users/:id?', async (req, res) => {
  const response = await userHandler(req);
  res.status(response.status).json(response.body);
});
```

---

## Making Requests

### Find All

```bash
GET /api/users
```

Response:
```json
{
  "data": [
    { "id": 1, "email": "user@example.com", "name": "John Doe", "role": "user" }
  ],
  "meta": {
    "page": 1,
    "pageSize": 25,
    "pageCount": 1,
    "total": 1
  }
}
```

### Find One

```bash
GET /api/users/1
```

Response:
```json
{
  "data": { "id": 1, "email": "user@example.com", "name": "John Doe", "role": "user" }
}
```

### Create

```bash
POST /api/users
Content-Type: application/json

{
  "email": "new@example.com",
  "name": "Jane Doe",
  "role": "user"
}
```

### Update

```bash
PUT /api/users/1
Content-Type: application/json

{
  "name": "John Smith"
}
```

### Delete

```bash
DELETE /api/users/1
```

---

## Query Parameters

### Field Selection

```bash
GET /api/users?fields=id,name,email
```

Returns only specified fields.

### Filtering

```bash
GET /api/users?where[role]=admin
GET /api/users?where[age][$gte]=18
```

### Pagination

```bash
GET /api/users?page=2&pageSize=50
GET /api/users?limit=50&offset=100
```

### Sorting

```bash
GET /api/users?sort=-createdAt,name
```

Prefix with `-` for descending order.

### Populate Relations

```bash
GET /api/users?populate[posts][fields]=title,content
```

---

## Handler Configuration

```typescript
const handlers = createHandlers({
  schema: userSchema,
  adapter: postgresAdapter,

  // Optional: Middleware
  middleware: [authMiddleware, loggingMiddleware],

  // Optional: Permissions
  permissions: {
    read: ['user', 'admin'],
    create: ['admin'],
    update: (ctx) => ctx.user?.id === ctx.params.id,
    delete: ['admin']
  },

  // Optional: Lifecycle hooks
  hooks: {
    beforeCreate: async (ctx, data) => ({
      ...data,
      createdAt: new Date()
    }),
    afterFind: async (ctx, data) => data
  },

  // Optional: Options
  options: {
    maxPageSize: 100,
    defaultPageSize: 25,
    maxPopulateDepth: 5
  }
});
```

---

## Common Patterns

### Authentication Middleware

```typescript
const authMiddleware: Middleware = async (context, next) => {
  const token = context.headers?.authorization;

  if (!token) {
    return {
      status: 401,
      body: { error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }
    };
  }

  context.user = await verifyToken(token);
  return await next();
};
```

### Role-Based Permissions

```typescript
permissions: {
  read: ['user', 'admin'],      // Any user or admin
  create: ['admin'],             // Only admin
  update: ['admin'],
  delete: ['admin']
}
```

### Function-Based Permissions

```typescript
permissions: {
  update: (ctx) => {
    // Users can update their own records
    return ctx.user?.id === ctx.params.id || ctx.user?.role === 'admin';
  }
}
```

### Lifecycle Hooks

```typescript
hooks: {
  beforeCreate: async (ctx, data) => ({
    ...data,
    createdAt: new Date(),
    createdBy: ctx.user?.id
  }),

  afterFind: async (ctx, data) => {
    // Remove sensitive fields
    if (ctx.user?.role !== 'admin') {
      return Array.isArray(data)
        ? data.map(item => ({ ...item, password: undefined }))
        : { ...data, password: undefined };
    }
    return data;
  }
}
```

---

## Next Steps

- [Query Syntax](./query-syntax.md) - Learn all query parameters
- [Handlers](./handlers.md) - Advanced handler configuration
- [Permissions](./permissions.md) - Access control patterns
- [Middleware](./middleware.md) - Request/response middleware
- [Hooks](./hooks.md) - Lifecycle hooks reference

---

## Reference

**Source:** `packages/api/src/handler/factory.ts`
