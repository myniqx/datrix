# @datrix/core

## 0.3.1

### Patch Changes

- **WHERE typing:** scalar fields whose type equals `DatrixId` (string fields in uuid mode, number fields in int mode) were taken for relations and required a nested WHERE. Scalars are now resolved before the relation check.
- **Untyped results:** calls without a generic that pass a WHERE or options (`datrix.findOne("post", { slug })`) inferred `T` from that argument and returned `DatrixEntry`, so fields were not accessible. WHERE/options parameters are now `NoInfer`, and untyped calls return `DatrixRecord` on `datrix` and `datrix.raw` alike.
- **Typed field lists now match what the query builder accepts:** `select`, `orderBy`, `groupBy` and upsert `conflictOn` / `update` take scalar fields only (relations were accepted by the types and rejected at runtime); `populate` takes relation fields only. Populate dot notation (`"posts.comments"`) now type-checks, with the first two segments checked against the relation graph; `orderBy` inside populate accepts every `OrderByClause` form and is checked against the related model.
- Added the `ScalarFieldKeys`, `RelationFieldKeys`, `RelatedEntity` and `ScalarFieldList` helper types.
- Type-tests (`packages/core/type-tests`, `pnpm type-test`) compile queries against generated-style models in both id modes, typed and untyped.

## 0.3.0

### Minor Changes

- **Node 22 required:** `engines.node` is now `>=22.0.0`.
- Added `idType: "int" | "uuid"` to `defineConfig` (default `"int"`). In uuid mode every user schema's `id`, foreign key and junction column is a `uuid`; core generates UUID v7 ids before insert (creates, upserts, junction links, migration data transfers), never the database. Internal `_datrix` schemas always keep integer ids. `int` mode produces byte-for-byte the previous schema definitions, so existing projects see no migration diff.
- Added the `DatrixId` type and `DatrixRegister` module augmentation (emitted by `datrix generate types` in uuid mode); public APIs (`DatrixEntry.id`, relation refs, `findById`/`update`/`delete`, `QueryContext.createdIds`) use `DatrixId`.
- Added the `uuid` field type (canonical lowercase UUID); relation id shortcuts accept integer or uuid ids. The query builder canonicalizes relation ids and `where` values per target schema id kind (numeric coercion for int, lowercase for uuid) and rejects ids of the wrong kind.
- Added `parseIdParam(segment, schema)` for parsing path ids per schema id kind.
- UUID v7 ids are monotonic within the same millisecond (RFC 9562 counter), so ordering by `id` follows insertion order.
- Added the idType migration: switching `idType` on an existing database is detected from the stored schema snapshot and applied via `MigrationSession.applyIdTypeChange` (export → id/FK/junction rewrite in creation order → import). It is refused when combined with other schema changes.
- **Schema defaults are now applied by the executor:** on create (`create`, `createMany`, nested relation creates, raw mode, and the insert path of `upsert`), fields the caller did not provide get their `default` **before** validation. Previously a `required` field with a `default` was rejected as missing, and defaults only existed as DB-level `DEFAULT`. Only `undefined` is filled — an explicit `null` is kept — and updates (including the conflict path of `upsert`) never re-apply defaults. Defaults are validated like any other value.
- Function defaults (`default: () => value`) are now called once per row; previously they were silently dropped (adapters cannot express them in DDL). Object/array defaults are cloned per row.

## 0.2.2

### Patch Changes

- Added `upsert(model, data, { conflictOn, update? })` and `upsertMany(...)` on `datrix`, `datrix.raw` and `tx`: inserts rows, or updates the row matching `conflictOn` with the incoming values. `update` limits the overwritten fields; `update: []` leaves matched rows (and their relations) untouched.
- `conflictOn` must be a `unique: true` field or exactly the fields of a unique index; every row must set it, rows may not conflict with each other in one batch, and `update` fields must be set in every row (query builder errors otherwise). Rows are validated as creates.
- Added `beforeUpsert` / `afterUpsert` schema hooks (`afterUpsert` receives the records split into `created` / `updated`); create/update hooks do not fire for upserts.
- Adapter contract: new `upsert` QueryObject type; adapters return one `{ id }` per row and the inserted ids in `metadata.insertIds`.
- Added `QueryContext.createdIds`: the ids of the records inserted by a create or upsert, set before plugin `onAfterQuery` and schema after-hooks run (`undefined` in before-hooks and for find/count/update/delete). `afterUpsert`'s `created` / `updated` split is derived from it.
- README: added the Transactions section.

## 0.2.1

### Patch Changes

- Added `datrix.transaction(fn, options?)` for running CRUD operations atomically: commits when `fn` resolves, rolls back when it throws. Works on every adapter through the existing `Transaction` contract; nested transactions are not supported.
- Added `tx.rollback()` for intentional rollback (`transaction()` rejects with `DatrixTransactionRollbackError`); a failed operation aborts the transaction even if its error is caught (`TRANSACTION_ABORTED`), and using `tx` after it finished throws `TRANSACTION_CLOSED`.
- Added `tx.afterCommit()` / `context.afterCommit()` to defer side effects until commit (dropped on rollback). Callback errors are logged and forwarded to the new `onAfterCommitError` plugin hook and the `onAfterCommitError` transaction option; they never fail the committed operation.
- Added `context.crud` to `QueryContext`: CRUD bound to the current session, so queries from hooks join the caller's transaction (`context.datrix` still runs outside it).
- Executor now runs on an internal session (`AdapterSession` / `TransactionSession`) instead of the adapter directly; standalone writes keep their per-operation transaction.

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
