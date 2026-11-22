# @datrix/adapter-json

## 0.3.1

### Patch Changes

- Released alongside `@datrix/core` 0.3.1 (type fixes); no changes in this package.

## 0.3.0

### Minor Changes

- **Node 22 required:** `engines.node` is now `>=22.0.0`.
- Support for `idType: "uuid"` (requires `@datrix/core` 0.3.0): stored ids are compared without forcing numbers, uuid tables skip the auto-increment counter, and `onDelete` follows uuid foreign keys.

## 0.2.1

### Patch Changes

- Implemented the `upsert` query type (requires `@datrix/core` 0.2.2).
- The lock-timeout error now hints to use the `tx` argument when the global `datrix` is called from inside `datrix.transaction()`.
- Fixed concurrent writers both acquiring the lock: an empty or unreadable lock file (still being written by its holder) is no longer treated as stale until it has not changed for `staleTimeout`, and acquirers within one process now queue so only one competes for the lock file.

## 0.2.0

### Minor Changes

- Fixed WHERE operator gaps (`$icontains`, `$regex`, LIKE metachar escaping) and sort-before-projection ordering.
- Fixed hasOne/belongsTo populate filtering, relation FK resolution, and self-referential manyToMany junction lookups.
- Fixed double lock release, `renameTable` stale schema metadata, and corrupt-file error reporting.
- Added ownership-token + heartbeat locking, atomic (write-then-rename) file writes, and a staged/atomic importer.
- Added `AsyncLocalStorage`-based transaction context; concurrent transactions now queue instead of throwing.
- Added copy-at-boundary row handling so populate/select no longer mutate the shared cache.
- Normalized date fields to ISO storage with correct comparison/coercion on read.
- Added an in-memory schema index (`_datrix` lookups) for O(1) model/table resolution.
- `groupBy`/`having` now throw a clear error instead of silently ignoring the clause; later added full support in count/select.
- Fixed batch-update unique-constraint checks and junction insert dedup to use upsert semantics.

## 0.1.2

### Patch Changes

- 7d7915b: Add password reset flow to auth system, fix WhereClause optional fields, update adapter-json readme
  - `AuthenticatedUser` extended with `resetToken` and `resetTokenExpiry` fields
  - `AuthConfig` now accepts a second generic `TUser extends DatrixEntry` for typed user population in callbacks
  - `AuthConfig.passwordReset` block added: `tokenExpirySeconds` and `onForgotPassword` callback
  - `DEFAULT_API_AUTH_CONFIG` updated with `forgotPassword` and `resetPassword` endpoint defaults
  - `WhereClause` fix: optional scalar fields (`field?: string`) no longer resolve to `never` in typed where clauses
  - New endpoints: `POST /auth/forgot-password` and `POST /auth/reset-password`
  - `AuthManager` and `AuthHandlerConfig` updated with `TUser` generic
  - `@datrix/adapter-json` README updated

- Updated dependencies [7d7915b]
  - @datrix/core@0.1.2

## 0.1.1

### Patch Changes

- Initial release of @datrix/\* packages and small fixes
- Updated dependencies
  - @datrix/core@0.1.1
