# adapter-mongodb — Review Findings

Review scope: `packages/adapter-mongodb/src/**`, checked against the core→adapter contract in
`packages/core/info_core.md` (incl. the extra `$icontains` operator note).
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

- `packages/adapter-mongodb/src/query-translator.ts:403-459` (`translateComparisonOperators`)
- Core's operator list includes `$icontains`, but the switch has no case for it → falls to
  `default` (`:454-458`) and throws "Unsupported operator".
- Contract (§4): `$contains` = case-sensitive `LIKE %v%`, `$icontains` = case-insensitive,
  `$notContains` = case-sensitive NOT LIKE. Current code sets `$options: "i"` for both
  `$contains` (`:411-414`) and `$notContains` (`:415-420`).
- Fix: `$contains` → `$regex` without `$options`; add `$icontains` → `$regex` + `$options: "i"`;
  `$notContains` → `$not: { $regex: ... }` without `$options`. Leave `$startsWith`/`$endsWith`
  as case-insensitive (contract doesn't fix their case; matches the decision taken for the
  postgres adapter in its A1). Regex-metachar escaping via `escapeRegex` is already correct.

### A2. `$exists` has MongoDB semantics, not the contract's IS NOT NULL semantics ✅ DONE

- `packages/adapter-mongodb/src/query-translator.ts:437-439`
- Contract (§4): `$exists: true` ≡ `$notNull: true` ≡ `IS NOT NULL`. The translator passes
  `$exists` straight to MongoDB, where `$exists: true` matches a field that is **present with
  value null**. Since `applyDefaults` (adapter.ts:479-517) stores explicit `null` for every
  missing optional field, `{ field: { $exists: true } }` matches rows whose field is NULL —
  the opposite of the SQL adapters.
- Fix: translate `$exists: true` → `{ $ne: null }` and `$exists: false` → `{ $eq: null }`,
  exactly like the existing `$notNull`/`$null` cases (`:441-453`). Do not emit Mongo `$exists`.

### A3. Multiple pattern operators on one field silently overwrite each other ✅ DONE

- `packages/adapter-mongodb/src/query-translator.ts:404-428`
- Contract (§4): multiple operators on a field combine with AND
  (`{ age: { $gte: 18, $lt: 65 } }`). All of `$like`/`$ilike`/`$contains`/`$startsWith`/
  `$endsWith` write to the same `result["$regex"]` key, so
  `{ name: { $startsWith: "A", $endsWith: "z" } }` keeps only `z$` — the first condition is
  silently dropped. Same for `$like` + any other pattern op.
- Fix: change `translateComparisonOperators` to return
  `{ fieldFilter: Record<string, unknown>; extraFilters: Record<string, unknown>[] }`. When a
  pattern operator would write `$regex` (or `$not`) and the key already exists in `fieldFilter`,
  push `{ $regex: ..., $options?: ... }` into `extraFilters` instead. At the call site
  (`translateWhereConditions` query-translator.ts:349-355), assign `fieldFilter` to
  `filter[key]` and append each extra as `{ [key]: extra }` into `filter["$and"]`
  (create the `$and` array if absent, concat if present).

### A4. Relation shortcut in WHERE silently dropped when `foreignKey` is missing or kind is hasMany/manyToMany ✅ DONE

- `packages/adapter-mongodb/src/query-translator.ts:275-290`
- For a simple value under a relation field (`{ category: 2 }`), the code does
  `if (relationField.foreignKey) { filter[...] = ... } continue;` — when `foreignKey` is
  undefined the `continue` still runs and the condition **vanishes from the filter** (worst
  case: a DELETE whose only WHERE condition is dropped deletes everything). Additionally the
  branch applies `filter[foreignKey]` regardless of relation kind; for hasMany/manyToMany the
  FK column lives on the *target* collection, so filtering the source collection by it is
  wrong. (Core normally rewrites belongsTo/hasOne shortcuts before the adapter — §4 — so this
  is a safety net, but it must fail loudly, not silently.)
- Fix: in that branch, if `!relationField.foreignKey` or
  `relationField.kind !== "belongsTo" && relationField.kind !== "hasOne"`, call
  `throwQueryError` with a clear message ("relation shortcut '<key>' cannot be translated")
  instead of `continue`.

### A5. Operator/field-name injection: unvalidated keys become MongoDB operators (`$where`) ✅ DONE

- `packages/adapter-mongodb/src/query-translator.ts:236-362` (`translateWhereConditions`),
  `:492-500` (`translateSort`), `:468-487` (`translateProjection`);
  `packages/adapter-mongodb/src/populate/populator.ts:553-563` (`buildSelectProjection`),
  `:460-467` and `:519-525` (populate orderBy → sort keys).
- Core does NOT validate field names in `orderBy`/`having` and populate-level `where`/`orderBy`
  (contract §8); the adapter is the safety net. `translateWhereConditions` copies any
  non-`$and/$or/$not` key straight into the filter: a populate-where of
  `{ $where: "sleep(10000)||true" }` reaches the else-branch at `:357-361` and becomes a
  top-level `$where` — **server-side JavaScript execution from user input**. Dotted keys also
  pass through and traverse subdocuments. `helpers.ts` already has `validateIdentifier`
  (helpers.ts:12-28) but it is only applied to table names.
- Fix: in `translateWhereConditions`, for every key that is not exactly `$and`/`$or`/`$not`,
  call `validateIdentifier(key)` (rejects `$` prefix and dots). Apply the same call to each
  `item.field` in `translateSort` and the populate sort loops, and to each field in
  `translateProjection`/`buildSelectProjection`. This throws a clear `DatrixAdapterError`
  instead of forwarding operators.

### A6. `select: undefined` returns hidden FK columns (core issue 2.2 survival) ✅ DONE

- `packages/adapter-mongodb/src/query-translator.ts:75-100` (`translateSelect` →
  `translateProjection` returns `undefined` for missing/empty/`"*"` select), consumed at
  `packages/adapter-mongodb/src/adapter.ts:257-264` (projection defaults to `{_id: 0}` only).
- Contract §3/§8: post-write refetch may carry `select: undefined`; the adapter must treat it
  as "all non-hidden scalar columns". Today the full document is returned, including hidden FK
  fields (e.g. `categoryId` marked `hidden`). No crash, but hidden fields leak into rows —
  including through the populate path (`populator.ts:224-237`, `injectFkColumns` returns
  `undefined` → full docs).
- Fix: in `translateSelect` (and `translateCount` untouched), when
  `translateProjection` returns `undefined`, build a default projection from the schema:
  `getSchema(query.table)` (already exists, query-translator.ts:593-597), include every field
  with `type !== "relation"` and not `hidden`, plus `id: 1`, `_id: 0`. Keep `undefined` only
  when the schema is unknown (e.g. `_datrix` internals). Note for the implementer: after this,
  `populator.injectFkColumns` will start receiving a projection for refetch queries, which is
  exactly what it needs — no change required there.

### A7. Populated refetch loses ALL scalar fields (`buildFinalProjection` inclusion-only projection) ✅ DONE

- `packages/adapter-mongodb/src/populate/populator.ts:568-584`
- When the base projection is `undefined` (select: undefined / `"*"`), `buildFinalProjection`
  returns `{_id: 0, <relation>: 1, ...}` — mixing `_id` exclusion with relation inclusions.
  MongoDB treats this as an **inclusion projection**, so the depth-1 `$lookup` result contains
  only the relation fields: every scalar column (`id`, `title`, …) is stripped from the rows.
  Any select-with-populate query where `select` is undefined returns crippled rows.
- Fix: in `buildFinalProjection`, if `baseProjection` is undefined return `{ _id: 0 }` only
  (relation fields added by `$lookup` are included by default). Keep the current merge when a
  base projection exists. (A6's default projection reduces how often this path is hit, but the
  guard must exist regardless — implement both.)

### A8. hasOne `$unwind` duplicates parent rows when multiple children share the FK ✅ DONE

- `packages/adapter-mongodb/src/populate/populator.ts:119-129` (hasOne lookup) and
  `:589-619` (`buildLookupWithUnwind`).
- Nothing enforces uniqueness of the hasOne FK in MongoDB (no unique index is created for it),
  so the `$lookup` array can contain 2+ documents; `$unwind` then emits the parent row once per
  child — duplicated main rows. The batched strategy is safe (Map overwrite, `:351-360`).
- Fix: in `buildLookupWithUnwind`, append `{ $limit: 1 }` to the inner lookup pipeline
  (after the `$match`/`$sort` stages produced by `buildLookupPipeline`, before `$project` is
  fine too). Harmless for belongsTo (FK → unique `id` can only match one).

### A9. DELETE returns no rows ✅ DONE

- `packages/adapter-mongodb/src/adapter.ts:379-418` (`executeDeleteOp`)
- Contract §3: `delete` must return the deleted rows. The adapter already pre-fetches the ids
  (`docsToDelete`, `:387-394`) but returns `rows: []` (`:417`). UPDATE (`:370`) correctly
  returns id rows from its pre-fetch; DELETE should match.
- Fix: `const idRows = docsToDelete.map((doc) => ({ id: doc["id"] })) as TResult[];` and return
  `{ rows: idRows, metadata }`. Keep metadata based on `result.deletedCount`.

### A10. `limit: 0` bypasses the empty-result short-circuit when populate is present ✅ DONE

- `packages/adapter-mongodb/src/adapter.ts:242-252` (`executeFindOp` returns `[]` for
  `limit === 0`) vs `:445-473` (`executeWithPopulate` has no such check).
- In the populate path, `limit: 0` reaches the populator: the lookup strategy pushes
  `{ $limit: 0 }` (populator.ts:180-182) which is a MongoDB **server error** ("limit must be
  positive"), and the batched strategy calls `cursor.limit(0)` (populator.ts:240) which MongoDB
  treats as **no limit** — returning everything instead of nothing.
- Fix: at the top of `executeWithPopulate`, if `query.limit === 0` return
  `{ rows: [], metadata: { rowCount: 0, affectedRows: 0 } }`.

### A11. Nested-relation WHERE on `id` silently drops conditions when merged ✅ DONE

- `packages/adapter-mongodb/src/nested-where.ts:93-104` and `:308-325` (`mergeIdFilter`)
- Two loss scenarios: (1) filter `{ comments: {...}, id: { $gt: 5 } }` — the relation resolves
  first and writes `resolvedFilter["id"] = { $in: [...] }`, then the regular-field branch at
  `:104` **overwrites** it with `{ $gt: 5 }`, silently discarding the relation condition.
  (2) reverse order — `mergeIdFilter` sees an existing non-`$in` value (`{ $gt: 5 }`),
  `existingIn` is undefined, and returns `{ $in: newIds }`, discarding the `$gt`. Either way
  one condition vanishes (dangerous for DELETE filters).
- Fix: stop assigning relation-derived id constraints to `resolvedFilter["id"]`. Instead push
  `{ id: { $in: matchedIds } }` into a local `andConditions: Filter<Document>[]`, and at the end
  of `resolveNestedWhere` merge: if `andConditions.length > 0`, return
  `{ $and: [resolvedFilter, ...andConditions] }` (or append to an existing `$and`). Delete
  `mergeIdFilter`.

### A12. `alterTable` ignores its transaction session ✅ DONE

- `packages/adapter-mongodb/src/adapter.ts:787-841` — the parameter is declared `_session` and
  never used; all `updateMany`/`$unset`/`$rename` document rewrites run without the session,
  as does the `_datrix` meta update (`applyOperationsToMetaSchema`, adapter.ts:1002-1085).
  `MongoDBTransaction.alterTable` (adapter.ts:1257-1262) passes the session for nothing:
  contract §6 phase 2 runs `alterTable` inside the migration transaction, so a rollback leaves
  the documents already rewritten. Unlike collection DDL (create/drop/rename, which MongoDB
  genuinely can't do in a transaction — correctly documented at adapter.ts:1241-1244),
  `updateMany` and `findOne/updateOne` fully support sessions.
- Fix: rename `_session` → `session`; build `const sessionOpts = session ? { session } : {}`
  and pass it to every `collection.updateMany(...)` call in the switch, and thread the session
  into `applyOperationsToMetaSchema` (add optional param, pass to `findOne` and `updateOne`).

### A13. `renameTable` leaves stale `tableName` inside the stored schema JSON ✅ DONE

- `packages/adapter-mongodb/src/adapter.ts:746-785`
- The `_datrix` doc's `key` is updated (`table:<old>` → `table:<new>`) but the JSON in `value`
  still contains `tableName: "<old>"`. `getTableSchema(newName)` then returns a schema whose
  `tableName` is wrong and migration diffing sees a phantom rename forever. `references.table`
  values in OTHER stored schemas that point at the renamed collection also go stale.
- Fix: after the key update, read the doc, `JSON.parse(value)`, set `tableName = to`, write
  back (same pattern as `applyOperationsToMetaSchema`). Then scan all `_datrix` docs whose key
  starts with `DATRIX_META_KEY_PREFIX`, parse each, and patch every
  `fields.*.references.table === from` → `to`, writing back only when changed.

### A14. `getNextIds` upsert race throws duplicate-key on first concurrent insert ✅ DONE

- `packages/adapter-mongodb/src/helpers.ts:63-89`
- `findOneAndUpdate(..., { upsert: true })` on a missing counter doc is not atomic across
  concurrent callers: two first-ever inserts into the same collection can both attempt the
  upsert, and the loser gets an E11000 on the `_datrix` unique `key` index, surfacing as a
  spurious `ADAPTER_UNIQUE_CONSTRAINT` failure to the user's insert.
- Fix: wrap the `findOneAndUpdate` in a small retry loop (e.g. up to 3 attempts): catch errors
  with `code === 11000` and retry (the doc now exists, so the retry takes the `$inc` path);
  rethrow anything else or after max attempts.

### A15. Cascade delete can recurse infinitely on cyclic FK graphs ✅ DONE

- `packages/adapter-mongodb/src/on-delete.ts:115-140`
- `applyOnDeleteActions` recurses into children **before** deleting them (`:135` then `:137`).
  With a cyclic cascade (A.fk → B cascade, B.fk → A cascade, rows referencing each other), the
  recursion finds the still-existing original rows again and ping-pongs A→B→A… until stack
  overflow. Self-referencing trees terminate, but cycles do not.
- Fix: add a `visited: Set<string>` parameter (default `new Set()`), key `` `${table}:${id}` ``.
  At entry, filter `idsToDelete` to ids not already in `visited`, add the survivors, return
  early if none remain, and pass `visited` through the recursive call at `:135`.

### A16. Debug logging always on outside production ✅ DONE

- `packages/adapter-mongodb/src/mongo-client.ts:15` (`IS_DEBUG = NODE_ENV !== "production"`)
  and `:55-64` (`log`).
- Every MongoDB operation logs the operation, its context, and the **full serialized
  QueryObject** to console in dev/test — noisy and leaks row data into logs; `JSON.stringify`
  runs on every call. Same defect as the postgres adapter's A14.
- Fix: gate on an explicit opt-in env var (`DATRIX_DEBUG=1`) instead of NODE_ENV, and build the
  JSON strings only when the flag is set.

### A17. Dead code removal ✅ DONE

- `packages/adapter-mongodb/src/nested-where.ts:26-35` — `RelationFilter` interface is exported
  and referenced nowhere in the package.
- `packages/adapter-mongodb/src/mongo-client.ts:37-42` — `getSession()` is never called (all
  call sites use `sessionOptions()`).
- Fix: delete both.

---

## Section B — Decision-required issues (one Part per session)

### Part 1 — `importData` wipes the ENTIRE database; export dumps foreign collections (data-destructive) ✅ DONE

**Done note (2026-07-12).** `getManagedCollections()` helper added (helpers.ts) — derives the
managed list from `_datrix` schema keys. Exporter scopes to managed collections + `_datrix` and
uses a single sorted cursor with a chunk accumulator (`_datrix` by `key`, others by `id`).
Importer stages everything into `_import_tmp_*` collections (stale temps from a crashed import
are cleaned at start), then renames into place with `dropTarget: true`; managed collections not
in the archive are dropped afterwards; a staging failure drops the temps and leaves existing
data untouched. Rename-window trade-off documented in README.

**Resolution (decided 2026-07-12).**
1. **Scope:** restrict BOTH export and import to datrix-managed collections — derive the list
   from `_datrix` docs whose key starts with `DATRIX_META_KEY_PREFIX`, plus `_datrix` itself.
   `getTables()` stays broad; filtering lives in exporter/importer (same decision as the
   postgres adapter's Part 8).
2. **Atomicity:** option (a) — import into temp-suffixed collections (e.g. `_import_tmp_<name>`),
   and only after ALL data landed successfully, `rename(..., { dropTarget: true })` each into
   place. A failed import leaves the existing data untouched; the small per-collection window
   between renames is accepted and documented in the README.
3. **Export pagination:** replace skip/limit pagination with a single `find().sort()` cursor
   iterated with a chunk accumulator; `_datrix` sorts by `key`, managed collections by `id`.

**Problem.**

- `packages/adapter-mongodb/src/export-import/importer.ts:19-23` — step 1 drops **every
  collection `getTables()` returns**, and `getTables()` (adapter.ts:919-935) lists all
  collections in the database. datrix is positioned as "a plugin for existing projects": if the
  host app shares the MongoDB database, importing an archive destroys the host's collections.
- `packages/adapter-mongodb/src/export-import/exporter.ts:19-31` — export iterates the same
  full list, so foreign collections' data is exported too (`exportCollection` runs for every
  table even when `getTableSchema` returned null and no schema was written; the chunk loop at
  exporter.ts:42-48 sorts by `id`, which foreign collections may not have → unstable
  skip-pagination, possible duplicate/missing docs across chunks).
- No atomicity: the import (importer.ts:16-45) runs on the live db with no session; a failure
  after step 1 leaves the database emptied. (MongoDB cannot do collection DDL in a transaction,
  so full transactional import is off the table — but the current code has no mitigation at all.)

**Decision to make.**

1. **Scope (recommended):** restrict both export and import to datrix-managed collections —
   derive the list from `_datrix` docs whose key starts with `DATRIX_META_KEY_PREFIX`, plus
   `_datrix` itself. Pros: safe in shared databases; also fixes the foreign-collection
   `sort({id:1})` pagination problem. Cons: collections that lost their `_datrix` row are
   orphaned (acceptable; document it). Leave `getTables()` itself broad — check `@datrix/cli`
   usage before narrowing introspection; the exporter/importer must filter on their own either way.
2. **Atomicity strategy:** options — (a) import into temp-suffixed collections, then
   `rename(..., { dropTarget: true })` into place (rename is atomic per collection; the window
   between renames is small); (b) document the risk and require the caller to stop writers.
   Recommendation: (a) if effort allows, else (b) explicitly in the README.
3. While here: replace the exporter's skip/limit pagination (exporter.ts:42-60, O(n²) and
   unstable for `_datrix`, whose docs have no `id`) with a single `find().sort(...)` cursor
   iterated with a chunk accumulator; `_datrix` can sort by `key`.

**Files.** exporter.ts, importer.ts, adapter.ts (`exportData`/`importData`). Do A13 first if
touching `_datrix` key scanning helpers is shared.

### Part 2 — `distinct`, `groupBy`, `having` are silently ignored ✅ DONE

**Done note (2026-07-12).** Implemented via aggregation ($group): `translateGrouping` computes
the group key (groupBy fields, or the distinct select list / all non-hidden scalars) and
translates `having` (relation filters rejected; HAVING fields must appear in groupBy; select
and orderBy fields must appear in the group key — all throw, PG parity). `executeGroupedFind`
runs $match → $group → $replaceRoot → $match(having) → $sort/$skip/$limit → $project;
`executeCountOp` gets a grouped branch whose `metadata.count` mirrors PG's rows[0].count.
Sessions passed to all `aggregate` calls. distinct/groupBy/having + populate throws.

**Resolution (decided 2026-07-12).** Option 2: implement via aggregation pipeline. Core exposes
`.distinct()`/`.groupBy()`/`.having()` as public builder API (`packages/core/src/query-builder/
builder.ts:300-317`) and the SQL adapters support them, so a permanent throw would be a feature
gap in public API surface — not acceptable. Scope notes:
- `distinct` → `$group` on the selected fields + `$replaceRoot` (or `doc: { $first: "$$ROOT" }`).
- `groupBy` + `having` → `$group` + `$match` on the group result; grouped `count` → `$group` +
  count. `having` only needs to support what core's `WhereClause` type can express (plain field
  conditions — aggregate expressions are not representable), translated with the same operator
  translation as `where`.
- Target semantics = parity with the postgres adapter: check what its translateCount/select do
  with `groupBy`/`having`/`distinct` and mirror the observable behavior (incl. what lands in
  `metadata.count`).
- Sessions must be passed to `aggregate` calls where the find-based paths move to aggregation.

**Problem.** The translator never reads them: `translateSelect`
(`packages/adapter-mongodb/src/query-translator.ts:75-100`) ignores `query.distinct`,
`query.groupBy`, `query.having`; `translateCount` (`:105-119`) ignores `groupBy`/`having`.
A grep for `distinct|groupBy|having` over `src/**` finds zero hits. Contract §3 lists all three
on select and count shapes, and §4's rule applies: an adapter must never silently ignore a
condition — today `count` with `groupBy` returns a plain total and `select` with `distinct`
returns duplicates, both silently wrong.

**Decision to make.**

- **Option 1 (recommended): throw now, implement later.** At the top of `translateSelect`/
  `translateCount`, if `distinct`, `groupBy`, or `having` is present, `throwQueryError` with
  "not supported by the mongodb adapter yet". Pros: 10 lines, contract-compliant (fail loudly).
  Cons: if core/api e2e suites exercise these features per adapter, they will fail — verify
  with an e2e run and, if so, Option 2 becomes mandatory.
- **Option 2: implement via aggregation pipeline.** `distinct` → `$group` on the selected
  fields (`_id: { f1: "$f1", ... }` + `$replaceRoot`); `groupBy`+`having` → `$group` with
  accumulator + `$match` on the group result; grouped `count` → `$group` + `$count`. Pros:
  feature parity. Cons: `having` conditions reference aggregate expressions — decide the
  supported subset; a session must be passed to `aggregate` (the find-based paths would move to
  `MongoClient.execute` aggregations). Bigger session.
- Sequencing recommendation: land Option 1 immediately, schedule Option 2 as its own part if
  e2e requires it.

**Files.** query-translator.ts (`translateSelect`, `translateCount`); adapter.ts untouched for
Option 1 (find/count paths unchanged).

### Part 3 — Per-relation `limit`/`offset` applies globally, not per parent, in the batched strategy ✅ DONE

**Done note (2026-07-12).** `fetchAndPopulateNested` no longer applies skip/limit to the
batched cursor; hasMany/manyToMany groups are windowed in memory (`applyRelationWindow`:
fallback id-sort when no orderBy, then offset/limit slice). manyToMany grouping now iterates
relatedRows (fetch order) instead of junction order so orderBy is preserved per group.
belongsTo/hasOne ignore limit/offset in both strategies (`buildLookupWithUnwind` strips them).
Unbounded intermediate fetch documented in README.

**Resolution (decided 2026-07-12).** Option 1: in-memory per-parent windowing in the batched
path — fetch without skip/limit (keep the `where` filter), then after grouping sort each group
by `orderBy` (fallback `id`) and slice `offset..offset+limit`. Unbounded intermediate fetch is
accepted and documented. belongsTo/hasOne: `limit`/`offset` are meaningless for single-row
relations — explicitly ignore them in BOTH strategies (fixes the current parent-starvation in
`fetchAndPopulateNested`).

**Problem.** Two populate strategies disagree:

- Depth 1 (lookup): `buildLookupPipeline` puts `$sort/$skip/$limit` inside the `$lookup`
  sub-pipeline (`packages/adapter-mongodb/src/populate/populator.ts:519-535`), which MongoDB
  applies **per parent document** — correct.
- Depth ≥ 2 (batched): `fetchAndPopulateNested` applies `cursor.skip/limit` to the whole
  batched `$in` query (populator.ts:470-478). `populate: { comments: { limit: 5 } }` over 20
  posts at depth 2 returns 5 comments **total**, distributed arbitrarily; `offset` is equally
  wrong; `orderBy` orders the whole batch, not each group.

So the same query returns different results depending on whether a nested populate bumps the
depth past 1. (Note: the depth-1 correctness itself relies on `$lookup` combining
`localField`/`foreignField` with `pipeline`, which requires MongoDB **5.0+** — see Notes.)

**Decision to make.**

- **Option 1 (recommended): in-memory per-parent windowing.** In the batched path, when
  `limit`/`offset`/`orderBy` is set on a hasMany/manyToMany populate, fetch WITHOUT
  `skip/limit` (keep the `where` filter), then after grouping (`populateBatchedRows`
  populator.ts:373-381, :419-427) sort each group by `orderBy` (fallback `id`) and slice
  `offset..offset+limit`. Pros: single round-trip preserved, simple, works for nested levels.
  Cons: unbounded intermediate fetch when children are numerous (document it).
- **Option 2: switch constrained relations to per-level `$lookup` aggregation** even at
  depth ≥ 2 (run the depth-1 pipeline level by level). Pros: server-side limiting. Cons: more
  moving parts, still needs Mongo 5.0+, harder to keep the recursion readable.
- Also decide belongsTo/hasOne: `limit`/`offset` are meaningless there (single row) — ignore
  them explicitly in both strategies for consistency (today `fetchAndPopulateNested` applies
  them to belongsTo batches too, which can starve some parents of their related row:
  populator.ts:324-330 with `:478`).

**Files.** populator.ts (`fetchAndPopulateNested`, `populateBatchedRows`). Verify with e2e:
3 parents × 5 children, nested one level deeper, `limit: 2` → each parent gets exactly its own
first 2 by `orderBy`.

### Part 4 — populate-level `where` with nested relation conditions silently matches nothing ✅ DONE

**Done note (2026-07-12).** `translateWhere` gained a `rejectNestedRelationFiltersIn` option
(context label, threaded through $and/$or/$not recursion): a nested relation condition throws
`DatrixAdapterError` "nested relation filters are not supported in <context>". Both populate
paths (`buildLookupPipeline`, `fetchAndPopulateNested`) pass it; Part 2's `having` translation
reuses it. Relation-FK shortcuts on belongsTo/hasOne keep working.

**Resolution (decided 2026-07-12).** Option 2: reject with a clear `DatrixAdapterError`
("nested relation filters are not supported in populate.where"). Rationale: the postgres
adapter took the same decision for its Part 5 — cross-adapter consistency wins; resolving here
while postgres rejects would make behavior diverge. Detection: schema lookup on the target —
a populate-where key that is a relation-typed field of the target schema. A5 (key validation)
must land before this Part.

**Problem.** `translateWhere` leaves nested relation conditions under the relation field name
(`filter[key] = nestedFilter`, `packages/adapter-mongodb/src/query-translator.ts:326-338`),
expecting a later `resolveNestedWhere` pass. The main query path does that pass
(`adapter.ts:523-540`), but the populate paths do not:

- `packages/adapter-mongodb/src/populate/populator.ts:508-516` (`buildLookupPipeline` `$match`)
  and `:449-458` (`fetchAndPopulateNested` merge) call `translator.translateWhere(...)` and use
  the result directly. A populate-where like `{ author: { verified: true } }` on a `comments`
  populate produces `$match: { author: { verified: true } }` against the comments collection —
  a field-equality on a nonexistent subdocument that **silently matches zero rows** (or, worse,
  silently matches embedded garbage). Contract §4: never silently ignore/corrupt a condition.

**Decision to make.**

- **Option 1 (recommended): resolve.** The populator already holds `client` and
  `schemaRegistry`; after `translateWhere`, run the filter through `resolveNestedWhere(filter,
  targetCollection, client, schemaRegistry)` (it is already async-friendly — `buildLookupPipeline`
  callers would need to become async, or resolution happens before pipeline construction in
  `executeLookup`/`fetchAndPopulateNested`). Pros: feature parity with top-level WHERE.
  Cons: extra queries per populate level; `buildLookupPipeline` call sites need an async refactor.
- **Option 2: reject.** Detect relation-typed keys in populate-where (schema lookup on the
  target) and throw a clear `DatrixAdapterError` ("nested relation filters are not supported in
  populate.where"). Pros: tiny, honest. Cons: feature gap vs. SQL adapters.
- Either way, A5 (key validation) must land first so unknown `$` keys in populate-where are
  rejected rather than forwarded.

**Files.** populator.ts (`executeLookup`, `buildLookupPipeline`, `fetchAndPopulateNested`),
possibly a small helper in nested-where.ts.

---

## Notes (no action, or fold into the parts above)

- **Minimum server version is implicit.** `$lookup` with `localField`/`foreignField` +
  `pipeline` (populator.ts:108-166) requires MongoDB 5.0+; `$not: { $regex, $options }`
  (query-translator.ts:415-420) requires 4.0.7+. Nothing checks or documents this — worth a
  README line and/or a `buildInfo` check at `connect()`. Verify with e2e against the oldest
  supported server.
- `executeUpdateOp` (adapter.ts:355-376) pre-fetches ids then runs `updateMany` with the same
  filter — outside a transaction the two steps can see different row sets, and `affectedRows`
  reports the pre-fetch count rather than `modifiedCount`. Same model as the MySQL adapter;
  acceptable, but inherent race.
- FK emulation is check-then-write: `fk-validator.ts` (validate then insert) and the
  `restrict` pass of `on-delete.ts:71-99` can race with concurrent writes when no transaction
  is used. Inherent to MongoDB without sessions; not fixable in the adapter proper.
- `getNextIds` runs on the `_datrix` collection **without** the caller's session
  (adapter.ts:302-306) — id ranges are consumed even if the transaction aborts. This matches
  SQL sequence semantics and is the right call; leave as is (a comment would help).
- `orderBy` `nulls: "first"|"last"` is silently ignored (`translateSort`,
  query-translator.ts:492-500). MongoDB always sorts null/missing first ascending; matching
  SQL `NULLS LAST` needs an aggregation sort key. Minor ordering deviation — document it.
- Projections always inject `id: 1` even when `id` was not selected
  (query-translator.ts:482, populator.ts:561); hasOne/hasMany batched populate additionally
  leaves the child's FK column in the result rows (populator.ts:292-300 injects it and nothing
  removes it), while belongsTo deletes the parent FK (populator.ts:337). Deviations from
  "exactly the select fields" — harmless, but tidy up if the populator is touched (Part 3/4).
- `adapter.mapMongoError` (adapter.ts:545-570) re-implements the 11000/11001 mapping that
  `helpers.mongoCodeToAdapterCode` already provides — unify when convenient.
- `executeRawQuery` (adapter.ts:576-615) ignores `params` entirely (the "sql" string is parsed
  as a JSON MongoDB command). Reasonable for a NoSQL adapter, but callers passing parameterized
  statements get no error — a README note or a throw-on-nonempty-params would make it explicit.
- Transaction DDL (`createTable`/`dropTable`/`renameTable`) intentionally runs without the
  session (adapter.ts:1241-1255) — matches MongoDB limits and the migration runner already
  keeps those phases outside the transaction (contract §6). `MongoDBTransaction.addIndex`
  passes `schema: undefined` (adapter.ts:1264-1266), so relation-name index fields won't be
  remapped to FK columns in that path — same minor caveat as the postgres adapter.
- `alterTable` `dropColumn`/`renameColumn` do not touch indexes that reference the old column
  name; MongoDB keeps indexes on missing fields silently. Only matters for migrations that
  rename indexed columns — fold into A12's session work if desired.
- Savepoints correctly throw `throwTransactionSavepointNotSupported`
  (adapter.ts:1229-1239) — contract-compliant (clear error, no silent no-op). No issue.
- Date round-trip is native (BSON Date in, `Date` out) and arrays/json are stored natively —
  §1 items 3–4 are satisfied without a conversion layer. No issue.
- This package has no `tests/` directory — nothing to delete.
