# API Module - Development Guidelines

## 📖 Module Overview

The API module provides HTTP request handling, query string parsing, and response serialization. It's designed to be framework-agnostic and work with Next.js, Express, Fastify, and other frameworks.

**Components:**
- **Handler**: Route handler factory (`createHandler`)
- **Parser**: Query string parsing (populate, fields, where, pagination)
- **Serializer**: JSON response formatting

---

## 🎯 Module Responsibilities

### Handler Factory (`src/api/handler/`)

**Purpose:** Generate CRUD route handlers for any framework

**Files:**
- `types.ts` - Handler type definitions
- `factory.ts` - `createHandler` function
- `crud.ts` - CRUD operation implementations
- `context.ts` - Request context builder

**Usage Pattern:**
```typescript
// Next.js App Router
// app/api/users/[...forja]/route.ts
import { createHandler } from 'forja';

export const { GET, POST, PUT, DELETE } = createHandler('User');

// Express
// routes/users.ts
import { createHandler } from 'forja';

const handler = createHandler('User');
router.get('/users', handler.GET);
router.post('/users', handler.POST);
router.put('/users/:id', handler.PUT);
router.delete('/users/:id', handler.DELETE);
```

**Handler Type Definition:**
```typescript
type RouteHandler<TRequest = unknown, TResponse = unknown> = (
  request: TRequest
) => Promise<TResponse>;

type HandlerConfig = {
  readonly model: string;
  readonly middleware?: readonly Middleware[];
  readonly permissions?: PermissionConfig;
  readonly hooks?: LifecycleHooks;
};

type PermissionConfig = {
  readonly create?: readonly string[] | PermissionFunction;
  readonly read?: readonly string[] | PermissionFunction;
  readonly update?: readonly string[] | PermissionFunction;
  readonly delete?: readonly string[] | PermissionFunction;
};

type PermissionFunction = (context: RequestContext) => boolean | Promise<boolean>;
```

**Create Handler Implementation:**
```typescript
export function createHandler(
  model: string,
  config?: Partial<HandlerConfig>
): {
  GET: RouteHandler;
  POST: RouteHandler;
  PUT: RouteHandler;
  DELETE: RouteHandler;
} {
  const fullConfig: HandlerConfig = {
    model,
    middleware: config?.middleware ?? [],
    permissions: config?.permissions ?? {},
    hooks: config?.hooks ?? {}
  };

  return {
    GET: async (request) => handleGet(request, fullConfig),
    POST: async (request) => handlePost(request, fullConfig),
    PUT: async (request) => handlePut(request, fullConfig),
    DELETE: async (request) => handleDelete(request, fullConfig)
  };
}

// Framework-specific adapters
export function createNextHandler(model: string, config?: Partial<HandlerConfig>) {
  const handlers = createHandler(model, config);

  return {
    GET: async (req: NextRequest) => {
      const result = await handlers.GET(adaptNextRequest(req));
      return NextResponse.json(result);
    },
    POST: async (req: NextRequest) => {
      const result = await handlers.POST(adaptNextRequest(req));
      return NextResponse.json(result);
    },
    PUT: async (req: NextRequest) => {
      const result = await handlers.PUT(adaptNextRequest(req));
      return NextResponse.json(result);
    },
    DELETE: async (req: NextRequest) => {
      const result = await handlers.DELETE(adaptNextRequest(req));
      return NextResponse.json(result);
    }
  };
}
```

**CRUD Operations:**
```typescript
// GET /api/users?populate[posts][fields][0]=title&fields[0]=email
async function handleGet(
  request: NormalizedRequest,
  config: HandlerConfig
): Promise<ApiResponse> {
  // 1. Parse query string
  const parsedQuery = parseQueryString(request.query);

  // 2. Check permissions
  const hasPermission = await checkPermission(
    request.context,
    config.permissions.read
  );
  if (!hasPermission) {
    return errorResponse(403, 'Forbidden');
  }

  // 3. Build query
  const query: QueryObject = {
    type: 'select',
    table: config.model,
    select: parsedQuery.fields ?? '*',
    where: parsedQuery.where,
    populate: parsedQuery.populate,
    limit: parsedQuery.pagination.limit,
    offset: parsedQuery.pagination.offset
  };

  // 4. Execute before hook
  if (config.hooks?.beforeFind) {
    await config.hooks.beforeFind(query, request.context);
  }

  // 5. Execute query
  const result = await adapter.executeQuery(query);
  if (!result.success) {
    return errorResponse(500, 'Query failed', result.error);
  }

  // 6. Execute after hook
  let data = result.data;
  if (config.hooks?.afterFind) {
    data = await config.hooks.afterFind(data, request.context);
  }

  // 7. Serialize response
  return successResponse(data);
}

// POST /api/users
async function handlePost(
  request: NormalizedRequest,
  config: HandlerConfig
): Promise<ApiResponse> {
  // 1. Parse body
  const body = await parseBody(request);

  // 2. Validate
  const validation = await validateSchema(config.model, body);
  if (!validation.success) {
    return errorResponse(400, 'Validation failed', validation.errors);
  }

  // 3. Check permissions
  const hasPermission = await checkPermission(
    request.context,
    config.permissions.create
  );
  if (!hasPermission) {
    return errorResponse(403, 'Forbidden');
  }

  // 4. Execute before hook
  let data = validation.data;
  if (config.hooks?.beforeCreate) {
    data = await config.hooks.beforeCreate(data, request.context);
  }

  // 5. Execute query
  const result = await adapter.executeQuery({
    type: 'insert',
    table: config.model,
    data
  });
  if (!result.success) {
    return errorResponse(500, 'Create failed', result.error);
  }

  // 6. Execute after hook
  let created = result.data;
  if (config.hooks?.afterCreate) {
    created = await config.hooks.afterCreate(created, request.context);
  }

  // 7. Serialize response
  return successResponse(created, 201);
}

// PUT /api/users/:id
async function handlePut(
  request: NormalizedRequest,
  config: HandlerConfig
): Promise<ApiResponse> {
  // Similar to POST but for updates
}

// DELETE /api/users/:id
async function handleDelete(
  request: NormalizedRequest,
  config: HandlerConfig
): Promise<ApiResponse> {
  // Similar pattern for deletes
}
```

---

### Query Parser (`src/api/parser/`)

**Purpose:** Parse Strapi-style query strings into QueryObject

**Files:**
- `types.ts` - Parser type definitions
- `query-parser.ts` - Main query parser
- `populate-parser.ts` - Populate syntax parser
- `fields-parser.ts` - Fields syntax parser
- `where-parser.ts` - Where clause parser

**Supported Query Syntax:**

```typescript
// Fields selection
// ?fields[0]=email&fields[1]=name
// Result: select: ['email', 'name']

// Populate (relations)
// ?populate=*
// Result: populate all relations

// ?populate[posts][fields][0]=title&populate[posts][fields][1]=createdAt
// Result: populate: { posts: { select: ['title', 'createdAt'] } }

// ?populate[profile]=*&populate[posts][populate][author]=*
// Result: nested populate

// Where conditions
// ?where[role]=admin
// Result: where: { role: 'admin' }

// ?where[age][$gte]=18&where[age][$lt]=65
// Result: where: { age: { $gte: 18, $lt: 65 } }

// ?where[$or][0][role]=admin&where[$or][1][role]=moderator
// Result: where: { $or: [{ role: 'admin' }, { role: 'moderator' }] }

// Pagination
// ?page=2&pageSize=25
// Result: limit: 25, offset: 25

// Sorting
// ?sort[0]=createdAt:desc&sort[1]=name:asc
// Result: orderBy: [{ field: 'createdAt', direction: 'desc' }, { field: 'name', direction: 'asc' }]
```

**Parser Implementation:**

```typescript
interface ParsedQuery {
  readonly fields?: readonly string[];
  readonly where?: WhereClause;
  readonly populate?: PopulateClause;
  readonly pagination: {
    readonly page: number;
    readonly limit: number;
    readonly offset: number;
  };
  readonly orderBy?: readonly OrderByItem[];
}

export function parseQueryString(
  queryString: Record<string, string | string[]>
): ParsedQuery {
  return {
    fields: parseFields(queryString.fields),
    where: parseWhere(queryString.where),
    populate: parsePopulate(queryString.populate),
    pagination: parsePagination(queryString.page, queryString.pageSize),
    orderBy: parseOrderBy(queryString.sort)
  };
}

// Fields parser
function parseFields(
  fields: unknown
): readonly string[] | undefined {
  if (!fields) return undefined;
  if (typeof fields === 'string') return [fields];
  if (Array.isArray(fields)) return fields.filter(f => typeof f === 'string');

  // Handle ?fields[0]=email&fields[1]=name format
  if (typeof fields === 'object' && fields !== null) {
    return Object.values(fields).filter(f => typeof f === 'string');
  }

  return undefined;
}

// Populate parser
function parsePopulate(populate: unknown): PopulateClause | undefined {
  if (!populate) return undefined;

  // Handle ?populate=*
  if (populate === '*') {
    // Return all relations (need schema info)
    return {}; // Will be filled by handler
  }

  // Handle ?populate[posts][fields][0]=title
  if (typeof populate === 'object' && populate !== null) {
    const result: Record<string, {
      select?: readonly string[];
      where?: WhereClause;
      populate?: PopulateClause;
    }> = {};

    for (const [relation, value] of Object.entries(populate)) {
      if (value === '*') {
        result[relation] = {};
      } else if (typeof value === 'object' && value !== null) {
        const relationValue = value as Record<string, unknown>;
        result[relation] = {
          select: parseFields(relationValue.fields),
          where: parseWhere(relationValue.where),
          populate: parsePopulate(relationValue.populate)
        };
      }
    }

    return result;
  }

  return undefined;
}

// Where parser
function parseWhere(where: unknown): WhereClause | undefined {
  if (!where || typeof where !== 'object') return undefined;

  const result: WhereClause = {};

  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    // Handle logical operators
    if (key === '$or' || key === '$and') {
      if (Array.isArray(value)) {
        result[key] = value.map(v => parseWhere(v)).filter(Boolean) as WhereClause[];
      }
      continue;
    }

    // Handle comparison operators
    if (typeof value === 'object' && value !== null) {
      const operators: Record<string, unknown> = {};
      for (const [op, opValue] of Object.entries(value as Record<string, unknown>)) {
        if (op.startsWith('$')) {
          operators[op] = opValue;
        }
      }
      if (Object.keys(operators).length > 0) {
        result[key] = operators;
        continue;
      }
    }

    // Simple equality
    result[key] = value;
  }

  return result;
}

// Pagination parser
function parsePagination(
  page: unknown,
  pageSize: unknown
): { page: number; limit: number; offset: number } {
  const parsedPage = typeof page === 'string' ? parseInt(page, 10) : 1;
  const parsedPageSize = typeof pageSize === 'string' ? parseInt(pageSize, 10) : 25;

  const safePage = Math.max(1, parsedPage);
  const safePageSize = Math.min(100, Math.max(1, parsedPageSize)); // Max 100 per page

  return {
    page: safePage,
    limit: safePageSize,
    offset: (safePage - 1) * safePageSize
  };
}

// Order by parser
function parseOrderBy(sort: unknown): readonly OrderByItem[] | undefined {
  if (!sort) return undefined;

  const items: OrderByItem[] = [];

  if (typeof sort === 'string') {
    const [field, direction] = sort.split(':');
    if (field) {
      items.push({
        field,
        direction: direction === 'desc' ? 'desc' : 'asc'
      });
    }
  } else if (Array.isArray(sort)) {
    for (const item of sort) {
      if (typeof item === 'string') {
        const [field, direction] = item.split(':');
        if (field) {
          items.push({
            field,
            direction: direction === 'desc' ? 'desc' : 'asc'
          });
        }
      }
    }
  } else if (typeof sort === 'object' && sort !== null) {
    // Handle ?sort[0]=createdAt:desc format
    for (const value of Object.values(sort)) {
      if (typeof value === 'string') {
        const [field, direction] = value.split(':');
        if (field) {
          items.push({
            field,
            direction: direction === 'desc' ? 'desc' : 'asc'
          });
        }
      }
    }
  }

  return items.length > 0 ? items : undefined;
}
```

---

### Response Serializer (`src/api/serializer/`)

**Purpose:** Format query results as JSON responses

**Files:**
- `types.ts` - Serializer type definitions
- `json.ts` - JSON response serializer
- `relations.ts` - Relation data serializer

**Response Format:**
```typescript
type ApiResponse<T = unknown> =
  | SuccessResponse<T>
  | ErrorResponse;

interface SuccessResponse<T> {
  readonly success: true;
  readonly data: T;
  readonly meta?: {
    readonly pagination?: {
      readonly page: number;
      readonly pageSize: number;
      readonly total: number;
      readonly pageCount: number;
    };
  };
}

interface ErrorResponse {
  readonly success: false;
  readonly error: {
    readonly message: string;
    readonly code?: string;
    readonly details?: unknown;
  };
}
```

**Serializer Implementation:**
```typescript
export function successResponse<T>(
  data: T,
  status: number = 200,
  meta?: SuccessResponse<T>['meta']
): ApiResponse<T> {
  return {
    success: true,
    data,
    ...(meta && { meta })
  };
}

export function errorResponse(
  status: number,
  message: string,
  details?: unknown
): ErrorResponse {
  return {
    success: false,
    error: {
      message,
      ...(details && { details })
    }
  };
}

// Serialize relations
export function serializeWithRelations<T extends Record<string, unknown>>(
  data: T,
  populate: PopulateClause | undefined,
  schema: SchemaDefinition
): T {
  if (!populate) return data;

  const result = { ...data };

  for (const [relation, options] of Object.entries(populate)) {
    const relationField = schema.fields[relation];
    if (!relationField || relationField.type !== 'relation') continue;

    // Fetch related data
    // Apply populate options (select, where, nested populate)
    // Add to result
  }

  return result;
}
```

---

## ✅ Testing Requirements

### Tests Required:
1. Query string parsing (all formats)
2. Handler creation
3. CRUD operations
4. Permission checking
5. Response serialization
6. Framework adapters (Next.js, Express)

---

## 🎯 Implementation Priority

1. **Query Parser** (Foundation)
2. **Handler Factory** (Core functionality)
3. **CRUD Operations**
4. **Response Serializer**
5. **Framework Adapters**

---

## 🔑 Key Principles

1. **Framework Agnostic** - Core works with any framework
2. **Type Safe** - Infer types from schemas
3. **Strapi Compatible** - Similar query syntax
4. **Extensible** - Easy to add middleware
5. **Result Pattern** - Consistent error handling

**Remember:** The API module bridges HTTP requests to database queries with type safety and flexibility.
