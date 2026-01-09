# CLI Module - Development Guidelines

## 📖 Module Overview

The CLI module provides command-line tools for Forja:
- `forja migrate` - Run database migrations
- `forja generate schema <Name>` - Generate schema template
- `forja generate migration <name>` - Generate migration file
- `forja dev` - Development mode with auto-reload
- `forja init` - Initialize forja.config.ts

**Goal:** User-friendly, helpful error messages, progress indicators

---

## 🎯 Module Responsibilities

### CLI Entry Point (`src/cli/index.ts`)

**Purpose:** Parse commands and route to handlers

```typescript
#!/usr/bin/env node

import { parseArgs } from './utils/args';
import { logger } from './utils/logger';
import { migrateCommand } from './commands/migrate';
import { generateCommand } from './commands/generate';
import { devCommand } from './commands/dev';
import { initCommand } from './commands/init';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  try {
    switch (args.command) {
      case 'migrate':
        await migrateCommand(args.options);
        break;

      case 'generate':
        if (!args.subcommand) {
          logger.error('Missing subcommand. Use: forja generate schema|migration <name>');
          process.exit(1);
        }
        await generateCommand(args.subcommand, args.args[0] ?? '', args.options);
        break;

      case 'dev':
        await devCommand(args.options);
        break;

      case 'init':
        await initCommand(args.options);
        break;

      case 'help':
      case undefined:
        printHelp();
        break;

      default:
        logger.error(`Unknown command: ${args.command}`);
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    logger.error('Command failed:', error);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
Forja CLI - Database Management Framework

Usage:
  forja <command> [options]

Commands:
  init                          Initialize forja.config.ts
  migrate                       Run database migrations
  generate schema <Name>        Generate schema template
  generate migration <name>     Generate migration file
  dev                           Development mode with auto-reload
  help                          Show this help message

Options:
  --config <path>               Config file path (default: ./forja.config.ts)
  --verbose                     Verbose output
  --help                        Show help for command

Examples:
  forja init
  forja migrate
  forja generate schema User
  forja generate migration add-users-table
  forja dev --verbose
  `);
}

main().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
```

---

## 📝 Command Implementations

### Migrate Command (`src/cli/commands/migrate.ts`)

**Purpose:** Run pending migrations

```typescript
import { loadConfig } from '@core/config/loader';
import { loadSchemas } from '@core/schema/registry';
import { generateMigrations } from '@core/migration/generator';
import { runMigrations } from '@core/migration/runner';
import { logger } from '../utils/logger';
import { spinner } from '../utils/spinner';

interface MigrateOptions {
  readonly config?: string;
  readonly verbose?: boolean;
  readonly dryRun?: boolean;
}

export async function migrateCommand(options: MigrateOptions): Promise<void> {
  const configPath = options.config ?? './forja.config.ts';

  // 1. Load config
  spinner.start('Loading configuration...');
  const configResult = await loadConfig(configPath);
  if (!configResult.success) {
    spinner.fail('Failed to load config');
    logger.error(configResult.error.message);
    process.exit(1);
  }
  spinner.succeed('Configuration loaded');
  const config = configResult.data;

  // 2. Load schemas
  spinner.start('Loading schemas...');
  const schemasResult = await loadSchemas(config.schemas.path);
  if (!schemasResult.success) {
    spinner.fail('Failed to load schemas');
    logger.error(schemasResult.error.message);
    process.exit(1);
  }
  spinner.succeed(`Loaded ${schemasResult.data.size} schemas`);
  const schemas = schemasResult.data;

  // 3. Generate migrations
  spinner.start('Generating migrations...');
  const migrationsResult = await generateMigrations(schemas);
  if (!migrationsResult.success) {
    spinner.fail('Failed to generate migrations');
    logger.error(migrationsResult.error.message);
    process.exit(1);
  }
  const migrations = migrationsResult.data;

  if (migrations.length === 0) {
    spinner.info('No pending migrations');
    return;
  }

  spinner.succeed(`Generated ${migrations.length} migrations`);

  // 4. Show migrations
  logger.info('Pending migrations:');
  for (const migration of migrations) {
    logger.info(`  - ${migration.name}`);
    if (options.verbose) {
      for (const op of migration.operations) {
        logger.info(`    ${op.type}: ${JSON.stringify(op)}`);
      }
    }
  }

  // 5. Dry run check
  if (options.dryRun) {
    logger.info('Dry run - no changes made');
    return;
  }

  // 6. Run migrations
  spinner.start('Running migrations...');
  const runResult = await runMigrations(migrations, config.database);
  if (!runResult.success) {
    spinner.fail('Migration failed');
    logger.error(runResult.error.message);
    process.exit(1);
  }
  spinner.succeed('Migrations completed successfully');
}
```

### Generate Command (`src/cli/commands/generate.ts`)

**Purpose:** Generate schema or migration templates

```typescript
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger';
import { schemaTemplate, migrationTemplate } from '../utils/templates';

type GenerateType = 'schema' | 'migration';

interface GenerateOptions {
  readonly output?: string;
  readonly typescript?: boolean;
}

export async function generateCommand(
  type: GenerateType,
  name: string,
  options: GenerateOptions
): Promise<void> {
  if (!name) {
    logger.error('Name is required');
    logger.info(`Usage: forja generate ${type} <name>`);
    process.exit(1);
  }

  switch (type) {
    case 'schema':
      await generateSchema(name, options);
      break;
    case 'migration':
      await generateMigration(name, options);
      break;
    default:
      logger.error(`Unknown generate type: ${type}`);
      process.exit(1);
  }
}

async function generateSchema(name: string, options: GenerateOptions): Promise<void> {
  const filename = `${name.toLowerCase()}.schema.ts`;
  const outputPath = options.output ?? join(process.cwd(), 'schemas', filename);

  const content = schemaTemplate(name);

  try {
    await writeFile(outputPath, content, 'utf-8');
    logger.success(`Schema created: ${outputPath}`);
    logger.info('\nNext steps:');
    logger.info('1. Edit the schema to add fields');
    logger.info('2. Run: forja migrate');
  } catch (error) {
    logger.error('Failed to create schema:', error);
    process.exit(1);
  }
}

async function generateMigration(name: string, options: GenerateOptions): Promise<void> {
  const timestamp = Date.now();
  const filename = `${timestamp}-${name}.ts`;
  const outputPath = options.output ?? join(process.cwd(), 'migrations', filename);

  const content = migrationTemplate(name);

  try {
    await writeFile(outputPath, content, 'utf-8');
    logger.success(`Migration created: ${outputPath}`);
  } catch (error) {
    logger.error('Failed to create migration:', error);
    process.exit(1);
  }
}
```

### Dev Command (`src/cli/commands/dev.ts`)

**Purpose:** Watch for schema changes and auto-migrate

```typescript
import { watch } from 'fs/promises';
import { join } from 'path';
import { loadConfig } from '@core/config/loader';
import { migrateCommand } from './migrate';
import { logger } from '../utils/logger';

interface DevOptions {
  readonly config?: string;
  readonly verbose?: boolean;
}

export async function devCommand(options: DevOptions): Promise<void> {
  const configPath = options.config ?? './forja.config.ts';

  // Load config
  const configResult = await loadConfig(configPath);
  if (!configResult.success) {
    logger.error('Failed to load config:', configResult.error.message);
    process.exit(1);
  }
  const config = configResult.data;

  logger.info('🚀 Forja dev mode started');
  logger.info(`Watching: ${config.schemas.path}`);

  // Initial migration
  await migrateCommand({ config: configPath, verbose: options.verbose });

  // Watch for changes
  const schemasDir = join(process.cwd(), config.schemas.path.replace('/**/*.schema.ts', ''));

  try {
    const watcher = watch(schemasDir, { recursive: true });

    for await (const event of watcher) {
      if (event.filename?.endsWith('.schema.ts')) {
        logger.info(`\n📝 Schema changed: ${event.filename}`);
        logger.info('Running migrations...\n');

        await migrateCommand({ config: configPath, verbose: options.verbose });

        logger.info('\n✨ Ready for changes');
      }
    }
  } catch (error) {
    logger.error('Watch failed:', error);
    process.exit(1);
  }
}
```

### Init Command (`src/cli/commands/init.ts`)

**Purpose:** Initialize forja.config.ts

```typescript
import { writeFile, access } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger';
import { configTemplate } from '../utils/templates';

interface InitOptions {
  readonly force?: boolean;
  readonly database?: 'postgres' | 'mysql' | 'mongodb';
}

export async function initCommand(options: InitOptions): Promise<void> {
  const configPath = join(process.cwd(), 'forja.config.ts');

  // Check if config already exists
  try {
    await access(configPath);
    if (!options.force) {
      logger.error('forja.config.ts already exists');
      logger.info('Use --force to overwrite');
      process.exit(1);
    }
  } catch {
    // File doesn't exist, continue
  }

  // Prompt for database type if not specified
  const dbType = options.database ?? 'postgres';

  const content = configTemplate(dbType);

  try {
    await writeFile(configPath, content, 'utf-8');
    logger.success('Created forja.config.ts');
    logger.info('\nNext steps:');
    logger.info('1. Update database connection in forja.config.ts');
    logger.info('2. Create schemas in ./schemas/');
    logger.info('3. Run: forja migrate');
  } catch (error) {
    logger.error('Failed to create config:', error);
    process.exit(1);
  }
}
```

---

## 🛠️ Utility Modules

### Logger (`src/cli/utils/logger.ts`)

**Purpose:** Colored, formatted console output

```typescript
import { bold, green, red, yellow, blue, cyan } from './colors';

export const logger = {
  info(message: string, ...args: unknown[]): void {
    console.log(blue('ℹ'), message, ...args);
  },

  success(message: string, ...args: unknown[]): void {
    console.log(green('✔'), message, ...args);
  },

  warn(message: string, ...args: unknown[]): void {
    console.log(yellow('⚠'), message, ...args);
  },

  error(message: string, ...args: unknown[]): void {
    console.error(red('✖'), message, ...args);
  },

  debug(message: string, ...args: unknown[]): void {
    if (process.env.DEBUG) {
      console.log(cyan('🐛'), message, ...args);
    }
  }
};
```

### Spinner (`src/cli/utils/spinner.ts`)

**Purpose:** Progress indicators

```typescript
export class Spinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private interval: NodeJS.Timeout | null = null;
  private currentFrame = 0;
  private message = '';

  start(message: string): void {
    this.message = message;
    this.currentFrame = 0;

    this.interval = setInterval(() => {
      const frame = this.frames[this.currentFrame];
      process.stdout.write(`\r${cyan(frame ?? '')} ${this.message}`);
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
    }, 80);
  }

  succeed(message?: string): void {
    this.stop();
    console.log(green('✔'), message ?? this.message);
  }

  fail(message?: string): void {
    this.stop();
    console.log(red('✖'), message ?? this.message);
  }

  info(message: string): void {
    this.stop();
    console.log(blue('ℹ'), message);
  }

  private stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      process.stdout.write('\r\x1b[K'); // Clear line
    }
  }
}

export const spinner = new Spinner();
```

### Templates (`src/cli/utils/templates.ts`)

**Purpose:** Code templates for generation

```typescript
export function schemaTemplate(name: string): string {
  return `import { defineSchema } from 'forja';

export const ${name.toLowerCase()}Schema = defineSchema({
  name: '${name}',

  fields: {
    // Add your fields here
    // Example:
    // name: {
    //   type: 'string',
    //   required: true,
    //   minLength: 2,
    //   maxLength: 50
    // },
    // email: {
    //   type: 'string',
    //   required: true,
    //   unique: true,
    //   pattern: /^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$/
    // },
    // age: {
    //   type: 'number',
    //   min: 0,
    //   max: 120
    // }
  },

  indexes: [
    // Add indexes here
    // Example:
    // { fields: ['email'], unique: true }
  ]
} as const);

export type ${name} = typeof ${name.toLowerCase()}Schema['__type'];
`;
}

export function migrationTemplate(name: string): string {
  return `import type { Migration } from 'forja';

export const migration: Migration = {
  name: '${name}',

  up: async (adapter) => {
    // Write your migration here
    // Example:
    // await adapter.createTable({
    //   name: 'users',
    //   fields: {
    //     id: { type: 'string', required: true },
    //     email: { type: 'string', required: true, unique: true }
    //   }
    // });
  },

  down: async (adapter) => {
    // Write rollback logic here
    // Example:
    // await adapter.dropTable('users');
  }
};
`;
}

export function configTemplate(dbType: 'postgres' | 'mysql' | 'mongodb'): string {
  const connectionConfig = {
    postgres: `{
      host: 'localhost',
      port: 5432,
      database: 'myapp',
      user: 'postgres',
      password: 'password'
    }`,
    mysql: `{
      host: 'localhost',
      port: 3306,
      database: 'myapp',
      user: 'root',
      password: 'password'
    }`,
    mongodb: `{
      url: 'mongodb://localhost:27017/myapp'
    }`
  };

  return `import { defineConfig } from 'forja';

export default defineConfig({
  database: {
    adapter: '${dbType}',
    connection: ${connectionConfig[dbType]}
  },

  schemas: {
    path: './schemas/**/*.schema.ts'
  },

  plugins: [
    // 'auth',
    // 'upload',
    // 'hooks',
    // 'soft-delete'
  ],

  api: {
    prefix: '/api',
    defaultPageSize: 25,
    maxPageSize: 100
  }
});
`;
}
```

---

## ✅ Testing Requirements

### Tests Required:
1. Command parsing
2. Each command execution
3. Template generation
4. Error handling
5. File system operations

---

## 🎯 Implementation Priority

1. **Init Command** (Bootstrap new projects)
2. **Generate Command** (Schema templates)
3. **Migrate Command** (Core functionality)
4. **Dev Command** (Developer experience)

---

## 🔑 Key Principles

1. **User Friendly** - Clear messages, helpful errors
2. **Progress Indicators** - Show what's happening
3. **Fail Fast** - Validate early, fail with context
4. **Dry Run** - Allow preview of changes
5. **Verbose Mode** - Detailed output when needed

**Remember:** CLI is the first touchpoint for users. Make it delightful!
