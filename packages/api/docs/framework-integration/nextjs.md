# Next.js Integration

> Using forja-api with Next.js App Router and Pages Router

---

## App Router (Recommended)

Next.js 13+ App Router with separate HTTP method handlers.

### File Structure

```
app/
└── api/
    └── users/
        └── [...forja]/
            └── route.ts
```

### Basic Setup

```typescript
// app/api/users/[...forja]/route.ts
import { createHandlers } from 'forja-api';
import { defineSchema } from 'forja-core';
import { postgresAdapter } from '@/lib/db';

const userSchema = defineSchema({
  name: 'user',
  fields: {
    email: { type: 'string', required: true },
    name: { type: 'string', required: true }
  }
});

export const { GET, POST, PUT, DELETE } = createHandlers({
  schema: userSchema,
  adapter: postgresAdapter
});
```

### With Middleware

```typescript
// app/api/users/[...forja]/route.ts
import { createHandlers } from 'forja-api';
import { authMiddleware } from '@/lib/middleware/auth';

export const { GET, POST, PUT, DELETE } = createHandlers({
  schema: userSchema,
  adapter: postgresAdapter,
  middleware: [authMiddleware],
  permissions: {
    read: true,
    create: (ctx) => !!ctx.user,
    update: (ctx) => !!ctx.user,
    delete: (ctx) => ctx.user?.role === 'admin'
  }
});
```

### Context from Next.js

```typescript
import { headers } from 'next/headers';

const authMiddleware: Middleware = async (context, next) => {
  const headersList = headers();
  const token = headersList.get('authorization');

  if (token) {
    context.user = await verifyToken(token);
  }

  return await next();
};
```

---

## Pages Router

Next.js 12 and below with API routes.

### File Structure

```
pages/
└── api/
    └── users/
        ├── index.ts
        └── [id].ts
```

### Setup

```typescript
// pages/api/users/[[...params]].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createUnifiedHandler } from 'forja-api';

const userHandler = createUnifiedHandler({
  schema: userSchema,
  adapter: postgresAdapter
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const response = await userHandler({
    method: req.method as any,
    params: { id: req.query.params?.[0] },
    query: req.query,
    body: req.body,
    headers: req.headers as any,
  });

  res.status(response.status).json(response.body);
}
```

---

## Multiple Resources

```
app/
└── api/
    ├── users/
    │   └── [...forja]/
    │       └── route.ts
    ├── posts/
    │   └── [...forja]/
    │       └── route.ts
    └── comments/
        └── [...forja]/
            └── route.ts
```

Each resource has its own handlers:

```typescript
// app/api/users/[...forja]/route.ts
export const { GET, POST, PUT, DELETE } = createHandlers({
  schema: userSchema,
  adapter: postgresAdapter
});

// app/api/posts/[...forja]/route.ts
export const { GET, POST, PUT, DELETE } = createHandlers({
  schema: postSchema,
  adapter: postgresAdapter
});
```

---

## Database Adapter Setup

```typescript
// lib/db.ts
import { PostgresAdapter } from '@forja/postgres-adapter';

export const postgresAdapter = new PostgresAdapter({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  pool: {
    min: 2,
    max: 10
  }
});
```

---

## Authentication

### JWT Middleware

```typescript
// lib/middleware/auth.ts
import { jwtVerify } from 'jose';
import type { Middleware } from 'forja-api';

export const authMiddleware: Middleware = async (context, next) => {
  const token = context.headers?.authorization?.replace('Bearer ', '');

  if (token) {
    try {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET);
      const { payload } = await jwtVerify(token, secret);

      context.user = {
        id: payload.userId as string,
        role: payload.role as string
      };
    } catch (error) {
      // Invalid token, continue without user
    }
  }

  return await next();
};
```

---

## Server Actions (App Router)

Use forja-api handlers from Server Actions:

```typescript
// app/actions/users.ts
'use server';

import { createHandlers } from 'forja-api';

const { GET, POST } = createHandlers({
  schema: userSchema,
  adapter: postgresAdapter
});

export async function getUsers() {
  const response = await GET({ query: {}, params: {} });
  return response.body;
}

export async function createUser(data: any) {
  const response = await POST({ body: data, params: {} });
  return response.body;
}
```

---

## Reference

**Source:** `packages/api/src/handler/factory.ts`
