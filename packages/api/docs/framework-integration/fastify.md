# Fastify Integration

> Using forja-api with Fastify

---

## Installation

```bash
pnpm add forja-api forja-core fastify
```

---

## Basic Setup

```typescript
import Fastify from 'fastify';
import { createUnifiedHandler } from 'forja-api';
import { defineSchema } from 'forja-core';
import { postgresAdapter } from './db';

const fastify = Fastify({ logger: true });

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

fastify.all('/api/users/:id?', async (request, reply) => {
  const response = await userHandler({
    method: request.method as any,
    params: request.params as any,
    query: request.query,
    body: request.body,
    headers: request.headers as any
  });

  reply.status(response.status).send(response.body);
});

await fastify.listen({ port: 3000 });
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

fastify.all('/api/users/:id?', async (request, reply) => {
  const response = await userHandler(request);
  reply.status(response.status).send(response.body);
});

fastify.all('/api/posts/:id?', async (request, reply) => {
  const response = await postHandler(request);
  reply.status(response.status).send(response.body);
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

## Using Fastify Hooks

```typescript
// Fastify hook (all routes)
fastify.addHook('onRequest', async (request, reply) => {
  request.log.info('Request received');
});

// OR forja-api middleware (specific handler)
const loggingMiddleware: Middleware = async (context, next) => {
  console.log(`${context.method} ${context.params.id || ''}`);
  return await next();
};

const userHandler = createUnifiedHandler({
  schema: userSchema,
  adapter: postgresAdapter,
  middleware: [loggingMiddleware]
});
```

---

## Plugin Organization

```typescript
import fp from 'fastify-plugin';

async function usersPlugin(fastify, options) {
  const userHandler = createUnifiedHandler({
    schema: userSchema,
    adapter: options.adapter
  });

  fastify.all('/users/:id?', async (request, reply) => {
    const response = await userHandler(request);
    reply.status(response.status).send(response.body);
  });
}

async function postsPlugin(fastify, options) {
  const postHandler = createUnifiedHandler({
    schema: postSchema,
    adapter: options.adapter
  });

  fastify.all('/posts/:id?', async (request, reply) => {
    const response = await postHandler(request);
    reply.status(response.status).send(response.body);
  });
}

fastify.register(usersPlugin, { adapter: postgresAdapter, prefix: '/api' });
fastify.register(postsPlugin, { adapter: postgresAdapter, prefix: '/api' });
```

---

## Complete Example

```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { createUnifiedHandler } from 'forja-api';
import { defineSchema } from 'forja-core';
import { postgresAdapter } from './db';

const fastify = Fastify({
  logger: {
    level: 'info'
  }
});

// Fastify plugins
await fastify.register(cors);
await fastify.register(helmet);

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
fastify.all('/api/users/:id?', async (request, reply) => {
  try {
    const response = await userHandler(request);
    reply.status(response.status).send(response.body);
  } catch (error) {
    fastify.log.error(error);
    reply.status(500).send({
      error: { message: 'Internal server error', code: 'SERVER_ERROR' }
    });
  }
});

// Start server
try {
  await fastify.listen({ port: 3000 });
  fastify.log.info('Server running on port 3000');
} catch (error) {
  fastify.log.error(error);
  process.exit(1);
}
```

---

## Reference

**Source:** `packages/api/src/handler/factory.ts`
