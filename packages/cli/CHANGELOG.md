# @datrix/cli

## 0.3.1

### Patch Changes

- `datrix generate types` emits `XRelationUpdate` as a type alias instead of an interface. Interfaces have no implicit index signature, so `CreateXInput` / `UpdateXInput` did not satisfy the input constraint of `create<X, CreateXInput>()` / `update<X, UpdateXInput>()`. Regenerate your types after upgrading.

## 0.3.0

### Minor Changes

- **Node 22 required:** `engines.node` is now `>=22.0.0`.
- Support for `idType: "uuid"` (requires `@datrix/core` 0.3.0): `generate types` emits the `DatrixRegister` augmentation in uuid mode and types uuid fields as `string`.
- `datrix migrate` handles an `idType` switch: it refuses to combine it with other schema changes, writes a zip backup and an old → new id mapping file, then converts the database.
- Fixed file import resolving record ids with `Number()`, which broke media relinking for uuid ids; ids are now parsed per schema id kind.

## 0.2.0

### Minor Changes

- Fixed scoped `--agree` values being coerced to full consent, boolean flags swallowing the next positional argument, and single-dash arguments being silently ignored.
- Added `--version`, `--force` (for `generate schema`), and `--yes` (non-interactive `migrate`); help text now matches actual behavior.
- Fixed CSV/zip data integrity: ISO-date auto-detect corrupting string fields, `\N` round-tripping to `null`, embedded newlines breaking record parsing, and silently-skipped missing chunk files.
- Fixed media export/import: filename collisions across different keys, ledger entries with spaces being dropped, resumed `--pack-files` overwriting chunks, and partially-downloaded files being treated as complete on resume.
- Added `datrix generate config` (including a MongoDB template) and offline (no-DB) `generate types` support.
- Fixed schema/type generator casing bugs (`toPascalCase`, `toCamelCase`), dangling relation targets producing non-compiling output, and unescaped enum values.
- Added `datrix.shutdown()` call on process exit; consolidated duplicate interactive-prompt helpers.

## 0.1.1

### Patch Changes

- Initial release of @datrix/\* packages and small fixes
- Updated dependencies
  - @datrix/core@0.1.1
