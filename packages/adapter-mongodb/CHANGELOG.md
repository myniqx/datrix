# @datrix/adapter-mongodb

## 0.3.1

### Patch Changes

- Released alongside `@datrix/core` 0.3.1 (type fixes); no changes in this package.

## 0.3.0

### Minor Changes

- **Node 22 required:** `engines.node` is now `>=22.0.0`.
- Support for `idType: "uuid"` (requires `@datrix/core` 0.3.0): uuid collections skip id counters; foreign-key checks and `onDelete` follow uuid foreign keys; import skips counter resets for uuid tables.

## 0.2.1

### Patch Changes

- Implemented the `upsert` query type with `bulkWrite` `updateOne` + `upsert: true` (requires `@datrix/core` 0.2.2).

## 0.2.0

### Minor Changes

- Fixed `$icontains`, `$exists`/`$notNull` semantics, and multiple pattern operators on the same field silently overwriting each other.
- Fixed relation-shortcut WHERE conditions silently vanishing, and unvalidated field/operator keys reaching MongoDB (`$where` injection).
- Fixed `select: undefined` hidden-column leakage, populated-refetch losing scalar fields, and hasOne `$unwind` row duplication.
- Fixed DELETE returning no rows, `limit: 0` with populate, nested-relation WHERE on `id` dropping conditions, and `renameTable` stale schema metadata.
- Fixed `alterTable` not honoring its transaction session, `getNextIds` upsert races, and infinite recursion on cyclic cascade deletes.
- Added `distinct`/`groupBy`/`having` support via aggregation pipeline; per-relation `limit`/`offset` now windows in-memory per parent.
- Added nested-relation filter resolution (and rejection with a clear error) for populate-level `where`.
- Scoped export/import to datrix-managed collections with staged/atomic rename-based import.
- Gated debug logging behind an explicit env var; removed dead code.

## 0.1.1

### Patch Changes

- Initial release of @datrix/\* packages and small fixes
- Updated dependencies
  - @datrix/core@0.1.1
