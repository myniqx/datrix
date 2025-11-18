# Forja Setup Guide

Complete guide to setting up and using Forja - a TypeScript-first database management framework with Strapi-like REST API flexibility.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Schema Definition](#schema-definition)
- [Database Adapters](#database-adapters)
- [API Integration](#api-integration)
- [Plugins](#plugins)
- [CLI Commands](#cli-commands)
- [TypeScript Integration](#typescript-integration)
- [Common Patterns](#common-patterns)
- [Troubleshooting](#troubleshooting)
- [Examples](#examples)

---

## Prerequisites

### Required

- **Node.js**: 18.x or 20.x (LTS recommended)
- **TypeScript**: 5.0+ (included as dependency)
- **Database**: One of the following:
  - PostgreSQL 14+ (recommended)
  - MySQL 8.0+
  - MongoDB 6.0+

### Recommended

- **Package Manager**: pnpm (faster, more efficient) or npm
- **Code Editor**: VS Code with TypeScript and ESLint extensions
- **Database GUI**: pgAdmin (PostgreSQL), MySQL Workbench, or MongoDB Compass

---

## Installation

### 1. Install Forja

```bash
# Using pnpm (recommended)
pnpm add forja

# Using npm
npm install forja

# Using yarn
yarn add forja
```

### 2. Install Database Driver

Choose one based on your database:

```bash
# PostgreSQL
pnpm add pg
pnpm add -D @types/pg

# MySQL
pnpm add mysql2

# MongoDB
pnpm add mongodb
```

### 3. Install TypeScript (if not already installed)

```bash
pnpm add -D typescript @types/node
```

---

## Quick Start

### 1. Initialize Configuration

Create `forja.config.ts` in your project root:

```typescript
import { PostgresAdapter } from 'forja/adapters';

export default {
  adapter: new PostgresAdapter({
    connectionString: process.env.DATABASE_URL!,
  }),

  schemas: {
    path: './schemas/**/*.schema.ts',
  },

  api: {
    defaultPageSize: 25,
    maxPageSize: 100,
  },

  migration: {
    auto: true, // Auto-run migrations in development
  },
} as const;
```

### 2. Create Your First Schema

Create `schemas/user.schema.ts`:

```typescript
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

    name: {
      type: 'string',
      required: true,
      minLength: 2,
      maxLength: 100,
    },

    age: {
      type: 'number',
      min: 18,
      max: 120,
      integer: true,
    },

    role: {
      type: 'enum',
      values: ['user', 'admin'] as const,
      default: 'user',
    },
  },

  timestamps: true, // Adds createdAt, updatedAt
} as const);

// TypeScript type is automatically inferred!
export type User = InferSchemaType<typeof userSchema>;
```

### 3. Run Migrations

```bash
# Create tables from schemas
npx forja migrate

# Or with pnpm
pnpm forja migrate
```

### 4. Create API Routes

#### Next.js App Router

Create `app/api/users/[...forja]/route.ts`:

```typescript
import { createHandlers } from 'forja/api';
import { buildContextFromNextApp } from 'forja/api/context';
import { userSchema } from '@/schemas/user.schema';
import config from '@/forja.config';

const handlers = createHandlers({
  schema: userSchema,
  adapter: config.adapter,
});

export async function GET(request: Request) {
  const context = await buildContextFromNextApp(request);
  const response = await handlers.GET(context);
  return Response.json(response.body, { status: response.status });
}

export async function POST(request: Request) {
  const context = await buildContextFromNextApp(request);
  const response = await handlers.POST(context);
  return Response.json(response.body, { status: response.status });
}

// ... PUT, PATCH, DELETE
```

#### Express.js

```typescript
import express from 'express';
import { createUnifiedHandler } from 'forja/api';
import { buildContextFromExpress } from 'forja/api/context';
import { userSchema } from './schemas/user.schema';
import config from './forja.config';

const app = express();
app.use(express.json());

const userHandler = createUnifiedHandler({
  schema: userSchema,
  adapter: config.adapter,
});

app.all('/api/users/:id?', async (req, res) => {
  const context = buildContextFromExpress(req);
  const response = await userHandler(context);
  res.status(response.status).json(response.body);
});

app.listen(3000);
```

### 5. Test Your API

```bash
# Create a user
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","name":"John Doe","age":25}'

# List users
curl http://localhost:3000/api/users

# Get specific user
curl http://localhost:3000/api/users/1

# Update user
curl -X PUT http://localhost:3000/api/users/1 \
  -H "Content-Type: application/json" \
  -d '{"name":"Jane Doe"}'

# Delete user
curl -X DELETE http://localhost:3000/api/users/1
```

---

## Configuration

### Complete Configuration Example

```typescript
import { PostgresAdapter } from 'forja/adapters';
import { AuthPlugin, UploadPlugin, HooksPlugin } from 'forja/plugins';
import { LocalStorageProvider } from 'forja/plugins/upload';

export default {
  /**
   * Database Adapter
   */
  adapter: new PostgresAdapter({
    connectionString: process.env.DATABASE_URL!,
    // Connection pool settings
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  }),

  /**
   * Schema Location
   */
  schemas: {
    path: './schemas/**/*.schema.ts', // Glob pattern
  },

  /**
   * Plugins (optional)
   */
  plugins: [
    new AuthPlugin({
      jwt: {
        secret: process.env.JWT_SECRET!,
        expiresIn: '7d',
      },
      rbac: {
        roles: [
          {
            name: 'admin',
            permissions: [
              { resource: '*', action: 'create' },
              { resource: '*', action: 'read' },
              { resource: '*', action: 'update' },
              { resource: '*', action: 'delete' },
            ],
          },
          {
            name: 'user',
            permissions: [
              { resource: 'posts', action: 'create' },
              { resource: 'posts', action: 'read' },
            ],
          },
        ],
      },
    }),

    new UploadPlugin({
      provider: new LocalStorageProvider({
        basePath: './public/uploads',
        baseUrl: 'http://localhost:3000/uploads',
      }),
      validation: {
        maxSize: 5 * 1024 * 1024, // 5MB
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      },
    }),

    new HooksPlugin(),
  ],

  /**
   * API Configuration
   */
  api: {
    prefix: '/api',
    defaultPageSize: 25,
    maxPageSize: 100,
    maxPopulateDepth: 5,
  },

  /**
   * Migration Configuration
   */
  migration: {
    auto: process.env.NODE_ENV === 'development',
    directory: './migrations',
  },
} as const;
```

### Environment Variables

Create `.env`:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/myapp"

# JWT (for auth plugin)
JWT_SECRET="your-secret-key-minimum-32-characters-long"

# Upload (for upload plugin)
UPLOAD_DIR="./public/uploads"
UPLOAD_URL="http://localhost:3000/uploads"

# Environment
NODE_ENV="development"
```

---

## Schema Definition

### Field Types

Forja supports these field types:

#### String

```typescript
{
  email: {
    type: 'string',
    required: true,
    unique: true,
    minLength: 5,
    maxLength: 255,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    errorMessage: 'Invalid email format',
  },

  slug: {
    type: 'string',
    required: true,
    unique: true,
    validator: (value) => {
      if (!/^[a-z0-9-]+$/.test(value)) {
        return 'Slug must contain only lowercase letters, numbers, and hyphens';
      }
      return true;
    },
  },
}
```

#### Number

```typescript
{
  age: {
    type: 'number',
    required: true,
    min: 18,
    max: 120,
    integer: true,
  },

  price: {
    type: 'number',
    min: 0,
    validator: (value) => {
      if (value % 0.01 !== 0) {
        return 'Price must have at most 2 decimal places';
      }
      return true;
    },
  },
}
```

#### Boolean

```typescript
{
  isActive: {
    type: 'boolean',
    required: true,
    default: true,
  },
}
```

#### Date

```typescript
{
  birthDate: {
    type: 'date',
    required: true,
    min: new Date('1900-01-01'),
    max: new Date(),
  },

  createdAt: {
    type: 'date',
    autoCreate: true, // Automatically set on creation
  },

  updatedAt: {
    type: 'date',
    autoUpdate: true, // Automatically update on modification
  },
}
```

#### Enum

```typescript
{
  status: {
    type: 'enum',
    values: ['draft', 'published', 'archived'] as const,
    required: true,
    default: 'draft',
  },

  role: {
    type: 'enum',
    values: ['user', 'moderator', 'admin'] as const,
    default: 'user',
  },
}
```

#### JSON

```typescript
{
  metadata: {
    type: 'json',
    required: false,
  },

  settings: {
    type: 'json',
    default: { theme: 'light', notifications: true },
  },
}
```

#### Array

```typescript
{
  tags: {
    type: 'array',
    items: {
      type: 'string',
      maxLength: 50,
    },
    minItems: 1,
    maxItems: 10,
    unique: true, // All items must be unique
  },

  scores: {
    type: 'array',
    items: {
      type: 'number',
      min: 0,
      max: 100,
    },
  },
}
```

#### Relation

```typescript
{
  // One-to-One: User has one Profile
  profile: {
    type: 'relation',
    model: 'Profile',
    kind: 'hasOne',
    foreignKey: 'userId',
  },

  // One-to-Many: User has many Posts
  posts: {
    type: 'relation',
    model: 'Post',
    kind: 'hasMany',
    foreignKey: 'authorId',
    onDelete: 'cascade', // Delete posts when user is deleted
  },

  // Many-to-One: Post belongs to User
  author: {
    type: 'relation',
    model: 'User',
    kind: 'belongsTo',
    foreignKey: 'authorId',
  },

  // Many-to-Many: Post has many Tags
  tags: {
    type: 'relation',
    model: 'Tag',
    kind: 'manyToMany',
    through: 'PostTags', // Join table
  },
}
```

#### File

```typescript
{
  avatar: {
    type: 'file',
    required: false,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxSize: 2 * 1024 * 1024, // 2MB
  },

  attachments: {
    type: 'file',
    multiple: true,
    allowedTypes: ['application/pdf', 'image/*'],
    maxSize: 10 * 1024 * 1024, // 10MB
  },
}
```

### Indexes

Add indexes for performance:

```typescript
export const userSchema = defineSchema({
  name: 'User',
  fields: { /* ... */ },

  indexes: [
    // Single field index
    { fields: ['email'], unique: true },

    // Composite index
    { fields: ['lastName', 'firstName'] },

    // Named index
    { fields: ['createdAt'], name: 'idx_user_created' },
  ],
} as const);
```

### Lifecycle Hooks

Execute custom logic at different stages:

```typescript
export const userSchema = defineSchema({
  name: 'User',
  fields: { /* ... */ },

  hooks: {
    // Before creating a record
    beforeCreate: async (data) => {
      // Hash password
      data.password = await hash(data.password);
      return data;
    },

    // After creating a record
    afterCreate: async (user) => {
      // Send welcome email
      await sendWelcomeEmail(user.email);
      return user;
    },

    // Before updating
    beforeUpdate: async (data) => {
      // Validate changes
      if (data.email) {
        await validateEmailUnique(data.email);
      }
      return data;
    },

    // After updating
    afterUpdate: async (user) => {
      // Invalidate cache
      await cache.invalidate(`user:${user.id}`);
      return user;
    },

    // Before deleting
    beforeDelete: async (id) => {
      // Check if user can be deleted
      const posts = await getPosts({ authorId: id });
      if (posts.length > 0) {
        throw new Error('Cannot delete user with posts');
      }
    },

    // After deleting
    afterDelete: async (id) => {
      // Cleanup
      await deleteUserFiles(id);
    },

    // Before finding
    beforeFind: async (query) => {
      // Add default filters
      return {
        ...query,
        where: { ...query.where, deletedAt: null },
      };
    },

    // After finding
    afterFind: async (results) => {
      // Transform results
      if (Array.isArray(results)) {
        return results.map(removePassword);
      }
      return removePassword(results);
    },
  },
} as const);
```

### Timestamps

Automatically add `createdAt` and `updatedAt`:

```typescript
export const postSchema = defineSchema({
  name: 'Post',
  fields: { /* ... */ },
  timestamps: true, // Adds createdAt and updatedAt
} as const);
```

### Soft Delete

Enable soft delete (records marked as deleted, not removed):

```typescript
export const postSchema = defineSchema({
  name: 'Post',
  fields: { /* ... */ },
  softDelete: true, // Adds deletedAt field
} as const);
```

---

## Database Adapters

### PostgreSQL

```typescript
import { PostgresAdapter } from 'forja/adapters';

const adapter = new PostgresAdapter({
  // Connection string
  connectionString: process.env.DATABASE_URL,

  // Or individual parameters
  host: 'localhost',
  port: 5432,
  database: 'myapp',
  user: 'postgres',
  password: 'password',

  // Connection pool
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,

  // SSL
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
```

### MySQL

```typescript
import { MySQLAdapter } from 'forja/adapters';

const adapter = new MySQLAdapter({
  host: 'localhost',
  port: 3306,
  database: 'myapp',
  user: 'root',
  password: 'password',

  // Connection pool
  connectionLimit: 20,
  waitForConnections: true,
  queueLimit: 0,

  // Character set
  charset: 'utf8mb4',
});
```

### MongoDB

```typescript
import { MongoDBAdapter } from 'forja/adapters';

const adapter = new MongoDBAdapter({
  url: process.env.MONGODB_URL,

  // Or
  host: 'localhost',
  port: 27017,
  database: 'myapp',
  username: 'user',
  password: 'password',

  // Connection options
  maxPoolSize: 20,
  minPoolSize: 5,
});
```

---

## API Integration

### Query Parameters

Forja supports Strapi-style query parameters:

#### Filtering

```bash
# Equality
GET /api/posts?where[status]=published

# Comparison operators
GET /api/posts?where[viewCount][$gt]=100
GET /api/posts?where[price][$gte]=10&where[price][$lte]=50

# String operations
GET /api/posts?where[title][$contains]=tutorial
GET /api/posts?where[title][$startsWith]=How to
GET /api/posts?where[email][$endsWith]=@example.com

# Array operations
GET /api/posts?where[status][$in]=published,draft
GET /api/posts?where[id][$nin]=1,2,3

# Logical operators
GET /api/posts?where[$or][0][status]=published&where[$or][1][featured]=true
GET /api/posts?where[$and][0][status]=published&where[$and][1][featured]=true
```

Available operators:
- `$eq`, `$ne` - Equals, not equals
- `$gt`, `$gte`, `$lt`, `$lte` - Greater than, less than
- `$in`, `$nin` - In array, not in array
- `$contains`, `$notContains` - String contains
- `$startsWith`, `$endsWith` - String prefix/suffix
- `$null`, `$notNull` - Is null, is not null
- `$like`, `$ilike` - SQL LIKE (case-insensitive)
- `$and`, `$or`, `$not` - Logical operators

#### Pagination

```bash
# Page-based (recommended)
GET /api/posts?page=2&pageSize=25

# Offset-based
GET /api/posts?limit=25&offset=50
```

Response includes pagination metadata:
```json
{
  "data": [...],
  "meta": {
    "pagination": {
      "page": 2,
      "pageSize": 25,
      "total": 100,
      "pageCount": 4
    }
  }
}
```

#### Sorting

```bash
# Single field (ascending)
GET /api/posts?sort=createdAt

# Single field (descending)
GET /api/posts?sort=-createdAt

# Multiple fields
GET /api/posts?sort=status,-createdAt,title
```

#### Field Selection

```bash
# Select specific fields
GET /api/users?fields=id,name,email

# Array notation
GET /api/users?fields[0]=id&fields[1]=name&fields[2]=email
```

#### Populate (Relations)

```bash
# Populate all relations
GET /api/posts?populate=*

# Populate specific relation
GET /api/posts?populate=author

# Populate with field selection
GET /api/posts?populate[author][fields]=name,email

# Nested populate
GET /api/posts?populate[author][populate][profile]=*

# Multiple relations
GET /api/posts?populate=author,category,tags
```

### Response Format

#### Success Response

```json
{
  "data": {
    "id": "1",
    "email": "user@example.com",
    "name": "John Doe",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

Collection response:
```json
{
  "data": [
    { "id": "1", "name": "Item 1" },
    { "id": "2", "name": "Item 2" }
  ],
  "meta": {
    "pagination": {
      "page": 1,
      "pageSize": 25,
      "total": 50,
      "pageCount": 2
    }
  }
}
```

#### Error Response

```json
{
  "error": {
    "message": "Validation failed",
    "code": "VALIDATION_ERROR",
    "status": 400,
    "details": {
      "field": "email",
      "message": "Invalid email format"
    }
  }
}
```

### Permissions

Control access with RBAC:

```typescript
const handlers = createHandlers({
  schema: userSchema,
  adapter: config.adapter,

  permissions: {
    // Array of allowed roles
    read: ['user', 'admin'],
    create: ['admin'],

    // Custom function
    update: (context) => {
      // Users can update their own records
      return (
        context.user?.id === context.params.id ||
        context.user?.role === 'admin'
      );
    },

    delete: ['admin'],
  },
});
```

### Middleware

Add custom middleware:

```typescript
const handlers = createHandlers({
  schema: userSchema,
  adapter: config.adapter,

  middleware: [
    // Logging middleware
    async (context, next) => {
      console.log(`${context.method} ${context.params.id || 'collection'}`);
      const response = await next();
      console.log(`Response: ${response.status}`);
      return response;
    },

    // Auth middleware
    async (context, next) => {
      const token = context.headers.authorization?.replace('Bearer ', '');
      if (token) {
        context.user = await verifyToken(token);
      }
      return await next();
    },

    // Rate limiting
    async (context, next) => {
      const key = context.user?.id || context.headers['x-forwarded-for'];
      const allowed = await checkRateLimit(key);
      if (!allowed) {
        return {
          status: 429,
          body: { error: { message: 'Too many requests', code: 'RATE_LIMIT' } },
        };
      }
      return await next();
    },
  ],
});
```

---

## Plugins

### Auth Plugin

Enable JWT authentication and RBAC:

```typescript
import { AuthPlugin } from 'forja/plugins';

const authPlugin = new AuthPlugin({
  jwt: {
    secret: process.env.JWT_SECRET!,
    expiresIn: '7d',
    algorithm: 'HS256',
  },

  rbac: {
    roles: [
      {
        name: 'admin',
        permissions: [
          { resource: '*', action: 'create' },
          { resource: '*', action: 'read' },
          { resource: '*', action: 'update' },
          { resource: '*', action: 'delete' },
        ],
      },
      {
        name: 'user',
        permissions: [
          { resource: 'posts', action: 'create' },
          { resource: 'posts', action: 'read' },
        ],
      },
    ],
  },
});

// Use in config
export default {
  plugins: [authPlugin],
} as const;
```

Usage:
```typescript
// Generate token
const token = await authPlugin.generateToken({
  userId: user.id,
  role: user.role,
});

// Verify token
const payload = await authPlugin.verifyToken(token);

// Check permission
const allowed = authPlugin.checkPermission(user.role, 'posts', 'create');
```

### Upload Plugin

Enable file uploads:

```typescript
import { UploadPlugin, LocalStorageProvider, S3StorageProvider } from 'forja/plugins';

// Local storage (development)
const uploadPlugin = new UploadPlugin({
  provider: new LocalStorageProvider({
    basePath: './public/uploads',
    baseUrl: 'http://localhost:3000/uploads',
  }),

  validation: {
    maxSize: 5 * 1024 * 1024, // 5MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
  },
});

// S3 storage (production)
const uploadPlugin = new UploadPlugin({
  provider: new S3StorageProvider({
    bucket: process.env.S3_BUCKET!,
    region: process.env.S3_REGION!,
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  }),

  validation: {
    maxSize: 10 * 1024 * 1024, // 10MB
  },
});
```

Usage:
```typescript
// Upload file
const result = await uploadPlugin.upload({
  filename: 'avatar.jpg',
  originalName: 'my-photo.jpg',
  mimetype: 'image/jpeg',
  size: 123456,
  buffer: fileBuffer,
});

if (result.success) {
  console.log(result.data.url); // File URL
}

// Delete file
await uploadPlugin.delete('uploads/avatar.jpg');
```

### Hooks Plugin

Lifecycle hooks for all models:

```typescript
import { HooksPlugin } from 'forja/plugins';

const hooksPlugin = new HooksPlugin();

// Register hooks for a model
hooksPlugin.registerHooks('User', {
  beforeCreate: async (data) => {
    data.password = await hash(data.password);
    return data;
  },

  afterCreate: async (user) => {
    await sendWelcomeEmail(user.email);
    return user;
  },
});
```

### Soft Delete Plugin

Enable soft deletes globally:

```typescript
import { SoftDeletePlugin } from 'forja/plugins';

const softDeletePlugin = new SoftDeletePlugin();

// All DELETE operations become UPDATE with deletedAt
// All SELECT operations filter out deleted records automatically
```

---

## CLI Commands

### Migration Commands

```bash
# Create migration from schema changes
forja migrate

# Dry run (preview changes)
forja migrate --dry-run

# Rollback last migration
forja migrate --rollback

# Rollback to specific migration
forja migrate --rollback --to=20240115_create_users

# Show migration status
forja migrate --status
```

### Generate Commands

```bash
# Generate schema from existing database
forja generate schema

# Generate migration file
forja generate migration add_user_bio

# Generate CRUD handler
forja generate handler users
```

### Dev Commands

```bash
# Start development mode with auto-reload
forja dev

# Watch for schema changes and auto-migrate
forja dev --watch

# Start with specific port
forja dev --port 4000
```

---

## TypeScript Integration

### Type Inference

Forja automatically infers types from schemas:

```typescript
import { defineSchema, type InferSchemaType } from 'forja';

export const userSchema = defineSchema({
  name: 'User',
  fields: {
    email: { type: 'string', required: true },
    age: { type: 'number' },
    role: { type: 'enum', values: ['user', 'admin'] as const },
  },
} as const);

// Type is automatically inferred!
export type User = InferSchemaType<typeof userSchema>;
// Result: {
//   email: string;
//   age?: number;
//   role?: 'user' | 'admin';
// }
```

### Type Guards

Create type guards for runtime validation:

```typescript
export function isUser(value: unknown): value is User {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj['email'] === 'string' &&
    (obj['age'] === undefined || typeof obj['age'] === 'number')
  );
}

// Usage
if (isUser(data)) {
  // TypeScript knows data is User
  console.log(data.email);
}
```

### Strict Type Safety

Forja enforces strict type safety:

```typescript
// ❌ This will cause TypeScript error
const user: User = {
  email: 'test@example.com',
  age: 'twenty-five', // Error: Type 'string' is not assignable to 'number'
};

// ✅ Correct
const user: User = {
  email: 'test@example.com',
  age: 25,
};
```

### Generic Handlers

Create type-safe generic handlers:

```typescript
function createCrudHandlers<T extends SchemaDefinition>(
  schema: T
) {
  type ModelType = InferSchemaType<T>;

  return {
    async create(data: Partial<ModelType>): Promise<ModelType> {
      // Implementation
    },

    async findOne(id: string): Promise<ModelType | null> {
      // Implementation
    },

    async findMany(query: QueryOptions): Promise<ModelType[]> {
      // Implementation
    },

    async update(id: string, data: Partial<ModelType>): Promise<ModelType> {
      // Implementation
    },

    async delete(id: string): Promise<void> {
      // Implementation
    },
  };
}
```

---

## Common Patterns

### Authentication Flow

```typescript
// 1. Register
async function register(email: string, password: string, name: string) {
  const hashedPassword = await hash(password);

  const user = await forja.create('User', {
    email,
    password: hashedPassword,
    name,
    role: 'user',
  });

  const token = await authPlugin.generateToken({
    userId: user.id,
    role: user.role,
  });

  return { user, token };
}

// 2. Login
async function login(email: string, password: string) {
  const users = await forja.findMany('User', {
    where: { email },
  });

  if (!users.length) {
    throw new Error('Invalid credentials');
  }

  const user = users[0];
  const isValid = await verifyPassword(password, user.password);

  if (!isValid) {
    throw new Error('Invalid credentials');
  }

  const token = await authPlugin.generateToken({
    userId: user.id,
    role: user.role,
  });

  return { user, token };
}

// 3. Verify
async function verifyToken(token: string) {
  const payload = await authPlugin.verifyToken(token);
  const user = await forja.findOne('User', payload.userId);
  return user;
}
```

### File Upload Flow

```typescript
async function uploadAvatar(userId: string, file: File) {
  // 1. Validate file
  const validation = uploadPlugin.validateFile(file);
  if (!validation.success) {
    throw new Error(validation.error);
  }

  // 2. Upload file
  const uploadResult = await uploadPlugin.upload({
    filename: file.name,
    originalName: file.name,
    mimetype: file.type,
    size: file.size,
    buffer: await file.arrayBuffer(),
  });

  if (!uploadResult.success) {
    throw new Error(uploadResult.error);
  }

  // 3. Update user avatar
  const user = await forja.update('User', userId, {
    avatar: uploadResult.data.url,
  });

  return user;
}
```

### Pagination Helper

```typescript
interface PaginationParams {
  page?: number;
  pageSize?: number;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: {
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      pageCount: number;
    };
  };
}

async function paginate<T>(
  model: string,
  params: PaginationParams,
  where?: Record<string, unknown>
): Promise<PaginatedResponse<T>> {
  const page = params.page || 1;
  const pageSize = Math.min(params.pageSize || 25, 100);
  const offset = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    forja.findMany<T>(model, {
      where,
      limit: pageSize,
      offset,
    }),
    forja.count(model, { where }),
  ]);

  return {
    data,
    meta: {
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.ceil(total / pageSize),
      },
    },
  };
}
```

### Error Handling

```typescript
class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function errorHandler(error: unknown): Response {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        error: {
          message: error.message,
          code: error.code,
          details: error.details,
        },
      },
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      body: {
        error: {
          message: error.message,
          code: 'INTERNAL_ERROR',
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        message: 'Unknown error',
        code: 'UNKNOWN_ERROR',
      },
    },
  };
}
```

---

## Troubleshooting

### Database Connection Issues

**Problem:** `Error: Connection refused`

**Solutions:**
1. Verify database is running
2. Check connection string
3. Verify credentials
4. Check firewall/network settings
5. Test connection with database client

### Migration Failures

**Problem:** `Error: column already exists`

**Solutions:**
1. Check migration history
2. Drop and recreate database (development only)
3. Create manual migration to fix inconsistencies
4. Use `--dry-run` to preview changes

### Type Errors

**Problem:** TypeScript compilation errors

**Solutions:**
1. Ensure `as const` is used in schema definitions
2. Update TypeScript to 5.0+
3. Check `tsconfig.json` strict mode settings
4. Run `pnpm type-check` to see all errors

### Performance Issues

**Problem:** Slow queries

**Solutions:**
1. Add indexes to frequently queried fields
2. Use field selection to limit data
3. Enable connection pooling
4. Add caching layer (Redis)
5. Analyze queries with `EXPLAIN`

### Memory Leaks

**Problem:** Memory usage keeps growing

**Solutions:**
1. Ensure database connections are closed
2. Limit pagination page size
3. Use streaming for large datasets
4. Monitor with tools like `clinic.js`

---

## Examples

Complete working examples are available in the `examples/` directory:

### Next.js App Router Example

Location: `examples/nextjs-app/`

Features:
- PostgreSQL integration
- Authentication with JWT
- File uploads
- CRUD operations
- Relation handling

See [examples/nextjs-app/README.md](./examples/nextjs-app/README.md)

### Express.js Example

Location: `examples/express-app/`

Features:
- RESTful API
- Middleware integration
- Error handling
- CORS configuration

See [examples/express-app/README.md](./examples/express-app/README.md)

---

## Additional Resources

- [GitHub Repository](https://github.com/yourusername/forja)
- [API Documentation](https://forja.dev/docs)
- [Community Discord](https://discord.gg/forja)
- [Issue Tracker](https://github.com/yourusername/forja/issues)

---

## License

MIT License - see LICENSE file for details
