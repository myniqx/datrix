# forja-api

> HTTP request handling, query parsing, and response serialization for Forja framework

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

`forja-api` is Forja's REST API layer, providing Strapi-style query parsing, CRUD handlers, and response serialization. It's framework-agnostic and works with Next.js, Express, Fastify, and any HTTP framework.

## Features

### 🔍 **Query Parser**
- Strapi-style query string parsing
- 21 filter operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$like`, `$ilike`, `$contains`, `$startsWith`, `$endsWith`, etc.
- Nested relation population with field selection
- Multiple pagination formats (page-based, offset-based)
- Multi-field sorting

### ⚡ **CRUD Handlers**
- Framework-agnostic request handlers
- Built-in permission system (role-based & function-based)
- Middleware support (Express-style)
- Lifecycle hooks (beforeCreate, afterFind, etc.)
- Auto-detect framework (Next.js, Express, or generic)

### 📦 **Response Serializer**
- Field selection and projection
- Relation population
- Pagination metadata
- Circular reference detection
- Type-safe serialization

## Installation

```bash
# pnpm
pnpm add forja-api

# yarn
yarn add forja-api

# npm
npm install forja-api
```

## Quick Start

### Next.js App Router

```typescript
// app/api/users/[...forja]/route.ts
import { createHandlers } from 'forja-api';
import { userSchema, postgresAdapter } from '@/lib/forja';

export const { GET, POST, PUT, DELETE } = createHandlers({
  schema: userSchema,
  adapter: postgresAdapter,
  permissions: {
    read: ['user', 'admin'],
    create: ['admin'],
    update: (ctx) => ctx.user?.id === ctx.params.id,
    delete: ['admin']
  }
});
```

### Express

```typescript
import express from 'express';
import { createUnifiedHandler } from 'forja-api';

const app = express();

const userHandler = createUnifiedHandler({
  schema: userSchema,
  adapter: postgresAdapter
});

app.all('/api/users/:id?', async (req, res) => {
  const response = await userHandler(req);
  res.status(response.status).json(response.body);
});
```

## Query Syntax

```bash
# Field selection
GET /api/users?fields=name,email

# Filtering
GET /api/users?where[role]=admin&where[age][$gte]=18

# Populate relations
GET /api/users?populate[posts][fields]=title,content

# Pagination
GET /api/users?page=2&pageSize=25

# Sorting
GET /api/users?sort=-createdAt,name
```

## Core Concepts

### Handler Configuration

```typescript
const handlers = createHandlers({
  schema: userSchema,
  adapter: postgresAdapter,

  // Middleware
  middleware: [authMiddleware, loggingMiddleware],

  // Permissions
  permissions: {
    read: ['user', 'admin'],
    create: ['admin'],
    update: (ctx) => ctx.user?.role === 'admin',
    delete: ['admin']
  },

  // Lifecycle hooks
  hooks: {
    beforeCreate: async (ctx, data) => ({
      ...data,
      createdAt: new Date()
    }),
    afterFind: async (ctx, data) => {
      // Transform data
      return data;
    }
  },

  // Options
  options: {
    maxPageSize: 100,
    defaultPageSize: 25,
    maxPopulateDepth: 5
  }
});
```

### Middleware

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

### Permissions

```typescript
// Role-based
permissions: {
  read: ['user', 'admin'],
  create: ['admin']
}

// Function-based
permissions: {
  update: (ctx) => {
    return ctx.user?.id === ctx.params.id || ctx.user?.role === 'admin';
  }
}
```

### Lifecycle Hooks

```typescript
hooks: {
  // Before operations
  beforeFind: async (ctx, query) => query,
  beforeCreate: async (ctx, data) => data,
  beforeUpdate: async (ctx, id, data) => data,
  beforeDelete: async (ctx, id) => {},

  // After operations
  afterFind: async (ctx, data) => data,
  afterCreate: async (ctx, data) => data,
  afterUpdate: async (ctx, data) => data,
  afterDelete: async (ctx, id) => {}
}
```

## Framework Integration

### Next.js (App Router)

```typescript
import { createHandlers, buildContextFromNextApp } from 'forja-api';

export async function GET(request: Request, { params }) {
  const context = await buildContextFromNextApp(request, {
    extractParams: () => ({ id: params.id })
  });

  const response = await handlers.GET(context);
  return Response.json(response.body, { status: response.status });
}
```

### Express / Fastify

```typescript
import { createUnifiedHandler, buildContextFromExpress } from 'forja-api';

app.all('/api/users/:id?', async (req, res) => {
  const context = buildContextFromExpress(req);
  const response = await handler(context);
  res.status(response.status).json(response.body);
});
```

### Custom Framework

```typescript
import { createHandlers } from 'forja-api';

const context = {
  method: 'GET',
  params: { id: '123' },
  query: { fields: 'name,email' },
  body: null,
  headers: {},
  metadata: {}
};

const response = await handlers.GET(context);
```

## API Operations

### Find Many

```typescript
GET /api/users?where[status]=active&limit=10
```

Returns paginated list of records.

### Find One

```typescript
GET /api/users/123
```

Returns single record by ID.

### Create

```typescript
POST /api/users
Content-Type: application/json

{
  "email": "user@example.com",
  "name": "John Doe"
}
```

Creates new record with validation.

### Update

```typescript
PUT /api/users/123
Content-Type: application/json

{
  "name": "Jane Doe"
}
```

Updates record (partial updates supported).

### Delete

```typescript
DELETE /api/users/123
```

Deletes record by ID.

### Count

```typescript
GET /api/users/count?where[status]=active
```

Returns count of matching records.

## Advanced Usage

### Direct Parser Usage

```typescript
import { parseQuery } from 'forja-api';

const result = parseQuery({
  'fields[0]': 'name',
  'where[status]': 'active',
  'populate[posts]': '*'
});

if (result.success) {
  const { select, where, populate } = result.data;
}
```

### Custom Serialization

```typescript
import { serializeCollection } from 'forja-api';

const result = serializeCollection(records, {
  schema: userSchema,
  select: ['id', 'name', 'email'],
  populate: {
    posts: { select: ['title'] }
  }
});
```

### Custom Context Builder

```typescript
function buildCustomContext(request) {
  return {
    method: request.method,
    params: request.pathParams,
    query: request.queryParams,
    body: request.body,
    headers: request.headers,
    metadata: {}
  };
}
```

## Documentation

See [docs/](./docs/) for complete documentation:

- [Getting Started](./docs/user-guide/getting-started.md)
- [Query Syntax](./docs/user-guide/query-syntax.md)
- [Handlers](./docs/user-guide/handlers.md)
- [Permissions](./docs/user-guide/permissions.md)
- [Middleware](./docs/user-guide/middleware.md)
- [Hooks](./docs/user-guide/hooks.md)
- [Framework Integration](./docs/framework-integration/)
- [API Reference](./docs/api-reference/)

## Performance

- **Query Parsing:** <2ms for complex queries
- **Handler Execution:** <5ms (excluding database)
- **Serialization:** <3ms for typical payloads
- **Zero overhead:** Direct function calls, no reflection

## Dependencies

**Runtime:**
- `forja-core` (workspace package)
- `forja-types` (workspace package)

**Zero external runtime dependencies.**

## Type Safety

```typescript
import type {
  HandlerConfig,
  RequestContext,
  HandlerResponse,
  ParsedQuery,
  SerializerOptions
} from 'forja-api';
```

All exports are fully typed with TypeScript.

## Examples

See [examples/](../../examples/) for complete applications:
- [Next.js App](../../examples/nextjs-app/)
- [Express App](../../examples/express-app/)

## License

MIT © [Forja Contributors](https://github.com/myniqx/forja/graphs/contributors)

## Related Packages

- `forja-core` - Schema, validation, query building
- `forja-types` - TypeScript type definitions
- `forja-adapters` - Database adapters
- `forja-plugins` - Plugins (auth, upload, hooks)

---

**Made with ❤️ by the Forja team**
