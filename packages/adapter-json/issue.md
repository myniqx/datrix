# adapter-json — Review Findings

Review scope: `packages/adapter-json/src/**`, checked against the core→adapter contract in
`packages/core/info_core.md`. Core-side defects (issues 1.4, 1.8, 1.11, 2.2, etc.) are NOT
repeated here — only how the adapter must survive them.

Issues are split into two groups:

- **Section A — Mechanical fixes**: no design decision needed; hand each item (or the whole
  section) directly to a Sonnet agent with the instructions written below.
- **Section B — Decision-required issues**: each Part is sized for one session; contains the
  problem, `file:line` references, and solution options with a recommendation.

**Status: Section A (A1–A14) — DONE.** `type-check` passes. Existing test files are all
`describe.skip`'d repo-wide (pre-existing, unrelated to this pass) so no test signal was
available; changes were verified by type-check + manual trace only.

---

## Section A — Mechanical fixes (delegate to Sonnet agent as-is)

### A1. Unknown WHERE operators silently ignored; `$icontains` and `$regex` not implemented

- `packages/adapter-json/src/runner.ts:544-641` (`matchOperators`)
- The `switch` has no `default:` case — any operator without a case (`$icontains`, `$regex`,
  or a future/typo'd one) falls through and the condition is treated as "matches everything".
  Contract §4 requires both operators, and §4 forbids silently ignoring a condition.
- Fix:
  1. Add `case "$icontains":` — `String(value ?? "").toLowerCase().includes(String(opValue).toLowerCase())`.
  2. Add `case "$regex":` — accept `string | RegExp`; build `new RegExp(opValue)` when string,
     test against `String(value ?? "")`.
  3. Add `default:` that throws a `DatrixAdapterError` ("Unsupported operator '<op>'") via a
     core throw helper.

### A2. `$like`/`$ilike` pattern → regex conversion doesn't escape regex metacharacters

- `packages/adapter-json/src/runner.ts:611-620`
- Only `%` and `_` are translated; regex specials in the user pattern (`.`, `(`, `[`, `+`, `\`
  …) stay live. `$like: "a.c%"` wrongly matches `"aXcdef"`, and an unbalanced `(` throws a raw
  `SyntaxError` from the `RegExp` constructor.
- Fix: escape regex metacharacters first, then translate SQL wildcards:
  `pattern = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")`.

### A3. Sort runs AFTER projection — `orderBy` on a non-selected field breaks

- `packages/adapter-json/src/runner.ts:70-83` (`run()`: project at 70-72, sort at 75-83)
- When `select` excludes the `orderBy` field (e.g. `select: ["name"], orderBy: [{ field: "createdAt" }]`),
  the projected objects no longer carry the sort field (projection even rewrites missing fields
  to `null`), so the sort compares `null`s and ordering is lost.
- Fix: reorder `run()` to filter → sort → offset/limit → project/distinct. Note `distinct` must
  stay AFTER projection (it dedupes the projected shape) — keep distinct at the end.

### A4. hasOne populate ignores populate-level `where`/`orderBy`

- `packages/adapter-json/src/populate/`: `packages/adapter-json/src/populate.ts:175-201` —
  the `hasSortOrFilter` re-filter block (182-198) only runs in the `else` (hasMany) branch;
  hasOne (179-181) assigns `group[0] ?? null` directly, silently dropping `options.where`.
- Fix: when `kind === "hasOne"` and `options?.where` is set, run the same `groupRunner.filterAndSort`
  over the group and assign `filtered[0] ?? null`.

### A5. belongsTo populate `where` filter is O(N×M) — full-table filter re-run per candidate row

- `packages/adapter-json/src/populate.ts:114-132`
- For every entry in `relatedMap`, `filterAndSort` re-filters the ENTIRE target table and then
  checks membership. With N parents and M target rows this is N full scans.
- Fix: run `filterAndSort({ where: options.where, ... })` ONCE, build
  `matchedIds = new Set(result.map(r => r["id"]))`, then keep `relatedMap` entries whose id is
  in the set.

### A6. Double lock release on query failure

- `packages/adapter-json/src/adapter.ts:697` releases the lock, then `throwQueryError` throws,
  the outer catch at `:785-787` sees `lockAcquired === true` and releases AGAIN. Because
  `SimpleLock.release()` unconditionally unlinks the lock file (see B5), the second release can
  delete a lock another process acquired in between.
- Fix: restructure `executeQueryWithOptions` so release happens in exactly one place — a
  `finally` block — and remove the inline releases at `:697`, `:727`, `:779`. (Set
  `lockAcquired = false` after releasing if early-return paths must keep their structure.)

### A7. `renameTable` renames the `_datrix` key but not the schema content

- `packages/adapter-json/src/adapter.ts:1086-1114`
- Only the `table:<name>` key is rewritten; the stored schema JSON `value` still has
  `tableName: <from>`. After a rename, `getTableSchema(to)` returns a schema whose `tableName`
  points at the old (deleted) file — populate, FK checks and migration diffing all resolve the
  wrong table.
- Fix:
  1. Parse the `value`, set `tableName: to`, re-stringify before writing.
  2. Also scan the other `_datrix` entries and update any `fields.*.references.table === from`
     to `to` (FK references must follow the rename, like SQL does).

### A8. `foreignKey`/`through` non-null assertions without the contract's defaults

- `packages/adapter-json/src/populate.ts:59` (`relField.foreignKey!`),
  `packages/adapter-json/src/populate.ts:204` (`relField.through!`),
  `packages/adapter-json/src/runner.ts:314` (`relationField.foreignKey!`),
  `packages/adapter-json/src/populate.ts:225` (junction runner constructed WITHOUT a schema —
  the "schema-aware filtering" comment above it is false, so `$in` id coercion never happens).
- `table-utils.ts:178` already shows the right pattern (`?? \`${fieldName}Id\``). If an enhanced
  schema ever arrives without these set, the current code reads `item[undefined]` and silently
  returns no matches instead of failing or falling back.
- Fix: add a small shared helper (e.g. in `table-utils.ts`) that resolves relation metadata per
  contract §5 — belongsTo: `<field>Id`; hasOne/hasMany: `<OwnerModelName>Id`; manyToMany
  `through`: alphabetically sorted `ModelA_ModelB` — and use it at all four sites. Pass
  `await adapter.getSchemaByTableName(junctionTableName)` into the junction runner at
  populate.ts:225.

### A9. `getTables` derives names with `replace(".json", "")` — first-occurrence replace

- `packages/adapter-json/src/adapter.ts:1150-1153`
- `"my.json.table.json".replace(".json", "")` → `"my.table.json"` (wrong). Filter already uses
  `endsWith`.
- Fix: `f.slice(0, -".json".length)`.

### A10. Raw `Error` thrown instead of `DatrixAdapterError` (contract §1.5)

- `packages/adapter-json/src/adapter.ts:157` (tombstone "does not exist"),
  `packages/adapter-json/src/adapter.ts:282` ("Schema … not found in _datrix"),
  `packages/adapter-json/src/populate.ts:211-215` (junction table not found),
  `packages/adapter-json/src/adapter.ts:607-608` (`fs.unlink` unguarded — if the table exists
  only in a stale cache entry but the file is gone, a raw `ENOENT` escapes).
- Fix: replace raw `throw new Error(...)` with the appropriate core throw helpers
  (`throwQueryError` / `throwMigrationError` / a populate helper); wrap the `unlink` in
  try/catch and rethrow as `throwMigrationError` only for non-`ENOENT` codes.

### A11. Corrupt JSON file surfaces as "Table not found"

- `packages/adapter-json/src/adapter.ts:694-704`
- Any `readTable` failure — including `JSON.parse` throwing on a truncated/corrupt file — is
  wrapped as `Table '<x>' not found`, which sends debugging in the wrong direction.
- Fix: inspect the cause — `ENOENT` → keep "not found"; `SyntaxError` → message
  `Table file '<x>.json' is corrupted: <parse error>`; anything else → generic read failure.
  All still via `throwQueryError`.

### A12. Importer writes `meta.name = tableName` instead of the model name

- `packages/adapter-json/src/export-import/importer.ts:63-71`
- Everywhere else `meta.name` holds `schema.name` (model name, e.g. `"User"`); after an import
  it becomes the table name (`"users"`).
- Fix: `writeTableFile` should receive the schema (importer already has the
  `Map<tableName, SchemaDefinition>`) and use `schema.name`, falling back to `tableName` only
  when the schema is missing.

### A13. `select: undefined` refetch returns hidden FK columns (core issue 2.2 handling)

- `packages/adapter-json/src/runner.ts:70-72` — when `select` is `undefined`, projection is
  skipped entirely and rows come back with every stored key, including hidden FK columns.
  Contract §3/§8: treat `select: undefined` as "all non-hidden scalar columns".
- Fix: in `run()` (and the populate path in `query-handlers.ts:34-57`), when `query.select` is
  undefined and a schema is available, project to all fields where `type !== "relation"` and
  `hidden !== true`.

### A14. `disconnect()` leaks transaction lock and keeps stale state

- `packages/adapter-json/src/adapter.ts:121-123`
- If called with an active transaction, the `db.lock` file is never removed (other processes
  block until stale-timeout) and tx/cache state survives a later re-`connect()`.
- Fix: on disconnect, if a transaction is active perform the rollback path (clear tx state +
  `lock.release()`), and clear `this.cache`.

---

## Section B — Decision-required issues (one Part per session)

### Part 1 — Date fields: no type handling in comparisons, inconsistent row types on return

**Problem.** Contract §1.3-1.4: adapters convert JS → storage on write and MUST return `Date`
objects for date fields on read. This adapter does neither consistently:

- Storage is whatever `JSON.stringify` produces: rows inserted this process hold live `Date`
  objects in the cache, while rows read from disk hold ISO strings. The same query returns
  `createdAt: Date` or `createdAt: "2026-…"` depending on cache state.
- `compareValues` (`packages/adapter-json/src/runner.ts:510-542`) has `number`/`string`/
  `boolean` branches but NO `date` branch → `$eq`/`$ne` on a date field compares an ISO string
  (or `Date` object, by reference) against the query's `Date` object → always false.
- `coerceForComparison` (`runner.ts:643-668`) likewise has no `date` branch → `$gt/$gte/$lt/$lte`
  compare `string > Date`, which coerces to `NaN` → always false. Date range queries return
  nothing. `$in`/`$nin` with Dates compare object references.
- Sorting by a date field works only accidentally (ISO strings sort lexicographically) and
  breaks when the column mixes `Date` objects and strings.

**Where.** `runner.ts:510-542`, `runner.ts:643-668`, write paths in
`adapter.ts:758-775`/`query-handlers.ts:96-123`, and every row-returning path.

**Options.**
1. **(Recommended)** Canonical storage = ISO string everywhere: normalize `Date` → ISO at
   insert/update time (query-handlers), add a `date` branch to `compareValues`/
   `coerceForComparison` that compares `new Date(v).getTime()`, and convert ISO → `Date` at the
   result boundary (see Part 2 — this needs the copy-at-boundary decision, otherwise the
   conversion mutates the cache).
2. Canonical storage = epoch millis: faster comparisons, but the JSON files stop being
   human-readable and existing files need migration.
3. Document "dates are strings" and fix only the comparison branches — violates the contract
   (core and API layers expect `Date`s back), not really an option if adapter parity matters.

**Depends on:** Part 2 (result-boundary conversion needs safe row copies).

### Part 2 — Cache-by-reference: query results and populate mutate the shared cache

**Problem.** `readTable` returns the cached `JsonTableFile` object itself
(`packages/adapter-json/src/adapter.ts:152-202`), and `run()`/`filterAndSort` return the row
objects by reference (`runner.ts:48`, `runner.ts:104`). Consequences:

- `handleSelect` with populate (`query-handlers.ts:43-47`) passes those live references into
  `JsonPopulator.populate`, which writes relation fields ONTO the cached rows
  (`populate.ts:134-145`, `:175-201`, `:282-308`). The relation objects stay in the main cache;
  the next write on that table serializes them into the `.json` file on disk (verified path:
  `adapter.ts:758-775` writes the whole cached `tableData`). Populated data silently becomes
  persisted data.
- Select without projection returns cache-owned objects to core/user code — any caller mutation
  corrupts the cache and, after the next write, the file.
- Insert/update handlers mutate the main cache BEFORE the disk write
  (`query-handlers.ts:96-123`, `:163-179`); if `fs.writeFile` then fails, cache and disk
  diverge permanently (cache mtime no longer matches, but the mutated object is what a
  transaction copy-on-read would pick up in the meantime).

**Where.** `adapter.ts:152-202`, `query-handlers.ts:34-57`, `runner.ts:45-95`/`:101-138`,
`populate.ts` (all mapping loops).

**Options.**
1. **(Recommended)** Copy-at-boundary: keep internal filtering on references (cheap), but
   shallow-copy rows exactly once before they can be mutated — i.e. in `handleSelect` before
   populate (`rows = rows.map(r => ({ ...r }))`) and in the no-projection select path. Combine
   with Part 1's result-boundary Date conversion in the same map. Write-path: mutate a copy of
   the table file, only swap it into the cache after a successful disk write.
2. Deep-copy on every `readTable` (JSON round-trip): simplest, safest, but O(table size) per
   query and loses `Date` objects — probably too slow for the adapter's stated purpose.
3. Freeze cached objects in dev (`Object.freeze`) to detect mutation — a diagnostic, not a fix.

**Sizing note:** this touches select/populate/insert/update/delete paths; do it in one session
so the copy semantics stay consistent.

### Part 3 — One global transaction slot; non-transaction queries during an active tx are unsafe

**Problem.** Transaction state lives on the adapter as single fields
(`packages/adapter-json/src/adapter.ts:63-74`). While a transaction is active:

- A plain `adapter.executeQuery` (not via the `Transaction` object) READ sees the transaction's
  uncommitted cache — `readTable` checks `activeTransactionCache` unconditionally
  (`adapter.ts:161-166`), regardless of whether the caller is the transaction. Dirty reads for
  every concurrent reader in the process (read lock is off by default).
- A plain WRITE first blocks on the file lock the tx holds; after `lockTimeout` (5 s default) it
  fails — acceptable — but if the tx releases between acquire attempts, the writer proceeds
  with `tableData` that `readTable` may have served FROM the tx cache and writes uncommitted
  data to disk (`adapter.ts:758-775`).
- A second `beginTransaction` throws "A transaction is already active" (`adapter.ts:812-817`)
  instead of waiting — callers must serialize transactions themselves, which core does not do.

**Where.** `adapter.ts:63-74`, `:152-202`, `:660-789`, `:807-849`.

**Options.**
1. **(Recommended)** Keep the single-tx design (it matches the file-lock model) but make it
   safe: (a) route reads through the tx cache ONLY when the call carries a tx flag (thread
   `ExecuteQueryOptions` with `inTransaction: true` from `JsonTransaction`, default false);
   (b) make `beginTransaction` await the current transaction's completion (promise queue) with
   a timeout instead of throwing.
2. Full multi-transaction support with per-tx caches and conflict detection — over-engineering
   for a JSON file adapter.
3. Document "single connection, no concurrent use during transactions" — leaves the dirty-read
   footgun in place; core's executor does issue non-tx queries in normal operation, so this is
   not really safe to document away.

### Part 4 — Durability: non-atomic writes, partial commits, destructive import

**Problem.** Three related crash/consistency gaps:

1. Every persist uses a plain `fs.writeFile` (`adapter.ts:768`, `:888`, `:1080`,
   `importer.ts:73`, meta writes at `:327`, `:630`). A crash mid-write, or a lock-free reader
   (default `readLock: false`) reading mid-write, yields truncated JSON → `JSON.parse` throws
   (surfaces as A11's misleading error) or silent data loss.
2. `commitTransaction` (`adapter.ts:855-907`) writes modified tables sequentially; a failure on
   table N leaves tables 1..N-1 committed and the rest lost, with tx state cleared in `finally`
   — no retry, no rollback of the partial commit.
3. `JsonImporter.import` (`export-import/importer.ts:15-24`) DROPS every existing table before
   reading the first chunk; any failure during import (bad archive, disk full) = total data
   loss of the previous state.

**Options.**
1. **(Recommended)** Atomic file writes everywhere: write to `<table>.json.tmp`, `fs.rename`
   over the target (rename is atomic on the same volume, Windows included via `fs.rename`
   semantics on NTFS). This fixes torn reads and crash-mid-write for single tables, and makes
   commit failures at least per-table-atomic. For the importer: import into a staging directory,
   then swap directories (or rename per-file after all files are staged).
2. Add a commit journal (write-intent file listing tables + temp paths, replay on connect) for
   true multi-table commit atomicity — decide whether the adapter's "ACID-like" claim
   (`transaction.ts:1-13`) warrants the complexity, or whether the claim should be softened in
   the README instead.

### Part 5 — `SimpleLock` has no ownership: any process can delete any lock; stale threshold vs. long transactions

**Problem.** `packages/adapter-json/src/lock.ts`:

- `release()` (`lock.ts:59-68`) unlinks the lock file unconditionally. Sequence: A holds lock →
  B sees it stale (or A errors and double-releases, see A6) → B deletes and acquires → A's
  later `release()` deletes B's lock → C acquires while B still works. Two writers, corrupt
  files.
- The lock content is a timestamp written once at acquire (`lock.ts:27-29`) and never
  refreshed. Any transaction or bulk operation longer than `staleTimeout` (default 30 s) gets
  its lock stolen mid-flight by the next acquirer (`lock.ts:37-45`).

**Options.**
1. **(Recommended)** Ownership token: write `{ token, pid, timestamp }`; `release()` reads the
   file first and unlinks only when the token matches its own. Combine with a heartbeat: the
   holder refreshes the timestamp every `staleTimeout / 3` while held (a simple `setInterval`
   cleared on release), so legitimately long transactions are never stolen.
2. Ownership token only, plus raising `staleTimeout` — simpler, but then a genuinely crashed
   holder blocks everyone for the full (now longer) stale window.
3. Move to an existing battle-tested lockfile package (`proper-lockfile`) — new dependency;
   decide if the package's zero-dep footprint matters.

### Part 6 — `groupBy`/`having` silently ignored on select and count

**Problem.** `run()` (`packages/adapter-json/src/runner.ts:45-95`) and `handleCount`
(`query-handlers.ts:59-72`) have no code path for `groupBy`/`having` at all — a
`{ type: "count", groupBy: ["role"] }` returns the plain total row count and a select with
`groupBy` returns ungrouped rows. Contract §4/§8: unsupported features must throw a clear
`DatrixAdapterError`, never silently ignore.

**Options.**
1. **(Recommended, immediate)** Throw `DatrixAdapterError` ("groupBy/having not supported by
   JsonAdapter") whenever `query.groupBy` or `query.having` is present — small, honest,
   contract-compliant; can ship inside a mechanical session if this option is chosen.
2. Implement in-memory grouping (group rows by key tuple, evaluate `having` against aggregate
   pseudo-fields like `count`). Decide first what aggregate surface core actually sends in
   `having` (currently only `count`?) — implementing blind risks a half-compatible dialect.
3. The decision here: does the JSON adapter aim for feature parity with SQL adapters (then
   option 2 eventually), or is it a dev/test adapter (then option 1 permanently)?

### Part 7 — Schema lookups are O(all tables × file reads), on hot paths; `connect(schemas)` registry ignored

**Problem.** The adapter deliberately resolves schemas from `_datrix` instead of the registry —
`connect()` (`packages/adapter-json/src/adapter.ts:90-119`) doesn't even accept the
`ISchemaRegistry` parameter the interface defines. That choice makes every model-name lookup a
full scan:

- `getSchemaByModelName` (`adapter.ts:240-256`) = `getTables()` (a `readdir`) + `readTableSchema`
  for EVERY table until a name matches.
- Called per inserted row in `checkForeignKeyConstraints` (`table-utils.ts:183`, from
  `query-handlers.ts:119` inside the insert loop), per candidate row in `matchRelation`
  (`runner.ts:350-351`, `:376-377`, `:444-445`), and `findFkDependencies` re-reads every schema
  on every delete (`table-utils.ts:217-241`).
- A 50-table database bulk-inserting 100 rows with one FK does ~5000 schema-file reads (mostly
  cache hits, but still stat + map lookups per read, and cold on first touch).

**Options.**
1. **(Recommended)** Keep `_datrix` as the source of truth (it makes the adapter standalone-
   capable and migration diffing consistent — contract §7) but add an in-memory index:
   `modelName → tableName` + `tableName → SchemaDefinition`, built lazily, invalidated whenever
   `_datrix` is written (`upsertSchemaMeta`, `dropTable`, `renameTable`, `alterTable`) or its
   mtime changes. All lookups become O(1).
2. Use the live registry from `connect(schemas)` per contract §2 (treat as live, read at query
   time) and keep `_datrix` only for persistence/introspection. Faster and simpler, but breaks
   the adapter's standalone mode (`config.standalone`) — decide whether standalone mode is a
   supported feature or test-only convenience before choosing this.
3. Do both: registry when provided, `_datrix` index as fallback for standalone. Slightly more
   code, best behavior. Requires defining precedence when the two disagree mid-migration.

### Part 8 — Constraint-emulation scope + two behavioral edge cases in it

**Problem.** The adapter emulates DB constraints (unique, FK, defaults, ON DELETE actions) and
adds a WHERE-field safety net. Per `packages/core/CLAUDE.md` "adapters never validate data",
but these are DATABASE-level constraints a real engine would enforce, so emulation is arguably
correct. The scope should be an explicit decision, and two bugs exist inside it either way:

1. **Batch-update unique check misses same-batch duplicates** —
   `packages/adapter-json/src/query-handlers.ts:163-172`: each row's updated image is checked
   against the CURRENT table state, so updating two rows to the same unique value passes both
   checks (each sees the other's OLD value), then both get assigned → duplicate persisted.
   Fix direction: validate against the projected post-update state (track pending values in a
   set during the loop).
2. **Junction dedup silently drops insert rows** — `query-handlers.ts:99-105`: duplicate
   junction rows are skipped, so `rows`/`insertIds` come back shorter than `query.data`.
   Contract §3 says insert returns the inserted rows; core maps `rows[i].id` positionally for
   relation linking. Decide: return the EXISTING row's id for skipped duplicates (upsert
   semantics, keeps positions aligned — recommended), or throw a unique-constraint error like
   a real DB would.
3. **WHERE-field validation** (`runner.ts:258-265`, `throwInvalidWhereField`) — this is the
   safety net for core issues 1.4/1.11 (unvalidated orderBy/populate-where fields reach the
   adapter). Note that `sort()` (`runner.ts:670-693`) does NOT have the same net: an invalid
   orderBy field silently no-ops. Decide whether to extend the net to orderBy or drop it
   everywhere for consistency once core issues 1.4/1.11 are fixed.

**Recommendation.** Keep constraint emulation (it is what makes the adapter behave like a
database), document it in the package README as intentional, fix (1), choose upsert-id
semantics for (2), and align (3) with whatever timeline core issues 1.4/1.11 have.
