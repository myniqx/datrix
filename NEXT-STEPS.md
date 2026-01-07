# Forja - Next Steps & Implementation Roadmap

**Last Updated:** 2026-01-07
**Project Status:** v0.79.0 (~85% complete, ~23,000 LOC)
**Test Coverage:** 756 tests written (Core + Adapter + API Layer + Plugins Verified)

---

## 📊 Current State Summary

### ✅ Implementation Complete
- **Core Module** (~3,800 LOC) - Schema, Validator, Query Builder, Migration, **Dispatcher (New)**
- **PostgreSQL Adapter** (~1,800 LOC) - Connection, query translation, type mapping, **Strict Validation (New)**
- **API Layer** (~2,500 LOC) - Parser, handler, serializer
- **All Plugins** (~1,600 LOC) - Auth, upload, hooks, soft-delete
- **CLI Tools** - Migrate, generate, dev commands

### ✅ Tests Completed (756 tests)
All core, adapter, API layer, and critical plugin hooks are verified.

| Module | Status | Tests | Key Improvements |
|--------|--------|-------|------------------|
| **Core** | ✅ 100% | 293 | **Dispatcher:** Plugin orchestration, Error isolation<br>**Validation:** Strict QueryObject checks, `meta` support |
| **Adapter** | ✅ 100% | 305 | **PostgreSQL:** Transaction, Schema, Index, **Runtime Guards** |
| **API Layer** | ✅ 100% | 79 | **Parser:** Recursive Where, String Populate<br>**Handler:** Partial Update, Context Adapters |
| **Plugins** | ✅ 90% | 79 | **Soft-Delete:** Interceptor verified<br>**Hooks:** Lifecycle verified<br>**Auth/Upload:** Core logic tested |

### 🔄 In Progress
- **Phase 5: Persistence & Integration**
- **Error Handling Refactor** (Replacing 'any' with 'Result/Error' variants)
- **MySQL Adapter Preparation**

### ❌ Remaining Gaps
1. **Config Module** - Not implemented
2. **E2E Tests** - Not started
3. **MySQL/MongoDB Adapters** - Not started

---

## 🎯 Version Milestones

### v0.8.0 - Testing Foundation (Current - 1 week)
**Goal:** 85%+ test coverage, strict core stability, stable plugin dispatcher.

### v0.9.0 - Production Readiness (1 Month)
**Goal:** Complete MySQL adapter, config module, formal error handling.

### v1.0.0 - Stable Release (2-3 Months)
**Goal:** MongoDB adapter, 90%+ coverage, performance optimized.

---

## 🔵 PHASE 5: Persistence & Integration (NEXT)
**Priority:** HIGH
**Timeline:** 3-5 days
**Goal:** Advanced error handling and full-stack flow verification.

### 5.1 Error Handling & Type Safety
- [x] **Adapter Error Mapping**
  - Map native Postgres errors to internal `QueryError` codes (e.g., `UNIQUE_VIOLATION`, `FOREIGN_KEY_VIOLATION`).
  - Ensure consistent `Result<T, E>` usage across all adapter methods.
- [ ] **Type Refactoring**
  - Replace remaining `any` usage in `Dispatcher` and `QueryBuilder` with `unknown` or specific interfaces.
  - Finalize `QueryResult` generic propagation.

### 5.2 Integration Tests (~100 assertions)
- [ ] **`tests/integration/full-stack.test.ts`**
  - Complete CRUD workflow: Schema → Migration → API → Database.
  - Relations & Populate deep nesting testing.
- [ ] **`tests/integration/transaction-flow.test.ts`**
  - Multi-plugin transaction safety.
  - Rollback state verification after plugin failure.

---

## 🟣 PHASE 6: Config Module Implementation
**Priority:** MEDIUM
**Timeline:** 2-3 days

- [ ] **`src/core/config/loader.ts`** (Environment support + `forja.config.ts`)
- [ ] **`src/core/config/validator.ts`** (Strict schema for configuration)

---

## 🚀 Immediate Next Steps

### 1. Type Safety Cleanup
Finalize the "No Any" objective in core modules (Dispatcher, QueryBuilder) and ensure `Result` propagation is complete.

### 2. Integration Tests
Develop `full-stack.test.ts` to verify the entire flow from Schema/Migration to API and Database.

---

**Current Focus:** Phase 5 - Integration Testing & Type Safety Cleanup

**Test Philosophy:** Strict tests, exact value verification, fail-fast on malformed queries.
