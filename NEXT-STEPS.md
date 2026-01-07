# Forja - Next Steps & Implementation Roadmap

**Last Updated:** 2026-01-07
**Project Status:** v0.78.0 (~83% complete, ~22,000 LOC)
**Test Coverage:** 653 tests written (Core + Adapter + API Layer full)

---

## 📊 Current State Summary

### ✅ Implementation Complete
- **Core Module** (~3,600 LOC) - Schema, Validator, Query Builder, Migration
- **PostgreSQL Adapter** (~1,700 LOC) - Connection, query translation, type mapping
- **API Layer** (~2,500 LOC) - Parser, handler, serializer
- **All Plugins** (~1,500 LOC) - Auth, upload, hooks, soft-delete
- **CLI Tools** - Migrate, generate, dev commands

### ✅ Tests Completed (653 tests)
All core, adapter, and API layer tests are verified.

| Module | Status | Tests | Key Improvements |
|--------|--------|-------|------------------|
| **Core** | ✅ 100% | 276 | Validator, Query Builder, Migration |
| **Adapter** | ✅ 100% | 298 | PostgreSQL (Transaction, Schema, Index, Introspect) |
| **API Layer** | ✅ 100% | 79 | **Parser:** Recursive Where, String Populate<br>**Handler:** Partial Update, Context Adapters<br>**Serializer:** Circular Ref Fix, Numeric ID Support |

### 🔄 In Progress
- **Core Module Tests** - Remaning core edge cases
- **Plugin Tests** - Auth, upload, hooks, soft-delete

### ❌ Critical Gaps
1. **Config Module** - Not implemented
2. **Plugin Tests** - Not started (~850 tests)
3. **Integration Tests** - Not started
4. **MySQL/MongoDB Adapters** - Not started

---

## 🎯 Version Milestones

### v0.8.0 - Testing Foundation (2-3 Weeks)
**Goal:** 80%+ test coverage for core modules, PostgreSQL adapter, and API layer

### v0.9.0 - Production Readiness (1 Month)
**Goal:** Complete MySQL adapter, plugin tests, config module

### v1.0.0 - Stable Release (2-3 Months)
**Goal:** MongoDB adapter, 90%+ coverage, performance optimized

---

## 🟢 PHASE 3: Plugin Tests (CURRENT)
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

| Module | Status | Target | Tests Written | Tests Remaining |
|--------|---------|--------|---------------|-----------------|
| Core (Val/QB/Mig) | ✅ 100% | 90%+ | 276 | 0 |
| PostgreSQL Adapter | ✅ 100% | 80%+ | 298 | 0 |
| API Layer (Full) | ✅ 100% | 85%+ | 79 | 0 |
| Plugins | 🔄 0% | 75%+ | 0 | ~850 |
| Integration | 🔄 0% | - | 0 | ~200 |
| Config Module | 🔄 0% | 90%+ | 0 | ~130 |
| **Total** | **~83%** | **80%+** | **653** | **~1,200** |

---

## 🚀 Immediate Next Steps

### This Week (Phase 3 - Upcoming)
1. 🔄 Auth Plugin Tests (~450 assertions)
2. ⏳ Upload Plugin Tests (~220 assertions)
3. ⏳ Hooks & Soft Delete Plugin Tests (~180 assertions)

### Next Week (Phase 3)
1. Plugin tests (auth, upload, hooks, soft-delete)
2. Integration tests
3. Config module implementation

---

## 🎯 Success Criteria

### v0.8.0 (Current Goal - 1 week remaining)
- ✅ 80%+ overall test coverage (Currently ~83%)
- ✅ Core & Adapter & API Layer tests (DONE)
- 🔄 Plugin Tests & Config Module

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

**Current Focus:** Plugin Tests (Auth, Upload, Hooks)

**Test Philosophy:** Strict tests with exact value verification, recursive structures, comprehensive edge cases, security-focused.
