# forja-api Documentation

> Complete documentation for Forja's REST API layer

---

## Quick Navigation

### 📘 User Guide

Start here if you're building REST APIs with Forja.

- [Getting Started](./user-guide/getting-started.md) - Installation and first API endpoint
- [Query Syntax](./user-guide/query-syntax.md) - Strapi-style query parsing (21 operators)
- [Configuration](./user-guide/configuration.md) - Permissions, middleware, hooks, and options

### 🔌 Framework Integration

Framework-specific guides for different HTTP frameworks.

- [Next.js Integration](./framework-integration/nextjs.md) - App Router and Pages Router
- [Express Integration](./framework-integration/express.md) - Express.js setup
- [Fastify Integration](./framework-integration/fastify.md) - Fastify setup
- [Custom Framework](./framework-integration/custom.md) - Building custom integrations

### 📚 API Reference

Complete API documentation for all modules.

- [Parser Module](./api-reference/parser-module.md) - Query string parsing
- [Handler Module](./api-reference/handler-module.md) - Request handlers
- [Serializer Module](./api-reference/serializer-module.md) - Response serialization
- [Context Module](./api-reference/context-module.md) - Request context building

---

## Package Structure

```
forja-api/
├── src/
│   ├── parser/           # Query string parsing
│   │   ├── query.ts      # Main parser
│   │   ├── where.ts      # WHERE clause parsing
│   │   ├── populate.ts   # Populate clause parsing
│   │   └── pagination.ts # Pagination parsing
│   ├── handler/          # Request handlers
│   │   ├── factory.ts    # Handler creation
│   │   ├── crud.ts       # CRUD operations
│   │   ├── permissions.ts # Permission checking
│   │   ├── middleware.ts  # Middleware execution
│   │   └── hooks.ts      # Lifecycle hooks
│   ├── serializer/       # Response serialization
│   │   ├── collection.ts # Collection serialization
│   │   ├── single.ts     # Single record serialization
│   │   └── relations.ts  # Relation population
│   └── context/          # Request context
│       ├── nextjs.ts     # Next.js context builder
│       ├── express.ts    # Express context builder
│       └── generic.ts    # Generic context builder
└── docs/
    ├── user-guide/
    ├── framework-integration/
    └── api-reference/
```

---

## Quick Examples

### Next.js App Router

```typescript
import { createHandlers } from 'forja-api';

export const { GET, POST, PUT, DELETE } = createHandlers({
  schema: userSchema,
  adapter: postgresAdapter,
  permissions: {
    read: ['user', 'admin'],
    create: ['admin']
  }
});
```

### Express

```typescript
import { createUnifiedHandler } from 'forja-api';

const userHandler = createUnifiedHandler({
  schema: userSchema,
  adapter: postgresAdapter
});

app.all('/api/users/:id?', async (req, res) => {
  const response = await userHandler(req);
  res.status(response.status).json(response.body);
});
```

### Query Syntax

```bash
GET /api/users?where[status]=active&populate[posts][fields]=title&page=2
```

---

## Key Features

- **21 Filter Operators** - `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$like`, `$ilike`, etc.
- **Nested Populate** - Deep relation population with field selection
- **Framework Agnostic** - Works with Next.js, Express, Fastify, and custom frameworks
- **Type-Safe** - Full TypeScript support
- **Middleware Support** - Express-style middleware chain
- **Lifecycle Hooks** - beforeCreate, afterFind, etc.
- **Permission System** - Role-based and function-based access control

---

## Performance

- **Query Parsing**: <2ms for complex queries
- **Handler Execution**: <5ms (excluding database)
- **Serialization**: <3ms for typical payloads
- **Zero Overhead**: Direct function calls, no reflection

---

## Related Documentation

- [forja-core Documentation](../../core/docs/INDEX.md) - Schema, validation, query building
- [Examples](../../../examples/) - Complete example applications

---

## Need Help?

- Check the [Getting Started guide](./user-guide/getting-started.md)
- Review [API Reference](./api-reference/) for detailed function signatures
- See [Examples](../../../examples/) for complete applications
