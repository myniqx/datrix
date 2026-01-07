# Forja - Next Steps & Implementation Roadmap

**Last Updated:** 2026-01-07
**Project Status:** v0.75.0 (~78% complete, ~20,500 LOC)
**Test Coverage:** 418 tests written (Core + Adapter types/translator)

---

## 📊 Current State Summary

### ✅ Implementation Complete
- **Core Module** (~3,600 LOC) - Schema, Validator, Query Builder, Migration
- **PostgreSQL Adapter** (~1,700 LOC) - Connection, query translation, type mapping
- **API Layer** (~2,500 LOC) - Parser, handler, serializer
- **All Plugins** (~1,500 LOC) - Auth, upload, hooks, soft-delete
- **CLI Tools** - Migrate, generate, dev commands

### ✅ Tests Completed (418 tests)
- **Core Validator** - 145 tests (field + schema validation)
- **Core Query Builder** - 48 tests (SELECT/INSERT/UPDATE/DELETE, WHERE, operators)
- **Core Migration** - 83 tests (differ: 33, generator: 18, runner: 32)
- **PostgreSQL Types** - 79 tests (type mapping, value conversion)
- **PostgreSQL Query Translator** - 63 tests (SQL generation, SQL injection prevention)

### 🔄 In Progress
- **PostgreSQL Adapter Tests** - Connection, transactions, schema operations

### ❌ Critical Gaps
1. **Config Module** - Not implemented
2. **Adapter Tests (incomplete)** - PostgreSQL adapter.ts tests pending
3. **API Layer Tests** - Not started (~840 tests)
4. **Plugin Tests** - Not started (~850 tests)
5. **Integration Tests** - Not started
6. **MySQL Adapter** - Not started
7. **MongoDB Adapter** - Not started

---

## 🎯 Version Milestones

### v0.8.0 - Testing Foundation (2-3 Weeks)
**Goal:** 80%+ test coverage for core modules, PostgreSQL adapter, and API layer

### v0.9.0 - Production Readiness (1 Month)
**Goal:** Complete MySQL adapter, plugin tests, config module

### v1.0.0 - Stable Release (2-3 Months)
**Goal:** MongoDB adapter, 90%+ coverage, performance optimized

---

## 📋 Detailed Implementation Plan

---

## 🟡 PHASE 2: Adapter & API Tests (CURRENT)
**Priority:** HIGH
**Timeline:** 4-6 days remaining
**Goal:** Complete PostgreSQL adapter tests and API layer tests

### 2.1 PostgreSQL Adapter Tests (~150 assertions remaining)

#### ✅ Completed
- [x] **`tests/adapters/postgres/types.test.ts`** (79 tests)
  - Type mappings (FieldType → PostgreSQL)
  - Value conversions (to/from PostgreSQL)
  - Type modifiers (VARCHAR, NUMERIC with precision/scale)
  - Edge cases (NULL, empty strings, Unicode)

- [x] **`tests/adapters/postgres/query-translator.test.ts`** (63 tests)
  - SQL generation (SELECT/INSERT/UPDATE/DELETE)
  - WHERE clause translation (all operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin)
  - Logical operators ($and, $or)
  - Parameter binding and SQL injection prevention
  - Identifier escaping and validation
  - NULL handling
  - Edge cases (Unicode, long values, deep nesting)

#### 🔄 In Progress
- [ ] **`tests/adapters/postgres/adapter.test.ts`** (~150 assertions)
  - Connection/disconnection
  - Connection pooling
  - Query execution
  - Transaction management
    - Begin transaction
    - Commit
    - Rollback
    - Transaction isolation
  - Schema operations
    - createTable
    - dropTable
    - alterTable (addColumn, dropColumn, modifyColumn, renameColumn)
    - addIndex
    - dropIndex
  - Error handling
    - Connection errors
    - Query errors
    - Transaction errors
    - Timeout handling
  - Resource cleanup

**Implementation Notes:**
- Requires Docker/PostgreSQL for integration tests OR mock client
- Consider using `pg-mem` for in-memory PostgreSQL testing
- Test connection pool exhaustion scenarios
- Test concurrent transaction handling

### 2.2 API Layer Tests (~840 assertions)

#### Parser Tests (~300 assertions)
- [ ] **`tests/api/parser/query-parser.test.ts`** (~100 assertions)
  - Query string parsing (`?filter[email]=test&sort=-createdAt`)
  - Multiple parameters
  - Array syntax (`filter[role][]=admin&filter[role][]=user`)
  - Encoded characters (`%20`, `%40`, etc.)
  - Malformed query handling
  - URL decode edge cases

- [ ] **`tests/api/parser/fields-parser.test.ts`** (~50 assertions)
  - Comma-separated syntax (`fields=id,email,name`)
  - Array syntax (`fields[]=id&fields[]=email`)
  - Wildcard selection (`fields=*`)
  - Nested field selection (`fields=user.email,user.name`)
  - Invalid field handling

- [ ] **`tests/api/parser/where-parser.test.ts`** (~150 assertions)
  - Simple equality (`filter[email]=test@example.com`)
  - Operator parsing (`filter[age][$gte]=18`)
  - All operators ($eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $like, $regex)
  - Nested where clauses (`filter[$and][0][age][$gte]=18`)
  - Logical operators ($and, $or, $not)
  - Type coercion (string "true" → boolean, "123" → number)
  - Invalid syntax handling
  - Deep object nesting limits

- [ ] **`tests/api/parser/populate-parser.test.ts`** (~100 assertions)
  - Simple populate (`populate=author`)
  - Multiple populates (`populate=author,comments`)
  - Populate with fields (`populate[author][fields]=name,email`)
  - Nested populate (`populate[author][populate]=profile`)
  - Circular populate detection
  - Invalid relation handling
  - Depth limit enforcement

#### Handler Tests (~300 assertions)
- [ ] **`tests/api/handler/crud.test.ts`** (~200 assertions)
  - **findMany operation**
    - No filters (all records)
    - With filters (WHERE clause)
    - With pagination (limit/offset)
    - With populate (JOINs)
    - With sorting (ORDER BY)
    - With field selection (SELECT specific fields)
    - Empty result handling
  - **findOne operation**
    - By ID (primary key lookup)
    - Not found handling (404)
    - With populate
    - With field selection
  - **create operation**
    - Valid data (201 Created)
    - Validation errors (400 Bad Request)
    - Duplicate key errors (409 Conflict)
    - Required field validation
    - Default value handling
    - RETURNING clause
  - **update operation**
    - Full update (all fields)
    - Partial update (PATCH semantics)
    - Not found handling (404)
    - Validation errors
    - Optimistic locking (if implemented)
    - RETURNING clause
  - **delete operation**
    - Successful deletion (204 No Content)
    - Not found handling (404)
    - Soft delete vs hard delete
    - CASCADE behavior
  - **count operation**
    - Total count
    - With filters
    - Performance considerations

- [ ] **`tests/api/handler/factory.test.ts`** (~50 assertions)
  - Handler creation from schema
  - Permission configuration
  - Middleware integration
  - Context building
  - Route registration
  - Custom handler overrides

- [ ] **`tests/api/handler/context.test.ts`** (~50 assertions)
  - Next.js context builder (NextRequest/NextResponse)
  - Express context builder (req/res)
  - Generic context builder
  - Request parsing
  - Response formatting
  - Error handling

#### Serializer Tests (~240 assertions)
- [ ] **`tests/api/serializer/json.test.ts`** (~120 assertions)
  - Basic serialization (objects → JSON)
  - Date formatting (ISO 8601)
  - NULL handling
  - Undefined field handling
  - Field selection (only serialize selected fields)
  - Meta information (pagination, total count)
  - Nested object serialization
  - Array serialization
  - Custom serializers per field type
  - Performance (large datasets)

- [ ] **`tests/api/serializer/relations.test.ts`** (~120 assertions)
  - Single relation serialization (belongsTo, hasOne)
  - Multiple relations (hasMany, manyToMany)
  - Nested relations (3+ levels deep)
  - Circular reference detection
  - Circular reference handling (depth limit)
  - Lazy loading vs eager loading
  - Populate depth limiting
  - Partial relation serialization (field selection)
  - NULL relations
  - Empty array relations

**API Layer Total:** ~840 assertions

---

## 🟢 PHASE 3: Plugin Tests
**Priority:** MEDIUM-HIGH
**Timeline:** 3-5 days
**Goal:** Test all plugins (Target: 75%+ coverage)

### 3.1 Auth Plugin Tests (~450 assertions)

- [ ] **`tests/plugins/auth/jwt.test.ts`** (~150 assertions)
  - Token generation (sign)
  - Token verification (verify)
  - Token expiration (exp claim)
  - Token refresh
  - Invalid token handling
  - Expired token handling
  - Malformed token handling
  - Custom claims
  - Algorithm support (HS256, HS512, RS256)
  - Secret key validation

- [ ] **`tests/plugins/auth/session.test.ts`** (~100 assertions)
  - Session creation
  - Session retrieval
  - Session deletion
  - Session expiration
  - Session refresh
  - Memory store
  - Redis store (if implemented)
  - Concurrent session handling
  - Session hijacking prevention

- [ ] **`tests/plugins/auth/rbac.test.ts`** (~120 assertions)
  - Role definition
  - Permission checking
  - Role inheritance
  - Resource-based permissions
  - Action-based permissions (create, read, update, delete)
  - Custom permission functions
  - Permission caching
  - Wildcard permissions

- [ ] **`tests/plugins/auth/index.test.ts`** (~80 assertions)
  - Plugin initialization
  - Login flow
  - Logout flow
  - Password hashing (PBKDF2)
  - Password verification
  - Timing attack prevention
  - Rate limiting
  - Account lockout

### 3.2 Upload Plugin Tests (~220 assertions)

- [ ] **`tests/plugins/upload/index.test.ts`** (~80 assertions)
  - Single file upload
  - Multiple file upload
  - File validation
    - Size limits (max file size)
    - MIME type validation
    - Extension validation (whitelist/blacklist)
  - Invalid file rejection
  - Upload progress (if implemented)

- [ ] **`tests/plugins/upload/providers/local.test.ts`** (~60 assertions)
  - Local file saving
  - File URL generation
  - File deletion
  - Directory creation
  - Path traversal prevention
  - Filename sanitization
  - Disk space handling

- [ ] **`tests/plugins/upload/providers/s3.test.ts`** (~80 assertions)
  - S3 upload (mocked with AWS SDK mock)
  - Signature V4 generation
  - Presigned URL generation
  - File URL generation
  - Error handling (network, permissions)
  - Multipart upload (large files)
  - Bucket configuration

### 3.3 Hooks Plugin Tests (~100 assertions)

- [ ] **`tests/plugins/hooks/manager.test.ts`** (~100 assertions)
  - Hook registration
  - Hook execution order
  - beforeCreate hooks
  - afterCreate hooks
  - beforeUpdate hooks
  - afterUpdate hooks
  - beforeDelete hooks
  - afterDelete hooks
  - Hook error handling
  - Data transformation
  - Hook chaining
  - Async hook handling

### 3.4 Soft Delete Plugin Tests (~80 assertions)

- [ ] **`tests/plugins/soft-delete/interceptor.test.ts`** (~80 assertions)
  - Query interception
  - Auto-add deletedAt filter (WHERE deletedAt IS NULL)
  - Soft delete operation (UPDATE set deletedAt)
  - findDeleted() method
  - findWithDeleted() method (include soft-deleted)
  - restore() method (set deletedAt = NULL)
  - Hard delete bypass
  - Cascade soft delete

**Phase 3 Total:** ~850 assertions

---

## 🔵 PHASE 4: Integration & E2E Tests
**Priority:** MEDIUM
**Timeline:** 3-4 days
**Goal:** Test complete workflows

### 4.1 Integration Tests (~200 assertions)

- [ ] **`tests/integration/full-stack.test.ts`**
  - Complete CRUD workflow
  - Schema → Migration → API → Database
  - Multiple schemas with relations
  - Transaction handling
  - Rollback scenarios

- [ ] **`tests/integration/auth-flow.test.ts`**
  - User registration
  - Login (JWT generation)
  - Protected endpoint access
  - Permission-based access (RBAC)
  - Session management
  - Logout

- [ ] **`tests/integration/upload-flow.test.ts`**
  - File upload via API
  - File retrieval
  - File deletion
  - Image thumbnail generation (if implemented)

- [ ] **`tests/integration/migration-flow.test.ts`**
  - Schema changes
  - Auto-migration generation
  - Migration execution (up)
  - Rollback (down)
  - Migration history tracking

### 4.2 E2E Tests (Optional)

- [ ] **`tests/e2e/nextjs.test.ts`**
  - Test with actual Next.js app
  - Route handler testing
  - API calls from frontend

- [ ] **`tests/e2e/express.test.ts`**
  - Test with Express server
  - Middleware integration

---

## 🟣 PHASE 5: Config Module Implementation
**Priority:** MEDIUM
**Timeline:** 2-3 days
**Goal:** Implement missing config module

### 5.1 Config Module Files

- [ ] **`src/core/config/types.ts`**
  - ForjaConfig interface
  - Database config types
  - Plugin config types
  - API config types
  - Migration config types

- [ ] **`src/core/config/loader.ts`**
  - Load forja.config.ts file
  - Environment variable substitution (`process.env.DATABASE_URL`)
  - Default values
  - Validation
  - ESM/CJS support

- [ ] **`src/core/config/validator.ts`**
  - Config validation
  - Required field checking
  - Type checking
  - Database connection string parsing

- [ ] **`src/core/config/index.ts`**
  - Export `defineConfig` utility
  - Export `loadConfig` function

### 5.2 Config Module Tests (~130 assertions)

- [ ] **`tests/core/config/loader.test.ts`** (~50 assertions)
  - Config file loading
  - Environment variable substitution
  - Default values
  - File not found handling
  - Malformed config handling

- [ ] **`tests/core/config/validator.test.ts`** (~80 assertions)
  - Valid config
  - Invalid config (missing required fields)
  - Invalid types
  - Invalid database URLs
  - Invalid plugin configurations

---

## 🔴 PHASE 6: MySQL Adapter (Post v0.8.0)
**Priority:** HIGH (for v0.9.0)
**Timeline:** 1 week
**Goal:** Implement MySQL adapter with tests

### 6.1 MySQL Adapter Implementation

- [ ] **`src/adapters/mysql/types.ts`**
  - MySQL-specific types
  - Connection config
  - Type mappings (FieldType → MySQL types)

- [ ] **`src/adapters/mysql/adapter.ts`**
  - Implement DatabaseAdapter interface
  - Connection pooling (mysql2 library)
  - Query execution
  - Transaction support
  - Schema operations

- [ ] **`src/adapters/mysql/query-translator.ts`**
  - QueryObject → MySQL SQL
  - Backtick identifier escaping
  - `?` placeholder parameters (not `$1`, `$2`)
  - Type mapping differences

- [ ] **`src/adapters/mysql/index.ts`**
  - Export MySQLAdapter

### 6.2 MySQL Adapter Tests (~400 assertions)

- [ ] **`tests/adapters/mysql/types.test.ts`** (~80 assertions)
- [ ] **`tests/adapters/mysql/query-translator.test.ts`** (~200 assertions)
- [ ] **`tests/adapters/mysql/adapter.test.ts`** (~120 assertions)

---

## 🟠 PHASE 7: MongoDB Adapter (Post v0.9.0)
**Priority:** MEDIUM (for v1.0.0)
**Timeline:** 1 week
**Goal:** Implement MongoDB adapter

### 7.1 MongoDB Adapter Implementation

- [ ] **`src/adapters/mongodb/types.ts`**
- [ ] **`src/adapters/mongodb/adapter.ts`**
- [ ] **`src/adapters/mongodb/query-translator.ts`**
  - QueryObject → MongoDB filter objects
  - Aggregation pipeline for JOINs
  - Projection handling
- [ ] **`src/adapters/mongodb/index.ts`**

### 7.2 MongoDB Adapter Tests (~350 assertions)

- [ ] **`tests/adapters/mongodb/adapter.test.ts`** (~150 assertions)
- [ ] **`tests/adapters/mongodb/query-translator.test.ts`** (~200 assertions)

---

## 📊 Test Coverage Goals

| Module | Current | Target | Tests Written | Tests Remaining |
|--------|---------|--------|---------------|-----------------|
| Core Validator | ✅ 100% | 90%+ | 145 | 0 |
| Core Query Builder | ✅ 100% | 90%+ | 48 | 0 |
| Core Migration | ✅ 100% | 90%+ | 83 | 0 |
| PostgreSQL Types | ✅ 100% | 80%+ | 79 | 0 |
| PostgreSQL Query Translator | ✅ 100% | 80%+ | 63 | 0 |
| PostgreSQL Adapter | 🔄 30% | 80%+ | 0 | ~150 |
| API Layer | 0% | 85%+ | 0 | ~840 |
| Plugins | 0% | 75%+ | 0 | ~850 |
| Integration | 0% | - | 0 | ~200 |
| Config Module | 0% | 90%+ | 0 | ~130 |
| **Total** | **~25%** | **80%+** | **418** | **~2,170** |

---

## 🚀 Immediate Next Steps

### This Week (Phase 2 - In Progress)
1. ✅ Complete PostgreSQL types tests (79 tests)
2. ✅ Complete PostgreSQL query translator tests (63 tests)
3. 🔄 Write PostgreSQL adapter tests (~150 tests)
4. ⏳ Start API parser tests (~300 tests)
5. ⏳ Start API handler tests (~300 tests)
6. ⏳ Start API serializer tests (~240 tests)

### Next Week (Phase 3)
1. Plugin tests (auth, upload, hooks, soft-delete)
2. Integration tests
3. Config module implementation

---

## 🎯 Success Criteria

### v0.8.0 (Current Goal - 2 weeks)
- ✅ 80%+ overall test coverage
- ✅ All core modules tested (DONE)
- ✅ PostgreSQL types + translator tested (DONE)
- ⏳ PostgreSQL adapter fully tested
- ⏳ API layer fully tested
- ⏳ Config module implemented

### v0.9.0 (1 month)
- ✅ MySQL adapter complete with tests
- ✅ All plugins tested
- ✅ 85%+ overall test coverage
- ✅ Performance benchmarks established

### v1.0.0 (2-3 months)
- ✅ MongoDB adapter complete (optional)
- ✅ 90%+ test coverage
- ✅ All documentation updated
- ✅ Security audit passed
- ✅ Performance targets met
- ✅ Public npm release

---

**Current Focus:** PostgreSQL adapter connection/transaction tests, then API layer tests

**Test Philosophy:** Strict tests with exact value verification, comprehensive edge cases, security-focused (SQL injection, input validation)
