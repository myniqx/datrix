# API Module - Development Guidelines

## 📖 Module Overview

The API module provides HTTP request handling, query string parsing, and response serialization for the Forja framework. It's completely framework-agnostic and works seamlessly with Next.js, Express, Fastify, and other HTTP frameworks.

**Components:**
- **Parser**: Query string parsing (populate, fields, where, pagination, sorting)
- **Handler**: CRUD operation handlers and factory functions
- **Serializer**: JSON response formatting and relation serialization

**Critical Rule:** This module MUST be framework-agnostic. All implementations use generic interfaces that can adapt to any framework.

---

## 🎯 Module Responsibilities

### Parser Module (`src/api/parser/`)

**Purpose:** Parse Strapi-style query strings into QueryObject format

**Files:**
- `types.ts` - Parser type definitions
- `query-parser.ts` - Main query parser (combines all parsers)
- `fields-parser.ts` - Field selection parser (`?fields[0]=name`)
- `where-parser.ts` - WHERE clause parser (`?where[status]=active`)
- `populate-parser.ts` - Relation populate parser (`?populate[profile][fields][0]=name`)

**Supported Query Syntax:**

```typescript
// Field Selection
?fields[0]=email&fields[1]=name
?fields=email,name

// Where Conditions
?where[status]=active
?where[price][$gt]=100&where[price][$lt]=1000
?where[name][$contains]=john

// Pagination
?page=2&pageSize=25
?limit=50&offset=100

// Sorting
?sort=createdAt
?sort=-createdAt  // Descending
?sort=name,-createdAt  // Multiple sorts

// Populate (Relations)
?populate=*  // All relations
?populate[profile]=*  // Profile with all fields
?populate[profile][fields][0]=name  // Profile with specific fields
?populate[posts][populate][author]=*  // Nested populate
```

**Supported WHERE Operators:**
- `$eq`, `$ne` - Equality/inequality
- `$gt`, `$gte`, `$lt`, `$lte` - Comparison
- `$in`, `$nin` - Array membership
- `$contains`, `$notContains` - String contains
- `$startsWith`, `$endsWith` - String prefix/suffix
- `$null`, `$notNull` - Null checks
- `$like`, `$ilike` - Pattern matching
- `$and`, `$or`, `$not` - Logical operators

**Parser Implementation Pattern:**

```typescript
import { parseQuery } from '@api/parser/query-parser';

// Parse query string
const result = parseQuery(request.query, {
  maxPageSize: 100,
  defaultPageSize: 25,
  maxPopulateDepth: 5
});

if (!result.success) {
  // Handle parser error
  console.error(result.error.message);
  return;
}

// Use parsed query
const { select, where, populate, limit, offset, orderBy } = result.data;
```

**Result Pattern:**
All parsers return `Result<T, ParserError>`:
```typescript
type Result<T, E> =
  | { success: true; data: T }
  | { success: false; error: E };
```

---

### Handler Module (`src/api/handler/`)

**Purpose:** Create HTTP request handlers for CRUD operations

**Files:**
- `types.ts` - Handler type definitions
- `context.ts` - Request context builder (framework adapters)
- `crud.ts` - CRUD operations (findMany, findOne, create, update, delete, count)
- `factory.ts` - Handler factory functions

**Request Context (Framework-Agnostic):**

```typescript
interface RequestContext<TUser = unknown> {
  readonly method: HttpMethod;
  readonly params: Record<string, string>;
  readonly query: Record<string, string | readonly string[] | undefined>;
  readonly body: unknown;
  readonly headers: Record<string, string | undefined>;
  readonly user: TUser | undefined;
  readonly metadata: Record<string, unknown>;
}
```

**Handler Configuration:**

```typescript
interface HandlerConfig<TUser = unknown> {
  readonly schema: SchemaDefinition;
  readonly adapter: DatabaseAdapter;
  readonly middleware?: readonly Middleware<TUser>[];
  readonly permissions?: {
    readonly read?: PermissionCheck<TUser>;
    readonly create?: PermissionCheck<TUser>;
    readonly update?: PermissionCheck<TUser>;
    readonly delete?: PermissionCheck<TUser>;
  };
  readonly hooks?: {
    readonly beforeFind?: (context, query) => Promise<ParsedQuery> | ParsedQuery;
    readonly afterFind?: (context, data) => Promise<T> | T;
    readonly beforeCreate?: (context, data) => Promise<Record<string, unknown>>;
    readonly afterCreate?: (context, data) => Promise<T> | T;
    readonly beforeUpdate?: (context, id, data) => Promise<Record<string, unknown>>;
    readonly afterUpdate?: (context, data) => Promise<T> | T;
    readonly beforeDelete?: (context, id) => Promise<void> | void;
    readonly afterDelete?: (context, id) => Promise<void> | void;
  };
  readonly options?: {
    readonly maxPageSize?: number;
    readonly defaultPageSize?: number;
    readonly maxPopulateDepth?: number;
  };
}
```

**Usage Patterns:**

```typescript
// Next.js App Router
// app/api/users/[...forja]/route.ts
import { createHandlers } from '@api/handler/factory';
import { buildContextFromNextApp } from '@api/handler/context';

const handlers = createHandlers({
  schema: userSchema,
  adapter: postgresAdapter,
  permissions: {
    read: ['user', 'admin'],
    create: ['admin'],
    update: (context) => context.user?.id === context.params.id,
    delete: ['admin']
  }
});

export async function GET(request: Request) {
  const context = await buildContextFromNextApp(request);
  const response = await handlers.GET(context);
  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function POST(request: Request) {
  const context = await buildContextFromNextApp(request);
  const response = await handlers.POST(context);
  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Express
import { createUnifiedHandler } from '@api/handler/factory';
import { buildContextFromExpress } from '@api/handler/context';

const handler = createUnifiedHandler({
  schema: userSchema,
  adapter: postgresAdapter
});

app.all('/api/users/:id?', async (req, res) => {
  const context = buildContextFromExpress(req);
  const response = await handler(context);
  res.status(response.status).json(response.body);
});
```

**CRUD Operations:**

Each CRUD operation follows this pattern:
1. Parse request (query/body)
2. Run beforeHook (if defined)
3. Check permissions
4. Build query using QueryBuilder
5. Execute query through adapter
6. Run afterHook (if defined)
7. Return formatted response

```typescript
// GET /api/users?where[status]=active&populate[profile]=*
await findMany(context, config);
// Returns: { status: 200, body: { data: [...], meta: { pagination } } }

// GET /api/users/123?populate[posts][fields][0]=title
await findOne(context, config);
// Returns: { status: 200, body: { data: {...} } }

// POST /api/users
await create(context, config);
// Returns: { status: 201, body: { data: {...} } }

// PUT /api/users/123
await update(context, config);
// Returns: { status: 200, body: { data: {...} } }

// DELETE /api/users/123
await deleteRecord(context, config);
// Returns: { status: 200, body: { data: {...} } }

// GET /api/users/count?where[status]=active
await count(context, config);
// Returns: { status: 200, body: { data: { count: 42 } } }
```

**Middleware Pattern:**

```typescript
type Middleware<TUser> = (
  context: RequestContext<TUser>,
  next: () => Promise<HandlerResponse>
) => Promise<HandlerResponse>;

// Example: Logging middleware
const loggingMiddleware: Middleware = async (context, next) => {
  console.log(`${context.method} ${context.params.id || 'collection'}`);
  const response = await next();
  console.log(`Response: ${response.status}`);
  return response;
};

// Example: Auth middleware
const authMiddleware: Middleware<User> = async (context, next) => {
  const token = context.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return {
      status: 401,
      body: { error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }
    };
  }

  const user = await verifyToken(token);
  context.user = user;
  return await next();
};
```

**Permission Checks:**

```typescript
// Array of roles
permissions: {
  read: ['user', 'admin', 'moderator'],
  create: ['admin'],
  update: ['admin'],
  delete: ['admin']
}

// Custom function
permissions: {
  update: (context) => {
    // User can only update their own record
    return context.user?.id === context.params.id || context.user?.role === 'admin';
  }
}
```

---

### Serializer Module (`src/api/serializer/`)

**Purpose:** Serialize database results to JSON responses

**Files:**
- `types.ts` - Serializer type definitions
- `json.ts` - JSON serializer (field selection, data transformation)
- `relations.ts` - Relation serializer (handles populate, circular refs)

**Serialization Options:**

```typescript
interface SerializerOptions {
  readonly schema: SchemaDefinition;
  readonly select?: SelectClause;
  readonly populate?: PopulateClause;
  readonly includeTimestamps?: boolean;
  readonly includeMeta?: boolean;
}
```

**Response Format:**

```typescript
// Success response
{
  "data": { ... },
  "meta": {
    "pagination": {
      "page": 1,
      "pageSize": 25,
      "total": 100,
      "pageCount": 4
    }
  }
}

// Error response
{
  "error": {
    "message": "Validation failed",
    "code": "VALIDATION_ERROR",
    "details": { ... }
  }
}
```

**Serialization Features:**

1. **Field Selection**: Only includes selected fields
2. **Date Formatting**: Converts dates to ISO strings
3. **JSON Parsing**: Parses JSON fields
4. **Array Handling**: Serializes array fields
5. **Relation Population**: Handles nested relations
6. **Circular Reference Detection**: Prevents infinite loops
7. **Depth Limiting**: Configurable max populate depth

**Usage:**

```typescript
import { serializeRecord, serializeCollection } from '@api/serializer/json';

// Serialize single record
const result = serializeRecord(dbRecord, {
  schema: userSchema,
  select: ['id', 'email', 'name'],
  populate: { profile: { select: ['bio', 'avatar'] } }
});

if (result.success) {
  console.log(result.data); // { id, email, name, profile: { bio, avatar } }
}

// Serialize collection
const collectionResult = serializeCollection(dbRecords, {
  schema: userSchema
}, {
  pagination: { page: 1, pageSize: 25, total: 100, pageCount: 4 }
});

if (collectionResult.success) {
  console.log(collectionResult.data);
  // { data: [...], meta: { pagination: {...} } }
}
```

**Relation Serialization:**

Handles complex relation scenarios:
- **hasOne**: Single record
- **hasMany**: Array of records
- **belongsTo**: Single record (inverse of hasOne)
- **manyToMany**: Array of records

Supports:
- Nested populates (configurable depth)
- Field selection on relations
- Circular reference detection
- Wildcard populates (`populate=*`)

---

## 🎨 Code Patterns

### Result Pattern (REQUIRED)

All functions return `Result<T, E>`:

```typescript
type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

// Usage
const result = parseQuery(params);
if (!result.success) {
  return errorResponse(400, result.error.message);
}

const query = result.data;
```

### Type Safety

```typescript
// NO any types
❌ function parse(data: any): any

// Use generics
✅ function parse<T>(data: unknown): Result<T, ParserError>

// NO type assertions
❌ const user = response as User;

// Use type guards
✅ if (isUser(response)) {
    const user = response;
  }
```

### Error Handling

```typescript
// Create specific error types
class ParserError extends Error {
  code: ParserErrorCode;
  field?: string;
  details?: unknown;
}

class HandlerError extends Error {
  status: number;
  code: string;
  details?: unknown;
}

class SerializerError extends Error {
  code: SerializerErrorCode;
  field?: string;
  details?: unknown;
}
```

---

## ✅ Testing Requirements

### Parser Tests
- ✅ Field parsing (array, comma-separated)
- ✅ Where parsing (operators, nested conditions)
- ✅ Populate parsing (nested, wildcard)
- ✅ Pagination parsing (page/pageSize, limit/offset)
- ✅ Sort parsing (single, multiple, descending)
- ✅ Edge cases (invalid input, malformed params)

### Handler Tests
- ✅ Context building (Next.js, Express, generic)
- ✅ CRUD operations (success, error cases)
- ✅ Permission checks (roles, custom functions)
- ✅ Middleware execution (order, error handling)
- ✅ Lifecycle hooks (before/after)

### Serializer Tests
- ✅ Field selection
- ✅ Date formatting
- ✅ JSON parsing
- ✅ Relation serialization
- ✅ Circular reference detection
- ✅ Depth limiting

**Coverage Goals:**
- Parser: 90%+
- Handler: 85%+
- Serializer: 85%+

---

## 🚀 Implementation Guidelines

### Adding New Query Operators

1. Add operator to `WHERE_OPERATORS` in `parser/types.ts`
2. Update `parseWhere` in `where-parser.ts`
3. Ensure adapter supports operator
4. Add tests

### Adding New Framework Support

1. Create context builder in `handler/context.ts`
2. Add type guard for framework detection
3. Update `buildContext` auto-detect
4. Add tests

### Adding Custom Serializers

```typescript
const customSerializers: CustomSerializers = {
  date: (value) => new Date(value).toLocaleDateString(),
  file: (value) => ({ url: value, cdn: addCdnPrefix(value) })
};

serializeRecord(data, {
  schema,
  customSerializers
});
```

---

## 📚 Common Patterns

### Handler with Auth

```typescript
const handlers = createHandlers({
  schema: userSchema,
  adapter: postgresAdapter,
  middleware: [authMiddleware],
  permissions: {
    read: ['user', 'admin'],
    create: ['admin'],
    update: (context) => context.user?.id === context.params.id,
    delete: ['admin']
  },
  hooks: {
    beforeCreate: async (context, data) => {
      // Hash password before storing
      return {
        ...data,
        password: await hash(data.password)
      };
    },
    afterFind: async (context, data) => {
      // Remove password from response
      const { password, ...safe } = data;
      return safe;
    }
  }
});
```

### Custom Query Parsing

```typescript
const parseResult = parseQuery(request.query, {
  maxPageSize: 50,
  defaultPageSize: 10,
  maxPopulateDepth: 3
});

if (!parseResult.success) {
  return {
    status: 400,
    body: {
      error: {
        message: parseResult.error.message,
        code: parseResult.error.code,
        field: parseResult.error.field
      }
    }
  };
}
```

---

## 🔑 Key Principles

1. **Framework Agnostic**: Core logic works with any framework
2. **Type Safe**: Zero `any` types, explicit return types
3. **Result Pattern**: Consistent error handling
4. **Strapi Compatible**: Similar query syntax
5. **Extensible**: Easy to add middleware, hooks, custom serializers
6. **Performance**: Minimal overhead, efficient parsing

**Remember:** The API module bridges HTTP requests to database queries with complete type safety and framework flexibility.
