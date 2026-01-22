# Forja Error System - Development Guidelines

## 🎯 Philosophy

**Standardized, informative, and actionable errors across the entire framework.**

All errors in Forja follow a consistent pattern:
- ✅ **Type-safe** - Strong typing, no `any`
- ✅ **Informative** - Clear messages with context
- ✅ **Actionable** - Suggestions for how to fix
- ✅ **Traceable** - Cause chaining for error propagation
- ✅ **Serializable** - Clean JSON output for API responses

---

## 📐 Error Architecture

### Base Error Class: `ForjaError`

**File:** `forja-error.ts`

All Forja errors extend from `ForjaError`, which extends native JavaScript `Error`.

```typescript
import { ForjaError } from 'forja-types/errors';

throw new ForjaError('Database connection failed', {
  code: 'CONNECTION_FAILED',
  operation: 'database:connect',
  context: { host: 'localhost', port: 5432 },
  cause: originalError,
  suggestion: 'Check your database credentials and connection string',
  expected: 'successful connection',
  received: 'connection timeout',
});
```

**Key Features:**
- `code` - Machine-readable error code (required)
- `operation` - What was being attempted (optional)
- `context` - Additional details for debugging (optional)
- `cause` - Original error for chaining (optional)
- `suggestion` - User guidance (optional)
- `expected` - What was expected (optional)
- `received` - What was actually received (optional)
- `documentation` - Link to docs (optional)

---

## 🏗️ When to Create Specialized Error Classes

### ✅ Create Specialized Error Class When:

1. **Multiple errors in a module** (3+ different error scenarios)
2. **Additional fields needed** (beyond base ForjaError)
3. **Client-facing errors** (API, Parser, Validation)
4. **Complex context** (module-specific metadata)

### ❌ Use ForjaError Directly When:

1. **One-off errors** (utility functions, rare edge cases)
2. **No special fields needed** (base context is enough)
3. **Internal errors** (not exposed to end users)

---

## 📦 Existing Specialized Error Classes

### 1. **ParserError** (`api/parser.ts`)

**Purpose:** Query/URL parsing failures
**Module:** `packages/api`

**Additional Fields:**
- `parser: ParserType` - Which parser failed (where, populate, fields, etc.)
- `location: ErrorLocation` - Path tracking with parts, depth, index

**Error Codes:**
```typescript
type ParserErrorCode =
  | "INVALID_SYNTAX"
  | "INVALID_OPERATOR"
  | "INVALID_VALUE_TYPE"
  | "INVALID_VALUE_FORMAT"
  | "INVALID_FIELD_NAME"
  | "INVALID_PATH"
  | "MAX_DEPTH_EXCEEDED"
  | "MAX_LENGTH_EXCEEDED"
  | "MAX_SIZE_EXCEEDED"
  | "MIN_VALUE_VIOLATION"
  | "MAX_VALUE_VIOLATION"
  | "MISSING_REQUIRED"
  | "EMPTY_VALUE"
  | "ARRAY_INDEX_ERROR"
  | "CONSECUTIVE_INDEX_ERROR"
  | "UNKNOWN_PARAMETER"
  | "DUPLICATE_FIELD"
  | "INVALID_PAGINATION"
  | "PAGE_OUT_OF_RANGE"
  | "PARSER_INTERNAL_ERROR";
```

**Context Types:**
```typescript
WhereErrorContext | PopulateErrorContext | FieldsErrorContext |
PaginationErrorContext | SortErrorContext
```

**Example:**
```typescript
throw new ParserError('Invalid operator in where clause', {
  code: 'INVALID_OPERATOR',
  parser: 'where',
  location: buildErrorLocation(['filters', 'age', '$invalid']),
  context: {
    operator: '$invalid',
    validOperators: ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte']
  },
  suggestion: 'Use one of: $eq, $ne, $gt, $gte, $lt, $lte',
  received: '$invalid',
});
```

---

### 2. **ForjaValidationError** (`core/validation.ts`)

**Purpose:** Schema validation failures
**Module:** `packages/core/validator`

**Additional Fields:**
- `model: string` - Schema/model name
- `errors: ValidationError[]` - Array of field-level errors

**Error Codes:**
```typescript
type ValidationErrorCode =
  | "REQUIRED"
  | "TYPE_MISMATCH"
  | "MIN_LENGTH"
  | "MAX_LENGTH"
  | "MIN_VALUE"
  | "MAX_VALUE"
  | "MIN_ITEMS"
  | "MAX_ITEMS"
  | "PATTERN"
  | "UNIQUE"
  | "INVALID_ENUM"
  | "INVALID_FORMAT"
  | "INVALID_DATE"
  | "CUSTOM"
  | "UNKNOWN";
```

**Example:**
```typescript
throw new ForjaValidationError('Validation failed for User', {
  model: 'User',
  errors: [
    { field: 'email', code: 'REQUIRED', message: 'Email is required' },
    { field: 'age', code: 'MIN_VALUE', message: 'Age must be at least 18' }
  ],
  suggestion: 'Fix the validation errors listed above',
});
```

---

### 3. **ForgaCrudError** (`core/crud.ts`)

**Purpose:** Database CRUD operation failures
**Module:** `packages/core/mixins`

**Additional Fields:**
- `operation: CrudOperation` - CRUD operation type
- `model: string` - Schema/model name

**Error Codes:**
```typescript
type CrudErrorCode =
  | "QUERY_EXECUTION_FAILED"
  | "SCHEMA_NOT_FOUND"
  | "RECORD_NOT_FOUND"
  | "INVALID_POPULATE_VALUE"
  | "RESERVED_FIELD_WRITE"
  | "NOT_IMPLEMENTED"
  | "QUERY_FAILED";
```

**Context:**
```typescript
interface CrudErrorContext {
  model?: string;
  query?: QueryObject;
  recordId?: string | number;
  where?: WhereClause;
  adapterError?: string; // Adapter error message
}
```

**Example:**
```typescript
throw new ForgaCrudError('Query execution failed', {
  code: 'QUERY_EXECUTION_FAILED',
  operation: 'findOne',
  model: 'User',
  context: {
    query: { type: 'select', table: 'users', where: { id: 123 } },
    adapterError: 'Connection timeout'
  },
  cause: adapterError, // Original error from adapter
});
```

---

### 4. **ForjaConfigError** (`core/config.ts`)

**Purpose:** Configuration validation failures
**Module:** `packages/core/config`

**Additional Fields:**
- `field?: string` - Config field that failed

**Error Codes:**
```typescript
type ConfigErrorCode =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_INVALID_TYPE"
  | "CONFIG_REQUIRED_FIELD"
  | "CONFIG_INVALID_VALUE"
  | "CONFIG_EMPTY_VALUE"
  | "CONFIG_VALIDATION_FAILED"
  | "CONFIG_MULTIPLE_ERRORS";
```

**Special Class:**
```typescript
class ForjaConfigValidationError extends ForjaConfigError {
  readonly errors: readonly string[];
}
```

**Example:**
```typescript
throw new ForjaConfigError('Config.adapter has incorrect type', {
  code: 'CONFIG_INVALID_TYPE',
  field: 'adapter',
  context: { receivedType: 'null', expectedType: 'DatabaseAdapter' },
  suggestion: 'Ensure Config.adapter is a valid DatabaseAdapter instance',
  expected: 'DatabaseAdapter',
  received: null,
});
```

---

## 🛠️ Helper Functions Pattern

**Every specialized error class MUST have helper functions.**

### Helper Function Naming Convention

```typescript
// Pattern: throw{Module}{ErrorType}
throwValidationRequired(model, field)
throwCrudQueryFailed(operation, model, query, cause)
throwConfigRequired(field)
throwParserInvalidOperator(parser, operator, location)
```

### Helper Function Requirements

1. **One-line usage** - No boilerplate
2. **Automatic context** - Build context inside helper
3. **Built-in suggestions** - Every helper provides user guidance
4. **Type-safe** - Strong typing for all parameters
5. **Consistent naming** - Follow `throw{Module}{ErrorType}` pattern

### Example Helper Implementation

**File:** `packages/core/src/mixins/error-helper.ts`

```typescript
import { ForgaCrudError, type CrudOperation } from 'forja-types/errors';
import type { QueryObject } from 'forja-types/core/query-builder';

/**
 * Throw query execution error
 *
 * @param operation - CRUD operation
 * @param model - Model name
 * @param query - Query object
 * @param cause - Original adapter error
 */
export function throwQueryExecutionError(
  operation: CrudOperation,
  model: string,
  query: QueryObject,
  cause: Error,
): never {
  throw new ForgaCrudError('Query execution failed', {
    code: 'QUERY_EXECUTION_FAILED',
    operation,
    model,
    context: {
      query: {
        type: query.type,
        table: query.table,
        ...(query.where && { where: query.where }),
      },
      adapterError: cause.message,
    },
    cause, // ⚠️ IMPORTANT: Always chain the original error
  });
}
```

---

## 🔗 Error Chaining with `cause`

### When to Use `cause`

**Always use `cause` when wrapping lower-level errors:**

```typescript
// ✅ CORRECT - Adapter error is preserved
const result = await this.adapter.executeQuery(query);
if (!result.success) {
  throw new ForgaCrudError('Query failed', {
    code: 'QUERY_EXECUTION_FAILED',
    cause: result.error, // ← Original error preserved
  });
}

// ❌ WRONG - Original error information lost
const result = await this.adapter.executeQuery(query);
if (!result.success) {
  throw new ForgaCrudError('Query failed', {
    code: 'QUERY_EXECUTION_FAILED',
    // Missing cause - can't trace root issue
  });
}
```

### Cause Chain Benefits

1. **Full stack trace** - See entire error chain
2. **Root cause analysis** - Debug from bottom up
3. **No information loss** - All error details preserved
4. **Automatic serialization** - `toJSON()` includes cause

**Example Error Chain:**
```
ForgaCrudError: Query execution failed
  at throwQueryExecutionError (crud.ts:120)
  Operation: findOne
  Model: User
  Caused by: PostgresError: Connection timeout
    at PostgresAdapter.connect (adapter.ts:45)
    Host: localhost
    Port: 5432
```

---

## 📝 Documentation Standards

### Error Class Documentation

```typescript
/**
 * Forja Config Error Class
 *
 * Specialized ForjaError for configuration validation failures.
 * Includes field name for identifying which config property failed.
 *
 * @example
 * ```ts
 * throw new ForjaConfigError('Config.adapter is required', {
 *   code: 'CONFIG_REQUIRED_FIELD',
 *   field: 'adapter',
 *   suggestion: 'Add the "adapter" property to your config',
 * });
 * ```
 */
export class ForjaConfigError extends ForjaError<ConfigErrorContext> {
  // ...
}
```

### Helper Function Documentation

```typescript
/**
 * Throw config required field error
 *
 * @param field - Config field name
 *
 * @example
 * ```ts
 * throwConfigRequired('adapter');
 * ```
 */
export function throwConfigRequired(field: string): never {
  throw new ForjaConfigError(`Config must have "${field}" property`, {
    code: 'CONFIG_REQUIRED_FIELD',
    field,
    suggestion: `Add the "${field}" property to your config`,
    expected: `Config.${field}`,
  });
}
```

---

## 🎨 Error Message Guidelines

### Message Format

```typescript
// Pattern: "<What failed>: <Why it failed>"
"Invalid operator in where clause: $invalid"
"Config.adapter has incorrect type. Expected DatabaseAdapter, got null"
"Validation failed for User: email is required, age must be at least 18"

// ✅ GOOD - Clear, specific, actionable
"Field 'email' is required"
"Config.schemas must be an array"
"Query execution failed for User"

// ❌ BAD - Vague, unhelpful
"Error occurred"
"Invalid input"
"Something went wrong"
```

### Suggestion Guidelines

```typescript
// ✅ GOOD - Tells user exactly what to do
suggestion: "Add the 'adapter' property to your config"
suggestion: "Use one of: $eq, $ne, $gt, $gte, $lt, $lte"
suggestion: "Provide a value for the 'email' field"

// ❌ BAD - Too generic
suggestion: "Fix the error"
suggestion: "Check your config"
suggestion: "Try again"
```

---

## 📂 File Organization

```
packages/types/src/errors/
├── forja-error.ts           # Base ForjaError class
├── index.ts                 # Export all errors
├── api/
│   └── parser.ts            # ParserError + types
├── core/
│   ├── config.ts            # ForjaConfigError
│   ├── crud.ts              # ForgaCrudError
│   └── validation.ts        # ForjaValidationError
└── CLAUDE.md                # This file
```

```
packages/{module}/src/
├── {feature}/
│   ├── error-helper.ts      # Module-specific error helpers
│   └── index.ts             # Export helpers
```

**Example Import Paths:**

```typescript
// Types (error classes)
import {
  ForjaError,
  ParserError,
  ForjaValidationError,
  ForgaCrudError,
  ForjaConfigError,
} from 'forja-types/errors';

// Helpers
import { throwQueryExecutionError } from './error-helper';
import { throwValidationRequired } from '../validator/errors';
import { throwConfigRequired } from './config/error-helper';
```

---

## ✅ Checklist for Creating New Error Types

When creating a new specialized error class:

- [ ] **Extends ForjaError** - Never extend native `Error` directly
- [ ] **Type-safe error codes** - Use string literal union types
- [ ] **Context interface** - Define `{Module}ErrorContext` type
- [ ] **Additional fields** - Document what extra fields are needed
- [ ] **Override `toJSON()`** - Include specialized fields in serialization
- [ ] **Override `toDetailedMessage()`** - Add specialized info to logs
- [ ] **Create helper functions** - At least one helper per common scenario
- [ ] **Document examples** - Show real-world usage in JSDoc
- [ ] **Export from index.ts** - Add to `packages/types/src/errors/index.ts`
- [ ] **Update this file** - Add new error type to this CLAUDE.md

---

## 🧪 Testing Error Behavior

### Type Guard Usage

```typescript
import { ForjaError, ForgaCrudError } from 'forja-types/errors';

try {
  await crud.findOne('User', { email: 'test@example.com' });
} catch (error) {
  if (ForjaError.isForjaError(error)) {
    console.log(error.code);           // Type-safe access
    console.log(error.operation);      // Type-safe access
    console.log(error.toJSON());       // Serialization
  }

  if (error instanceof ForgaCrudError) {
    console.log(error.model);          // CRUD-specific field
    console.log(error.operation);      // CRUD operation
  }
}
```

### Serialization Example

```typescript
const error = new ForjaValidationError('Validation failed', {
  model: 'User',
  errors: [
    { field: 'email', code: 'REQUIRED', message: 'Email required' }
  ],
});

console.log(error.toJSON());
// Output:
// {
//   type: 'ForjaValidationError',
//   message: 'Validation failed',
//   code: 'VALIDATION_FAILED',
//   timestamp: '2025-01-22T10:30:00.000Z',
//   operation: 'validation:data',
//   model: 'User',
//   errors: [{ field: 'email', code: 'REQUIRED', message: 'Email required' }]
// }
```

---

## ⚡ Throw vs Result Pattern

### When to Use Throw (Recommended) ✅

**Use `throw` for:**
- ✅ **User-facing APIs** - CRUD operations, validators, handlers
- ✅ **Error helpers** - All `throw{Module}{Error}` functions
- ✅ **Async operations** - Works seamlessly with async/await
- ✅ **Most internal code** - Default approach

```typescript
// ✅ GOOD - Throw for user-facing code
export function validateOrThrow(data, schema) {
  const errors = validate(data, schema);
  if (errors.length > 0) {
    throwValidationMultiple('User', errors);
  }
  return data;
}

// ✅ GOOD - CRUD operations throw
async findOne(model, where) {
  const result = await adapter.executeQuery(query);
  if (!result.success) {
    throwQueryExecutionError('findOne', model, query, result.error);
  }
  return result.data;
}
```

**Why throw is better:**
- Cleaner API - no need to check `.success` everywhere
- Call stack preserved - error bubbles up naturally
- Async/await compatible - `try/catch` is standard
- Cause chaining works perfectly
- Less boilerplate

### When to Use Result Pattern (Rare) ⚠️

**Use `Result<T, E>` ONLY for:**
- ⚠️ **Optional validation** - When error is not fatal
- ⚠️ **Library code** - When caller should decide
- ⚠️ **Parser/Lexer** - Multiple errors collected
- ⚠️ **Performance-critical** - Avoid exception overhead (rare)

```typescript
// ⚠️ OK - Internal parsing with multiple errors
function parseFields(input: string): Result<string[], ParserError> {
  const errors: ParserError[] = [];
  const fields: string[] = [];

  for (const field of input.split(',')) {
    if (!isValidField(field)) {
      errors.push(createParserError(field));
      continue; // Collect all errors, don't stop
    }
    fields.push(field);
  }

  if (errors.length > 0) {
    return { success: false, error: errors[0] }; // Return first error
  }
  return { success: true, data: fields };
}
```

**Why Result is worse:**
- Boilerplate - every call needs `if (!result.success)`
- Easy to ignore - caller can skip error check (unsafe)
- Verbose - needs explicit error propagation
- Doesn't work well with async/await

### Migration Guide: Result → Throw

**Before (Result pattern):**
```typescript
// ❌ OLD - Result pattern
export function validateWhereClause(
  where: WhereClause,
  schema: SchemaDefinition
): Result<void, ForjaQueryBuilderError> {
  if (invalidField) {
    return {
      success: false,
      error: new ForjaQueryBuilderError('Invalid field', { ... })
    };
  }
  return { success: true, data: undefined };
}

// Usage - verbose
const result = validateWhereClause(where, schema);
if (!result.success) {
  throw result.error; // Or propagate up
}
```

**After (Throw pattern):**
```typescript
// ✅ NEW - Throw pattern
export function validateWhereClause(
  where: WhereClause,
  schema: SchemaDefinition
): void {
  if (invalidField) {
    throwInvalidField('where', fieldName, availableFields);
  }
  // No return needed for void
}

// Usage - clean
validateWhereClause(where, schema); // Throws on error
```

### Public API Functions - ALWAYS Throw

```typescript
// ✅ Public API - throw on error
class QueryBuilder {
  build(): QueryObject {
    if (!this.table) {
      throwMissingTable();
    }

    // Validate all parts (each throws on error)
    validateWhereClause(this.where, this.schema);
    validateSelectFields(this.select, this.schema);

    return this.query; // Only reached if valid
  }
}

// Usage
try {
  const query = builder.where({ age: '$invalid' }).build();
} catch (error) {
  if (error instanceof ForjaQueryBuilderError) {
    console.log(error.suggestion); // User gets helpful error
  }
}
```

### The Rule of Thumb

**Default to throw unless you have a specific reason not to.**

```typescript
// ✅ DEFAULT - Throw
export function processData(input: unknown): ProcessedData {
  if (!isValid(input)) {
    throwInvalidInput(input);
  }
  return process(input);
}

// ⚠️ RARE - Result (only if caller needs to decide)
export function tryProcessData(input: unknown): Result<ProcessedData, Error> {
  if (!isValid(input)) {
    return { success: false, error: new Error('Invalid') };
  }
  return { success: true, data: process(input) };
}
```

**Summary:**
- **Throw** = 95% of code (helpers, CRUD, validation, builders)
- **Result** = 5% of code (internal parsing with multiple errors)

---

## 🚫 Common Mistakes to Avoid

### ❌ Don't: Create Error Without Code

```typescript
// ❌ WRONG
throw new ForjaError('Something failed', {
  // Missing code - can't handle programmatically
});

// ✅ CORRECT
throw new ForjaError('Something failed', {
  code: 'OPERATION_FAILED',
});
```

### ❌ Don't: Lose Original Error

```typescript
// ❌ WRONG - Original error lost
catch (error) {
  throw new ForjaError('Database failed', {
    code: 'DB_ERROR',
    // Missing cause
  });
}

// ✅ CORRECT - Original error preserved
catch (error) {
  throw new ForjaError('Database failed', {
    code: 'DB_ERROR',
    cause: error instanceof Error ? error : new Error(String(error)),
  });
}
```

### ❌ Don't: Use Generic Messages

```typescript
// ❌ WRONG - Too vague
throw new ForjaError('Error', {
  code: 'ERROR',
});

// ✅ CORRECT - Specific and helpful
throw new ForgaCrudError('Failed to find User with id 123', {
  code: 'RECORD_NOT_FOUND',
  operation: 'findById',
  model: 'User',
  context: { id: 123 },
  suggestion: 'Check that the User with id 123 exists in the database',
});
```

### ❌ Don't: Forget Suggestions for Client Errors

```typescript
// ❌ WRONG - No guidance for user
throw new ForjaValidationError('Validation failed', {
  model: 'User',
  errors: [{ field: 'email', code: 'REQUIRED', message: 'Required' }],
  // Missing suggestion
});

// ✅ CORRECT - Clear guidance
throw new ForjaValidationError('Validation failed', {
  model: 'User',
  errors: [{ field: 'email', code: 'REQUIRED', message: 'Email required' }],
  suggestion: 'Provide a value for the email field',
});
```

---

## 🎯 Summary

**Golden Rules:**
1. **Always extend ForjaError** - Never use raw `Error`
2. **Always add error code** - Make errors programmatically handleable
3. **Always chain with cause** - Preserve error history
4. **Always provide suggestions** - Help users fix the issue
5. **Always use helpers** - Keep usage simple and consistent
6. **Always document** - Examples in JSDoc
7. **Always type-safe** - No `any`, strong typing everywhere

**The error system is a user-facing feature.** Treat it with the same care as your API.
