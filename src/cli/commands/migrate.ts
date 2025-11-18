/**
 * Migrate Command Implementation (~250 LOC)
 *
 * Runs database migrations with support for:
 * - Running pending migrations
 * - Rolling back migrations (--down)
 * - Migrating to specific version (--to)
 * - Dry-run mode (--dry-run)
 */

import type { Result } from '@utils/types';
import type { Migration, MigrationRunner } from '@core/migration/types';
import type { MigrateCommandOptions } from '../types';
import { CLIError } from '../types';
import { logger, spinner, formatError, printTable } from '../utils/logger';

/**
 * Load migrations from directory (currently unused - placeholder for future use)
 */
// async function loadMigrations(
//   migrationsDir: string
// ): Promise<Result<readonly Migration[], CLIError>> {
//   try {
//     // Check if directory exists
//     let files: readonly string[];
//     try {
//       files = await readdir(migrationsDir);
//     } catch {
//       // Directory doesn't exist - no migrations
//       return { success: true, data: [] };
//     }

//     // Filter migration files
//     const migrationFiles = files
//       .filter((file): boolean => file.endsWith('.ts') || file.endsWith('.js'))
//       .sort(); // Sort by timestamp (filename)

//     // Load each migration
//     const migrations: Migration[] = [];

//     for (const file of migrationFiles) {
//       const filePath = join(migrationsDir, file);

//       try {
//         // Dynamic import
//         const module = await import(filePath);
//         const migration = module.migration as Migration | undefined;

//         if (!migration) {
//           logger.warn(`File ${file} does not export 'migration'`);
//           continue;
//         }

//         // Validate migration structure
//         if (!migration.metadata || !migration.up || !migration.down) {
//           logger.warn(`File ${file} has invalid migration structure`);
//           continue;
//         }

//         migrations.push(migration);
//       } catch (error) {
//         logger.warn(`Failed to load migration ${file}:`, formatError(error));
//       }
//     }

//     return { success: true, data: migrations };
//   } catch (error) {
//     return {
//       success: false,
//       error: new CLIError(
//         `Failed to load migrations: ${formatError(error)}`,
//         'FILE_ERROR',
//         error
//       ),
//     };
//   }
// }

/**
 * Display migration list
 */
function displayMigrations(
  migrations: readonly Migration[],
  verbose: boolean
): void {
  if (migrations.length === 0) {
    logger.info('No migrations found');
    return;
  }

  logger.log('');
  logger.log('Migrations to apply:');
  logger.log('');

  for (const migration of migrations) {
    const timestamp = new Date(migration.metadata.timestamp).toISOString();
    logger.info(`  ${migration.metadata.name} (${timestamp})`);

    if (verbose && migration.metadata.description) {
      logger.log(`    Description: ${migration.metadata.description}`);
    }

    if (verbose) {
      logger.log(`    Operations: ${migration.up.length} up, ${migration.down.length} down`);
    }
  }

  logger.log('');
}

/**
 * Display migration results
 */
function displayResults(
  results: readonly {
    readonly migration: Migration;
    readonly status: string;
    readonly executionTime: number;
    readonly error?: Error | undefined;
  }[]
): void {
  logger.log('');
  logger.log('Migration Results:');
  logger.log('');

  const rows: (readonly string[])[] = [
    ['Migration', 'Status', 'Time (ms)'] as const,
  ];

  for (const result of results) {
    const status = result.status === 'completed' ? '✔ Success' : '✖ Failed';
    rows.push([
      result.migration.metadata.name,
      status,
      result.executionTime.toString(),
    ] as const);
  }

  printTable(rows);

  // Display errors
  const failed = results.filter((r): boolean => r.status === 'failed');
  if (failed.length > 0) {
    logger.log('');
    logger.error('Failed migrations:');
    for (const result of failed) {
      logger.error(`  ${result.migration.metadata.name}: ${formatError(result.error)}`);
    }
  }
}

/**
 * Run pending migrations
 */
async function runPendingMigrations(
  runner: MigrationRunner,
  options: MigrateCommandOptions
): Promise<Result<void, CLIError>> {
  // Get pending migrations
  spinner.start('Checking pending migrations...');
  const pendingResult = await runner.getPending();

  if (!pendingResult.success) {
    spinner.fail('Failed to get pending migrations');
    return {
      success: false,
      error: new CLIError(
        formatError(pendingResult.error),
        'EXECUTION_ERROR',
        pendingResult.error
      ),
    };
  }

  const pending = pendingResult.data;

  if (pending.length === 0) {
    spinner.info('No pending migrations');
    return { success: true, data: undefined };
  }

  spinner.succeed(`Found ${pending.length} pending migration(s)`);

  // Display migrations
  displayMigrations(pending, options.verbose ?? false);

  // Dry run check
  if (options.dryRun) {
    logger.info('Dry run - no changes applied');
    return { success: true, data: undefined };
  }

  // Run migrations
  spinner.start('Running migrations...');

  const runOptions =
    options.to !== undefined
      ? { target: options.to, dryRun: false as const }
      : { dryRun: false as const };

  const runResult = await runner.runPending(runOptions);

  if (!runResult.success) {
    spinner.fail('Migration failed');
    return {
      success: false,
      error: new CLIError(
        formatError(runResult.error),
        'EXECUTION_ERROR',
        runResult.error
      ),
    };
  }

  spinner.succeed('Migrations completed');

  // Display results
  displayResults(runResult.data);

  return { success: true, data: undefined };
}

/**
 * Rollback migrations
 */
async function rollbackMigrations(
  runner: MigrationRunner,
  options: MigrateCommandOptions
): Promise<Result<void, CLIError>> {
  if (options.to) {
    // Rollback to specific version
    spinner.start(`Rolling back to version ${options.to}...`);

    const rollbackResult = await runner.rollbackTo(options.to);

    if (!rollbackResult.success) {
      spinner.fail('Rollback failed');
      return {
        success: false,
        error: new CLIError(
          formatError(rollbackResult.error),
          'EXECUTION_ERROR',
          rollbackResult.error
        ),
      };
    }

    spinner.succeed('Rollback completed');
    displayResults(rollbackResult.data);
  } else {
    // Rollback last migration
    spinner.start('Rolling back last migration...');

    const rollbackResult = await runner.rollbackLast();

    if (!rollbackResult.success) {
      spinner.fail('Rollback failed');
      return {
        success: false,
        error: new CLIError(
          formatError(rollbackResult.error),
          'EXECUTION_ERROR',
          rollbackResult.error
        ),
      };
    }

    spinner.succeed('Rollback completed');
    displayResults([rollbackResult.data]);
  }

  return { success: true, data: undefined };
}

/**
 * Migrate command handler
 */
export async function migrateCommand(
  options: MigrateCommandOptions,
  runner: MigrationRunner
): Promise<Result<void, CLIError>> {
  try {
    logger.log('');
    logger.info('Forja Migration Tool');
    logger.log('');

    // Run or rollback
    if (options.down) {
      return await rollbackMigrations(runner, options);
    } else {
      return await runPendingMigrations(runner, options);
    }
  } catch (error) {
    return {
      success: false,
      error: new CLIError(
        `Migration command failed: ${formatError(error)}`,
        'EXECUTION_ERROR',
        error
      ),
    };
  }
}

/**
 * Display migration status
 */
export async function displayMigrationStatus(
  runner: MigrationRunner
): Promise<Result<void, CLIError>> {
  try {
    spinner.start('Loading migration status...');

    // Get applied migrations
    const appliedResult = await runner.getApplied();
    if (!appliedResult.success) {
      spinner.fail('Failed to load migration status');
      return {
        success: false,
        error: new CLIError(
          formatError(appliedResult.error),
          'EXECUTION_ERROR',
          appliedResult.error
        ),
      };
    }

    // Get pending migrations
    const pendingResult = await runner.getPending();
    if (!pendingResult.success) {
      spinner.fail('Failed to load migration status');
      return {
        success: false,
        error: new CLIError(
          formatError(pendingResult.error),
          'EXECUTION_ERROR',
          pendingResult.error
        ),
      };
    }

    spinner.succeed('Migration status loaded');

    const applied = appliedResult.data;
    const pending = pendingResult.data;

    logger.log('');
    logger.log('Migration Status:');
    logger.log('');

    logger.info(`Applied: ${applied.length} migration(s)`);
    logger.info(`Pending: ${pending.length} migration(s)`);

    if (applied.length > 0) {
      logger.log('');
      logger.log('Applied migrations:');
      const appliedRows: (readonly string[])[] = [
        ['Version', 'Name', 'Applied At'] as const,
      ];

      for (const record of applied) {
        appliedRows.push([
          record.version,
          record.name,
          record.appliedAt.toISOString(),
        ] as const);
      }

      printTable(appliedRows);
    }

    if (pending.length > 0) {
      logger.log('');
      logger.log('Pending migrations:');
      for (const migration of pending) {
        logger.info(`  ${migration.metadata.name}`);
      }
    }

    logger.log('');

    return { success: true, data: undefined };
  } catch (error) {
    return {
      success: false,
      error: new CLIError(
        `Failed to display migration status: ${formatError(error)}`,
        'EXECUTION_ERROR',
        error
      ),
    };
  }
}
