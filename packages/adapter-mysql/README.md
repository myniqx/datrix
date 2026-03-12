# Forja MySQL Adapter

MySQL adapter for the Forja framework. Provides full CRUD, relation population, migration support, and native referential integrity enforcement.

## Installation

```bash
pnpm add forja-adapter-mysql
```

Requires `mysql2` driver as a peer dependency.

## Configuration

```typescript
import { MySQLAdapter } from "forja-adapter-mysql";

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

- **MySQL 8.0+** or **MariaDB 10.5+**. The adapter relies on `LATERAL` joins and JSON aggregation functions (`JSON_ARRAYAGG`, `JSON_OBJECT`) for efficient population.
  - MySQL 8.0.14+ required for `LATERAL` join support.
  - MariaDB 10.5+ required for `JSON_ARRAYAGG` support.
- Native foreign key constraints are fully supported and automatically managed by the framework migrations.
- Uses `mysql2` driver which supports both MySQL and MariaDB via the MySQL wire protocol.

## Architecture

```text
src/
├── adapter.ts                 # Main adapter logic & database connection handling
├── query-translator.ts        # Translates Forja QueryObjects into raw SQL statements
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

## Populate Strategies

Three strategies are employed dynamically based on query depth and complexity:

- **JSON Aggregation** — Default for single-level relations. Uses `JSON_ARRAYAGG` and `JSON_OBJECT` in subqueries. Offloads mapping to the database, reducing network payload.

- **LATERAL Joins** — Used when populate options include `limit`, `offset`, `where`, or `orderBy`. Requires MySQL 8.0.14+ / MariaDB 10.3+.

- **Batched IN Queries** — Fallback for deep nesting (depth > 1) or high cardinality. Collects parent IDs and issues targeted `WHERE id IN (...)` queries, stitching results in Node.js memory.

## Known Limitations

- **Implicit Commits:** As mentioned above, DDL operations cannot be transactionally undone if a migration crashes. Applies to both MySQL and MariaDB.
- **Strict Mode Requirement:** It is highly recommended to run the server with `sql_mode` set to strict (`STRICT_ALL_TABLES` or `STRICT_TRANS_TABLES`). Without strict mode, MySQL/MariaDB silently truncates data or converts types instead of raising errors.

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
docker run -d --name mysql-test -e MYSQL_ROOT_PASSWORD=forja -e MYSQL_USER=forja -e MYSQL_PASSWORD=forja -e MYSQL_DATABASE=forja -p 3306:3306 mysql:8.0

# MariaDB 10.5
docker run -d --name mariadb-test -e MYSQL_ROOT_PASSWORD=forja -e MYSQL_USER=forja -e MYSQL_PASSWORD=forja -e MYSQL_DATABASE=forja -p 3307:3306 mariadb:10.5
docker exec -it mariadb-test mariadb -uroot -pforja -e "GRANT ALL PRIVILEGES ON *.* TO 'forja'@'%'; FLUSH PRIVILEGES;"
```
