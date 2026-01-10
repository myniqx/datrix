# Configuration

> Complete handler configuration reference

---

## Basic Configuration

```typescript
import { createHandlers } from 'forja-api';

const handlers = createHandlers({
  schema: userSchema,
  adapter: postgresAdapter,

  // Optional: Middleware chain
  middleware: [authMiddleware, loggingMiddleware],

  // Optional: Access control
  permissions: {
    read: ['user', 'admin'],
    create: ['admin'],
    update: (ctx) => ctx.user?.id === ctx.params.id,
    delete: ['admin']
  },

  // Optional: Lifecycle hooks
  hooks: {
    beforeCreate: async (ctx, data) => ({ ...data, createdAt: new Date() }),
    afterFind: async (ctx, data) => data
  },

  // Optional: Handler options
  options: {
    maxPageSize: 100,
    defaultPageSize: 25,
    maxPopulateDepth: 5
  }
});

export const { GET, POST, PUT, DELETE } = handlers;
```

All fields except `schema` and `adapter` are optional.

---

## Permissions

Control access to CRUD operations with role-based or function-based permissions.

### Role-Based

```typescript
permissions: {
  read: ['user', 'admin'],      // Must have 'user' OR 'admin' role
  create: ['admin'],             // Must have 'admin' role
  update: ['admin'],
  delete: ['admin']
}
```

User's role is checked from `context.user.role`.

### Function-Based

```typescript
permissions: {
  read: true,                              // Allow all
  create: (ctx) => !!ctx.user,            // Must be authenticated
  update: (ctx) => ctx.user?.id === ctx.params.id,  // Owner only
  delete: (ctx) => ctx.user?.role === 'admin'       // Admin only
}
```

Function receives `context` and returns boolean.

### Mixed

```typescript
permissions: {
  read: true,
  create: ['user', 'admin'],
  update: (ctx) => ctx.user?.id === ctx.params.id || ctx.user?.role === 'admin',
  delete: ['admin']
}
```

### Permission Context

Functions receive full handler context:

```typescript
interface HandlerContext {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params: Record<string, string>;       // URL params { id: '123' }
  query: Record<string, unknown>;       // Parsed query string
  body: unknown;                        // Request body
  headers: Record<string, string>;      // Request headers
  user?: unknown;                       // Set by auth middleware
}
```

### Common Patterns

**Owner-based access:**
```typescript
update: (ctx) => ctx.user?.id === ctx.params.userId
```

**Admin override:**
```typescript
delete: (ctx) => ctx.user?.role === 'admin' || ctx.user?.id === ctx.params.userId
```

**Field-level permissions:**
```typescript
update: (ctx) => {
  if (ctx.user?.role === 'admin') return true;

  const allowedFields = ['name', 'bio'];
  const updatedFields = Object.keys(ctx.body || {});
  return updatedFields.every(f => allowedFields.includes(f));
}
```

---

## Middleware

Express-style middleware for request/response processing.

### Middleware Signature

```typescript
type Middleware = (
  context: HandlerContext,
  next: () => Promise<HandlerResponse>
) => Promise<HandlerResponse>;
```

### Authentication Middleware

```typescript
const authMiddleware: Middleware = async (context, next) => {
  const token = context.headers?.authorization?.replace('Bearer ', '');

  if (!token) {
    return {
      status: 401,
      body: { error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }
    };
  }

  try {
    const payload = await verifyJWT(token);
    context.user = { id: payload.userId, role: payload.role };
  } catch (error) {
    return {
      status: 401,
      body: { error: { message: 'Invalid token', code: 'INVALID_TOKEN' } }
    };
  }

  return await next();
};
```

### Logging Middleware

```typescript
const loggingMiddleware: Middleware = async (context, next) => {
  const start = Date.now();
  console.log(`${context.method} ${context.params.id || ''}`);

  const response = await next();

  console.log(`${response.status} - ${Date.now() - start}ms`);
  return response;
};
```

### Rate Limiting Middleware

```typescript
const rateLimiter = new Map<string, number[]>();

const rateLimitMiddleware: Middleware = async (context, next) => {
  const userId = context.user?.id || context.headers?.['x-forwarded-for'];
  if (!userId) return await next();

  const now = Date.now();
  const requests = rateLimiter.get(userId) || [];
  const recentRequests = requests.filter(time => now - time < 60000); // 1 min

  if (recentRequests.length >= 100) {
    return {
      status: 429,
      body: { error: { message: 'Too many requests', code: 'RATE_LIMIT' } }
    };
  }

  rateLimiter.set(userId, [...recentRequests, now]);
  return await next();
};
```

### CORS Middleware

```typescript
const corsMiddleware: Middleware = async (context, next) => {
  const response = await next();

  return {
    ...response,
    headers: {
      ...response.headers,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  };
};
```

### Middleware Order

Middleware executes in array order:

```typescript
middleware: [
  corsMiddleware,      // 1. CORS headers
  authMiddleware,      // 2. Authentication
  rateLimitMiddleware, // 3. Rate limiting
  loggingMiddleware    // 4. Logging
]
```

---

## Hooks

Lifecycle hooks for data transformation and validation.

### Available Hooks

```typescript
hooks: {
  beforeCreate: async (ctx, data) => data,
  afterCreate: async (ctx, data) => data,
  beforeUpdate: async (ctx, data) => data,
  afterUpdate: async (ctx, data) => data,
  beforeDelete: async (ctx, id) => {},
  afterDelete: async (ctx, id) => {},
  afterFind: async (ctx, data) => data
}
```

### Hook Signatures

```typescript
type BeforeCreateHook = (ctx: HandlerContext, data: unknown) => Promise<unknown>;
type AfterCreateHook = (ctx: HandlerContext, created: unknown) => Promise<unknown>;
type BeforeUpdateHook = (ctx: HandlerContext, data: unknown) => Promise<unknown>;
type AfterUpdateHook = (ctx: HandlerContext, updated: unknown) => Promise<unknown>;
type BeforeDeleteHook = (ctx: HandlerContext, id: string | number) => Promise<void>;
type AfterDeleteHook = (ctx: HandlerContext, id: string | number) => Promise<void>;
type AfterFindHook = (ctx: HandlerContext, data: unknown) => Promise<unknown>;
```

### Timestamps

```typescript
hooks: {
  beforeCreate: async (ctx, data) => ({
    ...data,
    createdAt: new Date(),
    createdBy: ctx.user?.id
  }),
  beforeUpdate: async (ctx, data) => ({
    ...data,
    updatedAt: new Date(),
    updatedBy: ctx.user?.id
  })
}
```

### Data Sanitization

```typescript
hooks: {
  afterFind: async (ctx, data) => {
    // Remove password from responses
    const sanitize = (record: any) => {
      const { password, ...safe } = record;
      return safe;
    };

    return Array.isArray(data)
      ? data.map(sanitize)
      : sanitize(data);
  }
}
```

### Validation

```typescript
hooks: {
  beforeCreate: async (ctx, data) => {
    if (!data.email?.includes('@')) {
      throw new Error('Invalid email');
    }
    return data;
  }
}
```

### Audit Trail

```typescript
hooks: {
  afterCreate: async (ctx, created) => {
    await auditLog.create({
      action: 'CREATE',
      resource: 'users',
      resourceId: created.id,
      userId: ctx.user?.id,
      timestamp: new Date()
    });
    return created;
  }
}
```

### Hook Execution Order

**Create:**
1. Middleware
2. Permissions check
3. `beforeCreate` hook
4. Database insert
5. `afterCreate` hook
6. Response

**Update:**
1. Middleware
2. Permissions check
3. `beforeUpdate` hook
4. Database update
5. `afterUpdate` hook
6. Response

**Delete:**
1. Middleware
2. Permissions check
3. `beforeDelete` hook
4. Database delete
5. `afterDelete` hook
6. Response

**Find:**
1. Middleware
2. Permissions check
3. Database query
4. `afterFind` hook
5. Response

---

## Options

Handler behavior configuration.

### Pagination Options

```typescript
options: {
  maxPageSize: 100,        // Maximum records per page (default: 100)
  defaultPageSize: 25      // Default records per page (default: 25)
}
```

### Populate Options

```typescript
options: {
  maxPopulateDepth: 5,     // Maximum nested populate depth (default: 5)
  allowedPopulates: ['posts', 'comments'] // Restrict populate fields
}
```

### Query Options

```typescript
options: {
  maxWhereDepth: 10,       // Maximum nested where depth (default: 10)
  allowedFilters: ['status', 'role'], // Restrict filterable fields
  allowedSorts: ['createdAt', 'name']  // Restrict sortable fields
}
```

### Response Options

```typescript
options: {
  serializeRelations: true, // Populate relations (default: true)
  includeTimestamps: true,  // Include createdAt/updatedAt (default: true)
  includeMeta: true         // Include pagination meta (default: true)
}
```

### Complete Options Example

```typescript
createHandlers({
  schema: userSchema,
  adapter: postgresAdapter,
  options: {
    // Pagination
    maxPageSize: 200,
    defaultPageSize: 50,

    // Populate
    maxPopulateDepth: 3,
    allowedPopulates: ['posts', 'profile'],

    // Query
    maxWhereDepth: 5,
    allowedFilters: ['status', 'role', 'email'],
    allowedSorts: ['createdAt', 'updatedAt', 'name'],

    // Response
    serializeRelations: true,
    includeTimestamps: true,
    includeMeta: true
  }
});
```

---

## Complete Example

```typescript
import { createHandlers } from 'forja-api';
import { defineSchema } from 'forja-core';
import { postgresAdapter } from './db';
import { authMiddleware } from './middleware/auth';
import { loggingMiddleware } from './middleware/logging';

const userSchema = defineSchema({
  name: 'user',
  fields: {
    email: { type: 'string', required: true },
    name: { type: 'string', required: true },
    role: { type: 'enum', values: ['user', 'admin'] as const },
    createdAt: { type: 'date' },
    updatedAt: { type: 'date' }
  }
});

export const { GET, POST, PUT, DELETE } = createHandlers({
  schema: userSchema,
  adapter: postgresAdapter,

  middleware: [authMiddleware, loggingMiddleware],

  permissions: {
    read: ['user', 'admin'],
    create: ['admin'],
    update: (ctx) => ctx.user?.id === ctx.params.id || ctx.user?.role === 'admin',
    delete: ['admin']
  },

  hooks: {
    beforeCreate: async (ctx, data) => ({
      ...data,
      createdAt: new Date(),
      createdBy: ctx.user?.id
    }),

    beforeUpdate: async (ctx, data) => ({
      ...data,
      updatedAt: new Date(),
      updatedBy: ctx.user?.id
    }),

    afterFind: async (ctx, data) => {
      // Remove password from responses
      const sanitize = (record: any) => {
        const { password, ...safe } = record;
        return safe;
      };

      return Array.isArray(data) ? data.map(sanitize) : sanitize(data);
    }
  },

  options: {
    maxPageSize: 100,
    defaultPageSize: 25,
    maxPopulateDepth: 5,
    allowedPopulates: ['posts', 'profile'],
    allowedFilters: ['status', 'role', 'email'],
    allowedSorts: ['createdAt', 'updatedAt', 'name']
  }
});
```

---

## Reference

**Source:**
- Handler factory - `packages/api/src/handler/factory.ts`
- Permissions - `packages/api/src/handler/permissions.ts`
- Middleware - `packages/api/src/handler/middleware.ts`
- Hooks - `packages/api/src/handler/hooks.ts`
