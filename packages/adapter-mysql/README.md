# Datrix MySQL Adapter

MySQL adapter for the Datrix framework. Provides full CRUD, relation population, migration support, and native referential integrity enforcement.

## Installation

```bash
pnpm add @datrix/adapter-mysql
```

Requires `mysql2` driver as a peer dependency.

## Configuration

```typescript
import { MySQLAdapter } from "@datrix/adapter-mysql";

const adapter = new MySQLAdapter({
  host: "localhost",
  port: 3306,
  user: "root",
  password: "password",
  database: "myapp",
  connectionLimit: 10,
  // Optional
  ssl: {
    rejectUnauthorized: false
  }
});
```

## Requirements

- **MySQL 8.0.16+** or **MariaDB 10.5+**. The adapter relies on:
  - Window functions (`ROW_NUMBER() OVER`) for per-parent populate `limit`/`offset`.
  - JSON aggregation functions (`JSON_ARRAYAGG`, `JSON_OBJECT`) for efficient population (MariaDB 10.5+).
  - Parenthesized expression defaults (`DEFAULT (expr)`, MySQL 8.0.13+) for `json`/`array` field defaults.
  - Enforced `CHECK` constraints (MySQL 8.0.16+) for `enum` fields.
- Native foreign key constraints are fully supported and automatically managed by the framework migrations.
- Uses `mysql2` driver which supports both MySQL and MariaDB via the MySQL wire protocol.

## Architecture

```text
src/
├── adapter.ts                 # Main adapter logic & database connection handling
├── query-translator.ts        # Translates Datrix QueryObjects into raw SQL statements
├── helpers.ts                 # SQL identifier escaping, syntax builders
├── types.ts                   # Type mappings between TypeScript and MySQL
├── index.ts                   # Public package exports
└── populate/
    ├── index.ts
    ├── populator.ts           # Strategy selection and batched recursive fetching
    ├── aggregation-builder.ts # Generates LATERAL JSON subqueries for high performance
    ├── join-builder.ts        # Dynamic JOIN string constructor
    └── result-processor.ts    # Stringified JSON parsing and final data formatting
```

## Migration

Migration operations map strictly to native SQL DDL commands (`CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`, vs.).

**Warning on Rollbacks:** DDL statements (`CREATE TABLE`, `ALTER TABLE`, etc.) trigger **implicit commits** in both MySQL and MariaDB. This means if a migration contains DDL and DML operations and fails halfway, the structural changes cannot be rolled back via the transaction. This is a fundamental MySQL/MariaDB behavior, not a limitation of the adapter.

To make this visible, `Transaction.rollback()` still performs the rollback but **throws a `DatrixAdapterError`** when DDL statements were executed inside the transaction — the error states that the rollback is partial and the database may be left half-migrated. Savepoints are equally destroyed by implicit commits.

## Populate Strategies

Two strategies are employed dynamically based on query depth and complexity:

- **JSON Aggregation** — Default for single-level relations without options. Uses `JSON_ARRAYAGG` and `JSON_OBJECT` in subqueries. Offloads mapping to the database, reducing network payload.

- **Batched IN Queries** — Used for populate options (`limit`, `offset`, `where`, `orderBy`) and/or nested populate. Collects parent IDs and issues targeted `WHERE fk IN (...)` queries, stitching results in Node.js memory. Populate `limit`/`offset` apply **per parent row** via `ROW_NUMBER() OVER (PARTITION BY fk)`. On `belongsTo`/`hasOne` relations only `where` is meaningful ("populate only when the target matches, else `null`"); `orderBy`/`limit`/`offset` have no per-parent effect on a single-record relation and are not applied.

## Export / Import

- Scope is limited to **datrix-managed tables**: the internal `_datrix*` tables plus every table registered in the `_datrix` meta table. Foreign (host application) tables in a shared database are never exported nor dropped.
- **Import is wipe-and-restore and is NOT atomic** (MySQL DDL cannot run in a transaction). A failure mid-import leaves the datrix tables partially restored; re-import the archive to recover.
- The whole import runs on one dedicated connection with `FOREIGN_KEY_CHECKS = 0`, re-enabled on the same connection before it returns to the pool.

## Known Limitations

- **Implicit Commits:** As mentioned above, DDL operations cannot be transactionally undone if a migration crashes. Applies to both MySQL and MariaDB.
- **Strict Mode Requirement:** It is highly recommended to run the server with `sql_mode` set to strict (`STRICT_ALL_TABLES` or `STRICT_TRANS_TABLES`). Without strict mode, MySQL/MariaDB silently truncates data or converts types instead of raising errors.
- **Case sensitivity:** Tables are created with the case-insensitive `utf8mb4_unicode_ci` collation. The adapter forces case-sensitive semantics for `$like`/`$contains`/`$startsWith`/`$endsWith`/`$regex` via `COLLATE utf8mb4_bin` (which may bypass indexes on those comparisons); `$ilike`/`$icontains` use `LOWER()`. A `RegExp` value with the `i` flag stays case-insensitive.
- **TEXT columns:** `string` fields without `maxLength` map to `TEXT`, which cannot carry `DEFAULT` or `UNIQUE` in MySQL — the adapter throws and asks for an explicit `maxLength` (VARCHAR) instead of silently changing storage semantics.
- **`timezone` default is `"local"`:** Date round-trips are consistent only if every connecting process shares the server's notion of local time. Set `timezone: "Z"` for UTC storage.

## Testing

```bash
# MySQL (default port 3306)
ADAPTER=mysql pnpm test

# MariaDB (default port 3307)
ADAPTER=mariadb pnpm test
```

Docker setup for test databases:

```bash
# MySQL 8.0
docker run -d --name mysql-test -e MYSQL_ROOT_PASSWORD=datrix -e MYSQL_USER=datrix -e MYSQL_PASSWORD=datrix -e MYSQL_DATABASE=datrix -p 3306:3306 mysql:8.0

# MariaDB 10.5
docker run -d --name mariadb-test -e MYSQL_ROOT_PASSWORD=datrix -e MYSQL_USER=datrix -e MYSQL_PASSWORD=datrix -e MYSQL_DATABASE=datrix -p 3307:3306 mariadb:10.5
docker exec -it mariadb-test mariadb -uroot -pdatrix -e "GRANT ALL PRIVILEGES ON *.* TO 'datrix'@'%'; FLUSH PRIVILEGES;"
```
