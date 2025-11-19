# Forja

**TypeScript-first database management framework** (under development)

[![npm version](https://img.shields.io/npm/v/forja.svg)](https://www.npmjs.com/package/forja)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)

Forja is a minimal, type-safe database management framework that provides REST API flexibility without being a standalone application. It's designed to be integrated into your existing Node.js/Next.js projects with zero runtime `any` types and full TypeScript inference.

## ✨ Features

### 🎯 Type-First Design
- **Zero `any` types** - Strict type safety throughout
- **Automatic type inference** - From schema to API
- **Full IDE autocomplete** - IntelliSense everywhere
- **Compile-time validation** - Catch errors before runtime

### 🚀 Developer Experience
- **Framework agnostic** - Works with Next.js, Express, Fastify
- **Plugin architecture** - Extend with auth, upload, hooks
- **Built-in CLI** - Migrations, generators, dev mode
- **Zero configuration** - Sensible defaults, customizable

### 🔌 Built-in Features
- **Authentication** - JWT + Session + RBAC (no dependencies)
- **File Upload** - Local + S3 providers
- **Lifecycle Hooks** - beforeCreate, afterUpdate, etc.
- **Soft Delete** - Automatic `deletedAt` handling
- **Migrations** - Auto-generate from schema changes
- **Query Builder** - Type-safe, database-agnostic

### 📦 Minimal Dependencies
- **~230KB main package** (gzipped: ~45KB)
- **Tree-shakeable** - Only bundle what you use
- **No ORM dependencies** - Custom query builder
- **No validation library** - Built-in validator
- **Only database drivers** - pg, mysql2, mongodb

## 📚 Quick Start

### Installation

```bash
# npm
npm install forja

# pnpm
pnpm add forja

# yarn
yarn add forja
```

### Create a Schema

```typescript
// schemas/user.schema.ts
import { defineSchema } from 'forja';

export const userSchema = defineSchema({
  name: 'User',

  fields: {
    email: {
      type: 'string',
      required: true,
      unique: true,
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },

    password: {
      type: 'string',
      required: true,
      minLength: 8,
    },

    role: {
      type: 'enum',
      values: ['admin', 'user'] as const,
      default: 'user',
    },

    posts: {
      type: 'relation',
      model: 'Post',
      kind: 'hasMany',
      foreignKey: 'authorId',
    },
  },

  indexes: [
    { fields: ['email'], unique: true },
  ],
} as const);

// Type is automatically inferred!
export type User = typeof userSchema['__type'];
```

### Configure Database

```typescript
// forja.config.ts
import { defineConfig } from 'forja';

export default defineConfig({
  database: {
    adapter: 'postgres',
    connection: {
      host: 'localhost',
      port: 5432,
      database: 'myapp',
      user: 'postgres',
      password: process.env.DB_PASSWORD,
    },
  },

  schemas: {
    path: './schemas/**/*.schema.ts',
  },

  plugins: [
    {
      name: 'auth',
      options: {
        jwt: { secret: process.env.JWT_SECRET },
        session: { store: 'memory' },
      },
    },
    'hooks',
    'soft-delete',
  ],
});
```

### Create API Endpoint (Next.js)

```typescript
// app/api/users/[...forja]/route.ts
import { createHandlers } from 'forja';
import { userSchema } from '@/schemas/user.schema';

const handlers = createHandlers({
  schema: userSchema,
  permissions: {
    read: ['user', 'admin'],
    create: ['admin'],
    update: (context) => context.user.id === context.params.id,
    delete: ['admin'],
  },
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
```

### Query Your API

```bash
# Get all users with posts
GET /api/users?populate[posts][fields][0]=title

# Filter and paginate
GET /api/users?where[role]=admin&page=1&pageSize=10

# Complex queries
GET /api/users?where[age][$gte]=18&where[status]=active&sort=-createdAt
```

## 🎨 Usage Examples

### Next.js App Router

```typescript
// app/api/posts/route.ts
import { createHandlers } from 'forja';
import { postSchema } from '@/schemas/post.schema';
import { authMiddleware } from '@/middleware/auth';

export const { GET, POST, PUT, DELETE } = createHandlers({
  schema: postSchema,
  middleware: [authMiddleware],
  permissions: {
    read: ['public'],
    create: ['user', 'admin'],
    update: (ctx) => ctx.user.id === ctx.data.authorId,
    delete: ['admin'],
  },
});
```

### Express.js

```typescript
import express from 'express';
import { createUnifiedHandler } from 'forja';
import { userSchema } from './schemas/user.schema';

const app = express();

app.all('/api/users/:id?', async (req, res) => {
  const handler = createUnifiedHandler({
    schema: userSchema,
    adapter: postgresAdapter,
  });

  const context = {
    method: req.method,
    params: req.params,
    query: req.query,
    body: req.body,
    user: req.user,
  };

  const response = await handler(context);
  res.status(response.status).json(response.body);
});
```

### Authentication

```typescript
import { AuthPlugin } from 'forja/plugins';

const authPlugin = new AuthPlugin({
  jwt: {
    secret: process.env.JWT_SECRET!,
    expiresIn: '7d',
  },
  rbac: {
    roles: [
      { name: 'admin', inherits: ['user'] },
      { name: 'user' },
    ],
  },
});

// Register user
const hashedPassword = await authPlugin.hashPassword('password123');

// Login
const loginResult = await authPlugin.login(user);
// Returns: { user, token: "eyJ...", sessionId: "abc..." }

// Verify token
const authContext = await authPlugin.verifyToken(token);

// Check permissions
const canCreate = authPlugin.checkPermission('user', 'posts', 'create');
```

### File Upload

```typescript
import { UploadPlugin, LocalStorageProvider } from 'forja/plugins';

const uploadPlugin = new UploadPlugin({
  provider: new LocalStorageProvider({
    uploadDir: './uploads',
    baseUrl: '/uploads',
  }),
  validation: {
    maxSize: 5 * 1024 * 1024, // 5MB
    allowedMimeTypes: ['image/jpeg', 'image/png'],
  },
});

// Upload file
const result = await uploadPlugin.upload(file);
// Returns: { url: "/uploads/abc123.jpg", size: 12345, mimeType: "image/jpeg" }
```

### Migrations

```bash
# Generate migration from schema changes
forja generate migration add-users-table

# Run pending migrations
forja migrate

# Rollback last migration
forja migrate --down

# View migration status
forja migrate --status

# Dry run (preview changes)
forja migrate --dry-run
```

### Development Mode

```bash
# Watch for schema changes and auto-migrate
forja dev
```

## 🏗️ Architecture

Forja is built with a modular, plugin-based architecture:

```
forja
├── Core                    # Schema, Validation, Query Builder
├── Adapters               # PostgreSQL, MySQL, MongoDB
├── API Layer              # Request parsing, Response serialization
├── Plugins                # Auth, Upload, Hooks, Soft-delete
└── CLI                    # migrate, generate, dev
```

### Core Modules

**Schema System** - Define your data models with TypeScript
```typescript
defineSchema({ name: 'User', fields: {...} })
```

**Validator** - Built-in validation engine (~300 LOC)
- Custom implementation
- String, Number, Date, Enum, Array, Relation validation
- Custom validators and error messages

**Query Builder** - Database-agnostic query construction
- Type-safe queries
- JOIN support (populate)
- Pagination, Sorting, Filtering
- Translates to SQL/MongoDB queries

### Adapters

**PostgreSQL** - Full-featured adapter
- Query translator (QueryObject → SQL)
- Transaction support
- Connection pooling
- Type mapping

**MySQL** - Coming soon (Phase 8)

**MongoDB** - Coming soon (Phase 8)

### Plugins

**Authentication Plugin** (Zero dependencies)
- JWT token generation/verification (manual implementation)
- Session management (memory/redis)
- RBAC with role inheritance
- PBKDF2 password hashing (100,000 iterations)
- Timing-attack prevention

**Upload Plugin**
- Local filesystem storage
- AWS S3 storage (manual Signature V4)
- File validation (size, type, extension)
- Secure filename generation

**Hooks Plugin**
- beforeCreate, afterCreate
- beforeUpdate, afterUpdate
- beforeDelete, afterDelete
- beforeFind, afterFind

**Soft Delete Plugin**
- Automatic `deletedAt` handling
- Query interceptor
- `findDeleted()`, `findWithDeleted()`, `restore()`

## 📖 Documentation

- [Setup Guide](./SETUP_GUIDE.md) - Complete installation and configuration
- [Next.js Example](./examples/nextjs-app/) - Full App Router integration
- [Express Example](./examples/express-app/) - Production-ready server
- [Schema Reference](./SETUP_GUIDE.md#schema-definition) - Define your models
- [API Reference](./SETUP_GUIDE.md#api-integration) - Build REST endpoints
- [Plugin Guide](./SETUP_GUIDE.md#plugins) - Extend functionality
- [CLI Reference](./SETUP_GUIDE.md#cli-commands) - Command-line tools

## 🔍 Query Syntax

Forja query syntax:

### Filtering

```bash
# Equal
GET /api/users?where[status]=active

# Operators
GET /api/users?where[age][$gte]=18
GET /api/users?where[role][$in]=admin,moderator
GET /api/users?where[email][$contains]=@example.com

# Supported operators:
# $eq, $ne, $lt, $lte, $gt, $gte
# $in, $nin, $contains, $notContains
# $startsWith, $endsWith, $null, $notNull
```

### Pagination

```bash
# Page-based
GET /api/users?page=2&pageSize=25

# Offset-based
GET /api/users?limit=25&offset=50
```

### Sorting

```bash
# Ascending
GET /api/users?sort=createdAt

# Descending
GET /api/users?sort=-createdAt

# Multiple fields
GET /api/users?sort=role,-createdAt
```

### Field Selection

```bash
# Select specific fields
GET /api/users?fields[0]=email&fields[1]=name

# Or comma-separated
GET /api/users?fields=email,name
```

### Population (Relations)

```bash
# Populate relation
GET /api/users?populate[posts]=*

# Populate with field selection
GET /api/users?populate[posts][fields][0]=title

# Nested populate
GET /api/users?populate[posts][populate][author][fields][0]=name
```

### Complex Queries

```bash
# Combine everything
GET /api/posts?\
  where[status]=published&\
  where[createdAt][$gte]=2024-01-01&\
  populate[author][fields][0]=name&\
  fields[0]=title&fields[1]=slug&\
  sort=-publishedAt&\
  page=1&pageSize=10
```

## 🛠️ CLI Commands

```bash
# Migrations
forja migrate                 # Run pending migrations
forja migrate --down          # Rollback last migration
forja migrate --to=20250101   # Migrate to specific version
forja migrate --status        # Show migration status
forja migrate --dry-run       # Preview changes

# Generators
forja generate schema User           # Generate schema template
forja generate migration AddUsers    # Generate migration file

# Development
forja dev                     # Watch mode with auto-migrations

# Help
forja help                    # Show all commands
```

## 🔒 Security

Forja implements security best practices:

- **SQL Injection Prevention** - Parameterized queries
- **Password Hashing** - PBKDF2 with 100,000 iterations
- **Timing Attack Prevention** - Constant-time comparisons
- **JWT Security** - HMAC-SHA256/SHA512 signing
- **Input Validation** - Comprehensive validation engine
- **File Upload Security** - Type and size validation
- **RBAC** - Role-based access control

## 📊 Performance

- **Query Building** - <1ms for complex queries
- **Validation** - <5ms for typical payloads
- **JWT Sign/Verify** - <1ms per operation
- **Password Hashing** - ~100-150ms (intentionally slow)
- **Bundle Size** - ~45KB gzipped (tree-shakeable)

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes following our commit conventions
4. Push to your branch
5. Open a Pull Request

### Development Setup

```bash
# Clone repository
git clone https://github.com/myniqx/forja.git
cd forja

# Install dependencies
pnpm install

# Type check
pnpm type-check

# Build
pnpm build

# Run tests
pnpm test

# Watch mode
pnpm dev
```

## 📝 License

MIT © [Forja Contributors](https://github.com/myniqx/forja/graphs/contributors)

## 🙏 Acknowledgments

Inspired by:
- [Strapi](https://strapi.io/) - Query API syntax and plugin architecture
- [Payload CMS](https://payloadcms.com/) - TypeScript-first approach
- [Prisma](https://www.prisma.io/) - Type safety and migrations
- [Drizzle](https://orm.drizzle.team/) - Query builder patterns

## 🗺️ Roadmap

- [x] Phase 1-7: Core development complete
- [ ] Phase 8: MySQL and MongoDB adapters
- [ ] Phase 9: Comprehensive testing suite
- [ ] v1.0: Stable release
- [ ] Additional plugins (GraphQL, WebSocket)
- [ ] Admin UI (optional)
- [ ] Real-time subscriptions
- [ ] Multi-tenancy support

## 💬 Support

- [GitHub Issues](https://github.com/myniqx/forja/issues) - Bug reports and feature request

---

**Made with ❤️ by the Forja team**
