# @datrix/cli — Review Issues

Scope: `packages/cli/src/**` (tests excluded). Each issue lists the problem, the exact
location, and how it should be fixed. Issues are grouped into sessions that can be
resolved independently. Severity: **[C]** critical (data loss / dangerous), **[H]** high,
**[M]** medium, **[L]** low/cosmetic.

Decisions already made with the user:
- `datrix generate config` will be implemented (Session 4).
- Offline (no-DB) mode for `generate types` will be added, incl. a small core change (Session 5).
- With `--include-files`, `--output` is interpreted as a directory; a `.zip` suffix is
  stripped with a logged warning (Session 3).

---

## Session 1 — Argument parsing & command lifecycle

### 1.1 [C] [DONE] Scoped `--agree` values are coerced to full consent
- **Problem:** `AgreeOption` supports `"drop-db" | "missing-files"` scopes, but the CLI
  passes `agree: Boolean(args.options["agree"])`. `--agree missing-files` becomes `true`,
  which `hasAgreed()` treats as consent to BOTH scopes — including dropping the entire DB.
- **Where:** `src/index.ts:249` (coercion), `src/commands/import.ts:12,23-28` (AgreeOption/hasAgreed).
- **Fix:** Pass the raw option through: if it is the string `"drop-db"` or
  `"missing-files"`, forward it as-is; if it is boolean `true`, forward `true`; any other
  string → exit with a clear error listing valid values. Document the scoped values in help.

### 1.2 [H] [DONE] Boolean flags swallow the next positional argument
- **Problem:** `parseArgs` treats any `--opt` followed by a non-`--` token as
  `--opt <value>`. `datrix import --agree file.zip` sets `agree="file.zip"` and leaves no
  file path → "Import file path is required". Same trap for `--verbose`, `--dry-run`,
  `--include-files`, `--with-files`, `--only-files`, `--status`, `--help`.
- **Where:** `src/index.ts:39-51`.
- **Fix:** Introduce a value-taking option whitelist (`config`, `output`, `resume`,
  `pack-files`, `agree` — the last two accept an *optional* value) and support
  `--opt=value` syntax. All other `--x` options are boolean and never consume the next
  token. `pack-files`/`agree`: consume the next token only if it matches their expected
  value set/format.

### 1.3 [M] [DONE] Single-dash arguments are silently ignored
- **Problem:** `-v`, `-h`, or a typo like `-config` falls through both branches of the
  parser and is dropped without any feedback.
- **Where:** `src/index.ts:52-55`.
- **Fix:** Exit with `Unknown option: -x` (suggest the `--` form). Optionally alias
  `-h` → `--help`, `-v` → `--version`.

### 1.4 [M] [DONE] No `--version` flag or `version` command
- **Problem:** There is no way to print the CLI version.
- **Where:** `src/index.ts` (command switch and help).
- **Fix:** Add `--version` / `version` that prints the version. Read it from the built
  package.json (tsup can inject it via `define`, or `require("../package.json").version`
  with `resolveJsonModule`); add to help text.

### 1.5 [M] [DONE] Help text is out of sync with the implementation
- **Problem:**
  - `generate types` default documented as `./types/datrix.ts`, code uses
    `types/generated.ts` (`src/commands/generate.ts:122`).
  - Import options `--with-files`, `--only-files`, `--resume` are parsed
    (`src/index.ts:242-247`) but undocumented; help says `import <file.zip>` while
    `--with-files`/`--only-files` expect a *directory*.
  - Scoped `--agree drop-db|missing-files` values undocumented (after 1.1).
  - Export `--output` directory semantics with `--include-files` undocumented (see 3.10).
  - Footer links point to `github.com/datrix/datrix`; the repo is `github.com/myniqx/datrix`
    (package.json).
- **Where:** `src/index.ts:70-118`.
- **Fix:** Rewrite the help block to match actual behavior; keep code defaults (fix docs,
  not code) — i.e. document `types/generated.ts`.

### 1.6 [M] [DONE] Error message references a `--force` flag that does not exist
- **Problem:** `writeFileSafe` says "Use --force to overwrite", but no command parses or
  forwards a `force` option; `generateSchema` hard-codes `overwrite: false`.
- **Where:** `src/commands/generate.ts:62` (message), `:102` (hard-coded false),
  `src/index.ts` (option never read).
- **Fix:** Implement `--force` for `generate schema`: add `force?: boolean` to
  `GenerateCommandOptions`, thread it from `index.ts` into `generateSchema` →
  `writeFileSafe(outputPath, content, options.force ?? false)`. Document in help.

### 1.7 [H] [DONE] `migrate` cannot run non-interactively (CI)
- **Problem:** The "Apply these migrations? (y/N)" prompt blocks forever when stdin is not
  a TTY; there is no `--yes` equivalent (import already has `--agree`).
- **Where:** `src/commands/migrate.ts:178` (confirm), `:29-41` (askQuestion).
- **Fix:** Add `--yes` to skip the confirmation. If stdin is not a TTY and `--yes` was not
  given, fail immediately with a clear message instead of hanging. Ambiguous changes
  (`resolveAmbiguousChanges`) still require a TTY — in non-TTY mode fail with a message
  telling the user to run interactively or resolve first.

### 1.8 [M] [DONE] Invalid answer to an ambiguous-change prompt aborts the whole migration
- **Problem:** A typo in the numeric choice throws `CLIError` and exits; the user must
  restart and re-answer everything.
- **Where:** `src/commands/migrate.ts:138-143`.
- **Fix:** Re-prompt on invalid input (loop, e.g. max 3 attempts before aborting).

### 1.9 [M] [DONE] `datrix.shutdown()` is never called
- **Problem:** Every command path relies on `process.exit()` to tear down adapter
  connections/pools. `IDatrix.shutdown()` exists (core `types/core/interfaces.ts:138`) but
  is never invoked — risky for adapters with buffered writes (e.g. JSON adapter).
- **Where:** `src/index.ts:146-266`.
- **Fix:** Track the loaded instance in `main()`; call `await datrix.shutdown()` in a
  `finally` block before `process.exit`.

### 1.10 [L] [DONE] `undefined!` non-null-assertion hacks for optional options
- **Problem:** `resume: undefined!`, `output: undefined!`, `packFilesChunkSize: undefined!`
  are used to satisfy `exactOptionalPropertyTypes`. Misleading and fragile.
- **Where:** `src/index.ts:213,220,227`.
- **Fix:** Build the options object with conditional spreads
  (`...(resume ? { resume } : {})`) so absent keys are truly absent.

---

## Session 2 — CSV / zip data integrity

### 2.1 [C] [DONE] String fields containing ISO dates are silently converted to `Date` on import
- **Problem:** The ISO-8601 auto-detect regex runs for every field type that is not
  boolean/number/json/date — including `string`. A text column holding
  `"2024-01-01T10:00:00"` round-trips as a `Date` object and gets inserted as a timestamp.
- **Where:** `src/export-import/csv.ts:152-154`.
- **Fix:** Apply the auto-detect branch only when `fieldType === undefined` (no schema
  info). For `fieldType === "string"` return the raw string.

### 2.2 [C] [DONE] String value `"\N"` round-trips to `null`
- **Problem:** `encodeValue` writes the string `\N` unquoted (no comma/quote/newline), and
  `decodeValue` maps `\N` to null. Worse, `parseLine` strips quotes before `decodeValue`
  runs, so even a quoted `"\N"` decodes to null — quoting cannot protect the value.
- **Where:** `src/export-import/csv.ts:16` (token), `:44-55` (encode), `:78-121`
  (parseLine loses quote info), `:127-129` (decode).
- **Fix:** (a) Encoder: always quote a string equal to `NULL_TOKEN`. (b) Parser: make
  `parseLine` return per-cell quoted-ness (e.g. `{ value, quoted }[]`); `decodeValue`
  treats `\N` as null only when unquoted. Backward compatible with existing exports
  (unquoted `\N` was always null).

### 2.3 [C] [DONE] Embedded newlines break record parsing
- **Problem:** `encodeValue` correctly keeps literal `\n` inside quoted cells (RFC 4180),
  but `ZipImportReader` splits chunk content with `content.split("\n")` — a multiline
  string tears the record apart and corrupts every following row in the chunk.
- **Where:** `src/export-import/csv.ts:46-53` (encode), `src/export-import/zip-reader.ts:72`
  (naive split).
- **Fix:** Add a quote-aware record splitter to `csv.ts` (e.g.
  `splitRecords(content): string[]` that only breaks on newlines outside quotes) and use
  it in `readChunks` instead of `split("\n")`.

### 2.4 [H] [DONE] Missing chunk file in the zip is silently skipped
- **Problem:** `readChunks` does `if (!entry) continue;` — a truncated/corrupt export
  imports "successfully" with missing rows.
- **Where:** `src/export-import/zip-reader.ts:68-69`.
- **Fix:** Throw `Error("Corrupt export: chunk file <name> listed in metadata.json but missing from zip")`.

### 2.5 [M] [DONE] Header row parsed with naive `split(",")`
- **Problem:** `readChunks` re-implements header parsing with `split(",")` + manual quote
  stripping instead of the existing quote-aware `parseLine`. A field name containing a
  comma (or future quoting changes) breaks it.
- **Where:** `src/export-import/zip-reader.ts:80-82`.
- **Fix:** Export `parseLine` from `csv.ts` and use it for the header line.

### 2.6 [M] [DONE] `finalize()` fails when output directory doesn't exist; temp dir leaks on error
- **Problem:** `createWriteStream(this.outputPath)` errors if the parent directory is
  missing. Also `temp_<timestamp>` is only removed on the success path — any error during
  export/zip leaves it behind next to the output file.
- **Where:** `src/export-import/zip-writer.ts:114-144` (finalize/createZip), `:57`
  (tempDir location).
- **Fix:** `await fs.mkdir(path.dirname(this.outputPath), { recursive: true })` in
  `finalize()`; wrap zip creation in `try/finally` with temp-dir cleanup. In
  `exportCommand`'s catch, also attempt a best-effort temp cleanup (expose a
  `cleanup()` on the writer).

### 2.7 [L] [DONE] Corrupt numeric cell decodes to `NaN` silently
- **Problem:** `Number(raw)` yields `NaN` for corrupt data; the row is imported with NaN.
- **Where:** `src/export-import/csv.ts:135-137`.
- **Fix:** If `Number.isNaN(result)`, throw with table/column context — the export was
  produced by us, so NaN means corruption.

---

## Session 3 — Media file export/import pipeline

### 3.1 [C] [DONE] Different keys with the same basename overwrite each other
- **Problem:** Files are stored as `path.basename(key)`. Keys `a/1.jpg` and `b/1.jpg`
  collide: the second download overwrites the first, and import uploads the wrong bytes
  for one of the records. All silent.
- **Where:** `src/export-import/file-exporter.ts:184` (download),
  `src/export-import/file-importer.ts:124,147` (lookup).
- **Fix:** Add a shared `keyToFileName(key)` helper (replace `/`, `\` and other unsafe
  chars with `__`, keep extension) used by both exporter and importer. Note in the code
  that old exports used basename (importer may fall back to basename when the sanitized
  name is absent, for backward compatibility).

### 3.2 [H] [DONE] Ledger entries with spaces in the key are silently dropped
- **Problem:** Ledger lines are space-separated and parsed with `split(" ")` expecting
  exactly 3 parts. A key containing a space produces >3 parts, the status check fails, and
  the entry is filtered out → the file is never downloaded/uploaded, with no warning.
- **Where:** `src/export-import/file-exporter.ts:273-293` (parseLedger),
  `src/export-import/file-importer.ts:241-258` (parseImportLedger); same `parts[2]`
  assumption in both `markStatus` implementations
  (`file-exporter.ts:205-221`, `file-importer.ts:222-238`).
- **Fix:** Parse as: `id` = first token, `status` = last token, `key` = middle tokens
  re-joined. Same change in both parsers and both `markStatus` line-matchers. Write format
  stays unchanged (backward compatible).

### 3.3 [H] [DONE] Resume + `--pack-files` overwrites previously packed chunks
- **Problem:** `packIntoZipChunks` always starts at `chunk_0.zip`. On a resumed export
  that packs again, `createWriteStream` truncates the existing `chunk_0.zip` — previously
  packed files are destroyed.
- **Where:** `src/export-import/file-exporter.ts:236-242`.
- **Fix:** Scan `filesDir` for existing `chunk_<n>.zip` and start `chunkIndex` at
  `max(n) + 1`.

### 3.4 [H] [DONE] Ctrl+C is dead while the ESC listener is active
- **Problem:** `setRawMode(true)` disables SIGINT generation; the data handler only reacts
  to ESC (``), so Ctrl+C (``) does nothing during long downloads.
- **Where:** `src/export-import/file-exporter.ts:319-341`.
- **Fix:** In the handler, treat `` as an immediate abort: restore the terminal
  (`stop()`) and `process.exit(130)` (or trigger the same graceful stop as ESC — pick one
  and log which). ESC keeps the current "graceful stop + resume hint" behavior.

### 3.5 [H] [DONE] `Spinner.start()` leaks intervals when used as a progress updater
- **Problem:** `start()` creates a new `setInterval` without clearing the previous one.
  Export/import progress callbacks call `spinner.start(...)` per file — after N files
  there are N+1 live intervals fighting over stdout.
- **Where:** `src/utils/logger.ts:92-103` (start), `src/commands/export.ts:132-134` and
  `src/commands/import.ts:245-247` (per-tick start calls).
- **Fix:** Make `start()` call `this.stop()` first, and add an `update(message)` method
  that only swaps `this.message`; use `update` in the progress callbacks.

### 3.6 [M] [DONE] Ledger I/O is O(n²)
- **Problem:** `markStatus` reads and rewrites the whole ledger file once per file
  processed; `appendToLedger` re-reads the full ledger on every DB chunk. With tens of
  thousands of media files this dominates runtime.
- **Where:** `src/export-import/file-exporter.ts:65-66,205-221`,
  `src/export-import/file-importer.ts:222-238`.
- **Fix:** Introduce a small `Ledger` class holding entries in a `Map`, loaded once;
  `markStatus` appends a status line (append-only journal: `<id> <status>`); readers apply
  journal over base entries. Alternatively rewrite the file at most once per N updates and
  on completion. Shared by exporter and importer.

### 3.7 [M] [DONE] `uploadPending` misreports the uploaded count on resume
- **Problem:** `uploaded: doneCount - skippedCount` where `doneCount` is seeded with
  entries already done from a previous run — a resumed run reports old uploads as new.
- **Where:** `src/export-import/file-importer.ts:141-190`.
- **Fix:** Count this run's uploads/skips in local counters; keep `doneCount` only for the
  progress display.

### 3.8 [M] [DONE] `missing`/`restricted` export entries vanish silently during import
- **Problem:** `buildLedger` keeps only `status === "done"` entries. Files that were
  missing/restricted at export time are never mentioned again — the imported DB rows keep
  keys pointing at files that don't exist in the target storage.
- **Where:** `src/export-import/file-importer.ts:66-67`.
- **Fix:** Count the dropped entries and log a warning summary after building the ledger
  ("N file(s) were missing/restricted during export and will not be uploaded; affected DB
  records keep their original keys"). `--verbose` lists them.

### 3.9 [M] [DONE] Crash instead of a clear error when the media schema is missing
- **Problem:** `datrix.getSchema(mediaModel)!.tableName!` throws a bare `TypeError` if the
  upload plugin's model is not registered.
- **Where:** `src/commands/export.ts:84`.
- **Fix:** Explicit check: if schema or tableName is missing, throw
  `Error("Upload media model '<name>' is not registered in this Datrix config")`.

### 3.10 [M] [DONE] `--output` semantics with `--include-files` (decision: smart interpretation)
- **Problem:** With `--include-files`, `--output` silently becomes a *directory* (help
  documents a zip path). `--output backup.zip` creates a directory literally named
  `backup.zip`. With `--resume`, `--output` is ignored entirely without a word; same for
  import's positional path when `--resume` is given.
- **Where:** `src/commands/export.ts:70-76` (dir semantics, resume override),
  `src/commands/import.ts:115-119` (ignored positional), `src/index.ts:90-96` (help).
- **Fix:** (a) When `--include-files` and `--output` ends with `.zip`, strip the extension
  and use the result as the directory, logging a warning. (b) When `--resume` is combined
  with `--output` (export) or a positional path that differs from the resume dir (import),
  log a warning that it is ignored. (c) Document both output modes in help (Session 1.5).

### 3.11 [M] [DONE] `--pack-files` size is not validated
- **Problem:** `parseInt("abc")` → `NaN`; every size comparison against NaN is false, so
  everything lands in one unbounded chunk, silently defeating the flag.
- **Where:** `src/index.ts:223-227` (parse), `src/export-import/file-exporter.ts:256-259`
  (NaN-blind comparison).
- **Fix:** Validate at parse time: must be a positive integer, otherwise exit with a clear
  error. Convenience: accept `kb/mb/gb` suffixes (e.g. `--pack-files 500mb`) via a tiny
  size parser.

### 3.12 [M] [DONE] Partially downloaded files are treated as complete on resume
- **Problem:** `downloadFile` short-circuits when the destination exists, and writes
  directly to the final path. A crash mid-write leaves a truncated file that resume then
  "verifies" by existence alone.
- **Where:** `src/export-import/file-exporter.ts:184-202`.
- **Fix:** Download to `<name>.part`, `fs.rename` to the final name on success. The
  existence check on the final name then implies a complete file. Ignore/delete stray
  `.part` files on resume.

### 3.13 [L] [DONE] `askConfirm` calls `setRawMode` without a TTY guard
- **Problem:** `setupEscListener` guards `process.stdin.isTTY`; `askConfirm` doesn't —
  `setRawMode` is undefined on non-TTY stdin and would crash.
- **Where:** `src/export-import/file-exporter.ts:343-360`.
- **Fix:** Guard with `process.stdin.isTTY` (resolve `defaultYes` immediately when
  non-TTY), mirroring `setupEscListener`.

### 3.14 [L] [DONE] Three duplicate interactive-prompt helpers
- **Problem:** `askQuestion` (migrate), `confirm` (import), `askConfirm` (file-exporter)
  are three slightly different stdin prompt implementations.
- **Where:** `src/commands/migrate.ts:29-41`, `src/commands/import.ts:30-42`,
  `src/export-import/file-exporter.ts:343-360`.
- **Fix:** Consolidate into `src/utils/prompt.ts` with `ask(question)` and
  `confirm(question, defaultYes)`; reuse everywhere (also needed for 1.7/1.8).

---

## Session 4 — Generators & templates

### 4.1 [H] [DONE] Implement `datrix generate config` (decision: approved) + broken mongodb template
- **Problem:** `configTemplate()` exists but no command uses it (dead code), and its
  `connectionConfig` map lacks a `mongodb` entry — generating for mongodb would emit
  `const adapter = undefined;`.
- **Where:** `src/utils/templates.ts:111-169` (template, missing mongodb at `:122-140`),
  `src/commands/generate.ts:21` (GenerateType), `src/index.ts` (dispatch + help).
- **Fix:** (a) Add the mongodb block (`createMongoDbAdapter({ url: process.env.MONGODB_URL ?? 'mongodb://localhost:27017', database: ... })`
  — match the adapter's actual config shape). (b) Add `"config"` to `GenerateType`,
  implement `datrix generate config <postgres|mysql|json|mongodb>` writing
  `datrix.config.ts` to cwd (or `--output`), refusing to overwrite without `--force`
  (reuses 1.6). (c) Document in help. Note: the template must NOT be generated through
  `loadConfig` (there is no config yet) — dispatch it before config loading in `index.ts`.

### 4.2 [M] [DONE] Schema template lowercases the model name
- **Problem:** `schemaTemplate` uses `name.toLowerCase()`: `datrix generate schema UserProfile`
  produces `name: 'userprofile'`, losing the word boundary forever (affects generated type
  names, FK names, table pluralization).
- **Where:** `src/utils/templates.ts:14-20`.
- **Fix:** Use the existing `toCamelCase` (→ `'userProfile'`) for the schema `name`.

### 4.3 [M] [DONE] `toPascalCase` mangles camelCase input
- **Problem:** `"userProfile"` → `"Userprofile"` because each word's tail is lowercased.
  Affects every generated type name and relation target type (`schema-types.ts`,
  `relation-fields.ts`).
- **Where:** `src/utils/templates.ts:184-192`.
- **Fix:** Do not lowercase the remainder: `word.charAt(0).toUpperCase() + word.slice(1)`.
  (`"user_profile"` → `"UserProfile"` still works; `"USER"` stays `"USER"`, acceptable.)

### 4.4 [M] [DONE] Dangling relation targets produce non-compiling type output
- **Problem:** `collectRelationTargets` is exported but never called. A relation pointing
  to an unregistered model (or to a schema filtered out as internal) emits a reference to
  a type that is never defined — the generated file fails `tsc`.
- **Where:** `src/type-generator/schema-types.ts:30-42` (dead helper), `:199-207`
  (generateTypesFile).
- **Fix:** In `generateTypesFile`, compare collected targets against the set of generated
  names; for each dangling target log a warning and emit
  `type <Name> = unknown; // relation target not registered` so output always compiles.

### 4.5 [L] [DONE] `json` fields typed as `Record<string, unknown>` only
- **Problem:** JSON columns can legally hold arrays (and primitives), but the generated
  type excludes them.
- **Where:** `src/type-generator/scalar-fields.ts:22-23`.
- **Fix:** Emit a `JsonValue`-style union (`Record<string, unknown> | unknown[]` at
  minimum; ideally a recursive `JsonValue` type declared once in the header).

### 4.6 [L] [DONE] Enum values are not escaped in generated types
- **Problem:** `"${v}"` breaks if a value contains `"` or a backslash.
- **Where:** `src/type-generator/scalar-fields.ts:30`.
- **Fix:** Use `JSON.stringify(v)`.

---

## Session 5 — Offline `generate types` (decision: approved, touches core)

### 5.1 [H] [DONE] `generate types` requires a live database connection
- **Problem:** `generateCommand("types", ...)` goes through `loadConfig`, whose factory
  runs `initializeWithConfig(config)` and connects the adapter — so type generation fails
  without a reachable DB (CI, local dev without services up). Core already supports
  `skipConnection` in `DatrixInitOptions`, but `defineConfig`'s returned factory does not
  forward init options.
- **Where:** `src/index.ts:190` + `src/utils/config-loader.ts:62-99` (CLI side); core:
  `packages/core/src/datrix.ts:556-586` (defineConfig does not forward options),
  `:73-98` (`initializeWithConfig` already honors `skipConnection`).
- **Fix:**
  1. **Core:** let the function returned by `defineConfig` accept optional
     `DatrixInitOptions` and forward them to `initializeWithConfig`
     (`getDatrixInstance(options?)`). Backward compatible (no-arg call unchanged).
  2. **CLI:** `loadConfig(configPath, initOptions?)` forwards the options to the factory;
     `generate types` calls `loadConfig(path, { skipConnection: true })`.
  3. Guard: since `defineConfig` memoizes the initialized instance, a
     skip-connection init "poisons" the singleton for later connected use — irrelevant for
     the short-lived CLI process, but add a code comment in core noting this.

---

## Notes (out of scope for these sessions)

- Generated `Create<T>Input` marks `required` fields with a `default` as mandatory. That
  currently matches runtime behavior (core's executor does not inject field defaults —
  only `schema/inference.ts` knows about them). If core ever applies defaults on insert,
  revisit `scalar-fields.ts` optionality.
- `guessMimeType` in `file-importer.ts:260-276` may duplicate logic in `api-upload`;
  consider importing from there when convenient.
