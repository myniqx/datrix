# @datrix/cli

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
