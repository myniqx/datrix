# @datrix/adapter-postgres

## 0.2.0

### Minor Changes

- Fixed `$icontains`, LIKE metacharacter escaping, `integer: true` column typing, and table-qualified ORDER BY/GROUP BY (fixes ambiguous-column errors under populate joins).
- Fixed COUNT overcounting with relation-WHERE joins, `renameTable` stale schema metadata, and connection leaks in the transaction lifecycle.
- Fixed UPDATE/DELETE with relation-WHERE joins (id-subquery translation replaces the broken JOIN→FROM/USING rewrite).
- Fixed `select: undefined` refetch crashes, batched-strategy populate `where`/`orderBy`, and hasOne row duplication (correlated subquery instead of JOIN+GROUP BY).
- Added per-relation `limit`/`offset` support via window functions; self-referential manyToMany populate now resolves junction FKs from the schema.
- Added `modifyColumn` support for TYPE/NOT NULL/DEFAULT/UNIQUE changes and enum CHECK constraints.
- Scoped export/import to datrix-managed tables, escaped identifiers in the exporter/importer, and wrapped import in a transaction.
- Removed dead lateral-join/aggregation code paths; gated debug SQL logging behind an explicit env var.

## 0.1.1

### Patch Changes

- Initial release of @datrix/\* packages and small fixes
- Updated dependencies
  - @datrix/core@0.1.1
