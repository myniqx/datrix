# @datrix/adapter-mysql

## 0.3.1

### Patch Changes

- Released alongside `@datrix/core` 0.3.1 (type fixes); no changes in this package.

## 0.3.0

### Minor Changes

- **Node 22 required:** `engines.node` is now `>=22.0.0`.
- Support for `idType: "uuid"` (requires `@datrix/core` 0.3.0): uuid ids and foreign keys map to `CHAR(36)`, inserted ids are read from the data instead of `insertId`, and import skips `AUTO_INCREMENT` resets for uuid tables.
- Fixed object/array `default` values on JSON columns failing on MariaDB (`CAST(... AS JSON)` is MySQL-only); they now render as a parenthesized JSON string literal, which works on MySQL 8.0.13+ and MariaDB 10.2+.

## 0.2.1

### Patch Changes

- Implemented the `upsert` query type with `INSERT ... ON DUPLICATE KEY UPDATE` (requires `@datrix/core` 0.2.2). MySQL matches on any unique key of the table, not only the `conflictOn` target.

## 0.2.0

### Minor Changes

- Fixed `$icontains`, LIKE metacharacter escaping, populate `orderBy` `NULLS FIRST/LAST` (invalid MySQL syntax), and LIMIT/OFFSET bound as DOUBLE params.
- Fixed savepoints using the prepared-statement protocol, connection leaks in the transaction lifecycle, and COUNT overcounting with relation-WHERE joins.
- Fixed `renameTable` stale schema metadata, referential-action mapping (`noAction`/`setDefault`), and FK constraint error codes.
- Fixed import's `FOREIGN_KEY_CHECKS` toggling the wrong pooled connection, and identifier escaping in the exporter/importer.
- Scoped export/import to datrix-managed tables; migration DDL implicit-commit is now tracked and surfaced as a partial-rollback error.
- Added per-relation `limit`/`offset` via window functions; batched-strategy populate `where`/`orderBy` now applies to belongsTo/hasOne.
- Added date/DECIMAL type conversion on read (`decimalNumbers: true` + schema-driven date coercion) and case-sensitive LIKE via binary collation.
- Fixed TEXT column defaults/uniques, JSON/array column defaults, `modifyColumn` dropping constraints, and enum CHECK constraints.
- Removed the never-actually-lateral "lateral-joins" strategy in favor of batched queries; self-referential manyToMany populate now resolves junction FKs from the schema.

## 0.1.1

### Patch Changes

- Initial release of @datrix/\* packages and small fixes
- Updated dependencies
  - @datrix/core@0.1.1
