# Core Package — Review Findings

Issues found during a full review of `packages/core/src`. Grouped into phases so each
phase can be resolved in its own session. Each item states the problem, the location
(`file:line`), and the suggested fix.

ANA KURAL: bir query adaptere gönderilmeden tüm karışıklıklar netleşmeli. eğer ikilik oluşturacak bir durum varsa direk throw edilmeli. kullanıcının daha net sorgu yazması beklenmeli.


Severity: 🔴 correctness bug (wrong behavior / data corruption), 🟠 design gap
(violates the layer model or produces surprising behavior), 🟡 minor / cleanup.

## Decisions (made 2026-07-12 — apply these when fixing)

1. **ID policy: number-only.** Some adapters cannot support string IDs, so IDs are numeric
   end-to-end. Affects 1.5, 1.7, 4.2: string values that don't parse to a number must throw
   (never `NaN`/pass-through), `coerceValue` relation handling coerces to number, and
   `validateRelation`'s number-only `connect`/`set` check is correct as-is.
2. **UPDATE without WHERE must be guarded** exactly like DELETE (1.12) — add
   `throwUpdateWithoutWhere` in `build()`.
3. **Nested update relations: apply the same resolved set to all matched rows** (2.1) — move
   `resolveRelationCUD` outside the row loop, same philosophy as bulk insert (1.1). No N-query
   loops in core; users who need per-row behavior loop single-record `update` themselves.
   Document this contract together with the bulk-insert note (1.1).

---

## Phase 1 — Query Builder correctness [ ALL DONE ]

### 1.1 🟡 Bulk insert applies one shared `relations` to all items — intended, but undocumented
- **Where:** `src/query-builder/builder.ts:416` (`const relations = processedItems[0]?.relations`)
  and `src/query-executor/executor.ts:266-284` (applies that single `relations` to **every** inserted record).
- **Status:** **Intended design.** Bulk insert deliberately shares one relation set across all
  items ("these 5 products, all in this category"). Per-item relations would force an N-query loop
  and defeat the purpose of bulk insert; users who need per-item relations should call `create`
  in their own loop.
- **Fix (docs + guard):**
  1. Document this contract explicitly in `packages/core/CLAUDE.md` / README ("in bulk insert,
     relation operations are taken from the first item and applied to every inserted record").
  2. Optional guard: if items beyond the first contain relation fields that differ from the first
     item's, throw a clear error instead of silently ignoring them — the silent drop is the only
     real bug here.

### 1.2 🔴 `clone()` does not clone the `select` state
- **Where:** `src/query-builder/builder.ts:478-501`
- **Problem:** `where/populate/data/orderBy/groupBy/having` are deep-cloned but `select` comes from
  the `...this.query` spread and shares the same array. Calling `.select()` on a clone pushes into
  the original builder's array too.
- **Fix:** Add `select: deepClone(this.query.select)` to the clone block.

### 1.3 🔴 `reset()` leaves the builder unusable
- **Where:** `src/query-builder/builder.ts:509-512`
- **Problem:** `this.query = {}` wipes `type` and `table`. The next `build()` throws
  `throwInvalidQueryType(undefined)`.
- **Fix:** Reset to the constructor's initial state: `this.query = { table: this._schema.tableName!, type: <original type> }`.

### 1.4 🔴 `orderBy`, `groupBy`, `having` bypass all validation
- **Where:** `src/query-builder/orderby.ts:80-123` (no field-existence check),
  `src/query-builder/builder.ts:354` (orderBy only normalized), `builder.ts:308-311` (groupBy stored raw),
  `builder.ts:385-401` (having passed to the QueryObject without going through `normalizeWhere`).
- **Problem:** The layer model says the Query Builder validates field existence, yet these three
  clauses reach adapters unvalidated and uncoerced. Field names are SQL identifiers — adapters
  cannot parameterize them, so unvalidated names are an injection surface and a class of runtime
  SQL errors core promised to catch.
- **Fix:** In `build()`: validate every `orderBy` field and `groupBy` field against `schema.fields`
  (reuse `throwInvalidField`), validate `direction` is `asc|desc`, and run `having` through the same
  `validateWhereClause`/`normalizeWhereClause` pipeline as `where`.

### 1.5 🔴 `extractIds()` silently produces `NaN` / `0`
- **Where:** `src/query-builder/data.ts:82-117` (`Number(value)` at 90/96/106/110, `return 0` fallback at 112)
- **Problem:** A non-numeric string ID (`"abc"`) becomes `NaN`, an object without `id` becomes `0`.
  These invalid IDs flow into `connect`/`set` and end up in SQL — silent data corruption instead of
  a validation error.
- **Fix:** Throw `throwInvalidValue("data", field, item, "numeric id")` when `Number()` yields `NaN`
  or when an array item has no usable `id`. Remove the `return 0` fallback.

### 1.6 🔴 Array of RelationInput objects is silently dropped
- **Where:** `src/query-builder/data.ts:279-288`
- **Problem:** For `tags: [{ connect: [1] }, { create: {...} }]` the code detects "already
  RelationInput array" and sets `normalized = {}` — the comment says "needs processing" but no
  processing happens. The entire relation operation vanishes.
  KONTROL: executorda sıra create işlemine geldiğinde recursive olarak tekrar builder çağırılıyor, normalize o zaman bırakılıyor olabilir!
- **Fix:** Either merge/process each RelationInput in the array, or throw an explicit "unsupported
  format" error. Silence is the worst option.

### 1.7 🔴 Relation shortcut in WHERE force-coerces FK to number
- **Where:** `src/query-builder/where.ts:577-580` (`coerceValue(value, { type: "number" }, key)`)
- **Problem:** `where({ category: "uuid-string" })` throws a coercion error, while
  `isCorrectType` (`where.ts:143`) and `coerceString`'s `relation` case (`where.ts:213-217`) accept
  string IDs. The codebase is inconsistent about whether IDs may be strings (see also 4.2).
  KONTROL: ID'ler int sadece.
- **Fix:** Decide the ID policy once (registry defines `id` as auto-increment number →
  probably number-only), then make `coerceValue` here use `{ type: "relation" }` or fail with a
  clear "IDs must be numeric" message everywhere consistently.

### 1.8 🟠 hasMany/manyToMany WHERE values pass through raw
- **Where:** `src/query-builder/where.ts:622-624`
- **Problem:** For hasMany/manyToMany relation fields the value is kept "as-is": a primitive
  shortcut (`{ tags: 2 }`) or a nested WHERE is neither coerced nor normalized, so adapters receive
  a shape core never defined. `validateWhereClause` validates nested relation WHERE for all kinds
  (`where.ts:390-435`), but normalization only handles belongsTo/hasOne — validation and
  normalization disagree.
  KONTROL: burada da aynı durum var. relation kısmı, teknik olarak level sınırsız olabileceği için ilk kontrolde nested yapıların dahi tümü test etmek yerine builder -> executor -> nested part tekrar builder... yani bunu kontrol edip bununla ilgili issueları gereksiz işaretlemeli.
- **Fix:** Normalize nested WHERE against the target schema for all relation kinds (recursion into
  `normalizeWhereClause` with the target schema), and either define semantics for the primitive
  shortcut on hasMany/manyToMany (EXISTS on junction/FK) or reject it in `validateWhereClause`.

### 1.9 🔴 `populate: { rel: false }` behaves like `true`
- **Where:** `src/query-builder/populate.ts:137` (`typeof value === "boolean"`)
- **Problem:** `false` matches the boolean branch and expands the relation's select fields —
  the opposite of the user's intent.
- **Fix:** `if (value === false) continue;` before the boolean branch.

### 1.10 🔴 Dot-notation populate bypasses the depth limit
- **Where:** `src/query-builder/populate.ts:182-250` (recursive `normalizePopulateDotNotation` has no `depth` parameter)
- **Problem:** `populate(['a.b.c.d.e.f.g.h...'])` recurses without limit; `MAX_POPULATE_DEPTH` only
  guards the object-format path. Circular relations + dot paths can also blow the stack.
- **Fix:** Thread `depth` through `normalizePopulateDotNotation` and check it against
  `MAX_POPULATE_DEPTH` per segment.

### 1.11 🟠 Populate options (`where`, `orderBy`, `limit`) are not validated/normalized
- **Where:** `src/query-builder/populate.ts:142-156` (`...value` spreads `where`/`orderBy` raw; only `select` and nested `populate` are normalized)
- **Problem:** A populate-level `where` never goes through `validateWhereClause`/coercion against
  the target schema, and `orderBy` never through `normalizeOrderBy`. Adapters receive unnormalized
  clauses — a direct violation of the layer model ("adapters do not re-check what core should catch").
- **Fix:** In the object branch, run `value.where` through the WHERE pipeline with the target
  schema and `value.orderBy` through `normalizeOrderBy` (plus field validation per 1.4).

### 1.12 🟠 UPDATE without WHERE updates the whole table (DELETE is guarded, UPDATE is not)
- **Where:** `src/query-builder/builder.ts:427-447` vs `builder.ts:449-460` (`throwDeleteWithoutWhere`)
- **Problem:** Inconsistent safety: `delete` requires WHERE, `update` silently applies to all rows.
- **Fix:** Add the same guard for update (`throwUpdateWithoutWhere`), with an explicit opt-out
  (e.g. `.where({})`-style `allowAll` flag) for intentional full-table updates.

### 1.13 🟠 hasOne accepts multiple references without error
- **Where:** `src/query-builder/data.ts:434-447` (guard exists for belongsTo only), `data.ts:478-483`
  (hasOne passes through), `src/query-executor/relations.ts:336-352` (silently links only the first).
- **Problem:** `profile: { set: [1, 2] }` on a hasOne relation is accepted; the executor links id 1
  and silently ignores id 2.
  KURAL: ana kuralda yazdığımız gibi, hasOne 1 id alabilir, fazlası direk throw olmalı.
- **Fix:** Apply the `totalRefs > 1` guard to `hasOne` as well in `processData`.

### 1.14 🟠 Nested update `where` is never validated or normalized
- **Where:** `src/query-builder/data.ts:389-424` (`item.where` copied through untouched),
  consumed raw at `src/query-executor/relations.ts:231-236`.
- **Problem:** `author: { update: { where: {...}, data: {...} } }` — the `where` reaches the adapter
  without field validation or coercion against the target schema.
  KONTROL: yine bu recursive çağırılan bir yapı olabilir. executor -> update -> yapıyı tekrar buildera gönderip kontrol ediyor olabilir.
- **Fix:** In `processData`, run the nested `where` through `validateWhereClause` +
  `normalizeWhereClause` with the target schema before storing it.

---

## Phase 2 — Executor & relation processing [ ALL DONE ]

### 2.1 🔴 Nested relations inside `update` are re-created once per updated row
- **Where:** `src/query-executor/relations.ts:238-257`
- **Problem:** The whole point of `resolveRelationCUD` is "create ONCE, then link per parent"
  (see header comment), but for `update` items with nested relations, `resolveRelationCUD` is
  called **inside** the `for (const updated of updateResult.rows)` loop. If the update matches N
  rows, nested `create` operations run N times → duplicate records. This contradicts the project's
  explicit no-N-loop policy (same philosophy as bulk insert, issue 1.1).
- **Fix (align with the bulk-insert philosophy):** Move `resolveRelationCUD` **outside** the row
  loop — resolve the nested ops once, then only `processRelations` (ID-based linking) runs per row.
  This gives the same semantics as bulk insert: one shared nested-relation set applied to all
  matched rows, no N-query loop. If shared semantics are considered too surprising for hasMany
  `create` (a created child can only link to one parent), add a guard instead: reject nested
  create/update relations when the parent update matches more than one row, telling the user to
  loop with single-record `update` themselves (this is the guard already sketched in the TODO at
  `relations.ts:122-136`). Either way, document the chosen contract next to the bulk-insert note
  from 1.1.

### 2.2 🔴 Post-write refetch uses `select!` which can be `undefined`
- **Where:** `src/query-executor/executor.ts:301` and `executor.ts:408` (`select: insertQuery.select!`)
- **Problem:** The builder's `selectSpread` intentionally emits `select: undefined` when the user
  never called `.select()` (`builder.ts:357-360`). The refetch query then carries
  `select: undefined` into the adapter; behavior depends on the adapter instead of core's contract
  ("select is always a concrete field list after normalization").
- **Fix:** Fall back to `this.schemas.getCachedSelectFields(schema.name)` when
  `insertQuery.select`/`updateQuery.select` is undefined. Also reconsider `selectSpread` emitting an
  explicit `undefined` property at all (with `exactOptionalPropertyTypes` this is a type trap).

### 2.3 🟠 Nested create/update validates with `isRawMode: true`
- **Where:** `src/query-executor/relations.ts:144-155`, `relations.ts:171-187`, `relations.ts:221-230`
- **Problem:** Nested payloads are user input, but they are validated with `isRawMode: true`,
  which skips the reserved-field check (`validation.ts:52-65`) and allows user-supplied
  `createdAt`/`updatedAt`/`id` to slip through (since `id`, `createdAt`, `updatedAt` exist in every
  enhanced schema, `processData` accepts them as scalars).
- **Fix:** Propagate the parent operation's raw-mode flag into `resolveRelationCUD` instead of
  hardcoding `true`. Raw mode should be a caller decision, not a nested-processing default.

### 2.4 🔴 Self-referential manyToMany is broken (source FK === target FK)
- **Where:** `src/query-executor/relations.ts:435-438` (`${parentModel}Id` / `${relation.model}Id`)
  and `src/schema/registry.ts:661-721` (junction schema builds both fields from the same names).
- **Problem:** For `User manyToMany User` (e.g. `friends`), `sourceFK` and `targetFK` are both
  `"UserId"` — the junction schema field collides (one overwrites the other) and all junction
  queries filter/insert the same column twice.
- **Fix:** Detect self-relations in `createJunctionTable` and generate distinct FK names
  (e.g. `sourceUserId` / `targetUserId`, or `AId`/`BId` convention), and derive the same names in
  `processRelation` from the junction schema instead of recomputing string templates.
- **Done note:** Core now generates `source${Model}Id` / `target${Model}Id` for self-relation
  junctions (source field registered first) and `processRelation` reads FK names from the junction
  schema. Non-self junction naming is unchanged. **Adapters still recompute `${model}Id` templates
  in their populate paths** (json/mongodb) — self-relation manyToMany populate needs the
  same schema-derived lookup there; tracked in the adapter issue files. postgres-core is DONE
  (2026-07-12, `populate/junction.ts`, see adapter-postgres-core issue.md Part 10). mysql is
  DONE (2026-07-13, ported `populate/junction.ts`; used in populator, join-builder,
  aggregation-builder and the translator's nested manyToMany WHERE).

### 2.5 🟠 `onCreateQueryContext` failures are swallowed (fail-open)
- **Where:** `src/dispatcher/index.ts:60-74`
- **Problem:** If a plugin that enriches the context (auth/RBAC/tenant) throws, the error is only
  `console.error`'d and the query proceeds with an unenriched context. For security-related
  plugins this fails open.
- **Fix:** Rethrow (wrap with `throwHookPluginError`) like `dispatchBeforeQuery` does, or make the
  behavior explicit per plugin (`critical: true` flag). Silent continuation is the wrong default
  for context construction.

### 2.6 🟡 After-hook errors are always logged as `afterFind`
- **Where:** `src/dispatcher/index.ts:170-178` (`warnAfterHookError("afterFind", error)` for every plugin `onAfterQuery` failure)
- **Problem:** Misleading diagnostics: a failing `onAfterQuery` during a delete is reported as
  `afterFind`, and the plugin name is not included.
- **Fix:** Pass the actual action/hook name and the plugin name to `warnAfterHookError`.

### 2.7 🟡 `count` results flow through hooks typed as records
- **Where:** `src/query-executor/executor.ts:450-456` (`result as DatrixEntry` — for count this is a `number`)
- **Problem:** Plugins' `onAfterQuery` receives a `number` where the type promises an entry/rows.
  Any plugin that maps over rows breaks on count queries.
- **Fix:** Either skip result-transform hooks for `count` or widen the hook result type and
  document it (`QueryResultPayload = rows | count`).

### 2.8 🟡 DELETE prefetch runs in-transaction, INSERT/UPDATE refetch runs after commit
- **Where:** `src/query-executor/executor.ts:183-206` vs `executor.ts:293-312` / `executor.ts:399-419`
- **Problem:** Inconsistent read-consistency semantics between operations; also the `// TODO: do we
  need transaction here?` at `executor.ts:198` suggests this was never decided.
- **Fix:** Decide and document: either all returning-reads happen inside the transaction, or none
  do. Remove the TODO.

---

## Phase 3 — Schema registry & Datrix lifecycle

[ ALL DONE — 3.1-3.4, 3.9-3.12 registry session 2026-07-12; 3.5-3.8 lifecycle session 2026-07-12. ]

### 3.1 🔴 [DONE] Self-referential hasOne/hasMany loses its FK field
- **Where:** `src/schema/registry.ts:606-635` (writes FK into the *target* schema via
  `this.schemas.set(relation.model, ...)`) vs `registry.ts:651-655` (afterwards overwrites the
  *current* schema with a stale `schema` snapshot).
- **Problem:** When `relation.model === schemaName` (e.g. `Category hasMany Category "children"`),
  the FK added to the target map entry is immediately clobbered by the final
  `this.schemas.set(schemaName, { ...schema, fields: enhancedFields })`, because `schema` was
  captured before the target update. The FK column disappears → migrations and queries break.
- **Fix:** For self-relations, add the FK to `enhancedFields` directly instead of going through the
  target-schema path (or re-read the schema from the map before the final `set`).

### 3.2 🔴 [DONE] Two hasOne/hasMany relations to the same model share one FK
- **Where:** `src/schema/registry.ts:607` (`relation.foreignKey ?? \`${schemaName}Id\``)
- **Problem:** `Post { reviewer: hasOne User, editor: hasOne User }` → both default to FK
  `PostId` on `User`. No error is raised; the two relations become indistinguishable and
  `processRelation` reads/writes the same column for both.
- **Fix:** During `processRelations`, detect FK-name collisions among relations targeting the same
  model and throw a registry error demanding explicit `foreignKey` values (or derive the default
  from the field name).

### 3.3 🔴 [DONE] Junction FK `references.table` ignores custom `tableName`
- **Where:** `src/schema/registry.ts:690-709` (`table: this.pluralize(schemaName.toLowerCase())`)
- **Problem:** If a schema declares `tableName: "app_users"`, the junction table's FK reference
  still points at pluralized `users` — a nonexistent table. Migration DDL will fail or reference
  the wrong table.
- **Fix:** Use `sourceSchema.tableName` / `targetSchema.tableName` (resolving via the registry)
  instead of re-pluralizing the model name. Audit `registry.ts:584` (belongsTo) which does this
  correctly and mirror it.

### 3.4 🟠 [DONE] `getByTableName` is an O(n) scan on every executed query
- **Where:** `src/schema/registry.ts:307-317` (`findModelByTableName` loops all schemas),
  called from `src/query-executor/executor.ts:482-488` for **every** `execute()`.
- **Problem:** Contradicts the "Map for O(1) lookups" performance note in CLAUDE.md; measurable
  overhead with many schemas and chatty workloads.
- **Fix:** Maintain a `tableName → modelName` Map, built in `finalizeRegistry()` and invalidated
  with the other caches.

### 3.5 🔴 [DONE] `applySchemaExtensions` cannot work — `register()` rejects it
- **Done note:** Added internal `registry.replace(schema)` (bypasses duplicate/reserved checks,
  keeps strict validation + file-field transform); `applySchemaExtensions` uses it and throws a
  clear error when `targetSchema` doesn't exist. Regression tests: `tests/schema-registry.replace.test.ts`.
- **Where:** `src/datrix.ts:474-527` (calls `this._schemas.register(extendedSchema)`),
  guards at `src/schema/registry.ts:119-127` (DUPLICATE_SCHEMA, `allowOverwrite` defaults to false)
  and `registry.ts:129-140` (RESERVED_FIELD_NAME — the extended schema came from `get()` so it
  already contains `id`/`createdAt`/`updatedAt`).
- **Problem:** Any plugin using `extendSchemas` hits `DUPLICATE_SCHEMA` (or, if overwrite were
  allowed, `RESERVED_FIELD_NAME`). There appear to be no tests covering this path
  (only type/impl files reference `extendSchemas`). Also `this._schemas.get(extension.targetSchema)!`
  has no existence check — a typo in `targetSchema` crashes with a TypeError instead of a clear error.
- **Fix:** Add an internal `registry.replace(name, schema)` (bypasses duplicate/reserved checks,
  still validates), use it here, validate `targetSchema` exists with a proper error, and add tests.

### 3.6 🔴 [DONE] Failed initialization cannot be retried
- **Done note:** `initializeWithConfig` catch now disconnects the adapter (if it connected) and
  calls `this.reset()` before rethrowing, so a retry starts from a clean instance.
- **Where:** `src/datrix.ts:73-205` (state mutated before failure points; `initialized` stays false
  but `_schemas`/`pluginRegistry` stay dirty), `datrix.ts:556-586` (`defineConfig` clears
  `initPromise` in `finally`, so the next call re-runs init).
- **Problem:** After a transient failure (e.g. DB connection), the retry re-registers schemas into
  the already-populated registry → `DUPLICATE_SCHEMA`, masking the real error.
- **Fix:** In the `catch` block of `initializeWithConfig`, call `this.reset()` (and disconnect the
  adapter if it connected) before rethrowing.

### 3.7 🟠 [DONE] `adapter.connect()` is called before any schema is registered
- **Done note:** `connect()` moved after `finalizeRegistry()` — adapters now receive a complete
  registry at connect time.
- **Where:** `src/datrix.ts:96-98` (connect) vs `datrix.ts:100-144` (register + finalize afterwards)
- **Problem:** `connect(this._schemas)` hands the adapter an empty registry. It works only if the
  adapter never reads schemas during connect — an undocumented, fragile contract.
- **Fix:** Move `connect()` after `finalizeRegistry()`, or document explicitly that adapters must
  treat the registry as live and not read it during connect.

### 3.8 🟠 [DONE] `validateConfig` is dead code — config is never validated
- **Done note:** `validateConfig(config)` is now the first step of `initializeWithConfig()`.
  The "schemas cannot be empty" rule was dropped from the validator — an empty array is valid
  (plugin-only / internal-only setups, e.g. the `_datrix` meta table tests).
- **Where:** `src/config/validator.ts:26` (only reference in the codebase is its own file);
  `src/datrix.ts:73-84` uses `config` directly.
- **Problem:** The entire config validation module (adapter instance check, schemas array check,
  plugin checks) is never invoked, so misconfiguration produces deep, cryptic failures instead of
  the friendly errors this module was written for.
- **Fix:** Call `validateConfig(config)` at the top of `initializeWithConfig()`.

### 3.9 🟠 [DONE] Two divergent `pluralize` implementations
- **Where:** `src/schema/registry.ts:735-805` (irregulars, f/fe→ves, o→oes…) vs
  `src/schema/inference.ts:246-253` (naive).
- **Problem:** `getTableName(schema)` in inference.ts computes table names differently from the
  registry (e.g. `person` → registry `people`, inference `persons`). Any consumer of
  `inference.getTableName` (CLI type generation, docs) can disagree with the actual table name.
- **Fix:** Export one shared `pluralize` from a single module and use it in both places
  (inference should ideally just read `schema.tableName`, which the registry always sets).

### 3.10 🟡 [DONE] Type inference maps relation/file to `string`
- **Where:** `src/schema/inference.ts:40-43`
- **Problem:** IDs are auto-increment numbers (registry `id: { type: "number" }`), so generated
  types claim `string` where runtime values are `number`. `file` fields are transformed to
  relations at registration, so `"string" // File URL` is stale too.
- **Fix:** Return `"number"` for relation FKs (or the populated entity type union) and align the
  `file` case with the post-transform reality.

### 3.11 🟡 [DONE] `toJSON()`/`fromJSON()` round-trip changes junction schemas
- **Done note:** Junction schemas are now excluded from `toJSON` (derivable from manyToMany
  relations; recreated by `finalizeRegistry`), and `register()` skips timestamp injection for
  `_isJunctionTable` schemas.
- **Where:** `src/schema/registry.ts:810-832`
- **Problem:** `toJSON` strips `id/createdAt/updatedAt` from all schemas, then `fromJSON` →
  `register()` re-adds `createdAt/updatedAt` to junction schemas that intentionally never had
  timestamps (`_isJunctionTable`). Round-tripped registries then diff against the DB.
- **Fix:** Skip timestamp injection for `_isJunctionTable` schemas in `register()`, or exclude
  junction schemas from `toJSON` (they are derivable).

### 3.12 🟠 [DONE] hasOne hidden FK is not marked `unique` — DB allows multiple children
- **Done note:** hasOne FKs now get `unique: true`. The differ correctly reports
  hasOne↔hasMany/belongsTo kind switches as a unique-constraint change (migration e2e tests
  updated to expect the alter + verified diff is stable after apply).
- **Where:** `src/schema/registry.ts:606-624` (hasOne and hasMany share the same FK-injection path;
  the hidden FK field is created as `{ type: "number", required: false, hidden: true, references }`
  with no `unique` flag for either kind).
- **Problem:** For hasOne, nothing at the schema/DB level prevents two target rows from pointing at
  the same parent. Adapters that populate hasOne via JOIN + aggregation then duplicate the parent
  row (see adapter-postgres-core issue Part 9). Worse, the target schema's FK field is
  shape-identical for hasOne and hasMany, so an adapter cannot even detect at `createTable` time
  that the column should get a UNIQUE index — the relation kind only exists on the source schema.
- **Fix:** In `processRelations`, when `relation.kind === "hasOne"`, create the hidden FK with
  `unique: true` (adapters already translate `unique` into a constraint/index). Add a migration
  consideration: existing hasOne FKs without the unique index will diff as modified once this
  lands — verify the differ handles `unique: undefined → true` (see 5.2).
- **Note:** Adapters currently work around this defensively (DISTINCT ON / LIMIT 1); those
  workarounds stay harmless after the fix.

---

## Phase 4 — Validator [ ALL DONE — 2026-07-12 ]

### 4.1 🟠 [DONE] `pattern` with the `g` flag gives alternating results
- **Done note:** `field-validator` resets `pattern.lastIndex = 0` before `.test()`.
- **Where:** `src/validator/field-validator.ts:181` (`field.pattern.test(value)`)
- **Problem:** A schema pattern like `/foo/g` is stateful (`lastIndex`), so repeated validations of
  the same schema instance alternate between pass/fail.
- **Fix:** Strip the `g`/`y` flags when validating (`new RegExp(p.source, p.flags.replace(/[gy]/g, ""))`),
  or reset `lastIndex = 0` before `.test()`. Best done once at schema registration.

### 4.2 🟠 [DONE] `validateRelation` rejects string IDs that earlier layers accept
- **Done note:** Number-only policy enforced in the shortcut branch too: a string shortcut now
  fails with "IDs are number-only", non-integer numbers rejected. Builder layers (1.5/1.7) were
  already aligned in the Phase 1 session — all three layers now agree.
- **Where:** `src/validator/field-validator.ts:601-648` (connect/set must be numbers)
- **Problem:** The shortcut branch (`field-validator.ts:569`) accepts a string ID, the query-builder
  coercion accepts string IDs for relations (`where.ts:213-217`), but normalized `connect`/`set`
  arrays must be numbers — and `extractIds` has already converted strings to `NaN` (issue 1.5).
  Three layers disagree.
- **Fix:** Resolve together with 1.5/1.7: pick the ID policy (number-only given the auto-increment
  PK) and enforce it consistently in one early place with a clear error.

### 4.3 🟠 [DONE] `validateData` discards the validator's output
- **Done note:** The unimplemented `coerce` option was removed from `ValidatorOptions`.
  `stripUnknown` stays (it is implemented). With the executor's fixed `strict: true` +
  `stripUnknown: false` the validator is check-only, so returning `dataWithTimestamps` is
  correct — documented in `validateData`.
- **Where:** `src/query-executor/validation.ts:193-207` (`validatePartial/validateSchema` return
  values ignored; `dataWithTimestamps` is returned instead)
- **Problem:** `stripUnknown`, unknown-field passthrough, and any future coercion inside the
  validator have no effect on what is actually sent to the adapter. The `coerce` option in
  `ValidatorOptions` is defined but implemented nowhere.
- **Fix:** Either return/forward `validatedData` (merging timestamps into it), or remove the
  unused options (`coerce`, `stripUnknown`) so the API doesn't promise behavior it doesn't have.

### 4.4 🟡 [DONE] `getFieldValue` FK fallback uses a falsy check
- **Done note:** Fallback now triggers only on `undefined`/`null`.
- **Where:** `src/validator/schema-validator.ts:62-70` (`if (!value && ...)`)
- **Problem:** A legitimate relation value of `0` (or empty string with string IDs) triggers the
  foreign-key fallback and can mask the real value.
- **Fix:** Use `value === undefined || value === null`.

### 4.5 🟡 [DONE] `Infinity` passes number validation
- **Done note:** `isNumber` now uses `Number.isFinite`.
- **Where:** `src/validator/field-validator.ts:28-29` (`isNumber` rejects only `NaN`)
- **Problem:** `Infinity`/`-Infinity` pass type validation and fail later at the database layer.
- **Fix:** Use `Number.isFinite(value)`.

---

## Phase 5 — Migration system [ ALL DONE — 2026-07-12 ]

### 5.1 🔴 [DONE] Differ compares `pattern`, `items`, and `default` by reference
- **Done note:** Value-based comparison via `stableSerialize` (RegExp → string, functions
  dropped — mirrors JSON serialization). Function defaults never diff. A pattern that degraded
  to `{}` through JSON is incomparable and treated as unchanged (pattern never affects DDL, so
  a spurious diff would loop endless migrations). Regression tests:
  `tests/migration/differ.value-compare.test.ts`.
- **Where:** `src/migration/differ.ts:758` (`default !==`), `differ.ts:770-775` (`pattern !==`),
  `differ.ts:793-803` (`items !==`)
- **Problem:** The "old" schemas come from the database / persisted JSON, so RegExp patterns,
  array `items` definitions, and object/function defaults are never reference-equal to the current
  in-memory definitions. Every diff marks such fields `fieldModified` → endless spurious
  migrations (and `auto: true` init failures when they become ambiguous).
- **Fix:** Deep-compare by normalized value: `String(pattern)`, structural comparison of `items`
  (recursive field-definition equality), JSON-stable comparison for `default` (and skip function
  defaults entirely — they can't be diffed).
- **Note:** The DB stores the schema as JSON (same shape as core's), so the "old" side has
  necessarily gone through JSON serialization: `RegExp` becomes `{}` and function defaults are
  dropped by `JSON.stringify`. Verify how `pattern`/`default` are actually serialized before
  fixing — the comparison must be normalization-aware on both sides, and the serializer may also
  need to encode patterns as strings.

### 5.2 🟡 [DONE] `required: undefined` vs `required: false` counts as a modification
- **Done note:** `required` and `unique` normalized with `?? false` on both sides.
- **Where:** `src/migration/differ.ts:740`
- **Problem:** Schemas that omit `required` diff against DB-reported `required: false` → spurious
  `fieldModified`.
- **Fix:** Normalize with `(oldField.required ?? false) !== (newField.required ?? false)` (same for
  `unique` at `differ.ts:745-755`).

### 5.3 🔴 [DONE] `renameTable` is executed post-commit, contradicting the phase design
- **Done note:** `renameTable` moved into `txOps` (as the phase docs promised); postOps is
  dropTable-only now.
- **Where:** `src/migration/runner.ts:267-275` (`renameTable` pushed to `postOps`) vs the phase
  documentation at `runner.ts:141-155` which places `renameTable` in Phase 2 (tx).
- **Problem:** Operations inside the transaction that target the *new* table name (alterTable,
  dataTransfer produced by the session) run while the table still has its old name → migration
  fails or operates on the wrong table. Order within a migration is not preserved across phases.
- **Fix:** Move `renameTable` into `txOps` (as documented). If an adapter can't rename inside a
  transaction, that adapter should surface a capability flag rather than core reordering silently.

### 5.4 🔴 [DONE] Session's data-transfer FK names don't match the registry convention
- **Done note:** Added `resolveJunctionFkColumns()` — FK column names are read from the actual
  junction schema (`references.table` match): migrate_to_junction resolves from the createTable
  op's schema, migrate_first from the DB-side schema being dropped. `singularize` heuristics
  removed from both paths; unresolvable junctions throw. Also fixed the previously wrong target
  column in migrate_to_junction (used the source table's FK name instead of the junction's).
- **Where:** `src/migration/session.ts:1332-1342` and `session.ts:1379-1381`
  (`singularize(tableName) + "Id"` → e.g. `postId`) vs `src/schema/registry.ts:668-669`
  (junction FKs are `${schemaName}Id` → e.g. `PostId` for model `Post`).
- **Problem:** For any model whose name isn't already lowercase, the injected dataTransfer
  reads/writes columns that don't exist in the junction table (`postId` vs `PostId`) → transfer
  fails or silently inserts wrong columns.
- **Fix:** Resolve the junction schema from the registry and read its actual FK field names instead
  of re-deriving them from table-name heuristics (`singularize`).

### 5.5 🟠 [DONE] `couldBeRename` always returns true — every drop+add becomes ambiguous
- **Done note:** Rename is offered only when type and nullability (`required ?? false`) match;
  otherwise plain drop+add is emitted without an ambiguity (auto-migration no longer blocks).
- **Where:** `src/migration/session.ts:913-921`
- **Problem:** Removing field X and adding unrelated field Y always produces a
  `column_rename_or_replace` question. With `migration.auto: true`, init aborts
  (`datrix.ts:181-187`) — any simultaneous add+remove blocks automatic startup.
- **Fix:** Implement the heuristic the comment promises: only offer rename when types (and
  nullability) match; otherwise emit plain drop+add without an ambiguity.

### 5.6 🟠 [DONE] Generated migration files contain non-executable `dataTransfer` ops
- **Done note:** `generateFile` now emits a loud TODO stub whose `execute` throws with a clear
  "replace with raw SQL" message; the runner additionally validates `execute` is a function
  before calling and throws a descriptive `MigrationSystemError` otherwise.
- **Where:** `src/migration/generator.ts:356-360` (serializes only `description`; `execute` is a
  closure) and `src/migration/runner.ts:383-384` (`operation.execute(tx)`)
- **Problem:** A file produced by `generateFile` that includes a dataTransfer step will crash the
  runner (`execute is not a function`).
- **Fix:** When serializing, either translate dataTransfer into equivalent `raw` SQL operations or
  emit a TODO stub with a loud comment and validate at load time that `execute` exists.

### 5.7 🟡 [DONE] Commit failure is not recorded in history
- **Done note:** Commit catch now calls `recordSafe(..., "failed")` like the other paths.
- **Where:** `src/migration/runner.ts:193-199`
- **Problem:** Every other failure path calls `recordSafe(..., "failed")`; a `commit()` failure
  returns without recording, so history misses the failed run.
- **Fix:** Add `await this.recordSafe(migration, executionTime, "failed", err)` in that catch.

### 5.8 🟡 [DONE] First post-commit drop failure skips remaining drops
- **Done note:** The postOps loop continues on failure, collects all warnings, and returns once
  at the end (history-record warning is appended to the same list).
- **Where:** `src/migration/runner.ts:208-222`
- **Problem:** The early `return` on the first failed `dropTable` abandons the remaining postOps,
  leaving more leftovers than necessary, and the single warning hides them.
- **Fix:** Continue the loop, collect all warnings, return once at the end.

---

## Suggested session order

| Session | Scope | Items |
|---|---|---|
| 1 | Silent data corruption in builder | 1.5, 1.6, 1.13, 1.2, 1.3, 1.1 (docs + guard only) |
| 2 | Builder validation gaps (layer model) | 1.4, 1.8, 1.11, 1.14, 1.9, 1.10, 1.7, 1.12 |
| 3 | Executor & relations | 2.1, 2.2, 2.3, 2.4, 2.8 |
| 4 | Dispatcher & lifecycle | 2.5, 2.6, 2.7, 3.5, 3.6, 3.7, 3.8 |
| 5 | Registry correctness | 3.1, 3.2, 3.3, 3.4, 3.9, 3.10, 3.11 |
| 6 | Validator consistency (ID policy decision first) | 4.1, 4.2, 4.3, 4.4, 4.5 |
| 7 | Migration: differ false positives | 5.1, 5.2, 5.5 |
| 8 | Migration: runner/session/generator | 5.3, 5.4, 5.6, 5.7, 5.8 |

Notes:
- The ID policy, update-guard, and nested-update decisions are already made — see the
  "Decisions" section at the top.
- 5.1 and 3.5 should each get a regression test first; both look like paths no test currently exercises.
