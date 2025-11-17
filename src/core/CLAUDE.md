# Core Module - Development Guidelines

## 📖 Module Overview

The Core module contains the fundamental building blocks of Forja:
- **Schema**: Type definitions, schema registry, type inference
- **Validator**: Field and schema validation engine (~300 LOC)
- **Query Builder**: Database-agnostic query construction
- **Migration**: Auto-migration system, schema diffing
- **Config**: Configuration loading and validation

**Critical Rule:** This module MUST have ZERO external runtime dependencies (except TypeScript for development).

---

## 🎯 Module Responsibilities

### Schema System (`src/core/schema/`)

**Purpose:** Define and manage database schemas with full TypeScript type inference

**Files:**
- `types.ts` - Schema type definitions
- `inference.ts` - Type inference utilities
- `registry.ts` - Global schema registry
- `builder.ts` - Schema builder helper functions

**Key Requirements:**
```typescript
// User defines schema like this
const userSchema = defineSchema({
  name: 'User',
  fields: {
    email: { type: 'string', required: true, unique: true },
    age: { type: 'number', min: 18 }
  }
} as const);

// Type should be automatically inferred
type User = InferSchemaType<typeof userSchema>;
// Result: { email: string; age?: number }
```

**Type Inference Must Support:**
- Required vs optional fields
- Enum literal types
- Relation types
- Array types
- Nested objects
- Default values

---

### Validator System (`src/core/validator/`)

**Purpose:** Custom validation engine (~300 LOC total, NO external dependencies)

**Files:**
- `types.ts` - Validation type definitions
- `field-validator.ts` - Individual field validation (~150 LOC)
- `schema-validator.ts` - Full object validation (~150 LOC)
- `errors.ts` - Validation error classes

**Validation Rules to Support:**

```typescript
// String validation
type StringField = {
  type: 'string';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  validator?: (value: string) => true | string; // true or error message
};

// Number validation
type NumberField = {
  type: 'number';
  required?: boolean;
  min?: number;
  max?: number;
  integer?: boolean;
};

// Enum validation
type EnumField = {
  type: 'enum';
  values: readonly string[];
  required?: boolean;
};

// Date validation
type DateField = {
  type: 'date';
  required?: boolean;
  min?: Date;
  max?: Date;
};

// Array validation
type ArrayField = {
  type: 'array';
  items: FieldDefinition;
  minItems?: number;
  maxItems?: number;
};
```

**Validation Result Pattern:**
```typescript
type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: ValidationError[] };

type ValidationError = {
  field: string;
  message: string;
  code: 'REQUIRED' | 'TYPE_MISMATCH' | 'MIN_LENGTH' | 'MAX_LENGTH' | 'PATTERN' | 'CUSTOM';
};
```

**Implementation Strategy:**
1. Create simple type guards (isString, isNumber, isDate, etc.)
2. Validate one field at a time
3. Accumulate errors
4. Return Result<T, ValidationError[]>

**Example Implementation Structure:**
```typescript
// field-validator.ts
export function validateField(
  value: unknown,
  field: FieldDefinition,
  fieldName: string
): ValidationResult<unknown> {
  // 1. Check required
  if (field.required && (value === null || value === undefined)) {
    return {
      success: false,
      errors: [{ field: fieldName, message: 'Field is required', code: 'REQUIRED' }]
    };
  }

  // 2. Type check
  if (field.type === 'string' && typeof value !== 'string') {
    return {
      success: false,
      errors: [{ field: fieldName, message: 'Must be a string', code: 'TYPE_MISMATCH' }]
    };
  }

  // 3. Specific validations based on type
  // ... minLength, maxLength, pattern, etc.

  return { success: true, data: value };
}
```

---

### Query Builder (`src/core/query-builder/`)

**Purpose:** Build database-agnostic query objects (NOT SQL strings - that's adapter's job)

**Files:**
- `types.ts` - Query object type definitions
- `builder.ts` - Main query builder
- `where.ts` - WHERE clause builder
- `select.ts` - Field selection builder
- `populate.ts` - Relation/JOIN builder
- `pagination.ts` - Pagination builder

**Query Object Structure:**
```typescript
type QueryObject = {
  type: 'select' | 'insert' | 'update' | 'delete';
  table: string;
  select?: SelectClause;
  where?: WhereClause;
  populate?: PopulateClause;
  orderBy?: OrderByClause;
  limit?: number;
  offset?: number;
  data?: Record<string, unknown>; // for insert/update
};

type WhereClause = {
  [field: string]:
    | Primitive
    | { $eq?: Primitive; $ne?: Primitive; $gt?: number; $gte?: number; $lt?: number; $lte?: number; $in?: Primitive[]; $nin?: Primitive[] }
    | { $and?: WhereClause[]; $or?: WhereClause[] };
};

type SelectClause = readonly string[] | '*';

type PopulateClause = {
  [relation: string]: {
    select?: SelectClause;
    where?: WhereClause;
    populate?: PopulateClause; // nested populate
  };
};
```

**Builder API:**
```typescript
const query = queryBuilder('users')
  .select(['id', 'email', 'name'])
  .where({ role: 'admin', age: { $gte: 18 } })
  .populate({ posts: { select: ['title', 'createdAt'] } })
  .limit(25)
  .offset(0)
  .build();
```

**Type Safety:**
```typescript
// Query builder should be type-safe based on schema
const userQuery = queryBuilder<UserSchema>('users')
  .select(['email', 'name']) // ✅ OK
  .select(['invalidField']) // ❌ TypeScript error
  .where({ email: 'test@example.com' }) // ✅ OK
  .where({ email: 123 }) // ❌ TypeScript error
```

---

### Migration System (`src/core/migration/`)

**Purpose:** Automatically generate and run migrations based on schema changes

**Files:**
- `types.ts` - Migration type definitions
- `generator.ts` - Generate migrations from schemas
- `differ.ts` - Detect schema changes
- `runner.ts` - Execute migrations
- `history.ts` - Track migration history

**Migration Workflow:**
1. Load current schemas from config
2. Compare with previous version (from migration history)
3. Generate diff (added tables/fields, removed, modified)
4. Create migration object
5. Pass to adapter for execution
6. Record in migration history

**Migration Object:**
```typescript
type Migration = {
  id: string; // timestamp-based
  name: string;
  operations: MigrationOperation[];
  timestamp: Date;
};

type MigrationOperation =
  | { type: 'createTable'; table: string; schema: SchemaDefinition }
  | { type: 'dropTable'; table: string }
  | { type: 'addColumn'; table: string; column: FieldDefinition }
  | { type: 'dropColumn'; table: string; column: string }
  | { type: 'modifyColumn'; table: string; column: string; changes: Partial<FieldDefinition> }
  | { type: 'addIndex'; table: string; index: IndexDefinition }
  | { type: 'dropIndex'; table: string; index: string };
```

**Schema Differ Algorithm:**
```typescript
function diffSchemas(
  oldSchemas: SchemaRegistry,
  newSchemas: SchemaRegistry
): MigrationOperation[] {
  const operations: MigrationOperation[] = [];

  // 1. Find new tables
  // 2. Find removed tables
  // 3. For existing tables, compare fields
  // 4. Find new fields
  // 5. Find removed fields
  // 6. Find modified fields (type, constraints)
  // 7. Compare indexes

  return operations;
}
```

---

### Config System (`src/core/config/`)

**Purpose:** Load and validate forja.config.ts

**Files:**
- `types.ts` - Config type definitions
- `loader.ts` - Load config file
- `validator.ts` - Validate config

**Config Type:**
```typescript
type ForjaConfig = {
  database: {
    adapter: 'postgres' | 'mysql' | 'mongodb';
    connection: Record<string, unknown>; // adapter-specific
  };

  schemas: {
    path: string; // glob pattern
  };

  plugins?: Array<string | { name: string; options: Record<string, unknown> }>;

  api?: {
    prefix?: string;
    defaultPageSize?: number;
    maxPageSize?: number;
  };

  migration?: {
    auto?: boolean; // auto-run migrations on start
    directory?: string;
  };
};
```

**Config Loader:**
```typescript
async function loadConfig(
  configPath: string = './forja.config.ts'
): Promise<Result<ForjaConfig, ConfigError>> {
  // 1. Check if file exists
  // 2. Import config file (handle ESM/CJS)
  // 3. Validate config structure
  // 4. Return validated config
}
```

---

## 🎨 Type Design Guidelines

### Use Discriminated Unions
```typescript
type Field =
  | { type: 'string'; minLength?: number; maxLength?: number; pattern?: RegExp }
  | { type: 'number'; min?: number; max?: number; integer?: boolean }
  | { type: 'boolean' }
  | { type: 'date'; min?: Date; max?: Date }
  | { type: 'enum'; values: readonly string[] }
  | { type: 'array'; items: Field }
  | { type: 'relation'; model: string; kind: 'hasOne' | 'hasMany' | 'belongsTo' | 'manyToMany' };
```

### Use Template Literal Types
```typescript
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type RoutePattern = `/${string}`; // Must start with /
```

### Use Conditional Types for Inference
```typescript
type InferFieldType<F extends Field> =
  F extends { type: 'string' } ? string :
  F extends { type: 'number' } ? number :
  F extends { type: 'boolean' } ? boolean :
  F extends { type: 'date' } ? Date :
  F extends { type: 'enum'; values: readonly (infer U)[] } ? U :
  F extends { type: 'array'; items: infer I extends Field } ? Array<InferFieldType<I>> :
  never;
```

---

## ✅ Testing Requirements

### Unit Tests Required For:
- Each field validator function
- Schema inference utilities
- Query builder methods
- Migration differ algorithm
- Config validator

### Test Coverage Goals:
- Validator: 95%+ (critical path)
- Schema system: 90%+
- Query builder: 90%+
- Migration: 85%+
- Config: 85%+

### Example Test:
```typescript
import { describe, it, expect } from 'vitest';
import { validateField } from './field-validator';

describe('validateField', () => {
  describe('string validation', () => {
    it('should accept valid string', () => {
      const result = validateField('hello', { type: 'string' }, 'name');
      expect(result.success).toBe(true);
    });

    it('should enforce minLength', () => {
      const result = validateField('ab', { type: 'string', minLength: 3 }, 'name');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0]?.code).toBe('MIN_LENGTH');
      }
    });
  });
});
```

---

## 🚀 Implementation Priority

1. **Phase 1:** Type definitions (all `types.ts` files)
2. **Phase 2:** Schema system (registry, inference)
3. **Phase 3:** Validator (~300 LOC)
4. **Phase 4:** Query builder
5. **Phase 5:** Config loader
6. **Phase 6:** Migration system

---

## 📚 Key Principles

1. **Zero Runtime Dependencies** - Everything custom-built
2. **Type Inference First** - Derive types from schemas
3. **Functional Approach** - Pure functions, immutable data
4. **Result Pattern** - No throwing errors
5. **Test Coverage** - 90%+ for core functionality

**Remember:** The core module is the foundation. It must be rock-solid, type-safe, and performant.
