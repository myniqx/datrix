# adapter-postgres-core / adapter-postgres — Review Findings

Review scope: `packages/adapter-postgres-core/src/**` and `packages/adapter-postgres/src/**`,
checked against the core→adapter contract in `packages/core/info_core.md`.
Core-side defects (issues 1.4, 1.8, 1.11, 2.2, etc.) are NOT repeated here — only how the
adapter must survive them.

Issues are split into two groups:

- **Section A — Mechanical fixes**: no design decision needed; hand each item (or the whole
  section) directly to a Sonnet agent with the instructions written below.
- **Section B — Decision-required issues**: each Part is sized for one session; contains the
  problem, `file:line` references, and solution options with a recommendation.

---

## Section A — Mechanical fixes (delegate to Sonnet agent as-is)

### A1. `$icontains` not implemented; `$contains`/`$notContains` use wrong case sensitivity ✅ DONE

- `packages/adapter-postgres-core/src/query-translator.ts:1116-1126`
- Core's operator list includes `$icontains` (`packages/core/src/types/core/query-builder.ts:62`),
  but `translateComparisonOperator` has no case for it → falls to `default` and throws
  "Unsupported operator".
- Contract (§4): `$contains` = case-sensitive `LIKE %v%`, `$icontains` = case-insensitive.
  Current code maps `$contains` → `ILIKE` and `$notContains` → `NOT ILIKE`.
- Fix: `$contains` → `LIKE`, `$icontains` → `ILIKE`, `$notContains` → `NOT LIKE`.
  Keep `$startsWith`/`$endsWith` behavior decision aside (contract doesn't fix their case
  sensitivity explicitly; leave them as `ILIKE` unless told otherwise) — just add the missing
  operator and fix `$contains`/`$notContains`.

### A2. LIKE metacharacters not escaped for adapter-added patterns ✅ DONE

- `packages/adapter-postgres-core/src/query-translator.ts:1117-1126`
- Contract (§4) explicitly requires: for `$startsWith`/`$endsWith`/`$contains`/`$icontains`/
  `$notContains` the adapter adds the `%` and MUST escape `%` and `_` in the user value.
  Currently `%${String(value)}%` is passed raw → user value `50%_off` behaves as wildcards.
- Fix: add a helper `escapeLikePattern(v: string): string` that escapes `\`, `%`, `_`
  (e.g. `v.replace(/[\\%_]/g, (m) => "\\" + m)`) and append `ESCAPE '\'` to those five
  operators' SQL. Do NOT touch `$like`/`$ilike` (pattern is user-provided by contract).

### A3. `integer: true` number fields become DOUBLE PRECISION columns ✅ DONE

- `packages/adapter-postgres-core/src/types.ts:151-179` (`getPostgresTypeWithModifiers`)
- `NumberField` has `integer?: boolean` (`packages/core/src/types/core/schema.ts:98`), but the
  mapper only special-cases `references` and `precision`. A plain `{ type: "number", integer: true }`
  column is created as `DOUBLE PRECISION`.
- Fix: in `getPostgresTypeWithModifiers`, after the `references` check, add:
  `if (field.type === "number" && field.integer) return "INTEGER";` (before the precision branch —
  or decide precision wins if both are set; precision+integer together should prefer NUMERIC).

### A4. `renameTable` leaves stale `tableName` inside the stored schema JSON ✅ DONE

- `packages/adapter-postgres-core/src/adapter.ts:438-474`
- The `_datrix` row's `key` is updated (`table:<old>` → `table:<new>`) but the JSON in `value`
  still contains `tableName: "<old>"`. A later `getTableSchema(newName)` returns a schema whose
  `tableName` is wrong; migration diffing then sees a phantom rename forever.
- Fix: after updating the key, read the row, `JSON.parse`, set `tableName = to`, write back
  (same pattern as `applyOperationsToMetaSchema`, adapter.ts:734-822).
- Note: `references.table` values in OTHER schemas that point to the renamed table also go stale.
  Fix those in the same UPDATE loop: scan all `_datrix` rows, patch `fields.*.references.table === from` → `to`.

### A5. Connection leaks in transaction lifecycle ✅ DONE

- `packages/adapter-postgres-core/src/adapter.ts:281-305` (`beginTransaction`): if
  `connection.query("BEGIN")` throws, the acquired connection is never released.
  Fix: wrap in try/catch, `connection.release()` before rethrowing.
- `packages/adapter-postgres-core/src/adapter.ts:962-1021` (`commit`/`rollback`): if the
  `COMMIT`/`ROLLBACK` query throws, `this.client.release()` is never called → pool exhaustion.
  Fix: release in a `finally`-style path (release exactly once; set a `released` flag).

### A6. `createTable` inside a transaction checks `_datrix` existence on the pool ✅ DONE

- `packages/adapter-postgres-core/src/adapter.ts:373` — `this.tableExists(DATRIX_META_MODEL)`
  always uses `this.config.runner` (pool), even when `createTable` was called with a transaction
  connection. If `_datrix` was created inside the same uncommitted transaction, the pool doesn't
  see it and `createTable` fails with "Create '_datrix' first".
- Fix: add optional `connection?: PgConnection` parameter to `tableExists` (adapter.ts:689-710),
  use `connection ?? this.config.runner`, and pass `queryRunner` at the call site (adapter.ts:373).

### A7. ORDER BY / GROUP BY / HAVING columns are not table-qualified ✅ DONE

- `packages/adapter-postgres-core/src/query-translator.ts:688-701` (`translateOrderBy`),
  `:443-452` (groupBy), `:334-339` (count groupBy).
- WHERE and SELECT columns are qualified with the main table
  (`"posts"."createdAt"`), but ORDER BY/GROUP BY emit bare `"createdAt"`. As soon as populate
  (json-aggregation LEFT JOINs, query-translator.ts:391-411) or relation-WHERE joins add another
  table that also has `createdAt`/`id`, Postgres throws `column reference is ambiguous`.
- Fix: pass the (escaped) main table name into `translateOrderBy` and the groupBy mapping, and
  prefix every column, same as `translateSelectClause` (query-translator.ts:483-495) does.

### A8. COUNT with relation-WHERE joins overcounts ✅ DONE

- `packages/adapter-postgres-core/src/query-translator.ts:316-348`
- For `type: "count"` with a nested relation WHERE on hasMany/manyToMany, LEFT JOINs multiply
  rows. The select path compensates with `SELECT DISTINCT` (query-translator.ts:398-411); the
  count path does not → `COUNT(*)` counts joined rows, not matching entities.
- Fix: when `whereResult.joins.length > 0`, emit
  `SELECT COUNT(DISTINCT ${table}."id")` instead of `COUNT(*)`.

### A9. Dead code removal (includes a latent param-binding bug) ✅ DONE

Never referenced from any live path — delete (or explicitly wire in, but deleting is the safe
mechanical action; the "lateral-joins" strategy in `populator.ts` builds its own SQL and uses
none of these):

- `packages/adapter-postgres-core/src/populate/join-builder.ts:296-353`
  (`buildHasOneLateralJoin`, `buildHasManyLateralJoin`) and `:444-499`
  (`buildManyToManyLateralJoin`) — `generateJoinSQL` drops lateral clauses anyway (`:528-531`).
- `packages/adapter-postgres-core/src/populate/aggregation-builder.ts:316-517`
  (`buildLateralSubquery`, `buildManyToManyLateralSubquery`) — NOTE: these contain a real bug
  (`translateWhere(options.where, 1)` at `:369` and `:476` embeds `$2…` placeholders but throws
  the params away), one more reason not to resurrect them without review.
- `packages/adapter-postgres-core/src/populate/result-processor.ts:155-313`
  (`processFlatJoinResults`, `extractMainRecord`, `attachRelations`, `extractRelationData`) and
  `:336-375` (`processLateralResults`).
- `packages/adapter-postgres-core/src/types.ts:184-297` (`toPostgresValue`, `fromPostgresValue`)
  and `:98-136` (`POSTGRES_TO_TS_TYPE`) — only referenced from the stale tests in
  `packages/adapter-postgres/tests/types.test.ts` (see A11). If Section B Part 3 (type
  conversion) decides to reuse `fromPostgresValue`, it can be restored from git history —
  do not keep it "just in case".
- `packages/adapter-postgres-core/src/populate/types.ts`: `ProcessedResult`,
  `PopulateFieldSelection` (only used by deleted code), `PopulateContext`, `JoinClause.isLateral` —
  prune whatever becomes unused after the deletions above.

### A10. Exporter/importer bypass identifier escaping (SQL injection via import archive) ✅ DONE

- `packages/adapter-postgres-core/src/export-import/exporter.ts:39` — `` `"${tableName}"` ``
  without validation.
- `packages/adapter-postgres-core/src/export-import/importer.ts:66-68` (table + column names
  from archive rows), `:99-107` (`addForeignKeys`: table, field, references.table/column),
  `:122-127` (`resetSequence`).
- Worst case: `resetSequence` interpolates `tableName` into a **string literal**
  (`pg_get_serial_sequence('${tableName}', 'id')`) — a table name containing `'` breaks out of
  the literal. Archive content is external input; identifiers must go through
  `translator.escapeIdentifier` (which validates the charset) and the sequence-name literal must
  be parameterized (`pg_get_serial_sequence($1, 'id')`).
- Fix: give `PostgresExporter`/`PostgresImporter` access to the adapter's translator
  (they already hold `adapter`; add a public accessor or pass translator in) and route every
  identifier through `escapeIdentifier`; parameterize `resetSequence`.

### A11. `packages/adapter-postgres/tests/**` broken by the core-split refactor ✅ DONE (test dosyaları kaldırıldı)

- `tests/types.test.ts:9-14` imports `getPostgresType`, `toPostgresValue`, `fromPostgresValue`,
  `POSTGRES_TO_TS_TYPE` from `../src` — no longer exported (src is now index/pg-driver/test-utils).
- `tests/query-translator.test.ts:8` imports `createPostgresTranslator` from `../src` — gone.
- `tests/adapter-index.test.ts:19` imports `../src/types` — file deleted.
- Several tests construct `new PostgresAdapter(config)` with a plain host/port config; the
  re-exported `PostgresAdapter` (= `PostgresCoreAdapter`) now takes a `PostgresCoreConfig` driver.
- Fix: move translator/populate/type-mapping tests into `packages/adapter-postgres-core/tests/`
  (package currently has NO tests directory) importing from `@datrix/adapter-postgres-core`
  internals; update remaining adapter-postgres tests to build adapters via
  `createPostgresAdapter(config)`. Delete tests that cover code removed in A9. Run
  `pnpm type-check` and `pnpm test:unit` to confirm.

### A12. Batched belongsTo runs a useless query when all FK values are null ✅ DONE

- `packages/adapter-postgres-core/src/populate/populator.ts:497-514` and nested variant
  `:707-722`. The lateral strategy already short-circuits (`populator.ts:229-234`); the batched
  strategy queries `ANY('{}')`. Mirror the short-circuit: set relation to `null`, delete the FK
  column, `continue`.

### A13. `ResultProcessor` null-detection can null out a legitimate row ✅ DONE

- `packages/adapter-postgres-core/src/populate/result-processor.ts:75-89`
- A belongsTo/hasOne row whose selected fields are all NULL (e.g. `select: ["bio"]` where bio is
  null) is indistinguishable from "LEFT JOIN no match" and becomes `null`.
- Mechanical rule: if the object has an `id` key, decide by `id === null` alone; only fall back
  to the all-fields-null heuristic when `id` was not selected. (`id` of a real row is never null.)

### A14. Debug logging always on outside production ✅ DONE

- `packages/adapter-postgres-core/src/pg-client.ts:13,46-50`
- `NODE_ENV !== "production"` logs every SQL statement, params, and the full serialized
  QueryObject to console — noisy in dev/test and leaks row data into logs; `JSON.stringify` runs
  on every query even when output is discarded.
- Fix: gate on an explicit opt-in env var (`DATRIX_DEBUG=1` or similar) instead of NODE_ENV, and
  build the queryObject JSON only when the flag is set.

---

## Section B — Decision-required issues (one Part per session)

### Part 1 — `select: undefined` crashes the translator (core issue 2.2 survival)

**Problem.** Contract §3/§8: post-write refetch may arrive with `select: undefined`, and the
adapter must treat it as "all non-hidden scalar columns". Today it crashes:

- `packages/adapter-postgres-core/src/query-translator.ts:483-495` — `translateSelectClause`
  calls `select.map(...)` → `TypeError: Cannot read properties of undefined`.
- `packages/adapter-postgres-core/src/populate/populator.ts:184-188` and `:456-465` — both
  batch strategies spread `...(query.select as string[])`.

**Decision to make.** Where to normalize:

- **Option 1 (recommended):** normalize once at the top of `translate()`
  (query-translator.ts:256) and at `PostgresPopulator.populate()` entry (populator.ts:69): if
  `query.type === "select" && !query.select`, derive the list from the registry schema —
  all fields with `type !== "relation"` and not `hidden`. Pros: single choke point, populate
  strategies inherit it. Cons: translator mutates/clones the query object.
- **Option 2:** defensive fallback inside `translateSelectClause` only (emit
  `"table".*`). Pros: tiny. Cons: `*` returns hidden FK columns (contract says non-hidden), and
  populator spread sites still crash.

**Implementation sketch (Option 1).** Add
`private resolveSelect(query): readonly string[]` on the translator using
`schemaRegistry.findModelByTableName` + field filter (`hidden` flag lives on FieldDefinition);
clone the query with the resolved list before the switch. Add unit tests: refetch-shaped query
without select, with a schema containing a hidden FK and a relation field.

### Part 2 — Per-relation `limit`/`offset` applies globally, not per parent row

**Problem.** The "lateral-joins" strategy does not actually use LATERAL. All constrained
populates are batched with `WHERE fk = ANY($1) ... LIMIT n`:

- `packages/adapter-postgres-core/src/populate/populator.ts:315-332` (hasMany, lateral strategy),
  `:381-400` (manyToMany, lateral strategy),
  `:1046-1091` (`buildBatchOptionsClause`, used by the batched strategy and nested populate).

`populate: { comments: { limit: 5 } }` over 20 posts returns 5 comments **total**, distributed
arbitrarily — not 5 per post. `offset` is equally wrong. `orderBy` currently orders the whole
batch (acceptable only as an accident when combined per-group).

**Decision to make.** Two correct implementations:

- **Option 1 (recommended): window function.** One batched query:
  `SELECT * FROM (SELECT t.*, ROW_NUMBER() OVER (PARTITION BY t."fk" ORDER BY <orderBy or id>) AS _rn FROM target t WHERE t."fk" = ANY($1) AND <where>) w WHERE w._rn > offset AND w._rn <= offset+limit`.
  Keeps the single-round-trip batching model; works for hasMany, manyToMany (partition by
  junction sourceFK), and nested populate. Straightforward to bolt into
  `buildBatchOptionsClause` call sites.
- **Option 2: true LATERAL join** driven from the parent table (matches the strategy's name and
  the doc comments at populator.ts:134-156). More SQL surface to build; harder to reuse for the
  nested/batched path.

Also decide: when `limit`/`offset` are absent, keep the current plain `ANY($1)` fast path (yes —
only branch to the window query when needed).

**Files to touch.** populator.ts hasMany/manyToMany branches in `executeLateralJoins`,
`executeBatchedQueries`, `populateBatchedRows`, plus `buildBatchOptionsClause`. Add integration
tests: 3 parents × 5 children, `limit: 2` → each parent gets exactly its own first 2 by orderBy.

### Part 3 — Returned rows violate the JS-type contract (dates/numbers as strings)

**Problem.** Contract §1.4: rows must come back with `Date` objects for date fields, numbers for
numeric fields, parsed JSON for json fields.

1. **Populated relations** are built via `row_to_json`/`jsonb_agg`
   (aggregation-builder.ts:130,208,282; populator.ts `rowToJson` batch queries), so every date
   field inside a populated relation arrives as an ISO **string**, and stays that way —
   `ResultProcessor.processRow` (result-processor.ts:52-119) only JSON-parses, never converts
   types. All three strategies are affected.
2. **Main rows**: the pg driver converts `timestamptz` → Date and JSONB → object, but `NUMERIC`
   (used when `precision` is set, types.ts:165-171) and `BIGINT` come back as **strings**. With
   the driver-agnostic `PgRunner` (postgres.js, Neon), even the Date/JSONB conversions are
   assumptions, not guarantees.

**Decision to make.**

- Add a schema-driven post-processing pass (recommended): a `convertRowTypes(row, schema)` that
  walks the target schema's fields and coerces `date` → `new Date(v)` and `number` →
  `Number(v)` when the runtime type is string. Apply it (a) in `ResultProcessor.processRow` per
  relation level (it already recurses with the populate tree — needs the target schema per
  relation, resolvable from the registry), (b) on batch-strategy `data` objects
  (populator.ts `fetchBatchQueryResults` consumers), and (c) on plain select rows in
  `adapter.executeQuery` (adapter.ts:170-177). Weigh the per-row cost; skip conversion when the
  schema has no date/precision-number fields (precompute a per-schema "needs conversion" flag).
- Alternatively, narrow the contract: declare in `driver.ts` that a conforming driver MUST
  return Dates/numbers/parsed JSON (pushes the problem to driver wrappers — does NOT fix
  the row_to_json string dates, so a processing pass for populated rows is needed either way).
- Decide `NUMERIC` policy: `Number(v)` loses precision beyond 2^53 — acceptable? (core assumes
  numeric ids and JS numbers everywhere, so probably yes; document it).

Suggested split if too big for one session: 3a = populated-relation conversion,
3b = main-row conversion + driver contract doc in `driver.ts`/README.

### Part 4 — Relation-WHERE on UPDATE/DELETE: JOIN→FROM/USING conversion is semantically wrong

**Problem.** `packages/adapter-postgres-core/src/query-translator.ts:592-620` (UPDATE) and
`:646-673` (DELETE) regex-parse the generated `LEFT JOIN ... AS ... ON ...` strings and convert
them to `FROM`/`USING` + ANDed conditions. This changes LEFT JOIN semantics to an inner join:

- Rows whose FK is NULL (no related row) can never match — even when the WHERE is
  `$or: [{ status: "draft" }, { author: { verified: true } }]`; the draft-status branch is
  silently lost because the join condition is ANDed at the top level.
- `$not` / `$ne` over relation conditions inverts incorrectly under inner-join semantics.
- manyToMany joins multiply rows; for UPDATE that's harmless (same row updated once) but for
  DELETE + RETURNING it can produce duplicate ids; and the regex parsing itself is fragile
  (any format change in join SQL breaks it silently → conditions dropped).

**Decision to make (recommended: Option 1).**

- **Option 1: subquery translation.** For UPDATE/DELETE with `whereResult.joins.length > 0`,
  emit `WHERE "t"."id" IN (SELECT "t"."id" FROM "t" LEFT JOIN ... WHERE <conditions>)` — i.e.
  reuse the SELECT-path translation (which is already correct, including DISTINCT) as an id
  subquery. Removes the regex conversion entirely. Cost: one extra subquery, planner handles it.
- **Option 2: EXISTS-based translation** of nested relation conditions at the point where the
  join is generated (translateWhereConditions query-translator.ts:900-989) — bigger change but
  also improves SELECT (no DISTINCT needed, no row explosion). Could be a follow-up part of its
  own; if chosen, Part 4 and the count fix (A8) collapse into it.

**Files.** query-translator.ts `translateUpdate`, `translateDelete`; tests for `$or` with
relation + scalar branches on UPDATE and DELETE, NULL-FK rows included.

### Part 5 — populate `where` silently ignored for belongsTo/hasOne in the batched strategy

**Problem.** Contract §4: an adapter must never silently ignore a condition. The lateral
strategy applies `options.where` to belongsTo/hasOne (populator.ts:236-249, 262-271), but the
batched strategy (chosen for depth > 1 or complex options at depth > 1) does not:

- `packages/adapter-postgres-core/src/populate/populator.ts:497-514` (belongsTo),
  `:540-552` (hasOne), and all of `populateBatchedRows` `:707-774` (nested belongsTo/hasOne) —
  no `buildBatchOptionsClause` call; `where`/`orderBy`/`limit` on these relations vanish.

**Decision to make.** Semantics first: what does `where` on a belongsTo populate mean —
"populate the author only if verified, else null"? (that's what the lateral strategy implements).
If yes: apply `buildBatchOptionsClause` in the four batched branches exactly like hasMany does
(note Part 2 interacts with `limit` here). If the team decides belongsTo/hasOne must not accept
`where`, then throw a clear `DatrixAdapterError` instead — but pick one, and make the lateral
strategy and batched strategy behave identically. Also decide whether populate-level `where`
values need the same relation-subfilter support as top-level WHERE (currently
`translateWhere(where, n, targetTable, "t")` supports nested relations via joins — those joins
are **discarded** by `buildBatchOptionsClause` (populator.ts:1055-1065 ignores
`whereResult.joins`) → nested-relation conditions inside populate-where reference missing
aliases and fail; either wire the joins into the batch SQL or reject nested relation filters in
populate-where with a clear error).

### Part 6 — `modifyColumn` is incomplete (TYPE only, no USING, no nullability/default)

**Problem.** `packages/adapter-postgres-core/src/adapter.ts:511-516`: `modifyColumn` emits only
`ALTER COLUMN <c> TYPE <t>`.

- No `USING <c>::<t>` clause → common migrations (TEXT→INTEGER, VARCHAR→TIMESTAMPTZ) fail with
  "column cannot be cast automatically".
- Changes to `required` (SET/DROP NOT NULL), `default` (SET/DROP DEFAULT), `unique`
  (ADD/DROP CONSTRAINT), enum `values` (CHECK, see Part 7) are silently NOT applied, while
  `applyOperationsToMetaSchema` (adapter.ts:766-767) happily records the new definition in
  `_datrix` → stored schema and physical table diverge, breaking future migration diffs.

**Decision to make.**

- Which deltas `modifyColumn` must support in v1: recommend TYPE (+`USING col::newtype` always),
  NOT NULL set/drop, DEFAULT set/drop. UNIQUE via constraint add/drop needs a naming convention
  — decide it (e.g. `uq_<table>_<column>`) or defer with an explicit
  `throwMigrationError("unsupported: unique change")` instead of silence.
- Whether the adapter receives old+new definitions (AlterOperation `modifyColumn` carries
  `newDefinition` only — check if core passes the old one; if not, read it from `_datrix` meta
  before altering, same read as `applyOperationsToMetaSchema`) so it can emit only the needed
  sub-statements.
- Failure semantics: `alterTable` runs inside the migration transaction (contract §6 phase 2),
  so multi-statement modify is safe to emit as several `ALTER TABLE` statements.

### Part 7 — Enum columns have no DB-level constraint

**Problem.** Contract §6: enum → "values list — CHECK constraint or native enum".
`packages/adapter-postgres-core/src/types.ts:83-93` maps enum → `VARCHAR` (no length, no CHECK),
and `buildColumnDefinition` (adapter.ts:835-857) adds nothing. Data written via
`executeRawQuery`, external tools, or a buggy executor is unconstrained.

**Decision to make.**

- **Option 1 (recommended): inline CHECK constraint** —
  `"col" TEXT NOT NULL CHECK ("col" IN ('a','b'))` with a stable constraint name
  (`chk_<table>_<col>_enum`) so Part 6's `modifyColumn` can DROP + re-ADD it when enum values
  change. Simple, no type management.
- **Option 2: native `CREATE TYPE ... AS ENUM`** — cleaner semantics but adds lifecycle pain
  (type creation order, `ALTER TYPE ADD VALUE` can't run in a transaction, value removal
  impossible) — not recommended for a migration-driven system.
- **Option 3: keep executor-only validation** and amend `info_core.md` §6 to say enum has no DB
  constraint — a legitimate outcome, but then the contract text must change, not the adapter.

If Option 1: implement in `buildColumnDefinition` + `addColumn`, and extend Part 6's
`modifyColumn` to swap the CHECK when `values` change. Escape values via
`translator.escapeValue`.

### Part 8 — Export/import scope and safety (data-destructive)

**Problem.** Import is a wipe-and-restore over the **entire public schema**:

- `packages/adapter-postgres-core/src/adapter.ts:631-652` — `getTables()` returns ALL
  `public` tables, datrix-managed or not. datrix is positioned as "a plugin for existing
  projects" (shared DB), so this includes the host app's tables.
- `packages/adapter-postgres-core/src/export-import/importer.ts:19-22` — step 1 drops every
  table `getTables()` returns → **importing an archive destroys non-datrix tables**; exporting
  also dumps foreign tables (exporter.ts:19-31 iterates the same list — and `exportTable`
  does `ORDER BY "id"`, which throws on any foreign table without an `id` column).
- `importer.ts:21` — `dropTable` runs `DROP TABLE IF EXISTS` (no CASCADE) in arbitrary order →
  fails on FK-referenced tables.
- The whole import runs on the pooled runner with no transaction (importer.ts:15-48) — a failure
  after step 1 leaves the database emptied.

**Decisions to make (can be one session if agreed quickly, else split 8a/8b):**

1. **Scope**: restrict both export and import to datrix-managed tables = tables that have a
   `table:<name>` key in `_datrix`, plus `_datrix` itself and the migration-history table.
   Recommended: derive the list from `_datrix` keys, not from `pg_tables`. (Leave `getTables()`
   introspection behavior itself as a separate question — core filters `_datrix*` but callers
   may rely on it listing everything; check `@datrix/cli` usage before changing it. If
   `getTables()` stays broad, the exporter/importer must do their own filtering.)
2. **Drop order**: with scope fixed, drop in reverse-FK order derived from the stored schemas
   (junction/child tables first), or simply `DROP ... CASCADE` limited to managed tables —
   CASCADE is acceptable once scope is limited, but decide explicitly.
3. **Atomicity**: wrap steps 1–4 in a single transaction (`config.connect()` + BEGIN … COMMIT);
   `resetSequence` can stay outside. Postgres DDL is transactional, so this is feasible —
   decide whether archive size makes a single transaction unacceptable (lock duration) and, if
   so, at least do "create into temp-prefixed tables, then swap" or document the risk.

**Files.** exporter.ts, importer.ts, adapter.ts (`exportData`/`importData`), plus A10 overlaps —
do A10 first so this part builds on escaped identifiers.

### Part 9 — hasOne row explosion in the json-aggregation strategy (minor)

**Problem.** hasOne is populated via plain LEFT JOIN + `GROUP BY main."id", rel."id"`
(join-builder.ts:237-271; query-translator.ts:419-442). Nothing enforces FK uniqueness at the
DB level, so two target rows pointing at the same parent duplicate the parent row in the result
(each with a different `rel."id"` group).

**Decision.** Either (a) enforce a UNIQUE index on the hasOne FK column at `createTable` time —
schema-level guarantee, recommended, small change in the DDL path (needs core to mark the FK
field as belonging to a hasOne inverse — check whether the enhanced schema exposes that; if the
hidden FK field carries `unique` already, this is a non-issue and only needs a test proving it);
or (b) make the aggregation defensive (`DISTINCT ON`/lateral `LIMIT 1`). Verify actual behavior
with an integration test first — it's possible core already sets `unique: true` on the hidden
FK for hasOne, in which case close this issue as documentation.

---

## Notes (no action, or fold into the parts above)

- The translator instance is shared per adapter and stateful (`paramIndex`/`params`,
  query-translator.ts:38-39). Safe today only because `translate()` is fully synchronous; any
  future `await` inside translation introduces cross-query corruption. Worth a comment or a
  refactor to a per-call context object if the file is touched anyway (fits Part 4's rewrite).
- `executeRawQuery` (adapter.ts:253-276) bypasses `PgClient`, so raw queries don't get the
  `ADAPTER_UNIQUE_CONSTRAINT`/`ADAPTER_FOREIGN_KEY_CONSTRAINT` code mapping
  (pg-client.ts:15-25) — only `ADAPTER_QUERY_ERROR`. Harmless inconsistency; could route
  through PgClient when convenient.
- `addIndex` from a Transaction (adapter.ts:1094-1096) passes `schema: undefined`, so indexes
  declared on relation *field names* won't be remapped to FK columns in that path
  (adapter.ts:571-580). Only matters if migration `createIndex` steps reference relation names.
- `test-utils.ts` (adapter-postgres) interpolates `dbName` into DDL unescaped
  (test-utils.ts:62-65) — test-only helper, acceptable, but a `"` in the name breaks it.
- `escapeValue` (query-translator.ts:223-251) is only used for column DEFAULTs; it relies on
  `standard_conforming_strings=on` (Postgres default) for `''` escaping — fine, but do not
  reuse it for user-supplied values.
