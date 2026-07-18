# Combined Issues

All problems found in the core and adapter reviews, merged into one document.
Issues shared by multiple adapters are listed once with the affected adapters noted.
All items below have been resolved unless explicitly marked open.

---

# Core Issues

## Query Builder

### Issue 1: Bulk insert silently shares one relation set

`createMany(model, [a, b])` takes relation operations from the **first** item and applies
them to every inserted record. Intended design (no N-query loops), but items whose relation
ops differed from the first were silently ignored.

```ts
createMany("post", [
  { ..., category: 1 },
  { ..., category: 2 }, // was silently dropped -> now throws
]);
```

### Issue 2: `clone()` shared the `select` array

Calling `.select()` on a cloned builder also mutated the original builder's select list.

### Issue 3: `reset()` left the builder unusable

`reset()` wiped `type` and `table`; the next `build()` threw `invalid query type: undefined`.

### Issue 4: `orderBy` / `groupBy` / `having` bypassed all validation

Field names in these clauses are SQL identifiers (cannot be parameterized) but reached
adapters unvalidated — an injection surface and a class of runtime SQL errors.

```ts
findMany("user", { orderBy: [{ field: "noSuchColumn" }] }); // passed through -> now throws
```

### Issue 5: `extractIds()` produced `NaN` / `0` silently

A non-numeric string ID (`"abc"`) became `NaN`, an object without `id` became `0`; these
invalid IDs flowed into `connect`/`set` SQL — silent data corruption.

### Issue 6: Array of RelationInput objects silently dropped

`tags: [{ connect: [1] }, { create: {...} }]` was detected but "normalized" to `{}` —
the whole relation operation vanished.

### Issue 7: Relation shortcut in WHERE force-coerced FK to number inconsistently

`where({ category: "abc" })` threw a coercion error while other layers accepted string IDs.
Resolved by the global decision: **IDs are number-only end-to-end**; any string ID throws.

### Issue 8: hasMany/manyToMany WHERE values passed through raw

Nested WHERE on a hasMany/manyToMany relation was validated but never normalized/coerced
against the target schema; primitive shortcuts (`{ tags: 2 }`) reached adapters in an
undefined shape.

### Issue 9: `populate: { rel: false }` behaved like `true`

`false` matched the boolean branch and expanded the relation — the opposite of intent.

### Issue 10: Dot-notation populate bypassed the depth limit

`populate(["a.b.c.d.e..."])` recursed without limit; circular relations + dot paths could
blow the stack. `MAX_POPULATE_DEPTH` only guarded the object format.

### Issue 11: Populate options (`where`, `orderBy`, `limit`) not validated/normalized

A populate-level `where` never went through validation/coercion against the target schema;
adapters received unnormalized clauses.

```ts
populate: { comments: { where: { bogusField: 1 } } } // passed through -> now throws
```

### Issue 12: UPDATE without WHERE updated the whole table

DELETE was guarded, UPDATE was not. Now both throw; `.where({})` is the explicit opt-in
for intentional full-table updates.

### Issue 13: hasOne accepted multiple references

`favoriteCategory: { set: [1, 2] }` linked id 1 and silently ignored id 2. Now throws —
hasOne/belongsTo take exactly one reference.

### Issue 14: Nested update `where` never validated

`author: { update: { where: {...}, data: {...} } }` — the inner `where` reached the adapter
without field validation or coercion against the target schema.

## Executor & Relations

### Issue 15: Nested relations inside `update` re-created once per matched row

An update matching N rows ran nested `create` operations N times → duplicate records.
Resolved: nested ops resolve **once**, then only ID-based linking runs per row (same
contract as bulk insert).

### Issue 16: Post-write refetch used `select!` which could be `undefined`

The refetch after INSERT/UPDATE carried `select: undefined` into the adapter; behavior
depended on the adapter instead of core's contract. Now falls back to the schema's cached
select-field list.

### Issue 17: Nested create/update validated with `isRawMode: true`

Nested payloads skipped the reserved-field check, so a nested create could smuggle
`id`/`createdAt`/`updatedAt`. Raw mode is now the parent operation's decision.

```ts
create("post", { ..., author: { create: { email, name, id: 999 } } }); // now throws
```

### Issue 18: Self-referential manyToMany broken (source FK === target FK)

`User manyToMany User` (e.g. `friends`) generated `UserId` for both junction FKs — one
overwrote the other and all junction queries filtered the same column twice. Core now
generates `source<Model>Id` / `target<Model>Id`; adapters resolve FK names from the
junction schema (see Adapter Issue 11).

### Issue 19: `onCreateQueryContext` failures swallowed (fail-open)

A plugin enriching the context (auth/RBAC/tenant) that threw was only logged; the query
proceeded with an unenriched context — a security fail-open. Now aborts the query.

### Issue 20: After-hook errors always logged as `afterFind`

A failing `onAfterQuery` during a delete was reported as `afterFind` with no plugin name.

### Issue 21: `count` results flowed through hooks typed as records

Plugins received a `number` where the type promised rows. `count` now skips
result-transform hooks (before-hooks still run).

### Issue 22: Inconsistent read-consistency between operations

DELETE prefetch ran in-transaction while INSERT/UPDATE refetch ran after commit.
Decided: **all** returning-reads run inside the write transaction.

## Schema Registry & Lifecycle

### Issue 23: Self-referential hasOne/hasMany lost its FK field

`Category hasMany Category "children"` — the FK added to the target map entry was clobbered
by a stale schema snapshot written afterwards; the FK column disappeared.

### Issue 24: Two hasOne/hasMany relations to the same model shared one FK

`Post { reviewer: hasOne User, editor: hasOne User }` both defaulted to FK `PostId`; the
relations became indistinguishable. Now a registry error demands explicit `foreignKey`.

### Issue 25: Junction FK references ignored custom `tableName`

A schema with `tableName: "app_users"` still got junction FK references pointing at
pluralized `users` — a nonexistent table.

### Issue 26: `getByTableName` was an O(n) scan per executed query

Now a `tableName → modelName` Map built at `finalizeRegistry()`.

### Issue 27: `applySchemaExtensions` could not work

Plugin schema extensions hit `DUPLICATE_SCHEMA` (or `RESERVED_FIELD_NAME`); a typo in
`targetSchema` crashed with a TypeError. Added internal `registry.replace()` + clear error.

### Issue 28: Failed initialization could not be retried

A transient failure (e.g. DB connection) left the registry populated; the retry hit
`DUPLICATE_SCHEMA`, masking the real error. Init failure now disconnects + resets.

### Issue 29: `adapter.connect()` ran before schema registration

Adapters received an empty registry at connect time. `connect()` now runs after
`finalizeRegistry()`.

### Issue 30: `validateConfig` was dead code

Config was never validated; misconfiguration produced deep cryptic failures. Now the first
step of init (empty `schemas` array is valid — plugin-only setups).

### Issue 31: Two divergent `pluralize` implementations

Registry said `person → people`, inference said `persons` — generated types could disagree
with actual table names.

### Issue 32: Type inference mapped relation/file fields to `string`

IDs are auto-increment numbers; generated types claimed `string`.

### Issue 33: `toJSON()`/`fromJSON()` round-trip mutated junction schemas

Re-registration re-added timestamps to junction schemas that intentionally had none →
spurious migration diffs. Junction schemas are now excluded from `toJSON` and skip
timestamp injection.

### Issue 34: hasOne hidden FK not marked `unique`

Nothing at the DB level prevented two target rows pointing at the same parent; populate
JOINs then duplicated the parent row. hasOne FKs now get `unique: true` (a real UNIQUE
constraint in SQL adapters).

## Validator

### Issue 35: `pattern` with the `g` flag gave alternating results

Stateful `lastIndex` made repeated validations of the same schema alternate pass/fail.

### Issue 36: `validateRelation` rejected string IDs earlier layers accepted

Three layers disagreed on string IDs. Resolved with the number-only ID policy: a string
shortcut fails with "IDs are number-only" everywhere.

### Issue 37: `validateData` discarded the validator's output

`stripUnknown`/`coerce` promised behavior that never reached the adapter. The unimplemented
`coerce` option was removed; the validator is check-only.

### Issue 38: FK fallback used a falsy check

A legitimate relation value of `0` triggered the foreign-key fallback. Now only
`undefined`/`null` do.

### Issue 39: `Infinity` passed number validation

Only `NaN` was rejected; now `Number.isFinite`.

## Migration

### Issue 40: Differ compared `pattern`/`items`/`default` by reference

The "old" schemas come from persisted JSON, so RegExp/objects were never reference-equal →
endless spurious `fieldModified` migrations. Now value-based comparison via stable
serialization.

### Issue 41: `required: undefined` vs `required: false` counted as a modification

Spurious diffs for schemas that omit `required`/`unique`. Normalized with `?? false`.

### Issue 42: `renameTable` executed post-commit

Operations inside the transaction targeting the new name ran while the table still had its
old name. `renameTable` moved into the transactional phase.

### Issue 43: Data-transfer FK names didn't match the registry convention

`singularize(tableName) + "Id"` produced `postId` where the junction actually had `PostId`
→ transfer failed or wrote wrong columns. FK names are now read from the junction schema.

### Issue 44: `couldBeRename` always returned true

Any simultaneous drop+add produced a rename ambiguity, blocking `migration.auto: true`
startup. Rename is now offered only when type + nullability match.

### Issue 45: Generated migration files contained non-executable `dataTransfer` ops

Serialization dropped the `execute` closure; the runner crashed with "execute is not a
function". Now a loud TODO stub that throws with a clear message.

### Issue 46: Commit failure not recorded in history

A `commit()` failure returned without a `failed` history record.

### Issue 47: First post-commit drop failure skipped remaining drops

The loop now continues, collecting all warnings.

---

# Adapter Issues (shared across adapters)

### Issue 1: `$icontains` missing; `$contains`/`$notContains` wrong case sensitivity

**postgres, mysql, mongodb, json.** `$icontains` threw "Unsupported operator" (or matched
nothing); `$contains`/`$notContains` were case-insensitive. Contract: `$contains` =
case-sensitive, `$icontains` = case-insensitive. MySQL additionally needed
`COLLATE utf8mb4_bin` because the default collation is case-insensitive.

```ts
where: { name: { $contains: "Sensitive" } }  // must NOT match "sensitive"
where: { name: { $icontains: "sensitive" } } // must match both
```

### Issue 2: LIKE metacharacters not escaped in adapter-added patterns

**postgres, mysql, json.** For `$contains`/`$startsWith`/`$endsWith`/`$notContains` the
adapter adds the `%` wrapper but did not escape `%`/`_` (json: regex specials too) in the
user value.

```ts
where: { name: { $contains: "50%_off" } } // "%50%_off%" also matched "50XoffYdeal"
```

### Issue 3: `select: undefined` crashed or leaked hidden columns

**postgres, mysql, mongodb, json.** The post-write refetch could arrive with
`select: undefined`: postgres crashed (`select.map` on undefined), mysql's populator crashed
on the spread, mongodb/json returned the full document including hidden FK columns.
MongoDB additionally stripped ALL scalar fields on a populated refetch (inclusion-only
projection).

```ts
const post = await datrix.create("post", data, { populate: { author: true } });
// post.title must exist, post.authorId (hidden FK) must not
```

### Issue 4: Per-relation `limit`/`offset` applied globally, not per parent

**postgres, mysql, mongodb (batched strategy), json.** `populate: { comments: { limit: 5 } }`
over 20 posts returned 5 comments **total**, distributed arbitrarily. Fixed via
`ROW_NUMBER() OVER (PARTITION BY fk)` windows (SQL) / in-memory per-parent windowing (mongo).

```ts
// 3 posts x 5 comments, limit 2 -> each post must get exactly its own first 2
findMany("post", { populate: { comments: { limit: 2, orderBy: [...] } } });
```

### Issue 5: populate-level `where` silently ignored for belongsTo/hasOne

**postgres, mysql (batched strategy), json (hasOne).** `populate: { author: { where: ... } }`
vanished depending on which populate strategy was picked. Semantics decided: "populate only
if the target matches, else null" — identical in all strategies. Nested relation filters
inside a populate-where are rejected with a clear error (postgres, mongodb) or wired into
the join SQL (mysql).

### Issue 6: Returned rows violated the JS-type contract

**postgres, mysql, json.** Date fields inside populated relations came back as ISO strings
(`row_to_json`/`JSON_OBJECT` paths); `NUMERIC`/`DECIMAL` columns came back as strings.
Fixed with a schema-driven `convertRowTypes` pass (dates → `Date`, numeric strings →
`Number`, with a per-schema "needs conversion" flag). JSON adapter: canonical storage is
ISO string, hydrated to `Date` at the result boundary (known remaining gap: nested populate
rows).

### Issue 7: COUNT with relation-WHERE joins overcounted

**postgres, mysql.** LEFT JOINs for a nested relation WHERE multiplied rows; the select path
used `SELECT DISTINCT` but count used plain `COUNT(*)`. Now `COUNT(DISTINCT id)`.

```ts
// 1 post with 3 matching comments: count must be 1, not 3
count("post", { where: { comments: { isApproved: true } } });
```

### Issue 8: hasOne populate duplicated parent rows

**postgres, mysql, mongodb.** Nothing enforced FK uniqueness, so JOIN/`$unwind`-based hasOne
populate emitted the parent once per child. Fixed structurally: core Issue 34 (unique FK)
plus defensive `LIMIT 1` subqueries (postgres) / `$limit: 1` in the lookup pipeline (mongo).

### Issue 9: `renameTable` left stale `tableName` in stored schema JSON

**postgres, mysql, mongodb, json.** Only the `_datrix` key was renamed; the schema JSON kept
the old `tableName` and other schemas' `references.table` went stale → phantom renames in
every future migration diff.

### Issue 10: Export/import destroyed foreign tables and bypassed identifier escaping

**postgres, mysql, mongodb, json (durability variant).** Import was a wipe-and-restore over
the ENTIRE database (dropping the host app's tables in shared-DB setups), export dumped
foreign tables, and identifiers from the archive were interpolated unescaped (SQL injection
via archive; worst case a table name breaking out of a string literal). Fixed: scope
restricted to datrix-managed tables (derived from `_datrix` keys), atomic staging
(temp tables/collections/directories swapped in only after full success), all identifiers
routed through `escapeIdentifier`.

### Issue 11: Self-referential manyToMany populate recomputed `${model}Id` templates

**postgres, mysql, mongodb, json.** After core Issue 18, junction FKs for self-relations are
`source<Model>Id`/`target<Model>Id`, but populate paths still computed `UserId` → queries hit
a nonexistent column. All adapters now resolve FK names from the junction schema
(`resolveJunctionForeignKeys`).

### Issue 12: ORDER BY / GROUP BY columns not table-qualified

**postgres, mysql.** WHERE/SELECT were qualified but ORDER BY/GROUP BY emitted bare column
names → "column reference is ambiguous" as soon as populate joins added another table with
`createdAt`/`id`.

```ts
findMany("post", { orderBy: [{ field: "createdAt" }], populate: { author: true } });
```

### Issue 13: `groupBy`/`having`/`distinct` silently ignored

**mongodb, json.** A count with `groupBy` returned the plain total; a select with `distinct`
returned duplicates — silently wrong. MongoDB implemented them via aggregation pipeline
(`$group`); JSON adapter throws a clear "not supported" error.

### Issue 14: Connection/lock leaks in the transaction lifecycle

**postgres, mysql** (connections), **json** (file lock). A throw in
BEGIN/COMMIT/ROLLBACK left the connection unreleased → pool exhaustion. JSON: double lock
release could delete another process's lock; the lock had no ownership token or heartbeat,
so long transactions were stolen mid-flight.

### Issue 15: Debug logging always on outside production

**postgres, mysql, mongodb.** `NODE_ENV !== "production"` logged every statement, params and
the full QueryObject (row data in logs). Now gated on an explicit `DATRIX_DEBUG=1`.

### Issue 16: Dead code with latent bugs

**postgres, mysql, mongodb.** Unused lateral-join/flat-join builders (containing real
param-binding bugs), stale type maps, never-called helpers — deleted. The broken
`adapter-postgres/tests` (pre-core-split imports) were removed.

### Issue 17: Result-processor null heuristic nulled legitimate rows

**postgres, mysql.** A populated belongsTo/hasOne row whose selected fields were all NULL
(e.g. `select: ["bio"]`, bio null) was indistinguishable from "no match" and became `null`.
Now decided by `id === null` when `id` is present.

---

# Adapter Issues (adapter-specific)

## adapter-postgres-core

### Issue 18: `integer: true` number fields became DOUBLE PRECISION columns

`{ type: "number", integer: true }` now maps to `INTEGER`.

### Issue 19: `createTable` inside a transaction checked `_datrix` existence on the pool

If `_datrix` was created in the same uncommitted transaction, the pool didn't see it and
`createTable` failed. The existence check now uses the transaction connection.

### Issue 20: Batched belongsTo ran a useless query when all FK values were null

Now short-circuits like the lateral strategy.

### Issue 21: Relation-WHERE on UPDATE/DELETE: JOIN→FROM/USING conversion semantically wrong

Regex-parsing the JOIN strings converted LEFT JOIN to inner-join semantics: NULL-FK rows
could never match even via an `$or` scalar branch, and `$not` inverted incorrectly.
Replaced with an id-subquery: `WHERE id IN (SELECT ... LEFT JOIN ... WHERE ...)`.

```ts
updateMany("post",
  { $or: [{ isPublished: false }, { author: { name: "X" } }] },
  { viewCount: 0 });
// posts with author = NULL and isPublished = false were silently skipped
```

### Issue 22: `modifyColumn` was TYPE-only

No `USING` cast (TEXT→INTEGER migrations failed), and NOT NULL / DEFAULT / UNIQUE / enum
CHECK changes were silently not applied while `_datrix` recorded the new definition —
schema and table diverged. Now emits the full set of ALTER statements.

### Issue 23: Enum columns had no DB-level constraint

Enum mapped to bare `VARCHAR`. Now an inline `CHECK (col IN (...))` with a stable
constraint name, swapped by `modifyColumn` when values change.

## adapter-mysql

### Issue 24: LIMIT/OFFSET bound as prepared-statement params

mysql2 encodes JS numbers as DOUBLE; MySQL < 8.0.22 / MariaDB reject non-integer
LIMIT/OFFSET params. Values are now validated and inlined as literals.

### Issue 25: SAVEPOINT via the prepared-statement protocol

`SAVEPOINT`/`ROLLBACK TO`/`RELEASE` are not allowed as prepared statements
(`ER_UNSUPPORTED_PS`). Switched to `connection.query()`.

### Issue 26: Populate `orderBy` emitted `NULLS FIRST/LAST` — invalid MySQL syntax

Any populate with an `orderBy` `nulls` option was a syntax error. Now uses the shared
CASE-based workaround.

```ts
populate: { comments: { orderBy: [{ field: "content", direction: "desc", nulls: "last" }] } }
```

### Issue 27: UPDATE id-prefetch missing DISTINCT

The RETURNING-emulation prefetch duplicated ids under hasMany/manyToMany joins.

### Issue 28: Meta `value` parsing assumed a string

mysql2 auto-parses JSON columns; `JSON.parse(object)` would throw. Now type-checked.

### Issue 29: `onDelete`/`onUpdate` camelCase values not mapped to SQL

`"noAction"` → `NOACTION` (invalid SQL). Now a proper `mapReferentialAction` helper.

### Issue 30: `mapMySQLError` missed FK constraint codes

Only duplicate-key was mapped; FK violations lost their error code.

### Issue 31: Import toggled `FOREIGN_KEY_CHECKS` on the pool

A session variable set on a random pooled connection: later statements ran on other
connections with checks still ON, and the flagged connection leaked back into the pool
unchecked. Import now uses one dedicated connection end-to-end.

### Issue 32: MySQL DDL implicitly commits — migration rollback was silently partial

Every DDL statement commits the open transaction; after a failed migration the runner
believed rollback succeeded while the DB was half-migrated. Now a `ddlExecuted` flag makes
rollback throw a partial-rollback error.

### Issue 33: DDL column-definition gaps

TEXT columns with `default`/`unique` produced invalid DDL (now throws, asking for
`maxLength`); json/array defaults needed the parenthesized `DEFAULT (expr)` form (floor
raised to MySQL 8.0.16); `MODIFY COLUMN` emitted type-only SQL, silently **dropping**
NOT NULL/DEFAULT from the column (now builds the full definition); enum got a
VARCHAR + CHECK constraint.

## adapter-mongodb

### Issue 34: `$exists` had MongoDB semantics, not IS NOT NULL semantics

Missing optional fields are stored as explicit `null`, so Mongo's `$exists: true` matched
NULL fields — the opposite of the SQL adapters. Now translated to `$ne: null` / `$eq: null`.

### Issue 35: Relation shortcut in WHERE silently dropped

When `foreignKey` was missing or the kind was hasMany/manyToMany, the condition vanished
from the filter — worst case a DELETE whose only condition was dropped deleted everything.
Now throws.

### Issue 36: Operator/field-name injection (`$where`)

Unvalidated keys in orderBy/populate-where/projection passed straight into the filter — a
populate-where of `{ $where: "sleep(10000)||true" }` became server-side JavaScript
execution. Every non-`$and/$or/$not` key now goes through `validateIdentifier`.

### Issue 37: DELETE returned no rows

The ids were pre-fetched but `rows: []` was returned. Contract: delete returns the deleted
rows.

```ts
const deleted = await datrix.deleteMany("tag", { ... });
// deleted must contain the removed rows' ids
```

### Issue 38: `limit: 0` bypassed the empty-result short-circuit under populate

The lookup strategy pushed `$limit: 0` (a server error); the batched strategy treated it as
**no limit** and returned everything.

### Issue 39: Nested-relation WHERE on `id` silently dropped conditions on merge

`{ comments: {...}, id: { $gt: 5 } }` — whichever resolved second overwrote the other's id
constraint (dangerous for DELETE filters). Now merged via `$and`.

### Issue 40: `alterTable` ignored its transaction session

Document rewrites (`$unset`/`$rename`) ran without the session; a migration rollback left
documents already rewritten.

### Issue 41: `getNextIds` upsert race on first concurrent insert

Two first-ever inserts could both attempt the counter upsert; the loser got a spurious
duplicate-key error. Now retried on E11000.

### Issue 42: Cascade delete recursed infinitely on cyclic FK graphs

A→B cascade + B→A cascade with rows referencing each other ping-ponged until stack
overflow. Now tracked with a `visited` set.

### Issue 43: populate-where nested relation conditions silently matched nothing

`populate: { comments: { where: { author: { verified: true } } } }` produced a field
equality on a nonexistent subdocument. Now rejected with a clear error (parity with
postgres).

## adapter-json

### Issue 44: Unknown WHERE operators silently matched everything

The operator switch had no `default:`; `$icontains`, `$regex`, or a typo'd operator made
the condition match all rows. Now implemented + `default:` throws.

### Issue 45: Sort ran after projection

`orderBy` on a non-selected field compared `null`s — ordering was lost. Pipeline reordered
to filter → sort → paginate → project.

```ts
findMany("user", { select: ["name"], orderBy: [{ field: "age", direction: "desc" }] });
```

### Issue 46: belongsTo populate `where` was O(N×M)

The whole target table was re-filtered once per parent row. Now filtered once into an id
set.

### Issue 47: Double lock release on query failure

A failed query released the lock twice; the second release could delete a lock another
process had acquired in between. Release now happens in exactly one `finally`.

### Issue 48: `foreignKey`/`through` non-null assertions without contract defaults

A schema arriving without them read `item[undefined]` and silently returned no matches.
Now resolved via a shared helper with contract defaults.

### Issue 49: `getTables` used first-occurrence `.replace(".json", "")`

`"my.json.table.json"` → wrong name. Now `slice`.

### Issue 50: Raw `Error`s instead of `DatrixAdapterError`; corrupt JSON reported as "Table not found"

A truncated/corrupt table file surfaced as "Table 'x' not found", sending debugging the
wrong way. Errors now typed and cause-aware.

### Issue 51: Importer wrote `meta.name = tableName` instead of the model name

After an import, `meta.name` was `"users"` instead of `"User"`.

### Issue 52: `disconnect()` leaked the transaction lock and stale state

With an active transaction, `db.lock` was never removed and tx/cache state survived a
re-`connect()`.

### Issue 53: Cache-by-reference — query results mutated the shared cache

Populate wrote relation objects ONTO cached rows; the next write persisted populated data
into the `.json` file. Callers mutating returned rows corrupted the cache. Fixed with
copy-at-boundary (rows shallow-copied before populate/return; writes mutate a copy swapped
in only after a successful disk write).

### Issue 54: One global transaction slot; dirty reads during an active transaction

Non-transaction reads saw the transaction's uncommitted cache; a second `beginTransaction`
threw instead of waiting. Fixed with `AsyncLocalStorage` tx context + a transaction queue.

### Issue 55: Non-atomic writes; destructive import

Plain `fs.writeFile` could leave truncated JSON on crash; `import` dropped every table
before reading the first chunk — a mid-import failure was total data loss. Now atomic
write-then-rename everywhere and staged imports. (Known accepted gap: multi-table commit
has no journal — a failure on table N leaves 1..N-1 committed.)

### Issue 56: Date fields had no canonical storage or comparison type

Rows held live `Date` objects (from cache) or ISO strings (from disk) depending on cache
state; `$gt`/`$lt` compared `string > Date` → `NaN` → date range queries returned nothing.
Canonical storage is now ISO string, compared by epoch millis, hydrated to `Date` at the
result boundary. (Known gap: nested populate rows may still surface ISO strings.)

```ts
findMany("post", { where: { createdAt: { $gte: yesterday, $lte: tomorrow } } });
// used to return nothing when rows came from disk
```

### Issue 57: Schema lookups were O(all tables × file reads) on hot paths

`getSchemaByModelName` did a readdir + per-table file read per call (per inserted row for
FK checks). Now an in-memory `_datrix` index invalidated on every `_datrix` write.

### Issue 58: Batch unique check missed same-batch duplicates; junction dedup shortened results

Updating two rows to the same unique value passed both checks (each saw the other's OLD
value). Duplicate junction inserts were skipped, shortening `rows`/`insertIds` relative to
`query.data` and breaking core's positional id mapping. Fixed with a pending-values set and
upsert-id semantics.

```ts
updateMany("user", { id: { $in: [a, b] } }, { email: "same@x.com" }); // must throw
```
