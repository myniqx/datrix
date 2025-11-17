# Forja - Database Management Framework

## 📖 Project Overview

Forja is a TypeScript-first database management framework that provides Strapi-like REST API flexibility without being a standalone application. It's designed to be installed via `pnpm add forja@latest` and integrated into existing Node.js/Next.js applications.

### Core Principles

1. **Zero Runtime Any Types**: All code must be strictly typed, no `any`, no type assertions with `as`
2. **Minimal Dependencies**: Custom implementations over heavy libraries
3. **Plugin Architecture**: Interface-based plugins with clear contracts
4. **Type Safety**: Full TypeScript inference from schema to API
5. **Framework Agnostic**: Works with Next.js, Express, Fastify, etc.

---

## 🎯 Key Features

### Schema System

- Plain TypeScript object definitions
- Automatic type inference
- Explicit relations (hasOne, hasMany, belongsTo, manyToMany)
- Config-based schema discovery

### Database Support

- PostgreSQL (Priority 1)
- MySQL/MariaDB (Priority 2)
- MongoDB (Priority 3)
- Custom query builder (no ORM dependency)

### API Layer

- Strapi-style query syntax:
  - `?populate[profile][fields][0]=name`
  - `?fields[0]=color&fields[1]=price`
  - `?where[status]=active&where[price][$gt]=100`
  - `?page=1&pageSize=10` (offset-based pagination)
- Next.js-style route handler generation
- JSON response serialization

### Built-in Features

- **Authentication**: JWT + Session + RBAC
- **File Upload**: S3 + Local storage adapters
- **Lifecycle Hooks**: beforeCreate, afterUpdate, beforeDelete, etc.
- **Soft Delete**: Optional deletedAt field
- **Custom Validation**: ~300 LOC validation engine

### CLI Tools

- `forja migrate` - Run migrations
- `forja generate schema <Name>` - Generate schema template
- `forja generate migration <name>` - Generate migration file
- `forja dev` - Development mode with auto-reload

---

## 📁 Project Structure

```
forja/
├── README.md
├── TODO.md (this file)
├── CLAUDE.md (global instructions)
├── package.json
├── tsconfig.json
├── .gitignore
│
├── src/
│   ├── index.ts                    # Main exports
│   │
│   ├── core/
│   │   ├── CLAUDE.md               # Core module instructions
│   │   ├── schema/
│   │   │   ├── types.ts            # Schema type definitions
│   │   │   ├── inference.ts        # Type inference utilities
│   │   │   ├── registry.ts         # Schema registry
│   │   │   └── builder.ts          # Schema builder utilities
│   │   │
│   │   ├── validator/
│   │   │   ├── types.ts            # Validation types
│   │   │   ├── field-validator.ts  # Individual field validation
│   │   │   ├── schema-validator.ts # Full schema validation
│   │   │   └── errors.ts           # Validation error classes
│   │   │
│   │   ├── query-builder/
│   │   │   ├── types.ts            # Query builder types
│   │   │   ├── builder.ts          # Query builder base
│   │   │   ├── where.ts            # WHERE clause builder
│   │   │   ├── select.ts           # SELECT/fields builder
│   │   │   ├── populate.ts         # JOIN/populate builder
│   │   │   └── pagination.ts       # Pagination builder
│   │   │
│   │   ├── migration/
│   │   │   ├── types.ts            # Migration types
│   │   │   ├── generator.ts        # Auto migration generator
│   │   │   ├── differ.ts           # Schema diff calculator
│   │   │   ├── runner.ts           # Migration runner
│   │   │   └── history.ts          # Migration history tracker
│   │   │
│   │   └── config/
│   │       ├── types.ts            # Config types
│   │       ├── loader.ts           # Config file loader
│   │       └── validator.ts        # Config validation
│   │
│   ├── adapters/
│   │   ├── CLAUDE.md               # Adapter interface documentation
│   │   ├── base/
│   │   │   ├── types.ts            # Base adapter interface
│   │   │   └── adapter.ts          # Abstract base adapter class
│   │   │
│   │   ├── postgres/
│   │   │   ├── adapter.ts          # PostgreSQL adapter implementation
│   │   │   ├── query-translator.ts # Query to SQL translator
│   │   │   ├── types.ts            # Postgres-specific types
│   │   │   └── connection.ts       # Connection pool manager
│   │   │
│   │   ├── mysql/
│   │   │   └── ... (same structure as postgres)
│   │   │
│   │   └── mongodb/
│   │       └── ... (similar structure, MongoDB-specific)
│   │
│   ├── plugins/
│   │   ├── CLAUDE.md               # Plugin interface documentation
│   │   ├── base/
│   │   │   ├── types.ts            # Base plugin interface
│   │   │   └── plugin.ts           # Abstract base plugin class
│   │   │
│   │   ├── auth/
│   │   │   ├── index.ts            # Auth plugin entry
│   │   │   ├── jwt.ts              # JWT strategy
│   │   │   ├── session.ts          # Session strategy
│   │   │   ├── rbac.ts             # Role-based access control
│   │   │   └── types.ts            # Auth types
│   │   │
│   │   ├── upload/
│   │   │   ├── index.ts            # Upload plugin entry
│   │   │   ├── providers/
│   │   │   │   ├── base.ts         # Base provider interface
│   │   │   │   ├── local.ts        # Local filesystem provider
│   │   │   │   └── s3.ts           # AWS S3 provider
│   │   │   └── types.ts            # Upload types
│   │   │
│   │   ├── hooks/
│   │   │   ├── index.ts            # Hooks plugin entry
│   │   │   ├── manager.ts          # Hook execution manager
│   │   │   ├── types.ts            # Hook types
│   │   │   └── lifecycle.ts        # Lifecycle hook definitions
│   │   │
│   │   └── soft-delete/
│   │       ├── index.ts            # Soft delete plugin entry
│   │       ├── interceptor.ts      # Query interceptor
│   │       └── types.ts            # Soft delete types
│   │
│   ├── api/
│   │   ├── CLAUDE.md               # API module instructions
│   │   ├── handler/
│   │   │   ├── types.ts            # Handler types
│   │   │   ├── factory.ts          # Handler factory (createHandler)
│   │   │   ├── crud.ts             # CRUD operations
│   │   │   └── context.ts          # Request context builder
│   │   │
│   │   ├── parser/
│   │   │   ├── types.ts            # Parser types
│   │   │   ├── query-parser.ts     # URL query string parser
│   │   │   ├── populate-parser.ts  # Populate syntax parser
│   │   │   ├── fields-parser.ts    # Fields syntax parser
│   │   │   └── where-parser.ts     # Where clause parser
│   │   │
│   │   └── serializer/
│   │       ├── types.ts            # Serializer types
│   │       ├── json.ts             # JSON response serializer
│   │       └── relations.ts        # Relation data serializer
│   │
│   ├── cli/
│   │   ├── CLAUDE.md               # CLI instructions
│   │   ├── index.ts                # CLI entry point
│   │   ├── commands/
│   │   │   ├── migrate.ts          # migrate command
│   │   │   ├── generate.ts         # generate command
│   │   │   └── dev.ts              # dev command
│   │   └── utils/
│   │       ├── logger.ts           # CLI logger
│   │       └── templates.ts        # Code templates
│   │
│   └── utils/
│       ├── types.ts                # Global utility types
│       └── helpers.ts              # Helper functions
│
└── tests/
    ├── core/
    ├── adapters/
    ├── plugins/
    └── api/
```

---

## 🔧 Technical Requirements

### TypeScript Standards

```typescript
// ❌ NEVER do this
function process(data: any) { ... }
const user = result as User;

// ✅ ALWAYS do this
function process<T extends Record<string, unknown>>(data: T): ProcessedData<T> { ... }
const user: User | null = parseUser(result);
```

### Interface Standards

**Adapter Interface:**

```typescript
// adapters/base/types.ts
interface DatabaseAdapter<TConfig = Record<string, unknown>> {
	readonly name: string;
	readonly config: TConfig;

	connect(): Promise<void>;
	disconnect(): Promise<void>;

	executeQuery<TResult>(query: QueryObject): Promise<TResult>;
	executeRawQuery<TResult>(sql: string, params: unknown[]): Promise<TResult>;

	beginTransaction(): Promise<Transaction>;
	createTable(schema: SchemaDefinition): Promise<void>;
	alterTable(tableName: string, changes: TableChanges): Promise<void>;
}
```

**Plugin Interface:**

```typescript
// plugins/base/types.ts
interface ForjaPlugin<TOptions = Record<string, unknown>> {
	readonly name: string;
	readonly version: string;
	readonly options: TOptions;

	init(context: PluginContext): Promise<void>;
	destroy(): Promise<void>;

	onSchemaLoad?(schemas: SchemaRegistry): Promise<void>;
	onBeforeQuery?(query: QueryObject): Promise<QueryObject>;
	onAfterQuery?<TResult>(result: TResult): Promise<TResult>;
}
```

---

## ✅ Implementation Checklist

### Phase 1: Core Foundation

- [x] Project setup (package.json, tsconfig, etc.)
- [x] Create folder structure
- [x] Write CLAUDE.md files for each module
- [x] Define core type system
  - [x] Schema types (`src/core/schema/types.ts`)
  - [x] Validation types (`src/core/validator/types.ts`)
  - [x] Query builder types (`src/core/query-builder/types.ts`)
- [x] Implement schema system
  - [x] Schema registry (`src/core/schema/registry.ts`)
  - [x] Type inference utilities (`src/core/schema/inference.ts`)
- [x] Implement custom validation engine
  - [x] Field validator (~150 LOC)
  - [x] Schema validator (~150 LOC)
  - [x] Error handling

### Phase 2: Query Builder & PostgreSQL Adapter

- [ ] Query builder base implementation
  - [ ] WHERE clause builder
  - [ ] SELECT/fields builder
  - [ ] JOIN/populate builder
  - [ ] Pagination builder
- [ ] PostgreSQL adapter
  - [ ] Connection management
  - [ ] Query translator (QueryObject → SQL)
  - [ ] Transaction support
  - [ ] Type mapping (TS types ↔ PG types)

### Phase 3: Migration System

- [ ] Migration types and interfaces
- [ ] Schema differ (detect changes)
- [ ] Migration generator (auto-generate from schemas)
- [ ] Migration runner
- [ ] Migration history tracking (migrations table)

### Phase 4: API Layer

- [ ] Query string parser
  - [ ] Parse `populate` syntax
  - [ ] Parse `fields` syntax
  - [ ] Parse `where` syntax
  - [ ] Parse pagination params
- [ ] Handler factory (`createHandler`)
- [ ] CRUD operations implementation
- [ ] JSON response serializer
- [ ] Relation data serialization

### Phase 5: Authentication Plugin

- [ ] Plugin base interface
- [ ] JWT strategy
- [ ] Session strategy
- [ ] RBAC (Role-Based Access Control)
- [ ] Permission checking middleware

### Phase 6: Additional Plugins

- [ ] File upload plugin
  - [ ] Base provider interface
  - [ ] Local filesystem provider
  - [ ] S3 provider
- [ ] Lifecycle hooks plugin
  - [ ] Hook manager
  - [ ] beforeCreate, afterCreate
  - [ ] beforeUpdate, afterUpdate
  - [ ] beforeDelete, afterDelete
- [ ] Soft delete plugin
  - [ ] Query interceptor
  - [ ] Auto-add deletedAt filter

### Phase 7: CLI Tools

- [ ] CLI framework setup
- [ ] `forja migrate` command
- [ ] `forja generate schema` command
- [ ] `forja generate migration` command
- [ ] `forja dev` command

### Phase 8: Additional Adapters

- [ ] MySQL adapter
- [ ] MongoDB adapter

### Phase 9: Testing & Documentation

- [ ] Unit tests for core modules
- [ ] Integration tests for adapters
- [ ] E2E tests for API layer
- [ ] README documentation
- [ ] API documentation
- [ ] Usage examples

---

## 📝 Development Notes

### Config File Structure

```typescript
// forja.config.ts
import { defineConfig } from "forja";

export default defineConfig({
	database: {
		adapter: "postgres",
		connection: {
			host: "localhost",
			port: 5432,
			database: "myapp",
			user: "postgres",
			password: "password",
		},
	},

	schemas: {
		path: "./schemas/**/*.schema.ts",
		// Auto-import all schema files
	},

	plugins: [
		{
			name: "auth",
			options: {
				jwt: { secret: process.env.JWT_SECRET },
				session: { store: "redis" },
			},
		},
		{
			name: "upload",
			options: {
				provider: "s3",
				config: { bucket: "my-bucket" },
			},
		},
		"soft-delete",
		"hooks",
	],

	api: {
		prefix: "/api",
		defaultPageSize: 25,
		maxPageSize: 100,
	},
});
```

### Schema Definition Example

```typescript
// schemas/user.schema.ts
import { defineSchema } from "forja";

export const userSchema = defineSchema({
	name: "User",

	fields: {
		email: {
			type: "string",
			required: true,
			unique: true,
			pattern: /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/,
			errorMessage: "Invalid email format",
		},

		password: {
			type: "string",
			required: true,
			minLength: 8,
			validator: (value: string) => {
				if (!/[A-Z]/.test(value)) return "Must contain uppercase";
				if (!/[0-9]/.test(value)) return "Must contain number";
				return true;
			},
		},

		name: {
			type: "string",
			required: true,
			minLength: 2,
			maxLength: 50,
		},

		age: {
			type: "number",
			min: 18,
			max: 120,
		},

		role: {
			type: "enum",
			values: ["admin", "user", "moderator"] as const,
			default: "user",
		},

		profile: {
			type: "relation",
			model: "Profile",
			kind: "hasOne",
			foreignKey: "userId",
		},

		posts: {
			type: "relation",
			model: "Post",
			kind: "hasMany",
			foreignKey: "authorId",
		},

		avatar: {
			type: "file",
			allowedTypes: ["image/jpeg", "image/png"],
			maxSize: 5 * 1024 * 1024, // 5MB
		},

		createdAt: {
			type: "date",
			autoCreate: true,
		},

		updatedAt: {
			type: "date",
			autoUpdate: true,
		},
	},

	hooks: {
		beforeCreate: async (data) => {
			// Hash password
			data.password = await hash(data.password);
			return data;
		},

		afterUpdate: async (result) => {
			// Invalidate cache
			await cache.invalidate(`user:${result.id}`);
			return result;
		},
	},

	indexes: [
		{ fields: ["email"], unique: true },
		{ fields: ["createdAt"], unique: false },
	],
} as const);

// Type is automatically inferred
export type User = (typeof userSchema)["__type"];
```

### Usage Example (Next.js App Router)

```typescript
// app/api/users/[...forja]/route.ts
import { createHandler } from "forja";

export const { GET, POST, PUT, DELETE } = createHandler("User", {
	middleware: [authMiddleware],

	permissions: {
		read: ["user", "admin"],
		create: ["admin"],
		update: (context) =>
			context.user.id === context.params.id || context.user.role === "admin",
		delete: ["admin"],
	},
});

// Example API calls:
// GET /api/users?populate[posts][fields][0]=title&fields[0]=name&fields[1]=email
// GET /api/users?where[role]=admin&where[age][$gte]=18
// GET /api/users/123?populate[profile]=*
// POST /api/users { "email": "...", "password": "...", "name": "..." }
// PUT /api/users/123 { "name": "New Name" }
// DELETE /api/users/123
```

---

## 🎨 Code Style Guidelines

1. **No `any` type** - Use generics, unknown, or specific types
2. **No type assertions** - Use type guards and proper typing
3. **Functional patterns** - Prefer pure functions where possible
4. **Explicit return types** - Always declare function return types
5. **Const assertions** - Use `as const` for literal types where appropriate
6. **Immutability** - Use `readonly` for arrays/objects that shouldn't mutate
7. **Error handling** - Use Result<T, E> pattern instead of throwing

---

## 🔍 Key Decisions & Rationale

### Why Custom Query Builder?

- Drizzle: 200KB+, complex abstraction
- Prisma: Heavy, separate schema language
- TypeORM: Decorator-based, large bundle
- **Custom**: ~500 LOC, full control, minimal size

### Why Custom Validation?

- Zod: 57KB, overkill for our needs
- Yup: 40KB, outdated patterns
- **Custom**: ~300 LOC, exactly what we need

### Why Plugin Architecture?

- Modularity: Users only import what they need
- Extensibility: Easy to add community plugins
- Maintainability: Clear separation of concerns
- Tree-shaking: Unused plugins don't bloat bundle

---

## 📚 References & Inspiration

- **Strapi**: Query API syntax, plugin architecture
- **Payload CMS**: TypeScript-first schemas, config-based
- **Prisma**: Migration system, type safety
- **Drizzle**: Query builder patterns, TypeScript inference
- **tRPC**: Type inference across boundaries
- **Effect-TS**: Result pattern, error handling

---

## 🚀 Getting Started (After Implementation)

```bash
# Install
pnpm add forja@latest

# Initialize config
npx forja init

# Create schema
npx forja generate schema User

# Run migration
npx forja migrate

# Development mode
npx forja dev
```

---

## 🗣️ Discussion Notes

### Conversation Summary

This project was designed through detailed discussion about:

1. **Database Support**: PostgreSQL, MySQL/MariaDB, MongoDB with custom query builder
2. **HTTP Layer**: Framework-agnostic, Next.js-style route handlers preferred
3. **Schema Format**: Plain TypeScript objects (Payload CMS style)
4. **Validation**: Custom ~300 LOC engine instead of Zod/Yup for minimal dependencies
5. **Relations**: Explicit field definitions (hasOne, hasMany, belongsTo, manyToMany)
6. **Pagination**: Offset/limit-based
7. **Auth**: Built-in JWT + Session + RBAC
8. **Extra Features**: File upload, lifecycle hooks, soft delete

### Key Architectural Decisions

- **Zero `any` types**: Strict TypeScript throughout
- **No type assertions**: Use proper type guards
- **Interface standards**: Clear contracts for adapters and plugins
- **Module-specific CLAUDE.md files**: Documentation for each component
- **Minimal dependencies**: Custom implementations preferred

### Development Philosophy

- Type safety first
- Developer experience focused
- Production-ready from start
- Tree-shakeable and modular
- Community-extensible via plugins
