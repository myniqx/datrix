# @forja/core

> Core functionality for Forja framework - schema system, validation engine, query builder, and migration system

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bundle Size](https://img.shields.io/badge/Bundle-<50KB-green.svg)]()

## Overview

`@forja/core` is the foundation of the Forja framework, providing database-agnostic tools for schema management, data validation, query building, and database migrations. It's designed with **zero external dependencies** (except types), full TypeScript type safety, and a Result pattern for error handling.

## Features

### 🎯 **Schema System**
- Define database schemas with full TypeScript type inference
- Central schema registry with metadata tracking
- Intelligent table name pluralization (User → users, Category → categories)
- Relation tracking and validation
- 9 field types: `string`, `number`, `boolean`, `date`, `json`, `enum`, `array`, `relation`, `file`

### ✅ **Validator**
- Custom validation engine (~800 LOC, zero dependencies)
- Field and schema validation with detailed error reporting
- Partial validation for updates
- Array and nested object support (max depth: 10)
- Custom validator functions

### 🔨 **Query Builder**
- Database-agnostic query construction
- Fluent API with method chaining
- 14+ operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$like`, `$ilike`, `$contains`, `$regex`, `$and`, `$or`, `$not`
- Relation loading with nested populate (max depth: 5)
- Pagination, sorting, field selection, grouping

### 🔄 **Migration System**
- Automatic schema diffing
- Migration generation with up/down operations
- Rollback support
- Migration history tracking
- Dry-run mode

### 🔌 **Plugin System**
- Extensible plugin architecture
- Lifecycle hooks: `init()`, `destroy()`, `onSchemaLoad()`
- Query hooks: `onBeforeQuery()`, `onAfterQuery()`

## Installation

```bash
# pnpm
pnpm add @forja/core

# yarn
yarn add @forja/core

# npm
npm install @forja/core
```

## Quick Start

### 1. Define a Schema

```typescript
import { SchemaRegistry } from '@forja/core';

const registry = new SchemaRegistry({
  strict: true,
  validateRelations: true
});

const userSchema = {
  name: 'User',
  fields: {
    email: {
      type: 'string',
      required: true,
      unique: true,
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    },
    name: {
      type: 'string',
      required: true,
      minLength: 2,
      maxLength: 100
    },
    age: {
      type: 'number',
      min: 18,
      max: 120
    },
    role: {
      type: 'enum',
      values: ['user', 'admin'],
      default: 'user'
    },
    posts: {
      type: 'relation',
      model: 'Post',
      kind: 'hasMany',
      foreignKey: 'authorId'
    }
  },
  indexes: [
    { fields: ['email'], unique: true }
  ],
  timestamps: true,
  softDelete: false
} as const;

const result = registry.register(userSchema);

if (result.success) {
  console.log('Schema registered!');

  // Get metadata
  const metadata = registry.getMetadata('User');
  console.log(metadata.tableName); // 'users'
  console.log(metadata.fieldCount); // 5
}
```

### 2. Validate Data

```typescript
import { validateSchema, validatePartial } from '@forja/core';

// Full validation
const userData = {
  email: 'user@example.com',
  name: 'John Doe',
  age: 25,
  role: 'user'
};

const result = validateSchema(userData, userSchema);

if (result.success) {
  console.log('Valid data:', result.data);
} else {
  console.error('Validation errors:', result.error);
  // [
  //   { field: 'email', code: 'PATTERN', message: 'Invalid email format' }
  // ]
}

// Partial validation (for updates)
const updateData = { age: 26 };
const partialResult = validatePartial(updateData, userSchema);
```

### 3. Build Queries

```typescript
import { selectFrom, insertInto, updateTable, deleteFrom } from '@forja/core';

// SELECT with filters and pagination
const selectQuery = selectFrom('users')
  .select(['id', 'email', 'name'])
  .where({
    role: 'admin',
    age: { $gte: 18 }
  })
  .orderBy('createdAt', 'desc')
  .limit(25)
  .offset(0)
  .build();

if (selectQuery.success) {
  console.log(selectQuery.data);
  // {
  //   type: 'select',
  //   table: 'users',
  //   select: ['id', 'email', 'name'],
  //   where: { role: 'admin', age: { $gte: 18 } },
  //   orderBy: [{ field: 'createdAt', direction: 'desc' }],
  //   limit: 25,
  //   offset: 0
  // }
}

// INSERT
const insertQuery = insertInto('users', {
  email: 'new@example.com',
  name: 'Jane Doe',
  age: 30,
  role: 'user'
})
  .returning(['id', 'email'])
  .build();

// UPDATE
const updateQuery = updateTable('users', { age: 31 })
  .where({ email: 'new@example.com' })
  .returning('*')
  .build();

// DELETE
const deleteQuery = deleteFrom('users')
  .where({ id: '123' })
  .build();
```

### 4. Complex Queries with Relations

```typescript
import { selectFrom } from '@forja/core';

const query = selectFrom('posts')
  .select(['id', 'title', 'content'])
  .where({
    status: 'published',
    createdAt: { $gte: new Date('2024-01-01') }
  })
  .populate({
    author: {
      select: ['id', 'name', 'email']
    },
    comments: {
      select: ['id', 'content', 'createdAt'],
      where: { approved: true },
      limit: 10,
      orderBy: [{ field: 'createdAt', direction: 'desc' }]
    }
  })
  .orderBy('publishedAt', 'desc')
  .limit(20)
  .build();
```

### 5. WHERE Clause Operators

```typescript
// Comparison operators
const where1 = {
  age: { $gte: 18, $lte: 65 },
  status: { $in: ['active', 'pending'] }
};

// Logical operators
const where2 = {
  $or: [
    { role: 'admin' },
    { role: 'moderator' }
  ]
};

// String matching
const where3 = {
  email: { $like: '%@example.com' },
  name: { $ilike: '%john%' }
};

// Complex nested conditions
const where4 = {
  $and: [
    { status: 'active' },
    {
      $or: [
        { age: { $gte: 18 } },
        { verified: true }
      ]
    }
  ]
};

// Helper functions
import { createAndCondition, createOrCondition } from '@forja/core';

const where5 = createAndCondition(
  { status: 'active' },
  createOrCondition(
    { role: 'admin' },
    { role: 'moderator' }
  )
);
```

### 6. Migrations

```typescript
import {
  createSchemaDiffer,
  createMigrationGenerator,
  createMigrationHistory,
  createMigrationRunner
} from '@forja/core';

// Compare old and new schemas
const differ = createSchemaDiffer();
const comparison = differ.compare(oldSchemas, newSchemas);

if (comparison.success && comparison.data.hasChanges) {
  // Generate migration
  const generator = createMigrationGenerator();
  const migration = generator.generate(
    comparison.data.differences,
    {
      name: 'add_users_table',
      version: '20260109_001'
    }
  );

  if (migration.success) {
    // Setup migration runner
    const history = createMigrationHistory(adapter);
    const runner = createMigrationRunner(
      adapter,
      history,
      [migration.data]
    );

    // Run migrations
    const result = await runner.runPending();

    if (result.success) {
      console.log('Migrations applied:', result.data);
    }
  }
}
```

## Core Concepts

### Result Pattern

All functions return a `Result<T, E>` type instead of throwing exceptions:

```typescript
type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

// Usage
const result = validateSchema(data, schema);

if (result.success) {
  // TypeScript knows result.data is available
  console.log(result.data);
} else {
  // TypeScript knows result.error is available
  console.error(result.error);
}
```

### Field Types

The core supports 9 field types:

```typescript
// String
{
  type: 'string',
  minLength: 2,
  maxLength: 100,
  pattern: /^[a-z]+$/,
  unique: true
}

// Number
{
  type: 'number',
  min: 0,
  max: 100,
  integer: true
}

// Boolean
{
  type: 'boolean',
  default: false
}

// Date
{
  type: 'date',
  min: new Date('2024-01-01'),
  max: new Date('2024-12-31')
}

// JSON
{
  type: 'json',
  default: {}
}

// Enum
{
  type: 'enum',
  values: ['draft', 'published'],
  default: 'draft'
}

// Array
{
  type: 'array',
  items: { type: 'string' },
  minItems: 1,
  maxItems: 10,
  unique: true
}

// Relation
{
  type: 'relation',
  model: 'Post',
  kind: 'hasMany',
  foreignKey: 'authorId'
}

// File
{
  type: 'file',
  allowedTypes: ['image/jpeg', 'image/png'],
  maxSize: 5 * 1024 * 1024
}
```

### Query Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$eq` | Equal | `{ age: { $eq: 25 } }` |
| `$ne` | Not equal | `{ status: { $ne: 'deleted' } }` |
| `$gt` | Greater than | `{ age: { $gt: 18 } }` |
| `$gte` | Greater than or equal | `{ age: { $gte: 18 } }` |
| `$lt` | Less than | `{ age: { $lt: 65 } }` |
| `$lte` | Less than or equal | `{ age: { $lte: 65 } }` |
| `$in` | In array | `{ role: { $in: ['admin', 'user'] } }` |
| `$nin` | Not in array | `{ status: { $nin: ['deleted'] } }` |
| `$like` | SQL LIKE (case-sensitive) | `{ email: { $like: '%@example.com' } }` |
| `$ilike` | SQL ILIKE (case-insensitive) | `{ name: { $ilike: '%john%' } }` |
| `$contains` | Contains string | `{ text: { $contains: 'hello' } }` |
| `$icontains` | Contains (case-insensitive) | `{ text: { $icontains: 'hello' } }` |
| `$regex` | Regular expression | `{ email: { $regex: '^[a-z]+@' } }` |
| `$and` | Logical AND | `{ $and: [{...}, {...}] }` |
| `$or` | Logical OR | `{ $or: [{...}, {...}] }` |
| `$not` | Logical NOT | `{ $not: {...} }` |
| `$exists` | Field exists | `{ deletedAt: { $exists: false } }` |
| `$null` | Field is null | `{ deletedAt: { $null: true } }` |

### Pagination

```typescript
import { calculatePagination, DEFAULT_PAGINATION_CONFIG } from '@forja/core';

// Page-based pagination
const params = calculatePagination(2, 25);
// { page: 2, pageSize: 25, limit: 25, offset: 25 }

// Limit/offset pagination
const params2 = calculatePaginationFromLimitOffset(25, 50);
// { page: 3, pageSize: 25, limit: 25, offset: 50 }

// Configuration
const config = {
  defaultPageSize: 25,
  maxPageSize: 100,
  defaultPage: 1
};
```

## API Reference

### Schema Module

**Classes:**
- `SchemaRegistry` - Central schema registry

**Functions:**
- `inferFieldType()` - Get field type name
- `isRelationField()` - Type guard for relations
- `getRequiredFields()` - Get all required field names
- `getRelationFields()` - Get all relation fields
- `hasTimestamps()` - Check if schema has timestamps
- `extractFieldMetadata()` - Extract field metadata
- `generateTypeScriptInterface()` - Generate TS interface

### Validator Module

**Functions:**
- `validateField()` - Validate a single field
- `validateSchema()` - Validate entire object
- `validatePartial()` - Validate partial object (updates)
- `validateMany()` - Validate array of objects
- `isValid()` - Boolean check
- `validateOrThrow()` - Throw on error
- `createValidationError()` - Create error object

**Classes:**
- `ValidationErrorCollection` - Manage validation errors

### Query Builder Module

**Classes:**
- `ForjaQueryBuilder` - Main query builder

**Factory Functions:**
- `selectFrom()` - Create SELECT query
- `insertInto()` - Create INSERT query
- `updateTable()` - Create UPDATE query
- `deleteFrom()` - Create DELETE query
- `countFrom()` - Create COUNT query

**WHERE Utilities:**
- `mergeWhereClauses()` - Merge multiple WHERE clauses
- `createEqualityCondition()` - Create equality check
- `createComparisonCondition()` - Create comparison
- `createInCondition()` - Create IN condition
- `createAndCondition()` - Create AND condition
- `createOrCondition()` - Create OR condition

**SELECT Utilities:**
- `normalizeSelectClause()` - Normalize select fields
- `expandSelectClause()` - Expand to full field list
- `isFieldSelected()` - Check if field is selected

**Populate Utilities:**
- `mergePopulateClauses()` - Merge populate clauses
- `createSimplePopulate()` - Create simple populate
- `createNestedPopulate()` - Create nested populate

**Pagination Utilities:**
- `calculatePagination()` - Calculate page params
- `createPaginationMeta()` - Create pagination metadata

### Migration Module

**Classes:**
- `ForgeSchemaDiffer` - Compare schemas
- `ForgeMigrationGenerator` - Generate migrations
- `ForgeMigrationHistory` - Track migration history
- `ForgeMigrationRunner` - Run migrations

**Factory Functions:**
- `createSchemaDiffer()` - Create differ instance
- `createMigrationGenerator()` - Create generator instance
- `createMigrationHistory()` - Create history tracker
- `createMigrationRunner()` - Create runner instance

### Plugin Module

**Classes:**
- `BasePlugin` - Abstract base class for plugins
- `Dispatcher` - Hook dispatcher

## Configuration

### SchemaRegistry Configuration

```typescript
interface SchemaRegistryConfig {
  strict?: boolean;              // Default: true
  allowOverwrite?: boolean;      // Default: false
  validateRelations?: boolean;   // Default: true
}
```

### Validator Options

```typescript
interface ValidatorOptions {
  strict?: boolean;         // Default: true - Reject unknown fields
  stripUnknown?: boolean;   // Default: false - Remove unknown fields
  abortEarly?: boolean;     // Default: false - Stop on first error
}
```

### Pagination Configuration

```typescript
interface PaginationConfig {
  defaultPageSize: number;  // Default: 25
  maxPageSize: number;      // Default: 100
  defaultPage: number;      // Default: 1
}
```

### Constraints

```typescript
// Maximum nesting depths
MAX_WHERE_DEPTH = 10
MAX_POPULATE_DEPTH = 5
MAX_VALIDATION_DEPTH = 10
```

## Performance

- **Query Building:** <1ms for complex queries
- **Validation:** <5ms for typical payloads
- **Bundle Size:** <50KB minified + gzipped
- **Tree-shakeable:** Only import what you use

## Dependencies

**Runtime:**
- `forja-types` (workspace package) - Type definitions only

**Development:**
- `typescript` - Type system
- `tsup` - Build tool
- `vitest` - Testing framework

**Zero external runtime dependencies.**

## Type Safety

All exports are fully typed with TypeScript:

```typescript
import type {
  SchemaDefinition,
  FieldDefinition,
  QueryObject,
  WhereClause,
  PopulateClause,
  ValidationError,
  Result
} from 'forja-types';
```

## Advanced Usage

### Custom Validators

```typescript
import { validateField } from '@forja/core';

const customField = {
  type: 'string',
  validate: (value: unknown) => {
    if (typeof value !== 'string') {
      return { success: false, error: 'Must be string' };
    }
    if (!value.startsWith('CUSTOM_')) {
      return { success: false, error: 'Must start with CUSTOM_' };
    }
    return { success: true, data: value };
  }
};

const result = validateField('CUSTOM_123', customField, 'customField');
```

### Query Builder Cloning

```typescript
const baseQuery = selectFrom('users')
  .select(['id', 'email'])
  .where({ status: 'active' });

// Clone and extend
const adminQuery = baseQuery.clone()
  .andWhere({ role: 'admin' });

const userQuery = baseQuery.clone()
  .andWhere({ role: 'user' });
```

### Error Handling

```typescript
import { ValidationErrorCollection } from '@forja/core';

const result = validateSchema(data, schema);

if (!result.success) {
  const errors = new ValidationErrorCollection(result.error);

  // Group by field
  const byField = errors.groupByField();
  console.log(byField.email); // All email errors

  // Get first error per field
  const firstErrors = errors.getFirstPerField();

  // Format as string
  console.log(errors.toString());

  // Format as JSON
  console.log(errors.toJSON());
}
```

## Examples

See the [HOW_TO_USE.md](./HOW_TO_USE.md) file for comprehensive examples and detailed documentation of every parameter and feature.

## License

MIT © [Forja Contributors](https://github.com/myniqx/forja/graphs/contributors)

## Related Packages

- `@forja/types` - TypeScript type definitions
- `@forja/adapters` - Database adapters (PostgreSQL, MySQL, MongoDB)
- `@forja/api` - REST API layer
- `@forja/plugins` - Plugins (auth, upload, hooks, soft-delete)
- `@forja/cli` - Command-line tools

## Support

For questions and support:
- [GitHub Issues](https://github.com/myniqx/forja/issues)
- [Documentation](https://github.com/myniqx/forja)

---

**Made with ❤️ by the Forja team**
