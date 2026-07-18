# @datrix/adapter-mysql

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
