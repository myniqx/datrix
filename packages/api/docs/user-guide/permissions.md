# Permissions

> Role-based and function-based access control

---

## Overview

forja-api provides flexible permission system supporting role-based and function-based access control. Permissions are evaluated before handler execution.

---

## Permission Types

### Role-Based Permissions

```typescript
permissions: {
  read: ['user', 'admin'],
  create: ['admin'],
  update: ['admin'],
  delete: ['admin']
}
```

User must have one of the specified roles.

### Function-Based Permissions

```typescript
permissions: {
  read: true,  // Allow all
  create: (ctx) => !!ctx.user,  // Must be authenticated
  update: (ctx) => ctx.user?.id === ctx.params.id,  // Owner only
  delete: (ctx) => ctx.user?.role === 'admin'  // Admin only
}
```

Function receives context and returns boolean.

### Mixed Permissions

```typescript
permissions: {
  read: true,
  create: ['user', 'admin'],
  update: (ctx) => ctx.user?.id === ctx.params.id || ctx.user?.role === 'admin',
  delete: ['admin']
}
```

Combine role-based and function-based as needed.

---

## Permission Operations

### read

Checked for:
- `GET /resource` (find all)
- `GET /resource/:id` (find one)
- `GET /resource/count` (count)

```typescript
permissions: {
  read: ['user', 'admin']
}
```

### create

Checked for:
- `POST /resource` (create)

```typescript
permissions: {
  create: ['admin']
}
```

### update

Checked for:
- `PUT /resource/:id` (update)

```typescript
permissions: {
  update: (ctx) => ctx.user?.id === ctx.params.id
}
```

### delete

Checked for:
- `DELETE /resource/:id` (delete)

```typescript
permissions: {
  delete: ['admin']
}
```

---

## Context in Permissions

Permission functions receive the full handler context:

```typescript
interface HandlerContext {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params: Record<string, string>;       // { id: '123' }
  query: Record<string, unknown>;       // Parsed query string
  body: unknown;                        // Request body
  headers: Record<string, string>;      // Request headers
  user?: {                              // Added by auth middleware
    id: string;
    role: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;               // Custom context
}
```

---

## Common Patterns

### Public Read, Authenticated Write

```typescript
permissions: {
  read: true,
  create: (ctx) => !!ctx.user,
  update: (ctx) => !!ctx.user,
  delete: (ctx) => !!ctx.user
}
```

### Owner-Based Access

```typescript
permissions: {
  read: true,
  create: (ctx) => !!ctx.user,
  update: async (ctx) => {
    // Check if user owns the record
    const record = await adapter.findOne({
      collection: 'posts',
      where: { id: ctx.params.id }
    });
    return record?.userId === ctx.user?.id;
  },
  delete: async (ctx) => {
    const record = await adapter.findOne({
      collection: 'posts',
      where: { id: ctx.params.id }
    });
    return record?.userId === ctx.user?.id;
  }
}
```

### Admin Override

```typescript
permissions: {
  update: (ctx) => {
    // Admins can update anything, users can update their own
    return ctx.user?.role === 'admin' || ctx.user?.id === ctx.params.id;
  }
}
```

### Field-Based Permissions

```typescript
permissions: {
  update: (ctx) => {
    // Users can update their own profile fields
    if (ctx.user?.id === ctx.params.id) {
      const allowedFields = ['name', 'bio', 'avatar'];
      const updatedFields = Object.keys(ctx.body || {});
      return updatedFields.every(field => allowedFields.includes(field));
    }
    // Admins can update all fields
    return ctx.user?.role === 'admin';
  }
}
```

### Time-Based Permissions

```typescript
permissions: {
  create: (ctx) => {
    // Only allow creating during business hours
    const hour = new Date().getHours();
    return hour >= 9 && hour < 17;
  }
}
```

### Rate-Limited Permissions

```typescript
const rateLimiter = new Map<string, number>();

permissions: {
  create: (ctx) => {
    const userId = ctx.user?.id;
    if (!userId) return false;

    const now = Date.now();
    const lastCreate = rateLimiter.get(userId) || 0;

    // Allow one create per minute
    if (now - lastCreate < 60000) {
      return false;
    }

    rateLimiter.set(userId, now);
    return true;
  }
}
```

---

## No Permissions

### Allow All Operations

```typescript
// No permissions specified = allow all
createHandlers({
  schema: userSchema,
  adapter: postgresAdapter
});
```

### Explicit Allow All

```typescript
permissions: {
  read: true,
  create: true,
  update: true,
  delete: true
}
```

---

## Deny All

```typescript
permissions: {
  read: false,
  create: false,
  update: false,
  delete: false
}
```

Or use empty role array:

```typescript
permissions: {
  read: [],
  create: [],
  update: [],
  delete: []
}
```

---

## Setting User Context

Permissions rely on `context.user` being set by authentication middleware:

```typescript
const authMiddleware: Middleware = async (context, next) => {
  const token = context.headers?.authorization?.replace('Bearer ', '');

  if (!token) {
    return await next();  // Continue without user
  }

  try {
    const payload = await verifyJWT(token);
    context.user = {
      id: payload.userId,
      role: payload.role
    };
  } catch (error) {
    // Invalid token, continue without user
  }

  return await next();
};

createHandlers({
  schema: userSchema,
  adapter: postgresAdapter,
  middleware: [authMiddleware],
  permissions: {
    read: true,
    create: (ctx) => !!ctx.user
  }
});
```

---

## Permission Errors

### 401 Unauthorized

When `context.user` is not set but required:

```json
{
  "error": {
    "status": 401,
    "code": "UNAUTHORIZED",
    "message": "Authentication required"
  }
}
```

### 403 Forbidden

When user is authenticated but lacks permissions:

```json
{
  "error": {
    "status": 403,
    "code": "FORBIDDEN",
    "message": "Insufficient permissions"
  }
}
```

### Custom Error Messages

```typescript
permissions: {
  delete: (ctx) => {
    if (!ctx.user) {
      throw new Error('You must be logged in to delete posts');
    }
    if (ctx.user.role !== 'admin') {
      throw new Error('Only administrators can delete posts');
    }
    return true;
  }
}
```

---

## Testing Permissions

```typescript
import { describe, it, expect } from 'vitest';

describe('Post Permissions', () => {
  const { POST, PUT, DELETE } = createHandlers({
    schema: postSchema,
    adapter: mockAdapter,
    permissions: {
      create: (ctx) => !!ctx.user,
      update: (ctx) => ctx.user?.id === ctx.params.userId,
      delete: ['admin']
    }
  });

  it('should deny create without auth', async () => {
    const response = await POST({ body: {}, params: {} });
    expect(response.status).toBe(401);
  });

  it('should allow create with auth', async () => {
    const response = await POST({
      body: { title: 'Test' },
      params: {},
      user: { id: '1', role: 'user' }
    });
    expect(response.status).toBe(201);
  });

  it('should allow owner to update', async () => {
    const response = await PUT({
      body: { title: 'Updated' },
      params: { id: '1', userId: '1' },
      user: { id: '1', role: 'user' }
    });
    expect(response.status).toBe(200);
  });

  it('should deny non-owner update', async () => {
    const response = await PUT({
      body: { title: 'Updated' },
      params: { id: '1', userId: '2' },
      user: { id: '1', role: 'user' }
    });
    expect(response.status).toBe(403);
  });

  it('should allow admin to delete', async () => {
    const response = await DELETE({
      params: { id: '1' },
      user: { id: '1', role: 'admin' }
    });
    expect(response.status).toBe(200);
  });
});
```

---

## Performance

### Cache Permission Checks

```typescript
const permissionCache = new Map<string, boolean>();

permissions: {
  update: async (ctx) => {
    const cacheKey = `${ctx.user?.id}-${ctx.params.id}`;

    if (permissionCache.has(cacheKey)) {
      return permissionCache.get(cacheKey)!;
    }

    const hasPermission = await checkOwnership(ctx.user?.id, ctx.params.id);
    permissionCache.set(cacheKey, hasPermission);

    return hasPermission;
  }
}
```

### Avoid Database Queries

```typescript
// ❌ Slow: Database query on every request
permissions: {
  update: async (ctx) => {
    const record = await adapter.findOne({ /* ... */ });
    return record?.userId === ctx.user?.id;
  }
}

// ✅ Fast: Use middleware to fetch once
const ownershipMiddleware: Middleware = async (context, next) => {
  if (context.params.id && context.user?.id) {
    const record = await adapter.findOne({ /* ... */ });
    context.isOwner = record?.userId === context.user.id;
  }
  return await next();
};

permissions: {
  update: (ctx) => ctx.isOwner === true
}
```

---

## Reference

**Source:**
- Permission checking - `packages/api/src/handler/permissions.ts`
- Handler context - `packages/api/src/handler/types.ts`
