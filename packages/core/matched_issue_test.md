# Issue → Test Coverage Map

Maps every issue in `combined_issues.md` to the regression test(s) that cover
it under `packages/core/tests/end-to-end/issues/`. This e2e suite runs once
per adapter (postgres/mysql/mongodb/json) with the adapter swapped via
`getAdapter()` — a single test here covers the same defect across every
adapter, not just the one it was originally found in.

Legend: ✅ covered · ⚠️ partially covered · ❌ not covered (relies on unit
tests elsewhere, or on code inspection only)

---

# Core Issues

## Query Builder


`issue-regressions.test.ts:832` `createMany applies the first item's relations to all records`
Creates 2 posts in one `createMany` call, both referencing the same category
id. If the issue had not been fixed (or regressed to "silently drop later
items' relations"), the second post's category could come back `null`
instead of the shared category — the test populates `category` on both rows
and asserts both equal `valCategoryId`.

`issue-regressions.test.ts:863` `createMany allows each item to reference a different belongsTo id`
Refines the contract: a plain id shortcut inlines into each row's own FK, so
different ids per item must succeed (no throw). If a later fix wrongly
tightened the guard to reject any per-item difference, this would throw
instead of returning 2 posts with 2 different categories.

`issue-regressions.test.ts:901` `createMany throws when later items carry different unresolvable relation ops`
Two items each with a *different* `category: { create: {...} }`. If the
guard were removed or only compared ids (not unresolvable ops), this would
silently create only the first category and link both posts to it instead of
throwing.

`issue-regressions.test.ts:923` `createMany throws when one item in a mixed batch carries a create op`
`issue-regressions.test.ts:953` `createMany throws when a trailing inline id follows create ops in a mixed batch`
Mixed inline-id/create combinations in both orders. If the guard only checked
`item[0]` vs `item[1]` (not "first item's set vs every other item"), one of
these two orderings would slip through undetected.

### Issue 6: Array of RelationInput objects silently dropped — ❌
Not directly exercised — no test passes `tags: [{ connect: [1] }, { create: {...} }]`.
Gap: worth adding.

### Issue 7: Relation shortcut in WHERE force-coerced FK to number inconsistently — ⚠️
Related to the number-only ID policy covered by Issue 5's tests, but no test
specifically targets a relation shortcut *inside a WHERE clause* with a
string id (e.g. `where: { category: "5" }`). Gap.

### Issue 8: hasMany/manyToMany WHERE values passed through raw — ⚠️
`self-many-to-many.test.ts:154` `filters by a nested where on the self-referential relation`
exercises nested WHERE on a manyToMany relation, but with an object condition
(`{ friends: { name: "..." } }`), not the primitive shortcut form (`{ tags: 2 }`)
the issue describes. Gap: primitive-shortcut-in-relation-WHERE not directly tested.


### Issue 12: UPDATE without WHERE updated the whole table — ❌
Not exercised in these files (would need a `datrix.update`-without-where
call). Gap — likely covered by a dedicated query-builder unit test instead.


## Executor & Relations


### Issue 19: `onCreateQueryContext` failures swallowed (fail-open) — ❌
Not covered here — needs a plugin-based test (see
`packages/core/tests/end-to-end/complex-scenarios/hooks.test.ts` instead).

### Issue 20: After-hook errors always logged as `afterFind` — ❌
Same — hook-logging behavior, not an e2e data-shape assertion. Check
`hooks.test.ts`.

### Issue 21: `count` results flowed through hooks typed as records — ❌
Not covered here. Check `hooks.test.ts` / plugin unit tests.

### Issue 22: Inconsistent read-consistency between operations — ❌
Not directly asserted (would require injecting a mid-transaction failure).
Structural guarantee, hard to black-box test at the e2e level.

## Schema Registry & Lifecycle

### Issue 24: Two hasOne/hasMany relations to the same model shared one FK — ❌
Not exercised — no schema in these test files declares two relations to the
same target model without explicit `foreignKey`. Gap (this is arguably
correctly a registry-level unit test / negative schema-definition test since
the fixed behavior is "throw a clear registry error at schema-definition time").

### Issue 25: Junction FK references ignored custom `tableName` — ❌
Not covered — no test schema uses a custom `tableName` on a manyToMany
participant. Gap.

### Issue 26: `getByTableName` was an O(n) scan per executed query — ❌
Performance characteristic, not correctness — not black-box testable via
assertions on results.

### Issue 27: `applySchemaExtensions` could not work — ❌
Plugin schema-extension feature — not exercised in these files. Check
plugin-specific tests.

### Issue 28: Failed initialization could not be retried — ❌
Requires simulating a connect failure then retrying `Datrix` init — not
covered in these files.

### Issue 29: `adapter.connect()` ran before schema registration — ❌
Lifecycle-ordering issue, not black-box observable via query results in this
suite.

### Issue 30: `validateConfig` was dead code — ❌
Not covered here — would need an invalid-config construction test.

### Issue 31: Two divergent `pluralize` implementations — ❌
Not covered — would require comparing generated table names against
inferred type names. Check `cli`/type-generator tests.

### Issue 32: Type inference mapped relation/file fields to `string` — ❌
Type-generation concern, not a runtime e2e assertion. Check `cli` tests.

### Issue 33: `toJSON()`/`fromJSON()` round-trip mutated junction schemas — ❌
Not directly tested here, though `self-many-to-many.test.ts` implicitly
relies on the junction schema surviving `beforeAll` registration correctly
across the run. No explicit round-trip/migration-diff assertion.

### Issue 34: hasOne hidden FK not marked `unique` — ⚠️
`issue-regressions.test.ts:511` (`applies populate-level where on a hasOne
relation`) exercises hasOne populate but does not specifically assert two
target rows cannot point at the same parent (would need an insert that
violates uniqueness and expect a throw). Gap on the negative case.

## Validator

### Issue 35: `pattern` with the `g` flag gave alternating results — ❌
Not covered — validator-internals unit test territory
(`packages/core/tests/validator/`).

### Issue 37: `validateData` discarded the validator's output — ❌
Internal wiring, not black-box observable.

### Issue 38: FK fallback used a falsy check — ❌
Not covered — would need a relation value of literal `0` to assert it is
NOT treated as "missing". Gap.

### Issue 39: `Infinity` passed number validation — ❌
Not covered — no test inserts a `number` field with value `Infinity`. Gap.

## Migration

### Issue 40–47 — ❌ (none covered here)
All migration-differ/history/rename issues live in
`packages/core/tests/migration/e2e/` (`data-preservation.test.ts`,
`relation-changes.test.ts` — both referenced in the earlier full-suite run),
not in `end-to-end/issues/`. Out of scope for this file; see those instead.

---

# Adapter Issues (shared across adapters)

### Issue 8: hasOne populate duplicated parent rows — ⚠️
No test explicitly creates 2+ target rows pointing at the same hasOne parent
and asserts the parent appears once. `issue-regressions.test.ts:512`
exercises hasOne populate generally but not the duplication scenario
specifically. Gap on the negative/duplication case.

### Issue 9: `renameTable` left stale `tableName` in stored schema JSON — ❌
Not covered here — migration-specific, check `packages/core/tests/migration/e2e/`.

### Issue 10: Export/import destroyed foreign tables and bypassed identifier escaping — ❌
Not covered here — check CLI/export-import test suites.

### Issue 13: `groupBy`/`having`/`distinct` silently ignored — ❌
Not covered in these files — no test uses `groupBy`/`having`/`distinct`.
Gap.

### Issue 14: Connection/lock leaks in the transaction lifecycle — ❌
Not black-box observable without inspecting pool/lock internals after a
forced failure. Not covered here.

### Issue 15: Debug logging always on outside production — ❌
Not a result-shape assertion — log output isn't captured in these tests.

### Issue 16: Dead code with latent bugs — ❌
N/A — code deletion, nothing to regression-test.

### Issue 17: Result-processor null heuristic nulled legitimate rows — ⚠️
`issue-regressions.test.ts:497`/`:512` populate-where tests use `name`
matches, not a `select` that could produce an all-NULL legitimate row. Gap:
no test does `populate: { author: { select: ["bio"] } }` with `bio: null`
to assert the row survives as a real (non-null) object rather than being
misclassified as "no match".

---

# Adapter-Specific Issues

## adapter-postgres-core (Issues 18–23) — ❌ none covered here
DDL/type-mapping/transaction issues (`integer: true` mapping, `createTable`
inside a transaction, batched belongsTo null short-circuit, JOIN→subquery
rewrite for relation-WHERE on UPDATE/DELETE, `modifyColumn`, enum CHECK
constraints) are either migration-suite or postgres-only unit-test concerns.
Partial exception: Issue 21 (relation-WHERE on UPDATE/DELETE) is exercised
generically by `issue-regressions.test.ts:300`
(`updateMany matches NULL-FK rows via the scalar branch of $or`), which is
adapter-agnostic and would catch the postgres-specific JOIN-conversion bug
too if it regressed.

## adapter-mysql (Issues 24–33) — ⚠️ one covered here
Most (LIMIT/OFFSET param binding, SAVEPOINT protocol, meta value parsing,
onDelete/onUpdate mapping, mapMySQLError codes, FOREIGN_KEY_CHECKS toggling,
DDL implicit commit, DDL column-definition gaps) are mysql-only and not
black-box observable through this adapter-agnostic suite.

Issue 27 (UPDATE id-prefetch missing DISTINCT) — ⚠️ likely covered indirectly
by `issue-regressions.test.ts:340` (`combines an explicit id condition with a
relation condition`, a findMany not updateMany) and `:300`
(`updateMany matches NULL-FK rows...`) exercise relation-joined
WHERE generally, but no test specifically does an `updateMany` with a
hasMany/manyToMany relation condition and asserts the affected-row count
(rather than a re-fetched find) is not inflated by duplicate ids. Gap.

## adapter-mongodb (Issues 34–43) — ✅ several covered here

Issue 35 (Relation shortcut in WHERE silently dropped) — ⚠️ related to Adapter
Issue 8 gap above; no direct test of a hasMany/manyToMany primitive shortcut
in WHERE.

Issues 34, 36, 40–43 — ❌ not covered
(`$exists` semantics, `$where` injection validation, `alterTable` session
threading, `getNextIds` race, cyclic cascade delete, populate-where nested
relation rejection) are mongodb-only concerns not exercised in these
adapter-agnostic files.

## adapter-json (Issues 44–58) — ✅ several covered here

Issue 53 (Cache-by-reference — query results mutated the shared cache) — ⚠️
Not directly asserted with a "mutate the returned row, then re-fetch and
check the cache wasn't corrupted" test, though the populate-heavy tests in
this suite run repeatedly against the same cached tables across `it` blocks
and would likely surface gross corruption. Indirect only — gap on an
explicit regression test.

Issues 46–52, 54, 55, 57, 58 — ❌ / ⚠️ not directly covered
- Issue 46 (belongsTo populate O(N×M)) — performance characteristic, not
  black-box testable via assertions.
- Issue 47 (double lock release) — needs a forced query failure mid-lock,
  not exercised.
- Issue 48 (`foreignKey`/`through` non-null assertions) — indirectly
  exercised by every relation test in this suite (would crash/silently
  no-match otherwise), no dedicated negative test.
- Issue 49 (`getTables` filename parsing) — no table is named with an extra
  `.json` in its name in these tests.
- Issue 50 (raw `Error`s / corrupt JSON reporting) — requires corrupting a
  table file on disk mid-test, not exercised.
- Issue 51 (Importer `meta.name`) — export/import specific, not in this file.
- Issue 52 (`disconnect()` leaked transaction lock) — lifecycle test, not
  covered here.
- Issue 54 (one global transaction slot / dirty reads) — needs concurrent
  transaction orchestration, not covered here.
- Issue 55 (non-atomic writes / destructive import) — needs a simulated
  crash mid-write or mid-import, not covered here.
- Issue 57 (O(all tables × file reads) schema lookups) — performance
  characteristic, not black-box testable.
- Issue 58 (batch unique check / junction dedup) — ✅ **covered**:
  `issue-regressions.test.ts:984` `throws on duplicate unique values inside
  one createMany batch` and `:993` `throws when updateMany would set the
  same unique value on two rows` directly test the same-batch uniqueness
  half of this issue. The junction-dedup-shortens-`insertIds` half is not
  separately asserted.


## Notable gaps worth adding tests for
1. Array of RelationInput objects (`tags: [{connect:[1]}, {create:{...}}]`) — core Issue 6.
2. Relation primitive shortcut inside WHERE for hasMany/manyToMany (`{tags: 2}`) — core Issue 8 / Adapter Issue 35.
3. UPDATE without WHERE guard (core Issue 12) — no e2e test, only inferred from code.
4. hasOne uniqueness violation (core Issue 34 / Adapter Issue 8) — no negative test forcing two rows at the same parent.
5. `Infinity` / falsy-FK (`0`) validation edge cases — core Issues 38–39.
6. `groupBy`/`having`/`distinct` (Adapter Issue 13) — completely untested in this suite.
