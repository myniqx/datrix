# @datrix/core

## 0.2.0

### Minor Changes

- Fixed query builder validation gaps: `clone()`/`reset()` state leaks, unvalidated `orderBy`/`groupBy`/`having`, silent `NaN`/`0` id coercion, dropped relation-array inputs, `populate: { rel: false }` behaving like `true`, and unbounded dot-notation populate depth.
- Added `UPDATE` without WHERE guard (matches the existing `DELETE` guard); enforced number-only ID policy consistently across builder/executor/validator.
- Fixed nested-update relations re-creating child records once per matched row instead of once per update; fixed post-write refetch crashing on `select: undefined`.
- Fixed self-referential manyToMany junctions (`friends`-style relations) generating colliding FK column names.
- Fixed `onCreateQueryContext` plugin failures failing open instead of aborting the query.
- Fixed self-referential hasOne/hasMany losing their FK field, FK-name collisions between multiple relations to the same model, and junction FK `references.table` ignoring custom `tableName`.
- Added `tableName → modelName` index for O(1) lookups; fixed schema-extension registration, retry-after-failed-init, and adapter `connect()` ordering.
- Added `countMany`/`groupBy`/`having`/`distinct` query API with builder-level validation.
- Fixed regex `pattern` validation statefulness, string-ID/number-ID inconsistency across validator layers, discarded validator output, falsy-value FK fallback, and `Infinity` passing number validation.
- Fixed migration differ false positives (reference-equality comparison of `pattern`/`items`/`default`, `required`/`unique` normalization), `renameTable` running post-commit, junction data-transfer FK name mismatches, and non-executable generated `dataTransfer` stubs.
- Added `hasOne` hidden FK `unique: true` constraint so adapters can enforce one-to-one at the DB level.

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

## 0.1.1

### Patch Changes

- Initial release of @datrix/\* packages and small fixes
