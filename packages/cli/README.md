# @datrix/cli

Command-line interface for the [Datrix](https://datrix.dev) database management framework. Provides tools for running migrations, generating TypeScript types, and exporting/importing data.

## Installation

```bash
npm install -D @datrix/cli
```

## Usage

```bash
datrix <command> [options]
```

## Commands

### `migrate`

Runs pending database migrations based on your current schema definitions.

```bash
datrix migrate
datrix migrate --dry-run   # Preview what would be applied without executing
datrix migrate --status    # Show current migration status
datrix migrate --yes       # Skip the confirmation prompt
```

| Option | Description |
|---|---|
| `--dry-run` | Show what would be done without applying changes |
| `--status` | Display pending and applied migrations |
| `--yes` | Apply without asking (required when stdin is not a TTY) |

#### Changing `idType`

When `idType` in the config differs from the database (`int` ↔ `uuid`), `migrate` runs a dedicated conversion instead of a regular migration:

1. Asks for confirmation (`--yes` skips, `--dry-run` only prints the plan).
2. Exports the database to `datrix-idtype-backup_<timestamp>.zip` in the current directory.
3. Rewrites every id, foreign key and junction row — int → uuid: UUID v7 from `createdAt`; uuid → int: sequential by `createdAt`. Creation order is preserved.
4. Drops, recreates and re-imports the managed tables.
5. Writes the old → new id mapping to `datrix-idtype-mapping_<timestamp>.json`.

It stops if other schema changes are pending — apply them with the old `idType` first. Ids stored outside Datrix (json fields, external systems) are not updated; use the mapping file. Dangling foreign keys are set to `null`, junction rows with a missing side are dropped. On failure, restore with `datrix import <backup.zip>`. Auto-migrate on startup never converts ids.

---

### `generate schema <Name>`

Generates a schema template file for a new model.

```bash
datrix generate schema User
datrix generate schema Post --output ./src/schemas
```

| Option | Description |
|---|---|
| `--output <path>` | Custom output directory (default: current directory) |

---

### `generate types`

Generates TypeScript type definitions from your registered schemas.

```bash
datrix generate types
datrix generate types --output ./src/types/datrix.ts
```

| Option | Description |
|---|---|
| `--output <path>` | Output file path (default: `./types/datrix.ts`) |

With `idType: "uuid"` the file also contains a `declare module "@datrix/core" { interface DatrixRegister { idType: "uuid" } }` block, so `DatrixId` and every id in the generated types become `string`.

---

### `export`

Exports all database data to a zip file.

```bash
datrix export
datrix export --output ./backups/backup.zip
datrix export --include-files
datrix export --include-files --pack-files
datrix export --resume ./export_2024-01-01   # Resume an interrupted file export
```

| Option | Description |
|---|---|
| `--output <path>` | Output file path (default: `./export_<timestamp>.zip`) |
| `--include-files` | Also export media files (requires `@datrix/api-upload` plugin) |
| `--pack-files [bytes]` | Pack downloaded files into zip chunks (default chunk size: 1GB) |
| `--resume <dir>` | Resume an interrupted file export from a previous run |

---

### `import <file.zip>`

Imports data from a previously exported zip file. **This drops all existing data.**

```bash
datrix import ./backup.zip
datrix import ./backup.zip --agree           # Skip confirmation prompt
datrix import ./export_dir --with-files      # Import data + media files
datrix import ./export_dir --only-files      # Import media files only
datrix import ./export_dir --resume <dir>    # Resume an interrupted file import
```

| Option | Description |
|---|---|
| `--agree` | Skip the "drop all data" confirmation prompt |
| `--with-files` | Import database and media files from an export directory |
| `--only-files` | Import media files only, skip database import |
| `--resume <dir>` | Resume an interrupted file import |

---

## Global Options

| Option | Description |
|---|---|
| `--config <path>` | Config file path (default: `./datrix.config.ts`) |
| `--verbose` | Enable verbose output |
| `--help` | Show help message |

## Configuration

The CLI looks for a `datrix.config.ts` file in the current directory by default.

```ts
import { defineConfig } from "@datrix/core";
import { createPostgresAdapter } from "@datrix/adapter-postgres";

export default defineConfig({
  adapter: createPostgresAdapter({
    connectionString: process.env.DATABASE_URL,
  }),
  schemas: [UserSchema, PostSchema],
});
```

## License

MIT
