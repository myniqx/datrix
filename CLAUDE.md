# Forja - Global Development Guidelines

## 🎯 Project Mission

BU PROJE PRODUCTION DEGIL! GERIYE UYUMLULUK DUSUNME!

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
    ctx
  )
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

All adapters and plugins MUST implement standardized interfaces:

**Adapter Interface** (defined in `src/adapters/base/types.ts`):

```typescript
interface DatabaseAdapter<TConfig = Record<string, unknown>> {
	readonly name: string;
	readonly config: TConfig;

	connect(): Promise<void>;
	disconnect(): Promise<void>;
	executeQuery<TResult>(query: QueryObject): Promise<TResult>;
	// ... more methods
}
```

**Plugin Interface** (defined in `src/plugins/base/types.ts`):

```typescript
interface ForjaPlugin<TOptions = Record<string, unknown>> {
	readonly name: string;
	readonly version: string;
	readonly options: TOptions;

	init(context: PluginContext): Promise<void>;
	destroy(): Promise<void>;
	// ... lifecycle hooks
}
```

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

## 📂 Module-Specific Guidelines

### Core Module (`src/core/`) - ✅ Implemented

**Purpose:** Core functionality - schema, validation, query building, migration
**Status:** 100% complete (~3,600 LOC)

- ✅ Schema system (397 LOC) - type inference, registry
- ✅ Validator (800 LOC) - zero external dependencies
- ✅ Query Builder (1,600 LOC) - database-agnostic
- ✅ Migration system (1,200 LOC) - auto-generation, diff, rollback
- ❌ Config module - NOT implemented yet (planned)

**Rules:**

- ZERO external dependencies (except TypeScript)
- Pure functions where possible
- Comprehensive type definitions
- See `src/core/CLAUDE.md` for detailed instructions

### Adapters Module (`src/adapters/`) - ⚠️ Partially Implemented

**Purpose:** Database-specific implementations (PostgreSQL, MySQL, MongoDB)
**Status:** 33% complete (1 of 3 adapters)

- ✅ PostgreSQL adapter (1,700 LOC) - production-ready
- ❌ MySQL adapter - NOT implemented
- ❌ MongoDB adapter - NOT implemented

**Rules:**

- MUST implement `DatabaseAdapter` interface
- Each adapter in its own folder
- Query translator specific to database
- See `src/adapters/CLAUDE.md` for interface documentation

### Plugins Module (`src/plugins/`) - ✅ Implemented

**Purpose:** Optional features (auth, upload, hooks, soft-delete)
**Status:** 100% complete (all 4 core plugins)

- ✅ Auth plugin (800 LOC) - JWT, session, RBAC, custom crypto
- ✅ Upload plugin - Local + S3 providers (custom Signature V4)
- ✅ Hooks plugin - All lifecycle hooks
- ✅ Soft Delete plugin - Query interception

**Rules:**

- MUST implement `ForjaPlugin` interface
- Should be tree-shakeable
- No required dependencies on other plugins
- See `src/plugins/CLAUDE.md` for interface documentation

### API Module (`src/api/`) - ✅ Implemented

**Purpose:** HTTP request handling, query parsing, response serialization
**Status:** 100% complete (~2,500 LOC)

- ✅ Parser module - Strapi-style query parsing
- ✅ Handler module - Framework-agnostic CRUD
- ✅ Serializer module - JSON, relations

**Rules:**

- Framework agnostic (works with Next.js, Express, etc.)
- Type-safe request/response handling
- See `src/api/CLAUDE.md` for detailed instructions

### CLI Module (`src/cli/`) - ✅ Implemented

**Purpose:** Command-line tools (migrate, generate, dev)
**Status:** 100% complete

- ✅ migrate command (up, down, status, dry-run)
- ✅ generate command (schema, migration)
- ✅ dev command (watch mode)

**Rules:**

- User-friendly error messages
- Progress indicators for long operations
- See `src/cli/CLAUDE.md` for detailed instructions

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

### Test Structure

```typescript
import { describe, it, expect } from "vitest";

describe("FieldValidator", () => {
	describe("validateString", () => {
		it("should accept valid string", () => {
			const result = validateString("hello", { type: "string" });
			expect(result.success).toBe(true);
		});

		it("should reject non-string value", () => {
			const result = validateString(123, { type: "string" });
			expect(result.success).toBe(false);
		});
	});
});
```

### Coverage Requirements

- Core modules: 90%+ coverage (CURRENT: 0% - CRITICAL GAP)
- Adapters: 80%+ coverage (CURRENT: 0% - CRITICAL GAP)
- Plugins: 75%+ coverage (CURRENT: 0% - CRITICAL GAP)

**IMPORTANT:** Test suite is the #1 priority for v1.0 release. No production deployment without adequate test coverage.

---

## 📦 Dependency Management

### Philosophy

**Minimal dependencies preferred.** Only add dependencies when:

1. Implementation would be >500 LOC
2. Security-critical (e.g., crypto)
3. Database drivers (pg, mysql2, mongodb)
4. Build tools (tsup, typescript, vitest)

### Current Dependencies

**Runtime:**

- `pg` - PostgreSQL driver
- `mysql2` - MySQL/MariaDB driver
- `mongodb` - MongoDB driver

**Dev:**

- `typescript` - Type system
- `tsup` - Build tool
- `vitest` - Testing framework
- `eslint` - Linting

---

## 🔍 Code Review Checklist

Before committing code, verify:

- [ ] No `any` types used
- [ ] No `as` type assertions
- [ ] All functions have return types
- [ ] All parameters have types
- [ ] Follows Result<T, E> pattern for errors
- [ ] Module follows interface contracts
- [ ] Tests written and passing
- [ ] Documentation updated
- [ ] No console.log left in code

---

## 📚 Documentation Requirements

### Code Comments

````typescript
/**
 * Validates a field value against its schema definition
 *
 * @param value - The value to validate
 * @param field - Field definition from schema
 * @returns Result with either validated data or validation error
 *
 * @example
 * ```ts
 * const result = validateField('john@example.com', {
 *   type: 'string',
 *   pattern: /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/
 * });
 * ```
 */
function validateField(
	value: unknown,
	field: FieldDefinition,
): Result<unknown, ValidationError> {
	// Implementation
}
````

### Module Documentation

Each module folder should have:

1. `CLAUDE.md` - Instructions for AI assistants
2. Main file with JSDoc comments
3. Type definitions file with comments

---

## 🚀 Development Workflow

### Starting Development

```bash
# Install dependencies
pnpm install

# Type check
pnpm type-check

# Run tests in watch mode
pnpm test:watch

# Build
pnpm build
```

### Before Committing

```bash
# Type check
pnpm type-check

# Run all tests
pnpm test

# Lint code
pnpm lint
```

---

## 🎯 Performance Considerations

### Bundle Size

- Core package should be <50KB minified + gzipped
- Each plugin should be <10KB
- Tree-shakeable exports

### Runtime Performance

- Query building should be <1ms
- Validation should be <5ms for typical payloads
- Avoid unnecessary object cloning
- Use lazy initialization where appropriate

---

## 🔐 Security Guidelines

### Input Validation

- ALWAYS validate user input
- Use parameterized queries (prevent SQL injection)
- Sanitize file uploads
- Rate limiting for API endpoints

### Sensitive Data

- Never log passwords or tokens
- Use environment variables for secrets
- Hash passwords with PBKDF2 (100,000 iterations) - implemented in auth plugin
- Secure session storage (memory/redis)

---

## 📞 Getting Help

### Documentation

- Read TODO.md for project roadmap
- Check module-specific CLAUDE.md files
- Review type definitions in `types.ts` files

### Best Practices

1. Start with type definitions
2. Write tests before implementation (TDD)
3. Keep functions small and focused
4. Use Result pattern for error handling
5. Document complex logic

---

## 🎓 Learning Resources

### TypeScript Patterns

- **Generics**: For reusable, type-safe code
- **Discriminated Unions**: For type-safe state machines
- **Template Literal Types**: For dynamic string types
- **Conditional Types**: For type transformations

### Architectural Patterns

- **Result/Either Pattern**: Error handling without exceptions
- **Builder Pattern**: For complex object construction
- **Strategy Pattern**: For interchangeable algorithms
- **Plugin Architecture**: For extensibility

---

**Remember:** Type safety first, minimal dependencies, clear interfaces, comprehensive testing.
