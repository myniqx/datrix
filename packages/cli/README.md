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
```

| Option | Description |
|---|---|
| `--dry-run` | Show what would be done without applying changes |
| `--status` | Display pending and applied migrations |

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
