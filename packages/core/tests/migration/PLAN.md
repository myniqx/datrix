# Migration E2E Test Plan

## Overview

End-to-end tests for the migration system. Tests verify that `forja.beginMigrate()` correctly:
- Detects schema differences between code and database
- Identifies ambiguous changes (potential renames)
- Applies migrations successfully

## Test Structure

### File Organization

```
packages/core/tests/migration/
├── e2e/
│   ├── setup/
│   │   ├── adapter.ts          # Adapter factory (same as core e2e)
│   │   ├── config.ts           # Forja config factory
│   │   ├── schemas-base.ts     # Base schemas (user, post, category)
│   │   └── helpers.ts          # Test utilities
│   ├── fresh-start.test.ts     # Scenario 1-3: Create/Drop tables
│   ├── column-changes.test.ts  # Scenario 4-5: Add/Drop columns
│   ├── ambiguous.test.ts       # Scenario 6-7: Ambiguous detection & resolution
│   └── complex.test.ts         # Scenario 8: Multiple changes at once
```

### Test Isolation

Each test file:
1. Uses unique temp directory (e.g., `.tmp/migration-fresh-start/`)
2. Drops all tables in `beforeAll`
3. Creates fresh Forja instance per test if needed
4. Cleans up in `afterAll`

## Schemas

### Base Schemas (schemas-base.ts)

```typescript
// user - basic schema with common fields
export const baseUserSchema = defineSchema({
  name: 'user',
  fields: {
    email: { type: 'string', required: true, unique: true },
    name: { type: 'string', required: true },
    age: { type: 'number' },
  },
  indexes: [{ fields: ['email'], unique: true }],
});

// post - with relation to user
export const basePostSchema = defineSchema({
  name: 'post',
  fields: {
    title: { type: 'string', required: true },
    content: { type: 'string' },
    published: { type: 'boolean', default: false },
    author: { type: 'relation', kind: 'belongsTo', model: 'user' },
  },
});

// category - simple schema for add/drop tests
export const baseCategorySchema = defineSchema({
  name: 'category',
  fields: {
    name: { type: 'string', required: true },
    slug: { type: 'string', required: true, unique: true },
  },
});
```

### Modified Schemas (inline in tests)

Tests will create modified versions inline:
- Clone base schema
- Add/remove/modify fields as needed
- This allows precise control per test case

## Test Helpers (helpers.ts)

```typescript
// ============================================
// Session Helpers
// ============================================

/**
 * Auto-resolve all ambiguous changes with given strategy
 */
function autoResolveAmbiguous(
  session: MigrationSession,
  strategy: 'rename' | 'drop_and_add'
): void;

/**
 * Resolve specific ambiguous change
 */
function resolveAmbiguousById(
  session: MigrationSession,
  id: string,
  strategy: 'rename' | 'drop_and_add'
): void;

// ============================================
// Assertion Helpers
// ============================================

/**
 * Assert table exists in database
 */
async function assertTableExists(
  adapter: DatabaseAdapter,
  tableName: string
): Promise<void>;

/**
 * Assert table does NOT exist in database
 */
async function assertTableNotExists(
  adapter: DatabaseAdapter,
  tableName: string
): Promise<void>;

/**
 * Assert column exists in table
 */
async function assertColumnExists(
  adapter: DatabaseAdapter,
  tableName: string,
  columnName: string
): Promise<void>;

/**
 * Assert column does NOT exist in table
 */
async function assertColumnNotExists(
  adapter: DatabaseAdapter,
  tableName: string,
  columnName: string
): Promise<void>;

/**
 * Assert table has exactly these columns (no more, no less)
 * Excludes auto-generated: id, createdAt, updatedAt
 */
async function assertTableColumns(
  adapter: DatabaseAdapter,
  tableName: string,
  expectedColumns: string[]
): Promise<void>;

// ============================================
// Setup Helpers
// ============================================

/**
 * Create Forja instance with given schemas
 */
async function createForjaWithSchemas(
  tmpDir: string,
  schemas: SchemaDefinition[]
): Promise<Forja>;

/**
 * Drop all tables (clean slate)
 */
async function dropAllTables(adapter: DatabaseAdapter): Promise<void>;

/**
 * Apply migration session (resolve ambiguous as drop+add by default)
 */
async function applyMigration(
  session: MigrationSession,
  ambiguousStrategy?: 'rename' | 'drop_and_add'
): Promise<void>;
```

## Test Scenarios

### Scenario 1: Fresh Start (fresh-start.test.ts)

```typescript
describe('Migration E2E - Fresh Start', () => {
  // Setup: empty database

  it('should create all tables from scratch', async () => {
    // Given: Empty DB, 3 schemas (user, post, category)
    // When: beginMigrate() + apply()
    // Then: 3 tables exist with correct columns
  });

  it('should detect no changes when schemas match DB', async () => {
    // Given: DB has tables matching schemas
    // When: beginMigrate()
    // Then: session.hasChanges() === false
  });
});
```

### Scenario 2: Add Table (fresh-start.test.ts)

```typescript
it('should add new table when schema added', async () => {
  // Given: DB has user, post tables
  // When: Add 'tag' schema, beginMigrate() + apply()
  // Then: tag table exists
  // And: user, post tables unchanged
});
```

### Scenario 3: Drop Table (fresh-start.test.ts)

```typescript
it('should drop table when schema removed', async () => {
  // Given: DB has user, post, category tables
  // When: Remove 'category' from schemas, beginMigrate() + apply()
  // Then: category table does NOT exist
  // And: user, post tables still exist
});
```

### Scenario 4: Add Column (column-changes.test.ts)

```typescript
describe('Migration E2E - Column Changes', () => {

  it('should add single column', async () => {
    // Given: user table with email, name
    // When: Add 'phone' field, beginMigrate() + apply()
    // Then: phone column exists
  });

  it('should add multiple columns', async () => {
    // Given: user table with email, name
    // When: Add 'phone', 'address', 'country' fields
    // Then: All 3 columns exist
  });
});
```

### Scenario 5: Drop Column (column-changes.test.ts)

```typescript
it('should drop single column', async () => {
  // Given: user table with email, name, age
  // When: Remove 'age' field, beginMigrate() + apply()
  // Then: age column does NOT exist
});

it('should drop multiple columns', async () => {
  // Given: user table with email, name, age, phone
  // When: Remove 'age', 'phone' fields
  // Then: Both columns do NOT exist
});
```

### Scenario 6: Ambiguous Changes (ambiguous.test.ts)

**These tests are critical - they stress-test the ambiguous detection algorithm.**

```typescript
describe('Migration E2E - Ambiguous Detection', () => {

  describe('1 removed + 1 added (classic rename candidate)', () => {
    it('should detect ambiguous: remove "name" + add "fullName"', async () => {
      // Given: user with 'name' column
      // When: Remove 'name', add 'fullName'
      // Then: session.ambiguous.length === 1
      // And: ambiguous[0].removedName === 'name'
      // And: ambiguous[0].addedName === 'fullName'
    });

    it('should apply as RENAME when resolved', async () => {
      // Given: above scenario
      // When: resolveAmbiguous('rename') + apply()
      // Then: 'fullName' column exists
      // And: 'name' column does NOT exist
      // And: Data preserved (if any test data inserted)
    });

    it('should apply as DROP+ADD when resolved', async () => {
      // Given: above scenario
      // When: resolveAmbiguous('drop_and_add') + apply()
      // Then: 'fullName' column exists
      // And: 'name' column does NOT exist
    });
  });

  describe('2 removed + 1 added (which one is rename?)', () => {
    it('should detect multiple ambiguous possibilities', async () => {
      // Given: user with 'firstName', 'lastName' columns
      // When: Remove both, add 'fullName'
      // Then: session.ambiguous.length === 2 (or handled differently?)
      // Discussion: How should this be handled?
      // Option A: 2 ambiguous entries (firstName->fullName, lastName->fullName)
      // Option B: No ambiguous (too complex, force drop+add)
    });
  });

  describe('1 removed + 2 added (which one is rename?)', () => {
    it('should detect ambiguous with multiple candidates', async () => {
      // Given: user with 'name' column
      // When: Remove 'name', add 'firstName', 'lastName'
      // Then: session.ambiguous.length === 2?
      // Or: How to handle?
    });
  });

  describe('3 removed + 3 added (chaos)', () => {
    it('should handle complex ambiguous scenario', async () => {
      // Given: user with 'a', 'b', 'c' columns
      // When: Remove all, add 'x', 'y', 'z'
      // Then: 9 possible combinations (3x3)
      // Expectation: ??? (need to define behavior)
    });
  });

  describe('2 removed + 2 added (pairs)', () => {
    it('should detect 2 separate ambiguous changes', async () => {
      // Given: user with 'firstName', 'lastName'
      // When: Remove both, add 'givenName', 'familyName'
      // Then: 2 ambiguous entries
      // And: Can resolve each independently
    });
  });

  describe('No ambiguous - clear cases', () => {
    it('should NOT flag as ambiguous when types differ', async () => {
      // Given: user with 'age' (number)
      // When: Remove 'age' (number), add 'birthDate' (date)
      // Then: No ambiguous (different types = clear drop+add)
    });

    it('should NOT flag as ambiguous when only adding', async () => {
      // Given: user with 'name'
      // When: Add 'phone' (nothing removed)
      // Then: No ambiguous
    });

    it('should NOT flag as ambiguous when only removing', async () => {
      // Given: user with 'name', 'phone'
      // When: Remove 'phone' (nothing added)
      // Then: No ambiguous
    });
  });
});
```

### Scenario 7: Table Rename (ambiguous.test.ts)

```typescript
describe('Table rename ambiguous', () => {
  it('should detect table rename candidate', async () => {
    // Given: 'user' table exists
    // When: Remove 'user' schema, add 'account' schema (similar structure)
    // Then: session.ambiguous includes table rename candidate
  });

  it('should NOT flag dissimilar tables as rename', async () => {
    // Given: 'user' table (email, name)
    // When: Remove 'user', add 'product' (sku, price, stock)
    // Then: No ambiguous - clearly different
  });
});
```

### Scenario 8: Complex Migration (complex.test.ts)

```typescript
describe('Migration E2E - Complex Scenarios', () => {

  it('should handle multiple table + column changes', async () => {
    // Given: user, post, category tables
    // When:
    //   - Add 'tag' table
    //   - Remove 'category' table
    //   - Add 'phone' to user
    //   - Remove 'published' from post
    //   - Rename 'title' to 'headline' in post (ambiguous)
    // Then: All changes applied correctly
  });

  it('should handle index changes', async () => {
    // Given: user table with email index
    // When: Remove email index, add name index
    // Then: Indexes updated correctly
  });

  it('should rollback on failure (transaction)', async () => {
    // Given: Valid migration plan
    // When: Force failure mid-migration (mock?)
    // Then: All changes rolled back
    // And: Database state unchanged
  });
});
```

## Implementation Order

1. **Setup files first**
   - [ ] `e2e/setup/adapter.ts` (copy from core e2e)
   - [ ] `e2e/setup/config.ts`
   - [ ] `e2e/setup/schemas-base.ts`
   - [ ] `e2e/setup/helpers.ts`

2. **Basic tests**
   - [ ] `fresh-start.test.ts` (Scenarios 1-3)
   - [ ] `column-changes.test.ts` (Scenarios 4-5)

3. **Ambiguous tests (critical)**
   - [ ] `ambiguous.test.ts` (Scenarios 6-7)
   - [ ] May need to adjust `MigrationSession.detectAmbiguousChanges()` based on test results

4. **Complex tests**
   - [ ] `complex.test.ts` (Scenario 8)

## Philosophy

**Tests drive implementation.**

- Write tests for desired behavior first
- If test fails, either:
  - Mark as `.skip` with TODO comment
  - Or implement the missing feature
- Tests are the roadmap

## Edge Cases to Explore

### Type Mismatch Scenarios

```typescript
describe('Type mismatch edge cases', () => {

  it('same name, different type - should flag as suspicious', async () => {
    // Given: user with 'birthCity' (string)
    // When: Change 'birthCity' to (date) - SAME NAME, DIFFERENT TYPE
    // Then: Should this be ambiguous? Or fieldModified?
    // Discussion: User might be fixing a mistake (stored dates as strings)
  });

  it('similar name, different type - birthCity->birthDate', async () => {
    // Given: user with 'birthCity' (string)
    // When: Remove 'birthCity', add 'birthDate' (date)
    // Then: Should NOT be ambiguous (types don't match)
    // Or: Should ASK because names are similar (birth prefix)?
  });

  it('exact semantic match, different type - age(number)->age(string)', async () => {
    // This is fieldModified, not ambiguous
    // But dangerous - data loss possible
  });
});
```

### Name Similarity Scenarios

```typescript
describe('Name similarity edge cases', () => {

  it('prefix match - userName->userFullName', async () => {
    // Strong rename candidate
  });

  it('suffix match - firstName->givenName', async () => {
    // Weak rename candidate (only "Name" suffix)
  });

  it('camelCase variation - userId->user_id', async () => {
    // Convention change - strong rename candidate
  });

  it('typo fix - adress->address', async () => {
    // Likely rename (typo correction)
  });

  it('completely different names, same type - foo->bar (both string)', async () => {
    // Should still ask - might be rename
  });
});
```

### Rollback Scenarios

```typescript
describe('Rollback (--down)', () => {

  it('should rollback last migration', async () => {
    // Given: Applied migration that added 'phone' column
    // When: session.rollbackLast()
    // Then: 'phone' column removed
  });

  it('should rollback to specific version', async () => {
    // Given: 3 migrations applied (v1, v2, v3)
    // When: session.rollbackTo('v1')
    // Then: v2 and v3 changes reverted
  });

  it('should rollback table creation', async () => {
    // Given: Applied migration that created 'tag' table
    // When: rollback
    // Then: 'tag' table dropped
  });

  it('should rollback column rename', async () => {
    // Given: Applied rename 'name' -> 'fullName'
    // When: rollback
    // Then: Column renamed back to 'name'
  });
});
```

## Notes

- Tests use same adapter system as core e2e tests
- Each test file is isolated (own temp directory)
- Run with: `pnpm vitest run packages/core/tests/migration/e2e/`
- Can filter: `pnpm vitest run packages/core/tests/migration/e2e/ambiguous.test.ts`
- **Failing tests are OK** - they document missing features
- Mark unimplemented features with `.skip` or `.todo`
