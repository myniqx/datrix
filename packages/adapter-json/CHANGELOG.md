# @datrix/adapter-json

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
