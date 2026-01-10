# Express Integration

> Using forja-api with Express.js

---

## Installation

```bash
pnpm add forja-api forja-core express
pnpm add -D @types/express
```

---

## Basic Setup

```typescript
import express from 'express';
import { createUnifiedHandler } from 'forja-api';
import { defineSchema } from 'forja-core';
import { postgresAdapter } from './db';

const app = express();
app.use(express.json());

const userSchema = defineSchema({
  name: 'user',
  fields: {
    email: { type: 'string', required: true },
    name: { type: 'string', required: true }
  }
});

const userHandler = createUnifiedHandler({
  schema: userSchema,
  adapter: postgresAdapter
});

app.all('/api/users/:id?', async (req, res) => {
  const response = await userHandler({
    method: req.method as any,
    params: req.params,
    query: req.query,
    body: req.body,
    headers: req.headers as any
  });

  res.status(response.status).json(response.body);
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

---

## Multiple Resources

```typescript
const userHandler = createUnifiedHandler({
  schema: userSchema,
  adapter: postgresAdapter
});

const postHandler = createUnifiedHandler({
  schema: postSchema,
  adapter: postgresAdapter
});

app.all('/api/users/:id?', async (req, res) => {
  const response = await userHandler(req);
  res.status(response.status).json(response.body);
});

app.all('/api/posts/:id?', async (req, res) => {
  const response = await postHandler(req);
  res.status(response.status).json(response.body);
});
```

---

## With Middleware

```typescript
const authMiddleware: Middleware = async (context, next) => {
  const token = context.headers?.authorization?.replace('Bearer ', '');

  if (!token) {
    return {
      status: 401,
      body: { error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }
    };
  }

  context.user = await verifyToken(token);
  return await next();
};

const userHandler = createUnifiedHandler({
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

---

## Using Express Middleware

Convert Express middleware to forja-api middleware:

```typescript
import cors from 'cors';
import helmet from 'helmet';

// Express middleware (app-level)
app.use(cors());
app.use(helmet());

// OR forja-api middleware (handler-level)
const corsMiddleware: Middleware = async (context, next) => {
  const response = await next();

  return {
    ...response,
    headers: {
      ...response.headers,
      'Access-Control-Allow-Origin': '*'
    }
  };
};

const userHandler = createUnifiedHandler({
  schema: userSchema,
  adapter: postgresAdapter,
  middleware: [corsMiddleware]
});
```

---

## Error Handling

```typescript
app.all('/api/users/:id?', async (req, res) => {
  try {
    const response = await userHandler(req);
    res.status(response.status).json(response.body);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: {
        status: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});
```

---

## Database Connection

```typescript
// db.ts
import { PostgresAdapter } from '@forja/postgres-adapter';

export const postgresAdapter = new PostgresAdapter({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  pool: {
    min: 2,
    max: 10
  }
});

// Initialize connection
await postgresAdapter.connect();
```

---

## Router-Based Organization

```typescript
import { Router } from 'express';

const usersRouter = Router();
const postsRouter = Router();

usersRouter.all('/:id?', async (req, res) => {
  const response = await userHandler(req);
  res.status(response.status).json(response.body);
});

postsRouter.all('/:id?', async (req, res) => {
  const response = await postHandler(req);
  res.status(response.status).json(response.body);
});

app.use('/api/users', usersRouter);
app.use('/api/posts', postsRouter);
```

---

## Complete Example

```typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createUnifiedHandler } from 'forja-api';
import { defineSchema } from 'forja-core';
import { postgresAdapter } from './db';

const app = express();

// Express middleware
app.use(express.json());
app.use(cors());
app.use(helmet());

// Schema
const userSchema = defineSchema({
  name: 'user',
  fields: {
    email: { type: 'string', required: true },
    name: { type: 'string', required: true },
    role: { type: 'enum', values: ['user', 'admin'] as const }
  }
});

// Auth middleware
const authMiddleware: Middleware = async (context, next) => {
  const token = context.headers?.authorization?.replace('Bearer ', '');

  if (token) {
    try {
      context.user = await verifyToken(token);
    } catch (error) {
      // Invalid token
    }
  }

  return await next();
};

// Handler
const userHandler = createUnifiedHandler({
  schema: userSchema,
  adapter: postgresAdapter,
  middleware: [authMiddleware],
  permissions: {
    read: true,
    create: (ctx) => !!ctx.user,
    update: (ctx) => ctx.user?.id === ctx.params.id,
    delete: (ctx) => ctx.user?.role === 'admin'
  }
});

// Route
app.all('/api/users/:id?', async (req, res) => {
  try {
    const response = await userHandler(req);
    res.status(response.status).json(response.body);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: { message: 'Internal server error', code: 'SERVER_ERROR' }
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

---

## Reference

**Source:** `packages/api/src/handler/factory.ts`
