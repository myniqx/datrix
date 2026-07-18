# adapter-mysql — Review Findings

> **STATUS (2026-07-13): ALL RESOLVED.** Section A (A1–A17) and Section B (Parts 1–8) were
> fixed in a single session. Decisions taken: Part 1 → scope limited to datrix-managed tables
> (`getManagedTables()`), wipe-and-restore documented as non-atomic; Part 2 → Option 1
> (`ddlExecuted` flag, rollback throws a partial-rollback error); Part 3 → Option 1
> (ROW_NUMBER window, per-parent limit/offset); Part 4 → belongsTo/hasOne apply `where` in all
> strategies, populate-where relation joins are wired into the batch SQL; Part 5 →
> `decimalNumbers: true` + date/number conversion in `convertMySQLTypes`; Part 6 → Option 1
> (`COLLATE utf8mb4_bin` on non-`i` variants incl. `$regex`; RegExp `i` flag respected);
> Part 7 → (1)b throw on TEXT+default/unique, (2) `DEFAULT (expr)` + floor raised to MySQL
> 8.0.16, (3) full definition via `buildColumnDefinition` (UNIQUE excluded from MODIFY),
> (4) VARCHAR + CHECK constraint; Part 8 → select normalized once in `MySQLPopulator.populate()`
> from the schema (non-hidden scalar fields).
>
> Additionally (from core issue 2.4): the `"lateral-joins"` strategy (never actually LATERAL,
> and buggy) was REMOVED — complex options go through batched queries; junction FK names are
> now resolved from the junction schema via `populate/junction.ts` (self-referential manyToMany
> populate works). Verification: `tsc --noEmit` clean; e2e runs still pending (no unit tests by
> project decision — all testing is end-to-end).

Review scope: `packages/adapter-mysql/src/**` (uses the `mysql2` driver directly; no separate
driver-shell package), checked against the core→adapter contract in `packages/core/info_core.md`.
Core-side defects (issues 1.4, 1.8, 1.11, 2.2, etc.) are NOT repeated here — only how the
adapter must survive them.

Issues are split into two groups:

- **Section A — Mechanical fixes**: no design decision needed; hand each item (or the whole
  section) directly to a Sonnet agent with the instructions written below.
- **Section B — Decision-required issues**: each Part is sized for one session; contains the
  problem, `file:line` references, and solution options with a recommendation.

---

## Section A — Mechanical fixes (delegate to Sonnet agent as-is)

### A1. `$icontains` not implemented — throws "Unsupported operator"

- `packages/adapter-mysql/src/query-translator.ts:1017-1050`
- Core's operator list includes `$icontains`, but `translateComparisonOperator` has no case for
  it → falls to `default` (query-translator.ts:1045-1050) and throws.
- Fix: add `case "$icontains":` returning the same SQL currently used for `$contains`
  (`LOWER(${fieldName}) LIKE LOWER(?)` with `%value%`). Do NOT change `$contains` here — its
  case-sensitivity is a decision item (Section B Part 6); just make `$icontains` work.

### A2. LIKE metacharacters not escaped for adapter-added patterns

- `packages/adapter-mysql/src/query-translator.ts:1017-1027`
- Contract (§4): for `$startsWith`/`$endsWith`/`$contains`/`$icontains`/`$notContains` the
  adapter adds the `%` and MUST escape `%` and `_` in the user value. Currently
  `` `%${String(value)}%` `` is passed raw → a value like `50%_off` behaves as wildcards.
- Fix: add `escapeLikePattern(v: string): string` in `helpers.ts` that escapes `\`, `%`, `_`
  (`v.replace(/[\\%_]/g, (m) => "\\" + m)`), use it in those five operators, and append
  `ESCAPE '\\\\'` to their SQL so the escape char is explicit (independent of
  `NO_BACKSLASH_ESCAPES` mode). Do NOT touch `$like`/`$ilike` (pattern is user-provided by
  contract).

### A3. Populate `orderBy` emits `NULLS FIRST/LAST` — invalid MySQL syntax

- `packages/adapter-mysql/src/populate/populator.ts:264-274` (hasMany, lateral strategy),
  `:333-344` (manyToMany, lateral strategy), `:1052-1061` (`buildBatchOptionsClause`, used by
  the batched strategy and nested populate).
- All three sites append `` ` NULLS ${item.nulls.toUpperCase()}` `` directly. MySQL has no
  `NULLS FIRST/LAST` — any populate with `orderBy: [{ field, direction, nulls }]` produces a
  syntax error. The main translator already has the correct CASE workaround
  (`query-translator.ts:610-626`).
- Fix: extract the CASE-based orderBy mapping from `translateOrderBy` into a shared helper
  (parameterized on a `t.`-prefix/alias) and use it at the three populate sites.

### A4. LIMIT/OFFSET bound as prepared-statement params — mysql2 sends numbers as DOUBLE

- `packages/adapter-mysql/src/query-translator.ts:411-422` — `LIMIT ?` / `OFFSET ?` with the
  values pushed via `addParam`. These queries run through `MySQLClient.execute()` (prepared
  statements): `adapter.ts:226`, `populate/populator.ts:115,164,427`. Also
  `export-import/exporter.ts:60-64` (`LIMIT ? OFFSET ?` via `pool.execute`).
- Verified in the installed driver (`mysql2@3.15.3/lib/packets/execute.js:33-37`): every JS
  `number` is encoded as `Types.DOUBLE` in the binary protocol. MySQL versions before 8.0.22
  (and MariaDB) reject non-integer-typed LIMIT/OFFSET params with
  `ER_WRONG_ARGUMENTS: Incorrect arguments to mysqld_stmt_execute`. The package README/docblock
  claims MySQL 5.7+ / MariaDB 10.2+ support (`src/index.ts:5`). Verify with an e2e run against
  MySQL < 8.0.22 or MariaDB.
- Fix: never bind LIMIT/OFFSET as params. In `translateSelect`, validate with
  `Number.isInteger(query.limit) && query.limit >= 0` (throw `throwQueryError` otherwise) and
  inline the literal (`LIMIT ${query.limit}`); same for offset and the `2147483647` fallback.
  Same treatment in `exporter.ts` (values are internal constants there — inline directly).
  Populate paths using `client.query()` (non-prepared) are unaffected — leave them.

### A5. `savepoint`/`rollbackTo`/`release` use `connection.execute()` — SAVEPOINT is not allowed in the prepared-statement protocol

- `packages/adapter-mysql/src/adapter.ts:1256-1303`
- `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` / `RELEASE SAVEPOINT` are not in MySQL's "SQL Syntax
  Permitted in Prepared Statements" list; `execute()` prepares the statement and the server
  answers `ER_UNSUPPORTED_PS` ("This command is not supported in the prepared statement
  protocol yet"). Verify with an e2e run that exercises savepoints.
- Fix: replace `this.connection.execute(...)` with `this.connection.query(...)` in
  `savepoint`, `rollbackTo`, and `release`.

### A6. Connection leaks in the transaction lifecycle

- `packages/adapter-mysql/src/adapter.ts:415-425` (`beginTransaction`): if
  `connection.beginTransaction()` throws, the acquired connection is never released.
  Fix: try/catch around `beginTransaction()`, `connection.release()` before rethrowing.
- `packages/adapter-mysql/src/adapter.ts:1207-1218` (`commit`) and `:1239-1250` (`rollback`):
  if `connection.commit()`/`connection.rollback()` throws, `this.connection.release()` is never
  called → pool exhaustion. Fix: release exactly once on both success and failure paths (e.g. a
  `released` flag + `finally`).

### A7. COUNT with relation-WHERE joins overcounts

- `packages/adapter-mysql/src/query-translator.ts:262-278`
- For `type: "count"` with a nested relation WHERE on hasMany/manyToMany, the LEFT JOINs
  (`whereResult.joins`) multiply rows. The select path compensates with `SELECT DISTINCT`
  (query-translator.ts:344-356); the count path does not → `COUNT(*)` counts joined rows, not
  matching entities.
- Fix: when `whereResult.joins.length > 0`, emit
  `SELECT COUNT(DISTINCT ${escapeIdentifier(query.table)}.\`id\`) as \`count\``.

### A8. ORDER BY / GROUP BY / HAVING columns are not table-qualified

- `packages/adapter-mysql/src/query-translator.ts:610-626` (`translateOrderBy`), `:386-394`
  (select groupBy), `:280-285` (count groupBy), `:396-402` / `:287-292` (having).
- WHERE and SELECT columns are qualified with the main table, but ORDER BY/GROUP BY emit bare
  `` `createdAt` ``. As soon as populate (json-aggregation LEFT JOINs) or relation-WHERE joins
  add another table with the same column name, MySQL throws error 1052
  (`Column 'createdAt' in order clause is ambiguous`).
- Fix: pass the escaped main table name into `translateOrderBy` and the groupBy mappings and
  prefix every column, the same way `translateSelectClause` (query-translator.ts:430-446) does.
  HAVING can stay unqualified (it may legitimately reference aliases like `count`).

### A9. UPDATE id-prefetch missing DISTINCT

- `packages/adapter-mysql/src/adapter.ts:204-221`
- The pre-UPDATE `SELECT table.\`id\` FROM table <joins> WHERE ...` used to emulate RETURNING
  duplicates ids when the relation-WHERE joins are hasMany/manyToMany (row multiplication).
  Core refetches by these ids; duplicates are at best wasted work, at worst duplicate rows in
  the returned result.
- Fix: `SELECT DISTINCT ${escapedTable}.\`id\` ...` in the prefetch SQL.

### A10. `renameTable` leaves stale `tableName` inside the stored schema JSON

- `packages/adapter-mysql/src/adapter.ts:568-607`
- The `_datrix` row's `key` is updated (`table:<old>` → `table:<new>`, adapter.ts:588-597) but
  the JSON in `value` still contains `tableName: "<old>"`. A later `getTableSchema(newName)`
  returns a schema whose `tableName` is wrong; migration diffing then sees a phantom rename
  forever.
- Fix: after updating the key, read the row, `JSON.parse`, set `tableName = to`, write back
  (same pattern as `applyOperationsToMetaSchema`, adapter.ts:891-981). Also scan all `_datrix`
  rows and patch `fields.*.references.table === from` → `to` in the same loop (FKs in other
  schemas that point to the renamed table go stale too).

### A11. Meta-value parsing assumes the `value` column comes back as a string

- `packages/adapter-mysql/src/adapter.ts:836` (`getTableSchema`) and `:912-914`
  (`applyOperationsToMetaSchema`): `JSON.parse(rows[0]!["value"] as string)`.
- mysql2 auto-parses JSON-typed columns into objects. If core defines `_datrix.value` as a
  `json` field, the read path receives an object and `JSON.parse(object)` throws
  (`SyntaxError: Unexpected token o`). Whether it is `string` or `json` cannot be confirmed
  from the adapter alone — verify with e2e — but the defensive fix is free.
- Fix: `const v = rows[0]!["value"]; const schema = typeof v === "string" ? JSON.parse(v) : v;`
  in both places.

### A12. `onDelete`/`onUpdate` camelCase values are not mapped to SQL

- `packages/adapter-mysql/src/adapter.ts:474-479` (`createTable`) and
  `packages/adapter-mysql/src/export-import/importer.ts:117-122` (`addForeignKeys`).
- Only `"setNull"` is special-cased; everything else is `toUpperCase()`d. `"noAction"` →
  `NOACTION` and `"setDefault"` → `SETDEFAULT` are invalid SQL and break `createTable` for any
  schema using them.
- Fix: add a shared helper `mapReferentialAction(a: string): string` in `helpers.ts` mapping
  `cascade→CASCADE`, `restrict→RESTRICT`, `setNull→SET NULL`, `noAction→NO ACTION`,
  `setDefault→SET DEFAULT` (throw on unknown), and use it in both files.

### A13. `mapMySQLError` misses FK constraint codes (duplicate of MySQLClient's map)

- `packages/adapter-mysql/src/adapter.ts:343-347` maps only `1062/ER_DUP_ENTRY`;
  `packages/adapter-mysql/src/mysql-client.ts:21-32` correctly maps `ER_DUP_ENTRY`,
  `ER_NO_REFERENCED_ROW_2` (1452) and `ER_ROW_IS_REFERENCED_2` (1451). Errors reaching
  `mapMySQLError` (anything not funneled through `MySQLClient`) lose the
  `ADAPTER_FOREIGN_KEY_CONSTRAINT` code.
- Fix: export `mysqlCodeToAdapterCode` from `mysql-client.ts` and use it in `mapMySQLError`
  instead of the inline `if`.

### A14. Import toggles `FOREIGN_KEY_CHECKS` on the pool — wrong connection, and it leaks back into the pool

- `packages/adapter-mysql/src/export-import/importer.ts:19` and `:49`
- `SET FOREIGN_KEY_CHECKS = 0` is a **session** variable. Executing it via `this.pool.execute`
  applies it to whichever pooled connection happens to serve that one statement; the subsequent
  `dropTable`/`createTable`/`insertChunk` calls run on the pool and may land on *different*
  connections where FK checks are still ON (drop order then fails on FK-referenced tables).
  Worse, the connection that ran `SET ... = 0` returns to the pool with FK checks disabled —
  unrelated application queries later reuse it unchecked; the `finally` re-enable may run on
  yet another connection.
- Fix: acquire one dedicated connection for the whole import
  (`const conn = await this.pool.getConnection()`), run `SET FOREIGN_KEY_CHECKS` on it, pass it
  to every `adapter.dropTable(..., conn, ...)`, `adapter.createTable(..., conn, ...)` call and
  use it in `insertChunk`/`addForeignKeys`/`resetAutoIncrement`; release it in `finally` after
  re-enabling FK checks on that same connection.

### A15. Exporter/importer bypass identifier escaping (SQL injection via import archive)

- `packages/adapter-mysql/src/export-import/importer.ts:75-77` (table + column names from
  archive rows, raw `` `\`${name}\`` `` without validation or backtick doubling), `:105-127`
  (`addForeignKeys`: table, field, `references.table`/`column`, constraint name), `:130-139`
  (`resetAutoIncrement`), and `packages/adapter-mysql/src/export-import/exporter.ts:43`.
- Archive content is external input; a table/column name containing a backtick breaks out of
  the identifier. `escapeIdentifier` (helpers.ts:16-36) already validates charset and length —
  it is simply not used here. Note `addForeignKeys`'s generated constraint name
  `fk_<table>_<field>` can also exceed MySQL's 64-char identifier limit; truncate or hash.
- Fix: import `escapeIdentifier` from `../helpers` and route every identifier in
  exporter.ts/importer.ts through it; clamp the generated constraint name to 64 chars.

### A16. `ResultProcessor` all-null heuristic can null out a legitimate row

- `packages/adapter-mysql/src/populate/result-processor.ts:75-89`
- The SQL already guards belongsTo/hasOne with `CASE WHEN rel.id IS NOT NULL`
  (aggregation-builder.ts:185), so a JSON object here is a real row — but if `id` was not in
  the populate `select` and all selected fields happen to be NULL (e.g. `select: ["bio"]`),
  the heuristic converts the legit object to `null`.
- Fix: if the object has an `id` key, decide by `id === null` alone; only fall back to the
  all-fields-null heuristic when `id` is absent from the object.

### A17. Dead code removal (includes a latent param-binding bug)

Never referenced from any live path — the populator's "lateral-joins" strategy builds its own
batched SQL and `buildJoins` is only ever called with `"json-aggregation"`
(populator.ts:781). Delete:

- `packages/adapter-mysql/src/populate/join-builder.ts:287-342`
  (`buildHasOneLateralJoin`, `buildHasManyLateralJoin`), `:426-483`
  (`buildManyToManyLateralJoin`), the `strategy === "lateral-joins"` branches in
  `buildRelationJoin` (`:131-137`, `:142-149`, `:153-160`), and `hasComplexOptions`
  (`:485-501`) — `generateJoinSQL` drops lateral clauses anyway (`:512-515`).
- `packages/adapter-mysql/src/populate/aggregation-builder.ts:308-402` (`buildLateralSubquery`)
  and `:404-491` (`buildManyToManyLateralSubquery`) — NOTE: both contain a real bug
  (`translateWhere(options.where, 1)` at `:365` and `:466` embeds `?` placeholders but throws
  the params away, and `LIMIT ${options.limit}` is interpolated unvalidated) — one more reason
  not to resurrect them without review. `buildOrderBy` (`:535-552`) survives only if A3 reuses
  it; otherwise prune.
- `packages/adapter-mysql/src/populate/result-processor.ts:121-163` (`processFlatJoinResults`),
  `:165-199` (`extractMainRecord`), `:201-258` (`attachRelations`), `:260-285`
  (`extractRelationData`), `:303-347` (`processLateralResults`). Keep `isArrayRelation`
  (used by `processRow`).
- `packages/adapter-mysql/src/populate/types.ts:39-48` (`ProcessedResult`), `:72-80`
  (`PopulateContext`); prune `JoinClause.type: "LATERAL"` / `isLateral` after the join-builder
  deletions.
- `packages/adapter-mysql/src/mysql-client.ts:19` — `IS_DEBUG = ... && false` is permanently
  false; either remove the debug block entirely or gate it on an explicit env var
  (`DATRIX_DEBUG=1`), not a hardcoded `false`.
- `packages/adapter-mysql/src/types.ts:238-242` — `TranslateResult.needAggregation` is always
  `false` and never read; remove the field (and its assignment at query-translator.ts:232).

Run `pnpm type-check` after deleting to catch dangling imports.

---

## Section B — Decision-required issues (one Part per session)

### Part 1 — Import wipes the ENTIRE database; export dumps foreign tables (data-destructive)

**Problem.** Import is a wipe-and-restore over every table in the configured database:

- `packages/adapter-mysql/src/adapter.ts:788-810` — `getTables()` returns ALL tables in
  `information_schema.tables` for the database, datrix-managed or not. datrix is positioned as
  "a plugin for existing projects" (shared DB), so this includes the host app's tables.
- `packages/adapter-mysql/src/export-import/importer.ts:22-26` — step 2 drops every table
  `getTables()` returns → **importing an archive destroys non-datrix tables**.
- `packages/adapter-mysql/src/export-import/exporter.ts:20-35` — export iterates the same list.
  Schemas are only written for tables found in `_datrix`, but `exportTable` runs on ALL tables
  and does `ORDER BY \`id\`` (`:62`) — it dumps foreign tables' data into the archive and
  throws on any foreign table without an `id` column.
- No atomicity: a failure after step 2 leaves the database emptied (importer.ts:15-57). MySQL
  DDL cannot be transactional, so a Postgres-style wrapping transaction is not available.

**Decisions to make:**

1. **Scope** (recommended): restrict both export and import to datrix-managed tables = tables
   that have a `table:<name>` key in `_datrix`, plus `_datrix` itself and the migration-history
   table. Derive the list from `_datrix` keys, not `information_schema`. Leave `getTables()`
   itself broad (check `@datrix/cli` usage before narrowing it) and filter in
   exporter/importer.
2. **Failure containment**: since transactional DDL is impossible, choose one of
   (a) create-into-temp-prefixed tables (`_datrix_import_<name>`), load data, then
   `RENAME TABLE` old→backup, temp→final in one multi-table `RENAME TABLE` statement (atomic in
   MySQL), drop backups last — safest, more code; (b) keep wipe-and-restore but document that a
   failed import requires re-import — acceptable only once scope is limited to datrix tables.
   Recommendation: (a) if effort allows, (b) as documented minimum.
3. **Drop order**: with A14's dedicated connection, `FOREIGN_KEY_CHECKS=0` makes order
   irrelevant; if option (a) is chosen, order still matters for the final drops — derive
   reverse-FK order from stored schemas or keep FK checks off for the swap window.

**Files.** exporter.ts, importer.ts, adapter.ts (`exportData`/`importData`). Do A14 and A15
first so this part builds on a dedicated connection and escaped identifiers.

### Part 2 — MySQL DDL implicitly commits: migration phase 2 rollback assumptions are broken

**Problem.** Contract §6 phase 2 runs `alterTable`, `dataTransfer` (DML), `createIndex`,
`dropIndex` inside a single Transaction. In MySQL, every DDL statement performs an **implicit
commit** of the open transaction:

- `packages/adapter-mysql/src/adapter.ts:1305-1330` — `MySQLTransaction.createTable/dropTable/
  renameTable/alterTable/addIndex/dropIndex` happily delegate to the adapter with the
  transaction's connection, and nothing acknowledges that the first `ALTER TABLE`/`CREATE
  INDEX` commits all prior work on that connection.
- Consequence: if a migration step fails after a DDL step, the runner's `rollback()` silently
  rolls back only the DML executed *after the last DDL statement*; everything before it is
  already committed. `connection.rollback()` succeeds (it is a no-op on a fresh implicit
  transaction), so the runner believes the migration was fully rolled back while the database
  is half-migrated. Savepoints are equally destroyed by implicit commits.

**Decision to make.**

- **Option 1 (recommended for this session): make the behavior visible.** Track a
  `ddlExecuted` flag in `MySQLTransaction`; set it in every SchemaOperations method; when
  `rollback()` is called with `ddlExecuted === true`, still roll back but throw (or attach to
  the error/log a clear warning) a `DatrixAdapterError` stating that DDL statements were
  implicitly committed and the rollback is partial. Document the limitation in the README.
  Pros: honest failure semantics, small change. Cons: the migration is still half-applied.
- **Option 2: compensating-DDL undo log.** Record each DDL op + its inverse in the transaction
  wrapper; on rollback, execute inverses best-effort. Pros: closest to real rollback. Cons:
  inverses are lossy (dropColumn loses data, modifyColumn needs the old definition), large
  surface, can itself fail — not recommended.
- **Option 3: capability flag in core.** Adapter advertises
  `supportsTransactionalDDL: false`; the migration runner sequences DDL outside the transaction
  for such adapters. Correct long-term fix but requires a core interface change — file it as a
  core issue; do Option 1 meanwhile.

**Files.** adapter.ts (`MySQLTransaction`), README. Also note `applyOperationsToMetaSchema`
(adapter.ts:891-981) is DML: after an `ALTER TABLE` the meta UPDATE runs in a *new* implicit
transaction — if the migration later "rolls back", physical DDL stays but the meta update may
be rolled back → stored schema and physical table diverge. Option 1's warning should mention
this; Option 3 fixes it structurally.

### Part 3 — Per-relation `limit`/`offset` applies globally, not per parent row

**Problem.** The "lateral-joins" strategy does not use LATERAL. All constrained populates are
batched with `WHERE fk IN (?) ... LIMIT n`:

- `packages/adapter-mysql/src/populate/populator.ts:276-296` (hasMany, lateral strategy),
  `:346-367` (manyToMany, lateral strategy), `:1063-1074` (`buildBatchOptionsClause`, used by
  the batched strategy at `:528-534`, `:570-577` and nested populate at `:692-698`,
  `:734-741`).

`populate: { comments: { limit: 5 } }` over 20 posts returns 5 comments **total**, distributed
arbitrarily — not 5 per post. `offset` is equally wrong. Additionally, in the lateral strategy
the belongsTo branch (`:207-212`) applies `buildBatchOptionsClause` to `WHERE id IN (?)` — a
`limit` there truncates which *parents* get populated at all.

**Decision to make.** Two correct implementations (MySQL 8.0+ has both):

- **Option 1 (recommended): window function.** One batched query:
  `SELECT * FROM (SELECT t.*, ROW_NUMBER() OVER (PARTITION BY t.\`fk\` ORDER BY <orderBy or id>) AS _rn FROM target t WHERE t.\`fk\` IN (?) AND <where>) w WHERE w._rn > offset AND w._rn <= offset + limit`.
  Keeps the single-round-trip batching model; works for hasMany, manyToMany (partition by the
  junction sourceFK), and nested populate; bolts into the `buildBatchOptionsClause` call sites.
- **Option 2: true `LEFT JOIN LATERAL`** (MySQL 8.0.14+) driven from the parent table —
  matches the strategy's name and doc comments (populator.ts:124-128) but drops MySQL
  8.0.0–8.0.13 and is harder to reuse for the nested/batched path.

Also decide: keep the plain `IN (?)` fast path when `limit`/`offset` are absent (yes — only
branch to the window query when needed). Note the `LIMIT 18446744073709551615` offset-only
fallback (populator.ts:287, :357, :1072) inherits the same per-parent problem.

**Files.** populator.ts hasMany/manyToMany branches in `executeLateralJoins`,
`executeBatchedQueries`, `populateBatchedRows`, plus `buildBatchOptionsClause`. E2e check:
3 parents × 5 children, `limit: 2` → each parent gets exactly its own first 2 by orderBy.

### Part 4 — populate `where`/`orderBy` silently ignored for belongsTo/hasOne in the batched strategy; populate-where relation joins discarded everywhere

**Problem.** Contract (§4): an adapter must never silently ignore a condition.

1. The lateral strategy applies `options.where`/`orderBy`/`limit` to belongsTo/hasOne via
   `buildBatchOptionsClause` (populator.ts:207-212, 229-234), but the batched strategy does
   not: `:462-472` (belongsTo), `:496-507` (hasOne), and the nested variants `:647-658`
   (belongsTo), `:671-682` (hasOne) build their batch SQL with no options clause at all —
   `where`/`orderBy`/`limit` on these relations vanish depending on which strategy the
   analyzer picks (depth > 1 flips to batched, populator.ts:888-901).
2. `buildBatchOptionsClause` (populator.ts:1041-1050) and the inline where-translations in the
   lateral strategy (`:251-261`, `:321-331`) call
   `translateWhere(options.where, 0, targetTable, "t")` and use only `.sql`/`.params` — the
   returned `joins` are **discarded**. A nested relation condition inside a populate-where
   (e.g. `populate: { comments: { where: { author: { verified: true } } } }`) generates SQL
   referencing a join alias that is never added → MySQL error 1054 (unknown column), or worse,
   silently wrong SQL.

**Decision to make.** Semantics first: what does `where` on a belongsTo/hasOne populate mean —
"populate the author only if verified, else null"? (that is what the lateral strategy
implements). If yes: apply `buildBatchOptionsClause` in the four batched branches exactly like
hasMany does (Part 3 interacts with `limit` here) so both strategies behave identically. If
belongsTo/hasOne must not accept `where`, throw a clear `DatrixAdapterError` in BOTH
strategies. For (2): either wire `whereResult.joins` into the batch SQL (insert between `FROM
... t` and `WHERE`) or reject nested relation filters in populate-where with a clear error —
pick one; silent alias breakage is the only unacceptable outcome.

**Files.** populator.ts (four batched branches + `buildBatchOptionsClause` + the two inline
where sites).

### Part 5 — Returned rows violate the JS-type contract (dates as strings; DECIMAL as strings)

**Problem.** Contract §1.4: rows must come back with `Date` objects for date fields, numbers
for numeric fields, parsed JSON for json fields.

1. **Populated relations** are built via `JSON_OBJECT`/`JSON_ARRAYAGG`
   (aggregation-builder.ts:172-186, 230, 284; populator.ts `buildJsonObject` batch queries), so
   every date field inside a populated relation arrives as a **string**
   (`"2026-01-01 12:00:00.000000"`) and stays that way: `convertMySQLTypes`
   (adapter.ts:1002-1062) converts booleans (1/0) and JSON strings, and recurses into
   relations, but has **no date branch**. All three strategies are affected.
2. **Main rows**: mysql2 converts DATETIME → `Date` (default `dateStrings: false`), but
   `DECIMAL` columns (created for `number` fields with `precision`, types.ts:169-175) come back
   as **strings** because the pool is created without `decimalNumbers: true`
   (adapter.ts:95-107).

**Decision to make.**

- Populated dates (recommended): extend `convertMySQLTypes` — it already walks the schema and
  recurses into populated relations — with a `dateFields` list, converting string values to
  `new Date(v)` (append a timezone-consistent parse; values come from JSON_OBJECT in server
  session time). Precompute a per-schema "needs conversion" flag to skip the per-row cost when
  a schema has no date fields.
- DECIMAL policy: set `decimalNumbers: true` in the pool options (adapter.ts:95-107) and
  document the precision caveat (> 2^53 loses precision — acceptable: core assumes JS numbers
  everywhere), OR convert in `convertMySQLTypes` via the schema's number fields. Pool option is
  simpler; schema-driven conversion also covers DECIMALs inside JSON_OBJECT (JSON numbers are
  fine, but `JSON_OBJECT` of a DECIMAL may serialize as a JSON string on some versions — verify
  with e2e).

### Part 6 — `$like`/`$contains`/`$startsWith`/`$endsWith` are case-insensitive under the default collation

**Problem.** Tables are created with `COLLATE utf8mb4_unicode_ci` (adapter.ts:488) — a
case-insensitive collation. Therefore:

- `$like` (query-translator.ts:1010-1011) is effectively case-INsensitive → `$like` ≡ `$ilike`,
  violating the contract's distinction (§4: `$like` = LIKE, `$ilike` = case-insensitive LIKE).
- `$contains`/`$notContains`/`$startsWith`/`$endsWith` (`:1017-1027`) wrap both sides in
  `LOWER()` — explicitly case-insensitive, while the contract (and the Postgres adapter after
  its A1 fix) treats the non-`i` variants as case-sensitive.
- Related note: `REGEXP` (`:1029-1034`) is also case-insensitive under a CI collation.

**Decision to make.**

- **Option 1 (recommended):** make the non-`i` variants case-sensitive with a binary collation:
  `field LIKE ? COLLATE utf8mb4_bin` (or `LIKE BINARY ?`). `$ilike`/`$icontains` keep the
  `LOWER()` form (works regardless of column collation). Trade-off: `COLLATE utf8mb4_bin`
  comparisons can bypass indexes on CI columns — same cost Postgres pays for ILIKE, acceptable.
- **Option 2:** document that in the MySQL adapter case-sensitivity follows column collation
  and both variants behave identically — a legitimate outcome, but then `info_core.md` §4 must
  say "dialect-dependent", and the operators should at least stop using `LOWER()` for the non-`i`
  variants (pure `LIKE`) so behavior is collation-driven, not hardcoded.
- Whichever option: `$regex` case sensitivity should be documented alongside (`REGEXP ...
  COLLATE utf8mb4_bin` if Option 1 extends to it; RegExp flags like `/x/i` are currently
  dropped — `value.source` only, `:1031-1033`).

**Files.** query-translator.ts `translateComparisonOperator`; coordinate with A1/A2 (do those
first — this part only flips case-sensitivity).

### Part 7 — DDL column-definition gaps (TEXT defaults/uniques, JSON defaults, modifyColumn definition loss, enum constraint)

**Problem.** Several `SchemaDefinition` shapes produce invalid or lossy DDL:

1. `string` without `maxLength` maps to `TEXT` (types.ts:134-144). MySQL forbids
   `DEFAULT 'literal'` on TEXT (error 1101) and `UNIQUE` on TEXT without a key length (error
   1170) — `buildColumnDefinition` (adapter.ts:1075-1096) emits both unconditionally →
   `createTable` fails for any string field with a default or `unique` and no `maxLength`.
2. `json`/`array` defaults: `escapeValue` renders objects as `CAST('...' AS JSON)` and arrays
   as `JSON_ARRAY(...)` (helpers.ts:63-67) — expression defaults require the parenthesized
   `DEFAULT (expr)` syntax (MySQL 8.0.13+); the current output is a syntax error.
3. `modifyColumn` (adapter.ts:660-665) emits `MODIFY COLUMN col <type-only>`. MySQL's `MODIFY`
   replaces the **entire** column definition — the current SQL silently drops `NOT NULL` and
   `DEFAULT` from the column even when the new definition still has `required`/`default`.
   (This is worse than an incomplete ALTER: it actively removes constraints.) Meanwhile
   `applyOperationsToMetaSchema` records the full new definition in `_datrix` → stored schema
   and physical table diverge.
4. `enum` maps to `VARCHAR(255)` with no CHECK constraint (types.ts:185-187) — contract §6
   requires "CHECK constraint or native enum". MySQL 8.0.16+ enforces CHECK; older versions
   parse and ignore it (harmless).

**Decision to make.**

- (1): pick a policy — (a) auto-upgrade to `VARCHAR(255)` when `default` or `unique` is present
  and no `maxLength` (changes storage semantics silently), or (b) throw a clear
  `DatrixAdapterError` telling the user to set `maxLength` (recommended: explicit beats
  silent), or (c) use `DEFAULT (expr)` / prefix-length unique index. Decide and apply the same
  policy in `addColumn`.
- (2): switch object/array/date-expression defaults to `DEFAULT (${expr})` parenthesized form;
  decide the minimum supported MySQL version (README says 5.7+ — expression defaults need
  8.0.13; either bump the floor or reject json defaults below it).
- (3): build the full definition — reuse `buildColumnDefinition(op.column, op.newDefinition)`
  in `modifyColumn`, minus the `UNIQUE` suffix (adding UNIQUE via MODIFY creates a new index on
  every migration run; handle unique changes as explicit index ops or reject them loudly).
- (4): native `ENUM('a','b')` vs `VARCHAR + CHECK`: CHECK (stable name `chk_<table>_<col>_enum`)
  is recommended — native ENUM value changes require table rebuilds and ALTER pitfalls. Or
  amend `info_core.md` to declare enum unconstrained at DB level (contract change, not code).

**Files.** types.ts (`getMySQLTypeWithModifiers`), adapter.ts (`buildColumnDefinition`,
`alterTable` modifyColumn case), helpers.ts (`escapeValue` default rendering).

### Part 8 — `select: undefined` with populate crashes the populator (core issue 2.2 survival)

**Problem.** Contract §3/§8: post-write refetch may arrive with `select: undefined`; the
adapter must treat it as "all non-hidden scalar columns". The plain translator survives —
`translateSelectClause` falls back to `` `table`.* `` (query-translator.ts:430-436, though `*`
exposes hidden FK columns, deviating from "non-hidden"). The populate paths do not:

- `packages/adapter-mysql/src/populate/populator.ts:150-160` (lateral strategy) and `:415-424`
  (batched strategy) spread `...(query.select as string[])` when injecting belongsTo FK
  columns → `TypeError` when `select` is undefined and the populate contains a belongsTo.

**Decision to make.**

- **Option 1 (recommended):** normalize once — at `MySQLPopulator.populate()` entry
  (populator.ts:70) and at the top of `translate()` (query-translator.ts:202): if
  `type === "select" && !query.select`, derive the list from the registry schema (all fields
  with `type !== "relation"` and not `hidden`) and clone the query with it. Fixes both the
  crash and the hidden-column leak of the `*` fallback in one place.
- **Option 2:** minimal patch — `...(query.select ?? [])` at the two spread sites and rely on
  the `*` fallback. Pros: two-line change. Cons: hidden FK columns still leak into refetched
  rows, and the injected-FK dedup logic stays inconsistent (`*` already includes FKs, so the
  post-populate `delete row[fkColumn]` at `:222-224`, `:488-491` would strip a column the
  caller implicitly selected).

**Files.** populator.ts, query-translator.ts. E2e check: create + populate refetch on a schema
with a hidden FK and a belongsTo relation.

---

## Notes (no action, or fold into the parts above)

- **Bulk-insert id arithmetic (adapter.ts:231-241) is safe as written**: a multi-row
  `INSERT ... VALUES` is a "simple insert" (row count known up front), and InnoDB allocates
  consecutive auto-increment values for a single such statement even under the default
  `innodb_autoinc_lock_mode=2`; `insertId` is the first value of the batch. The assumption
  breaks only for mixed-mode inserts (explicit `id` values — core forbids them) or triggers
  that insert into the same table. Worth a code comment documenting the assumption; no fix.
- **DELETE returns `rows: []`** (adapter.ts:246-251) with a comment that the executor
  pre-fetches via `needsReturnSelect`. Contract §3 says "the deleted rows (core may pre-fetch
  itself)". Consistent with the comment, but verify with e2e that no core path consumes delete
  `rows` beyond the pre-fetch case.
- UPDATE without WHERE (core issue 1.12) → no id prefetch → `rows: []` while
  `affectedRows > 0` (adapter.ts:205-221, 242-245). Adapter survives; refetch just returns
  nothing. Core-side gap, no adapter action.
- `tableExists` inside `createTable` always checks on the pool (adapter.ts:502, 851-867) even
  under a transaction connection — harmless in MySQL because CREATE TABLE auto-commits and is
  immediately visible, unlike the Postgres equivalent (postgres A6). No action.
- `addIndex` from a Transaction (adapter.ts:1324-1326) passes `schema: undefined`, so indexes
  declared on relation *field names* are not remapped to FK columns in that path
  (adapter.ts:726-735). Only matters if migration `createIndex` steps reference relation names.
- The batched/lateral populate strategies require `id` in the main query's select
  (`parentIds = rows.map(r => r.id)`, populator.ts:172, 434) and in each nested level's
  JSON_OBJECT. If core can emit a select list without `id`, populate silently returns empty
  relations — verify with e2e whether core always includes `id`.
- The `aborted` flag on `MySQLTransaction` (adapter.ts:1136-1150) emulates Postgres
  "transaction is aborted" semantics that MySQL does not have (a failed statement does not
  poison a MySQL transaction). Conservative and harmless; just be aware it is stricter than
  the engine requires (`rollbackTo` clears it, adapter.ts:1277).
- json-aggregation hasOne uses `LEFT JOIN` + `GROUP BY main.id, rel.id`
  (query-translator.ts:363-384; join-builder.ts:235-269): two target rows pointing at the same
  parent duplicate the parent row. Same issue as postgres Part 9 — resolve it the same way
  there (UNIQUE index on hasOne FK at createTable, or defensive aggregation); check whether
  core already marks the hasOne FK `unique`.
- `count` + `groupBy` returns one row per group but only the first row's count is reported
  (adapter.ts:252-265). Same behavior as the count contract allows today (`metadata.count` is
  a single number); a core-level question, not an adapter bug.
- The translator instance is shared per adapter and stateful (`paramIndex`/`params`,
  query-translator.ts:39-40). Safe only while `translate()` stays fully synchronous; any future
  `await` inside translation corrupts concurrent queries. Worth a comment if the file is
  touched.
- `upsertSchemaMeta` uses `VALUES(\`value\`)` in `ON DUPLICATE KEY UPDATE`
  (adapter.ts:881-885) — deprecated since MySQL 8.0.20 (warning, still works). Switch to the
  `AS new ... new.value` alias syntax when convenient.
- `timezone: "local"` default (adapter.ts:106, types.ts:89-93): Date round-trips are consistent
  only if every connecting process shares the server's notion of local time. Document, or
  default to `"Z"` + UTC storage in a future breaking change.
- `escapeValue` renders Date defaults in UTC (`toISOString`, helpers.ts:59-61) while runtime
  Date params are written in connection-local time — a fixed date `default` can be offset by
  the timezone. Only affects column DEFAULTs; fold into Part 7 if touched.
- `$regex` with a `RegExp` value drops flags (`value.source`, query-translator.ts:1031-1033) —
  `/foo/i` loses the `i`. Fold into Part 6 if desired.
- Import inserts date values as ISO strings from the archive (`importer.ts:86-95`); MySQL
  accepts the `T`/`Z` ISO format only on 8.0.19+ — older targets may reject or truncate.
  Verify with e2e on the oldest supported version; if needed, normalize to
  `YYYY-MM-DD HH:MM:SS.mmm` in `insertChunk`.
- `test-utils.ts:47-48` interpolates `dbName` into DDL with raw backticks — test-only helper,
  acceptable, but a backtick in the name breaks it.
- `packages/adapter-mysql/tests/**`: delete/ignore outdated tests.
