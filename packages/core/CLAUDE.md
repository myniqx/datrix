# Datrix Core - Development Guidelines

## Overview

The core package contains the fundamental building blocks of Datrix:
- **Schema System** - Type definitions and registry
- **Query Builder** - Database-agnostic query construction
- **Executor** - Query execution with validation
- **Validator** - Field-level and schema-level validation
- **Migration** - Schema diff and migration generation

---

## Validation Layer Model

Datrix uses a layered validation architecture. Each layer has specific responsibilities:

```
┌─────────────────────────────────────────────────────────┐
│ Query Builder (core/query-builder/)                     │
│ ✓ Schema existence validation                           │
│ ✓ Field existence (WHERE, SELECT, POPULATE)             │
│ ✓ Operator validity ($eq, $gt, $in, etc.)               │
│ ✓ Type coercion (string → number for query params)      │
│ ✓ Depth limits (nested relations, logical operators)    │
│ ✓ Relation normalization (shortcuts → full format)      │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│ Executor (core/query-executor/)                         │
│ ✓ Reserved field checks (id, createdAt, updatedAt)      │
│ ✓ Timestamp injection (automatic timestamps)            │
│ ✓ Full field validation (type, min, max, pattern)       │
│ ✓ Required field checks                                 │
│ ✓ Enum value validation                                 │
│ ✓ Array constraints (minItems, maxItems, unique)        │
│ ✓ Custom validators                                     │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│ Adapter (adapter-postgres/, adapter-mysql/, etc.)       │
│ ✓ SQL generation (translate QueryObject → SQL)          │
│ ✓ SQL injection prevention (parameterized queries)      │
│ ✓ Type conversion for database (Date → timestamp)       │
│ ✓ Database-specific identifier rules                    │
│ ✗ NO DATA VALIDATION - Already done by Executor         │
└─────────────────────────────────────────────────────────┘
```

---

## Query Builder Validations

**Location:** `src/query-builder/`

### Structural Validations

| File | Validation | Error |
|------|------------|-------|
| `builder.ts` | Schema exists in registry | `throwSchemaNotFound()` |
| `builder.ts` | DELETE must have WHERE clause | `throwDeleteWithoutWhere()` |
| `where.ts` | Field exists in schema | `throwInvalidField()` |
| `where.ts` | Operator is valid | `throwInvalidOperator()` |
| `where.ts` | Depth limit (max 10 levels) | `throwMaxDepthExceeded()` |
| `select.ts` | Field exists in schema | `throwInvalidFields()` |
| `select.ts` | Relation fields not in SELECT | `throwRelationInSelect()` |
| `populate.ts` | Field is a relation | `throwInvalidValue()` |
| `data.ts` | Field exists in schema | `throwInvalidField()` |
| `data.ts` | Nested depth (max 5 levels) | `throwInvalidValue()` |
| `data.ts` | No circular relations | `throwInvalidValue()` |

### Normalization (Not Validation)

- Relation shortcuts: `category: 2` → `{ set: [2] }`
- Foreign key inlining for belongsTo/hasOne
- Type coercion for query parameters (string "5" → number 5)

---

## Executor Validations

**Location:** `src/query-executor/`

### Data Validation Flow

```typescript
// executeInsert() / executeUpdate() flow:
1. checkReservedFields(data, isRawMode)   // Prevent manual id/timestamps
2. addTimestamps(data, options)           // Inject createdAt/updatedAt
3. validateSchema(data, schema)           // Full field validation
```

### Field-Level Validations (via Validator)

**Location:** `src/validator/field-validator.ts`

| Field Type | Validations |
|------------|-------------|
| `string` | type, minLength, maxLength, pattern (regex), custom validator |
| `number` | type, isInteger, min, max, custom validator |
| `boolean` | type |
| `date` | type, isValid, min, max |
| `enum` | type, value in allowed values |
| `array` | type, minItems, maxItems, uniqueItems, recursive item validation |
| `json` | valid JSON type (not undefined, not Date) |
| `relation` | ID shortcut OR valid RelationInput object |

### Validation Error Codes

Defined in `@datrix/core`:

- `REQUIRED` - Required field missing
- `TYPE_MISMATCH` - Wrong type
- `MIN_LENGTH` / `MAX_LENGTH` - String length
- `MIN_VALUE` / `MAX_VALUE` - Number range
- `MIN_ITEMS` / `MAX_ITEMS` - Array length
- `PATTERN` - Regex pattern mismatch
- `UNIQUE` - Array items not unique
- `INVALID_ENUM` - Value not in enum
- `INVALID_DATE` - Invalid Date object
- `CUSTOM` - Custom validator failed

---

## Critical Rules for Adapter Development

### DO NOT Validate Data in Adapters

Adapters should NEVER perform data validation. All validation is done by the Executor before the query reaches the adapter.

```typescript
// ❌ BAD - Redundant validation in adapter
async insert(query: QueryObject): Promise<Result<...>> {
    // DON'T DO THIS - Executor already validated
    if (typeof data.email !== 'string') {
        return { success: false, error: ... };
    }
    if (data.age < 0 || data.age > 150) {
        return { success: false, error: ... };
    }
    // ...
}

// ✅ GOOD - Adapter trusts Executor's validation
async insert(query: QueryObject): Promise<Result<...>> {
    // Data is already validated, just translate and execute
    const sql = this.translator.translate(query);
    return this.execute(sql);
}
```

### What Adapters SHOULD Do

1. **Translate QueryObject to SQL** - Convert the abstract query to database-specific SQL
2. **Prevent SQL Injection** - Use parameterized queries
3. **Type Conversion** - Convert JS types to database types (Date → timestamp)
4. **Handle Database Errors** - Translate database errors to Datrix errors
5. **Connection Management** - Pool handling, reconnection, etc.

### What Adapters SHOULD NOT Do

1. ❌ Validate required fields (Executor does this)
2. ❌ Check type correctness (Executor does this)
3. ❌ Validate min/max ranges (Executor does this)
4. ❌ Check pattern/regex (Executor does this)
5. ❌ Validate enum values (Executor does this)
6. ❌ Check array constraints (Executor does this)

---

## Module Structure

```
src/
├── query-builder/          # Query construction and structural validation
│   ├── builder.ts          # Main QueryBuilder class
│   ├── where.ts            # WHERE clause normalization
│   ├── select.ts           # SELECT clause handling
│   ├── populate.ts         # Relation population
│   └── data.ts             # INSERT/UPDATE data normalization
│
├── query-executor/         # Query execution and data validation
│   ├── executor.ts         # Main QueryExecutor class
│   ├── validation.ts       # Data validation orchestration
│   └── relations.ts        # Relation operation processing
│
├── validator/              # Field and schema validation
│   ├── field-validator.ts  # Per-field validation logic
│   └── schema-validator.ts # Full schema validation
│
├── schema/                 # Schema definitions and registry
│   ├── registry.ts         # Schema storage and retrieval
│   └── types.ts            # Schema type definitions
│
└── migration/              # Migration generation and execution
    ├── diff.ts             # Schema comparison
    └── generator.ts        # SQL generation
```

---

## Performance Considerations

- Query Builder uses caching for field lists (wildcard expansion)
- Validator supports `abortEarly` option for fast-fail
- Schema registry uses Map for O(1) lookups
- Avoid re-validating data that's already been validated

---

## Testing Guidelines

When writing tests for core modules:

1. **Query Builder tests** - Focus on normalization and structural validation
2. **Executor tests** - Focus on data validation and transaction handling
3. **Validator tests** - Focus on edge cases for each field type

See `src/tests/` for existing test patterns.
