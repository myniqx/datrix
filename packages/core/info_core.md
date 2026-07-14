# Core → Adapter Contract (info_core.md)

**Purpose:** This document is the complete reference for reviewing/developing adapter packages
**without reading core's source code**. It describes what core guarantees before a query reaches
an adapter, exactly what shapes the adapter receives, and what the adapter must (and must not) do.
If a review session has this file, it does NOT need to open `packages/core/src/**`.

Known core-side defects are tracked separately in `packages/core/issue.md` — do not report those
against adapters, and do not add adapter-side workarounds for them.

---

## 1. Layer model (who does what)

```
Query Builder (core)   → structural validation + normalization
Executor (core)        → data validation, timestamps, relation orchestration, transactions
Adapter                → SQL/NoSQL translation ONLY
```

Adapters **never validate data**. By the time `executeQuery` is called:
- Every field name in `select`, `where`, `data` has been checked against the schema (exceptions:
  `orderBy`, `groupBy`, `having`, and populate-level `where`/`orderBy` — see §8 Known gaps).
- Values are coerced to the field's type (string `"5"` → number `5`, ISO string → `Date`, etc.).
- Data values passed min/max/pattern/enum/required/custom validation.
- `createdAt`/`updatedAt` are already injected into insert/update data (except junction tables,
  which have no timestamps).
- Relation shortcuts are normalized (belongsTo/hasOne FK is already inlined into `data` as a
  scalar FK column, e.g. `category: 2` arrives as `categoryId: 2`).

Adapter responsibilities (the ONLY ones):
1. Translate `QueryObject` → SQL (or native query).
2. Prevent SQL injection: **parameterize all values, escape/quote all identifiers**.
   Identifier escaping is the adapter's job even though core validates most field names.
3. Convert JS types → DB types (`Date` → timestamp, `boolean` → DB bool, arrays/json → jsonb/text).
4. Convert DB types → JS types on the way back (rows must come back with `Date` objects for date
   fields, numbers for numeric fields, parsed JSON for json fields).
5. Translate database errors into `DatrixAdapterError` (all interface methods throw on failure —
   no Result objects).
6. Connection/pool management, transactions, savepoints.

---

## 2. Adapter interface (from `@datrix/core` types)

```ts
interface DatabaseAdapter<TConfig> extends QueryRunner, SchemaOperations {
  readonly name: string;
  readonly config: TConfig;

  connect(schemas: ISchemaRegistry): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getConnectionState(): "disconnected" | "connecting" | "connected" | "error";

  beginTransaction(): Promise<Transaction>;

  // Introspection
  getTables(): Promise<readonly string[]>;
  getTableSchema(tableName: string): Promise<SchemaDefinition | null>;
  tableExists(tableName: string): Promise<boolean>;

  // Export / Import (streaming via ExportWriter / ImportReader)
  exportData(writer: ExportWriter): Promise<void>;
  importData(reader: ImportReader): Promise<void>;
}

interface QueryRunner {
  executeQuery<T>(query: QueryObject<T>): Promise<QueryResult<T>>;
  executeRawQuery<T>(sql: string, params: readonly unknown[]): Promise<QueryResult<T>>;
}

interface SchemaOperations {
  createTable(schema: SchemaDefinition): Promise<void>;
  dropTable(tableName: string): Promise<void>;
  renameTable(from: string, to: string): Promise<void>;
  alterTable(tableName: string, operations: readonly AlterOperation[]): Promise<void>;
  addIndex(tableName: string, index: IndexDefinition): Promise<void>;
  dropIndex(tableName: string, indexName: string): Promise<void>;
}

interface Transaction extends QueryRunner, SchemaOperations {
  readonly id: string;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  savepoint(name: string): Promise<void>;
  rollbackTo(name: string): Promise<void>;
  release(name: string): Promise<void>;
}

interface QueryResult<T> {
  readonly rows: readonly T[];
  readonly metadata: {
    readonly rowCount?: number;
    readonly affectedRows?: number;
    readonly insertIds?: readonly number[];
    readonly count?: number;      // REQUIRED for type:"count" queries
  };
}
```

**`connect(schemas)` timing:** core calls `connect()` AFTER `finalizeRegistry()` (core issue 3.7,
fixed) — adapters receive a complete registry at connect time. Treating the registry as live is
still good practice (plugin schema extensions may replace schemas after connect).

---

## 3. QueryObject shapes (what `executeQuery` receives)

Discriminated union on `type`. Everything below is **post-normalization** — the shapes adapters
can rely on.

```ts
// SELECT
{ type: "select", table: string,
  select: readonly string[],            // ALWAYS a concrete field list, never "*"
                                        // (core issue 2.2 fixed: post-write refetch falls back to
                                        //  the cached select list; adapters may keep a fail-safe)
  where?: WhereClause,
  populate?: QueryPopulate,
  orderBy?: readonly { field: string; direction: "asc"|"desc"; nulls?: "first"|"last" }[],
  limit?: number, offset?: number,
  distinct?: boolean,
  groupBy?: readonly string[],
  having?: WhereClause }

// COUNT — result goes in metadata.count
{ type: "count", table, where?, groupBy?, having? }

// INSERT — data is ALWAYS an array (bulk); one INSERT statement expected
{ type: "insert", table,
  data: readonly Partial<T>[],          // validated scalars incl. timestamps + inlined FKs
  relations?, select?, populate? }      // relations/select/populate are consumed by the
                                        // EXECUTOR, not the adapter — adapter only inserts `data`

// UPDATE — data is a single object applied to all matched rows
{ type: "update", table, data: Partial<T>, where?, relations?, select?, populate? }

// DELETE — where is always present (builder rejects delete without where)
{ type: "delete", table, where, select?, populate? }
```

**Rows the adapter must return:**
- `insert`: the inserted rows — at minimum each row must contain `id` (core uses
  `rows.map(r => r.id)` for relation linking and post-insert refetch). `RETURNING id` or
  equivalent is mandatory.
- `update`: the matched/updated rows, at minimum with `id` (core refetches by those ids).
- `delete`: the deleted rows (core may pre-fetch itself when `select`/`populate` requested).
- `select`: rows with exactly the `select` fields; populated relations attached under the
  relation field name.

---

## 4. WHERE clause contract

`WhereClause` is a nested object of field conditions and logical operators. All values are
already type-coerced.

Logical operators (recursive): `$and: WhereClause[]`, `$or: WhereClause[]`, `$not: WhereClause`.
Max nesting depth 10 (enforced by core).

Comparison operators the adapter MUST support:

| Operator | Value type | SQL semantics |
|---|---|---|
| `$eq` / `$ne` | primitive/Date/null | `=` / `!=` (null → `IS NULL` / `IS NOT NULL`) |
| `$gt` `$gte` `$lt` `$lte` | number/Date | comparison |
| `$in` / `$nin` | array | `IN` / `NOT IN` (define behavior for empty arrays: `$in: []` → no rows) |
| `$like` / `$ilike` | string | `LIKE` / case-insensitive LIKE (pattern passed as-is, user provides `%`) |
| `$startsWith` / `$endsWith` | string | LIKE with adapter-added `%` — adapter must escape `%`/`_` in the value |
| `$contains` / `$icontains` / `$notContains` | string | LIKE `%value%` variants — same escaping duty |
| `$regex` | string or RegExp | regex match (dialect-specific) |
| `$exists` / `$null` / `$notNull` | boolean | `IS [NOT] NULL` checks (`$exists: true` ≡ `$notNull: true`) |

Bare values are shorthand for `$eq`: `{ role: "admin" }` ≡ `{ role: { $eq: "admin" } }`.
A field may combine multiple operators: `{ age: { $gte: 18, $lt: 65 } }` → AND.

**Relation fields in WHERE:** for belongsTo/hasOne, core rewrites shortcuts to the FK column
(`category: 2` → `categoryId: { $eq: 2 }`), so adapters mostly see plain columns. A **nested
object under a relation field name** (e.g. `{ author: { verified: { $eq: true } } }`) is a
relation sub-query: the adapter must translate it (EXISTS / JOIN against the target table).
Whether an adapter supports nested relation WHERE for hasMany/manyToMany is adapter-specific —
if unsupported it must throw a clear `DatrixAdapterError`, never silently ignore the condition.

---

## 5. POPULATE contract

Normalized shape (wildcards/dot-notation/booleans already expanded by core):

```ts
populate: {
  [relationFieldName]: {
    select: readonly string[],   // concrete field list of the TARGET model
    where?: WhereClause,         // filter on target rows (core-validated against the target schema)
    populate?: QueryPopulate,    // nested, max depth 5
    limit?: number, offset?: number,
    orderBy?: QueryOrderBy,
  }
}
```

The adapter resolves relation metadata (kind, FK, junction table) from the schema registry it
received in `connect()`. Relation kinds:

- `belongsTo` — FK column on the query's own table (`<field>Id` by default, or `foreignKey`).
- `hasOne` / `hasMany` — FK column on the TARGET table (default `<OwnerModelName>Id`, note the
  model-name casing).
- `manyToMany` — junction table named `through` (default: alphabetically sorted
  `ModelA_ModelB`), with FK columns `<ModelA>Id` and `<ModelB>Id` (model-name casing).
  **Self-referential** manyToMany junctions use `source<Model>Id` / `target<Model>Id` instead
  (the source relation field is registered first). Adapters must NOT recompute `${model}Id`
  string templates — resolve FK column names from the junction schema's belongsTo relation
  fields (`foreignKey` values; for self-relations, insertion order disambiguates source/target).

Populate strategy (JSON aggregation, LATERAL join, batched IN) is the adapter's choice; the
result shape must be: relation field on each row = object (belongsTo/hasOne, or null) / array
(hasMany/manyToMany).

---

## 6. Schema & DDL contract

`SchemaDefinition` as adapters receive it (post-registration, "enhanced"):
- `name` (model name), `tableName` (always set — core pluralizes if the user didn't specify),
  `fields`, `indexes?`, `_isJunctionTable?`.
- Every schema has `id` (number, auto-increment PK), `createdAt`, `updatedAt` (date, required) —
  except junction tables, which have `id` + two required hidden FK columns + a unique composite
  index, and NO timestamps.
- Relation fields (`type: "relation"`) have **no DB column of their own**; the physical column is
  the FK described above (present in `fields` as a hidden `number` field with a `references`
  block: `{ table, column: "id", onDelete: "cascade"|"setNull"|..., onUpdate? }`). `createTable`
  must skip relation fields and create FK columns from the hidden fields.
- hasOne hidden FKs carry `unique: true` (core issue 3.12, fixed) — adapters must translate the
  `unique` flag into a DB constraint/index so one parent cannot have two hasOne children.
- Field types → columns: `string` (respect `maxLength` if the dialect benefits), `number`
  (`integer` flag), `boolean`, `date` (timestamp), `enum` (values list — CHECK constraint or
  native enum), `array`/`json` (jsonb/text), `file` never reaches adapters (transformed to a
  relation at registration).

`alterTable` operations: `addColumn`, `dropColumn`, `modifyColumn`, `renameColumn`, plus
**meta-only** ops `addMetaField` / `dropMetaField` / `modifyMetaField` — these do NOT touch
physical columns; they update the schema JSON that the adapter persists (see §7).

Migration runner phases (adapters must tolerate this ordering):
1. `createTable` — called OUTSIDE any transaction.
2. `alterTable`, `renameTable`, `dataTransfer` (arbitrary `executeQuery` calls on a Transaction),
   `createIndex`, `dropIndex`, `raw` — inside a single Transaction (core issue 5.3 moved
   `renameTable` here; adapters must support rename on a transaction connection).
3. `dropTable` — after commit, outside the transaction.

---

## 7. Schema persistence & introspection

The database stores the **full schema JSON, identical to core's SchemaDefinition** (in the
`_datrix` metadata table). This means:
- `getTableSchema(tableName)` must return the stored schema definition (same shape core
  registered), not a raw-column reconstruction. Migration diffing is effectively a comparison of
  two schema JSONs (stored vs. in-memory).
- `createTable` / `alterTable` (including the `*MetaField` ops) must keep the stored schema JSON
  in sync with the DDL they execute.
- `getTables()` must list user tables; names starting with `_datrix` are internal (core filters
  them, but don't rely on it).
- Core creates the `_datrix` meta table and the migration-history table itself via
  `tableExists` + `createTable` — adapters just implement those primitives.

---

## 8. Former core gaps (now fixed) — keep the adapter fail-safes

The gaps previously listed here (issues 1.4, 1.5, 1.8, 1.11, 2.2) are all FIXED in core:
`orderBy`/`groupBy`/`having` and populate-level `where`/`orderBy` are validated and normalized,
post-write refetch always carries a concrete `select`, hasMany/manyToMany WHERE values are
normalized, and invalid relation IDs throw at the builder.

Adapters must still keep their defense-in-depth: parameterized SQL, escaped/validated
identifiers on EVERY identifier they emit, and clear `DatrixAdapterError`s. These are adapter
responsibilities regardless of what core validates (raw queries and future regressions exist).
Existing fail-safes (e.g. `select: undefined` → `["id"]`) are harmless and may stay.

## 9. Intentional core semantics (do not "fix" in adapters)

- **Bulk insert shares one `relations` set across all items** — by design ("insert 5 products,
  all in this category"). Per-item relations = user loops `create` themselves. The adapter is not
  involved: it only bulk-inserts `data`; core does the relation linking afterward with follow-up
  queries on the same Transaction.
- Relation orchestration (junction inserts/deletes, FK updates for connect/disconnect/set) is
  done by CORE as plain `executeQuery` calls on a Transaction. Adapters need no relation logic in
  the CRUD path — only in populate translation and DDL.
- `id` is a number (auto-increment). String/UUID primary keys are not currently supported
  end-to-end; adapters should assume numeric ids.
- DELETE and UPDATE always have a WHERE (issue 1.12 fixed — full-table update requires an
  explicit `.where({})`, which reaches the adapter as an empty/absent WHERE; translate as-is).
- Junction cleanup on delete relies on `ON DELETE CASCADE` in the FK definitions — adapters must
  honor `references.onDelete` when creating tables.
