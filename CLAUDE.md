# Forja - Global Development Guidelines

## 🎯 Project Mission

BU PROJE PRODUCTION DEGIL! GERIYE UYUMLULUK DUSUNME!
TIP HATALARINI İÇİN OTOMATİK İŞLEM YAPMA, bunu istediğimde prompt ile bildiririm.

Forja is a TypeScript-first database management framework that provides Strapi-like REST API flexibility without being a standalone application. Our goal is to create a minimal, type-safe, and highly extensible framework that developers can integrate into their existing projects.

---

## 🚨 Critical Rules (NEVER BREAK THESE)

### 1. Zero `any` Types Policy

```typescript
// ❌ NEVER do this
function processData(data: any): any {}
const result = response as User;

// ✅ ALWAYS do this
function processData<T extends Record<string, unknown>>(
	data: T,
): ProcessResult<T> {}
const result: User | null = isUser(response) ? response : null;
```

import { ForjaEntry } from 'forja-types/forja';
Database entry tipi için her zaman <T extends ForjaEntry> generic kullanılmalıdır.

**Enforcement:**

- Use generics for flexibility
- Use `unknown` when type is truly unknown
- Use union types for multiple possibilities
- Use type guards for narrowing
- NEVER use `as` type assertions
- NEVER use `any` type

### 2. Strict Type Safety

- All functions MUST have explicit return types
- All parameters MUST have explicit types
- Use `const` assertions where appropriate (`as const`)
- Enable all strict TypeScript compiler options
- Use `readonly` for immutable data structures

### 3. Error Handling Pattern

Use Result<T, E> pattern instead of throwing exceptions:

```typescript
// Define Result type
type Result<T, E = Error> =
	| { success: true; data: T }
	| { success: false; error: E };

// ❌ Don't throw
function parseUser(data: unknown): User {
	if (!isValidUser(data)) throw new Error("Invalid user");
	return data;
}

// ✅ Return Result
function parseUser(data: unknown): Result<User, ValidationError> {
	if (!isValidUser(data)) {
		return { success: false, error: new ValidationError("Invalid user") };
	}
	return { success: true, data };
}
```

### 4. Debug-Friendly Code Style

**ALWAYS break nested function calls into intermediate variables for easier debugging.**

This makes it easier to inspect values step-by-step in debugger and understand data flow.

```typescript
// ❌ BAD - Nested calls, hard to debug
const result = processData(transformInput(validateUser(parseJson(rawData))));

// ✅ GOOD - Step by step, easy to debug
const parsed = parseJson(rawData);
const validated = validateUser(parsed);
const transformed = transformInput(validated);
const result = processData(transformed);
```

```typescript
// ❌ BAD - Complex inline expression
return jsonResponse({
	data: await filterRecordsForRead(
		schema,
		await forja.findMany(schema.name, buildQuery(ctx)),
		ctx,
	),
});

// ✅ GOOD - Break into steps
const query = buildQuery(ctx);
const records = await forja.findMany(schema.name, query);
const filteredRecords = await filterRecordsForRead(schema, records, ctx);
return jsonResponse({ data: filteredRecords });
```

**Benefits:**

- Set breakpoints on each line
- Inspect intermediate values in debugger
- Understand data transformations clearly
- Easier to add logging/error handling
- Better stack traces

**When to apply:**

- Functions with 2+ nested calls
- Complex async operations
- Data transformation pipelines
- Anywhere debugging might be needed

---

## 📐 Code Architecture Principles

### 1. Modularity

- Each module should have a single responsibility
- Dependencies should flow inward (core ← adapters/plugins ← api)
- No circular dependencies
- Use dependency injection for flexibility

### 2. Interface-Based Design

All adapters and plugins MUST implement standardized interfaces defined in `packages/types/`.

### 3. Type Inference

Leverage TypeScript's type inference system:

```typescript
// Schema should infer types automatically
const userSchema = defineSchema({
	fields: {
		name: { type: "string", required: true },
		age: { type: "number" },
	},
} as const);

// Type is automatically inferred
type User = InferSchemaType<typeof userSchema>;
// Result: { name: string; age?: number }
```

---

## 📂 Package Structure

Project uses monorepo structure under `packages/`:

### packages/core
Schema, validation, query building, executor, migration.
See `packages/core/CLAUDE.md` for validation layer architecture.

### packages/types
Shared TypeScript types for all packages (ForjaEntry, QueryObject, adapters, etc.)

### packages/adapter-postgres
PostgreSQL adapter with query translator and populate support.

### packages/adapter-mysql
MySQL/MariaDB adapter.

### packages/adapter-mongodb
MongoDB adapter (experimental).

### packages/adapter-json
JSON file-based adapter for testing/development.

### packages/api
HTTP request handling, query parsing, auth (JWT/session), response serialization.

### packages/plugin-upload
File upload plugin with Local and S3 providers.

### packages/cli
Command-line tools (migrate, generate, dev).

---

## 🎨 Code Style Standards

### Naming Conventions

```typescript
// Types and Interfaces: PascalCase
type UserSchema = { ... };
interface DatabaseAdapter { ... }

// Functions and variables: camelCase
function parseQuery(input: string): ParsedQuery { }
const queryBuilder = createBuilder();

// Constants: UPPER_SNAKE_CASE
const MAX_PAGE_SIZE = 100;
const DEFAULT_TIMEOUT = 5000;

// Files: kebab-case
// query-builder.ts, field-validator.ts
```

### Function Signatures

```typescript
// Always specify return types
function processUser(id: string): Promise<Result<User, DatabaseError>> {
	// Implementation
}

// Use descriptive parameter names
function createQuery({
	table,
	where,
	select,
}: {
	table: string;
	where: WhereClause;
	select: readonly string[];
}): QueryObject {
	// Implementation
}
```

### Immutability

```typescript
// Use readonly for arrays and objects that shouldn't mutate
type Schema = {
	readonly fields: ReadonlyArray<Field>;
	readonly indexes: ReadonlyArray<Index>;
};

// Use const assertions
const FIELD_TYPES = ["string", "number", "boolean"] as const;
type FieldType = (typeof FIELD_TYPES)[number]; // 'string' | 'number' | 'boolean'
```

---

## 🧪 Testing Guidelines

Vitest config is only in root. Tests are in `packages/*/tests/` folders.

```bash
# Run specific test from root
pnpm vitest run packages/api/tests/crud-basic.test.ts

# Run all tests
pnpm test
```

---

## 📦 Dependency Management

**Minimal dependencies preferred.** Only add dependencies when:

1. Implementation would be >500 LOC
2. Security-critical (e.g., crypto)
3. Database drivers (pg, mysql2, mongodb)
4. Build tools (tsup, typescript, vitest)

---

## 🔍 Code Review Checklist

Before committing code, verify:

- [ ] No `any` types used
- [ ] No `as` type assertions
- [ ] All functions have return types
- [ ] All parameters have types
- [ ] Follows Result<T, E> pattern for errors
- [ ] No console.log left in code

---

## 🚀 Development Workflow

```bash
pnpm install      # Install dependencies
pnpm type-check   # Type check
pnpm build        # Build all packages
pnpm test         # Run tests
```

---

**Remember:** Type safety first, minimal dependencies, clear interfaces.
