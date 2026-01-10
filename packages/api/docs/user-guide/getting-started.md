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

## Query Syntax

### Filtering

```bash
GET /api/users?where[role]=admin
GET /api/users?where[age][$gte]=18
```

### Field Selection

```bash
GET /api/users?fields=id,name,email
```

### Pagination

```bash
GET /api/users?page=2&pageSize=50
```

### Sorting

```bash
GET /api/users?sort=-createdAt,name
```

### Populate Relations

```bash
GET /api/users?populate[posts][fields]=title,content
```

See [Query Syntax](./query-syntax.md) for complete reference with all 21 operators.

---

## Advanced Configuration

Add permissions, middleware, and lifecycle hooks:

```typescript
createHandlers({
  schema: userSchema,
  adapter: postgresAdapter,

  middleware: [authMiddleware],

  permissions: {
    read: ['user', 'admin'],
    create: ['admin']
  },

  hooks: {
    beforeCreate: async (ctx, data) => ({
      ...data,
      createdAt: new Date()
    })
  }
});
```

See [Configuration](./configuration.md) for complete reference on permissions, middleware, hooks, and options.

---

## Next Steps

- [Query Syntax](./query-syntax.md) - Complete query parameter reference
- [Configuration](./configuration.md) - Permissions, middleware, hooks, and options
- [Next.js Integration](../framework-integration/nextjs.md) - App Router and Pages Router setup
- [Express Integration](../framework-integration/express.md) - Express.js setup

---

## Reference

**Source:** `packages/api/src/handler/factory.ts`
