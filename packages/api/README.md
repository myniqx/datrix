# @forja/api

HTTP REST API plugin for Forja. Turns any Forja instance into a fully-featured REST API — auto-generates CRUD routes for every schema, handles JWT and session authentication, RBAC permissions, and optionally manages file uploads via [`@forja/api-upload`](../api-upload/README.md).

## Installation

```bash
pnpm add @forja/api
```

## Setup

```typescript
import { defineConfig } from "forja-core"
import { ApiPlugin } from "@forja/api"

export default defineConfig(() => ({
  adapter,
  schemas,
  plugins: [
    new ApiPlugin({
      prefix:           "/api",  // default: "/api"
      defaultPageSize:  25,      // default: 25
      maxPageSize:      100,     // default: 100
      maxPopulateDepth: 5,       // default: 5
      excludeSchemas:   [],      // always excludes _forja and _forja_migrations
    }),
  ],
}))
```

## Request handling

### `handleRequest`

```typescript
import { handleRequest } from "@forja/api"

handleRequest(forja: IForja, request: Request): Promise<Response>
```

Main entry point. Routes to the appropriate handler (auth, CRUD, or upload). Always returns a `Response`, never throws.

#### Next.js App Router

```typescript
import forja from "@/forja.config"
import { handleRequest } from "@forja/api"

async function handler(request: Request): Promise<Response> {
  return handleRequest(await forja(), request)
}

export const GET = handler
export const POST = handler
export const PATCH = handler
export const PUT = handler
export const DELETE = handler
```

#### Express

```typescript
import express from "express"
import { handleRequest, toWebRequest, sendWebResponse } from "@forja/api"

const app = express()
app.use(express.raw({ type: "*/*" }))

app.all("*", async (req, res) => {
  const request  = toWebRequest(req)
  const response = await handleRequest(await forja(), request)
  await sendWebResponse(res, response)
})
```

`toWebRequest` / `sendWebResponse` work with any Node.js-style request/response — Fastify, Koa, raw `http.createServer`.

## Auto-generated CRUD routes

For every registered schema:

| Method   | Path               | Description                              |
| -------- | ------------------ | ---------------------------------------- |
| `GET`    | `/api/:schema`     | List records — pagination, filtering, sorting, populate |
| `GET`    | `/api/:schema/:id` | Get a single record                      |
| `POST`   | `/api/:schema`     | Create a record                          |
| `PATCH`  | `/api/:schema/:id` | Update a record                          |
| `DELETE` | `/api/:schema/:id` | Delete a record                          |

The `:schema` segment matches the schema's table name (e.g. schema `"product"` → `/api/products`).

### Filtering, sorting, pagination

Pass query parameters as a serialized `ParsedQuery` object. Use `queryToParams` to build them:

```typescript
import { queryToParams } from "@forja/api"

const qs = queryToParams({
  where:   { status: "active" },
  orderBy: { createdAt: "desc" },
  page:    1,
  pageSize: 20,
})

fetch(`/api/products?${qs}`)
```

## Authentication

Enable by adding an `auth` block to `ApiPlugin`:

```typescript
const roles = ["admin", "editor", "user"] as const
type Role = (typeof roles)[number]

new ApiPlugin<Role>({
  auth: {
    roles,
    defaultRole: "user",
    jwt: {
      secret:    "your-secret-key-at-least-32-characters",
      expiresIn: "7d",
    },
    session: {
      store:  "memory",  // or a custom SessionStore instance
      maxAge: 86400,
    },
    defaultPermission: {
      create: ["admin"],
      read:   true,
      update: ["admin", "editor"],
      delete: ["admin"],
    },
  },
})
```

JWT and session can be active simultaneously. Responses include both a token and a `sessionId` cookie.

A `user` schema with an `email` field must exist before enabling auth. The plugin creates an `authentication` table automatically.

### Auth endpoints

| Method | Path                  | Description                              |
| ------ | --------------------- | ---------------------------------------- |
| `POST` | `/api/auth/register`  | Create a new user account                |
| `POST` | `/api/auth/login`     | Login — returns token and/or sets cookie |
| `POST` | `/api/auth/logout`    | Invalidate session                       |
| `GET`  | `/api/auth/me`        | Get the currently authenticated user     |

Endpoint paths are configurable via `auth.endpoints`. Registration can be disabled with `auth.endpoints.disableRegister: true`.

### Authenticated requests

```http
GET /api/products
Authorization: Bearer eyJ...
```

Or send the `sessionId` cookie — the browser handles this automatically.

### Permissions

Defined per schema in `SchemaDefinition.permission`:

```typescript
defineSchema({
  name: "product",
  fields: { ... },
  permission: {
    create: ["admin", "editor"],
    read:   true,               // public
    update: ["admin", "editor"],
    delete: ["admin"],
  },
})
```

Permission values: `true` (public), `false` (blocked), role array, async function, or a mixed array (OR logic). Field-level `read`/`write` permissions are also supported per field.

## File uploads

File upload support is in a separate package to keep `sharp` out of the core dependency tree. See [`@forja/api-upload`](../api-upload/README.md) for the full setup, storage provider docs, format conversion, and resolution variants.

```typescript
import { Upload, LocalStorageProvider } from "@forja/api-upload"

new ApiPlugin({
  upload: new Upload({
    provider: new LocalStorageProvider({
      basePath: "./uploads",
      baseUrl:  "https://example.com/uploads",
    }),
    format:  "webp",
    quality: 80,
    resolutions: {
      thumbnail: { width: 150, height: 150, fit: "cover" },
      small:     { width: 320 },
    },
  }),
})
```

## Architecture

```text
src/
├── api.ts                   # ApiPlugin class — plugin lifecycle, schema injection, request routing
├── interface.ts             # IApiPlugin interface — used internally to avoid circular deps
├── types.ts                 # ApiConfig type
├── index.ts                 # Public exports
├── helper/
│   └── index.ts             # handleRequest, toWebRequest, sendWebResponse, queryToParams
├── handler/
│   ├── unified.ts           # CRUD request handler (GET / POST / PATCH / DELETE)
│   ├── auth-handler.ts      # Auth endpoint handlers (register, login, logout, me)
│   └── utils.ts             # jsonResponse, forjaErrorResponse helpers
├── auth/
│   ├── manager.ts           # AuthManager — coordinates JWT, session, and password
│   ├── jwt.ts               # JwtStrategy — signing/verification (no external deps)
│   ├── session.ts           # SessionStrategy + MemorySessionStore
│   ├── password.ts          # PasswordManager — PBKDF2 hashing
│   └── types.ts             # AuthConfig, SessionConfig, JwtConfig, SessionData, etc.
├── middleware/
│   ├── context.ts           # RequestContext builder
│   ├── permission.ts        # Schema and field permission evaluation
│   └── types.ts             # RequestContext type
└── errors/
    ├── api-error.ts         # ForjaApiError and handlerError factory
    └── auth-error.ts        # ForjaAuthError and authError factory
```
