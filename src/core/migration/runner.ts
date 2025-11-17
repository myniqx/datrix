/**
 * Migration Runner Implementation (~200 LOC)
 *
 * Executes migrations, handles rollbacks, and manages migration plans.
 */

import type { DatabaseAdapter } from '@adapters/base/types';
import type { Result } from '@utils/types';
import type {
  MigrationRunner,
  Migration,
  MigrationHistory,
  MigrationHistoryRecord,
  MigrationExecutionResult,
  MigrationPlan,
  MigrationDirection,
  MigrationOperation
} from './types';
import { MigrationSystemError } from './types';

/**
 * Migration runner implementation
 */
export class ForgeMigrationRunner implements MigrationRunner {
  private readonly adapter: DatabaseAdapter;
  private readonly history: MigrationHistory;
  private readonly migrations: readonly Migration[];

  constructor(
    adapter: DatabaseAdapter,
    history: MigrationHistory,
    migrations: readonly Migration[]
  ) {
    this.adapter = adapter;
    this.history = history;
    this.migrations = migrations;
  }

  /**
   * Escape SQL identifier to prevent injection
   */
  private escapeIdentifier(identifier: string): string {
    // Validate identifier format
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
      throw new Error(`Invalid identifier: ${identifier}`);
    }
    if (identifier.length > 63) {
      throw new Error(`Identifier too long: ${identifier}`);
    }
    // PostgreSQL double-quote escaping
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  /**
   * Get pending migrations
   */
  async getPending(): Promise<Result<readonly Migration[], MigrationSystemError>> {
    try {
      // Initialize history table
      const initResult = await this.history.initialize();
      if (!initResult.success) {
        return { success: false, error: initResult.error };
      }

      // Get applied migrations
      const appliedResult = await this.history.getAll();
      if (!appliedResult.success) {
        return { success: false, error: appliedResult.error };
      }

      const appliedVersions = new Set(
        appliedResult.data
          .filter((record) => record.status === 'completed')
          .map((record) => record.version)
      );

      // Filter pending migrations
      const pending = this.migrations.filter(
        (migration) => !appliedVersions.has(migration.metadata.version)
      );

      return { success: true, data: pending };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationSystemError(
          `Failed to get pending migrations: ${message}`,
          'MIGRATION_ERROR',
          error
        )
      };
    }
  }

  /**
   * Get applied migrations
   */
  async getApplied(): Promise<Result<readonly MigrationHistoryRecord[], MigrationSystemError>> {
    try {
      const initResult = await this.history.initialize();
      if (!initResult.success) {
        return { success: false, error: initResult.error };
      }

      return await this.history.getAll();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationSystemError(
          `Failed to get applied migrations: ${message}`,
          'MIGRATION_ERROR',
          error
        )
      };
    }
  }

  /**
   * Run pending migrations
   */
  async runPending(options?: {
    readonly target?: string;
    readonly dryRun?: boolean;
  }): Promise<Result<readonly MigrationExecutionResult[], MigrationSystemError>> {
    try {
      const pendingResult = await this.getPending();
      if (!pendingResult.success) {
        return { success: false, error: pendingResult.error };
      }

      let migrationsToRun = pendingResult.data;

      // Filter by target version if specified
      if (options?.target) {
        const targetIndex = migrationsToRun.findIndex(
          (m) => m.metadata.version === options.target
        );

        if (targetIndex === -1) {
          return {
            success: false,
            error: new MigrationSystemError(
              `Target version ${options.target} not found`,
              'MIGRATION_ERROR'
            )
          };
        }

        migrationsToRun = migrationsToRun.slice(0, targetIndex + 1);
      }

      const results: MigrationExecutionResult[] = [];

      for (const migration of migrationsToRun) {
        const result = await this.runOne(migration, 'up');

        if (!result.success) {
          return { success: false, error: result.error };
        }

        results.push(result.data);

        // Stop on failure
        if (result.data.status === 'failed') {
          break;
        }
      }

      return { success: true, data: results };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationSystemError(
          `Failed to run pending migrations: ${message}`,
          'MIGRATION_ERROR',
          error
        )
      };
    }
  }

  /**
   * Run specific migration
   */
  async runOne(
    migration: Migration,
    direction: MigrationDirection
  ): Promise<Result<MigrationExecutionResult, MigrationSystemError>> {
    const startTime = Date.now();

    try {
      // Begin transaction
      const txResult = await this.adapter.beginTransaction();
      if (!txResult.success) {
        return {
          success: false,
          error: new MigrationSystemError(
            `Failed to begin transaction: ${txResult.error.message}`,
            'MIGRATION_ERROR',
            txResult.error
          )
        };
      }

      const tx = txResult.data;
      const operations = direction === 'up' ? migration.up : migration.down;

      try {
        // Execute all operations
        for (const operation of operations) {
          const opResult = await this.executeOperation(operation);

          if (!opResult.success) {
            // Rollback transaction
            await tx.rollback();

            const executionTime = Date.now() - startTime;

            // Record failure
            await this.history.record(
              migration,
              executionTime,
              'failed',
              opResult.error
            );

            return {
              success: true,
              data: {
                migration,
                status: 'failed',
                executionTime,
                error: opResult.error
              }
            };
          }
        }

        // Commit transaction
        const commitResult = await tx.commit();
        if (!commitResult.success) {
          const executionTime = Date.now() - startTime;

          return {
            success: true,
            data: {
              migration,
              status: 'failed',
              executionTime,
              error: commitResult.error
            }
          };
        }

        const executionTime = Date.now() - startTime;

        // Record success
        const recordStatus = direction === 'up' ? 'completed' : 'rolled_back';
        const recordResult = await this.history.record(migration, executionTime, recordStatus);

        // Log warning if recording fails, but don't fail the migration
        if (!recordResult.success) {
          console.warn('Failed to record migration history:', recordResult.error.message);
        }

        return {
          success: true,
          data: {
            migration,
            status: recordStatus,
            executionTime
          }
        };
      } catch (error) {
        // Rollback on error
        await tx.rollback();

        const executionTime = Date.now() - startTime;
        const err = error instanceof Error ? error : new Error(String(error));

        const recordResult = await this.history.record(migration, executionTime, 'failed', err);
        if (!recordResult.success) {
          console.warn('Failed to record migration failure:', recordResult.error.message);
        }

        return {
          success: true,
          data: {
            migration,
            status: 'failed',
            executionTime,
            error: err
          }
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        error: new MigrationSystemError(
          `Failed to run migration: ${message}`,
          'MIGRATION_ERROR',
          error
        )
      };
    }
  }

  /**
   * Rollback last migration
   */
  async rollbackLast(): Promise<Result<MigrationExecutionResult, MigrationSystemError>> {
    try {
      const lastResult = await this.history.getLast();
      if (!lastResult.success) {
        return { success: false, error: lastResult.error };
      }

      if (!lastResult.data) {
        return {
          success: false,
          error: new MigrationSystemError(
            'No migrations to rollback',
            'MIGRATION_ERROR'
          )
        };
      }

      const lastRecord = lastResult.data;

      // Find migration
      const migration = this.migrations.find(
        (m) => m.metadata.version === lastRecord.version
      );

      if (!migration) {
        return {
          success: false,
          error: new MigrationSystemError(
            `Migration ${lastRecord.version} not found`,
            'MIGRATION_ERROR'
          )
        };
      }

      // Run down migration
      const result = await this.runOne(migration, 'down');
      if (!result.success) {
        return result;
      }

      // Remove from history if successful
      if (result.data.status !== 'failed') {
        const removeResult = await this.history.remove(migration.metadata.version);
        if (!removeResult.success) {
          console.warn('Failed to remove migration from history:', removeResult.error.message);
        }
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationSystemError(
          `Failed to rollback migration: ${message}`,
          'MIGRATION_ERROR',
          error
        )
      };
    }
  }

  /**
   * Rollback to specific version
   */
  async rollbackTo(
    version: string
  ): Promise<Result<readonly MigrationExecutionResult[], MigrationSystemError>> {
    try {
      const appliedResult = await this.history.getAll();
      if (!appliedResult.success) {
        return { success: false, error: appliedResult.error };
      }

      const applied = appliedResult.data.filter(
        (record) => record.status === 'completed'
      );

      // Find target version index
      const targetIndex = applied.findIndex((record) => record.version === version);

      if (targetIndex === -1) {
        return {
          success: false,
          error: new MigrationSystemError(
            `Target version ${version} not found in migration history`,
            'MIGRATION_ERROR'
          )
        };
      }

      // Get migrations to rollback (in reverse order)
      const toRollback = applied.slice(targetIndex + 1).reverse();

      const results: MigrationExecutionResult[] = [];

      for (const record of toRollback) {
        const migration = this.migrations.find(
          (m) => m.metadata.version === record.version
        );

        if (!migration) {
          return {
            success: false,
            error: new MigrationSystemError(
              `Migration ${record.version} not found`,
              'MIGRATION_ERROR'
            )
          };
        }

        const result = await this.runOne(migration, 'down');
        if (!result.success) {
          return { success: false, error: result.error };
        }

        results.push(result.data);

        // Remove from history if successful
        if (result.data.status !== 'failed') {
          const removeResult = await this.history.remove(migration.metadata.version);
          if (!removeResult.success) {
            console.warn('Failed to remove migration from history:', removeResult.error.message);
          }
        } else {
          break; // Stop on failure
        }
      }

      return { success: true, data: results };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationSystemError(
          `Failed to rollback to version ${version}: ${message}`,
          'MIGRATION_ERROR',
          error
        )
      };
    }
  }

  /**
   * Get migration plan
   */
  getPlan(options?: {
    readonly target?: string;
    readonly direction?: MigrationDirection;
  }): Result<MigrationPlan, MigrationSystemError> {
    try {
      const direction = options?.direction ?? 'up';
      let migrations = [...this.migrations];

      if (options?.target) {
        const targetIndex = migrations.findIndex(
          (m) => m.metadata.version === options.target
        );

        if (targetIndex === -1) {
          return {
            success: false,
            error: new MigrationSystemError(
              `Target version ${options.target} not found`,
              'MIGRATION_ERROR'
            )
          };
        }

        migrations = migrations.slice(0, targetIndex + 1);
      }

      if (direction === 'down') {
        migrations = migrations.reverse();
      }

      return {
        success: true,
        data: {
          migrations,
          direction,
          ...(options?.target !== undefined && { target: options.target })
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationSystemError(
          `Failed to create migration plan: ${message}`,
          'MIGRATION_ERROR',
          error
        )
      };
    }
  }

  /**
   * Execute a single migration operation
   */
  private async executeOperation(
    operation: MigrationOperation
  ): Promise<Result<void, Error>> {
    switch (operation.type) {
      case 'createTable':
        return await this.adapter.createTable(operation.schema);

      case 'dropTable':
        return await this.adapter.dropTable(operation.tableName);

      case 'alterTable':
        return await this.adapter.alterTable(
          operation.tableName,
          operation.operations
        );

      case 'createIndex':
        return await this.adapter.addIndex(operation.tableName, operation.index);

      case 'dropIndex':
        return await this.adapter.dropIndex(
          operation.tableName,
          operation.indexName
        );

      case 'renameTable':
        // Use raw SQL for table rename (not in base adapter interface)
        // Escape identifiers to prevent SQL injection
        try {
          const fromTable = this.escapeIdentifier(operation.from);
          const toTable = this.escapeIdentifier(operation.to);

          return await this.adapter.executeRawQuery(
            `ALTER TABLE ${fromTable} RENAME TO ${toTable}`,
            []
          ).then((result) => {
            if (result.success) {
              return { success: true, data: undefined };
            }
            return { success: false, error: result.error };
          });
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          return { success: false, error: err };
        }

      case 'raw':
        return await this.adapter.executeRawQuery(
          operation.sql,
          operation.params ?? []
        ).then((result) => {
          if (result.success) {
            return { success: true, data: undefined };
          }
          return { success: false, error: result.error };
        });
    }
  }
}

/**
 * Create migration runner
 */
export function createMigrationRunner(
  adapter: DatabaseAdapter,
  history: MigrationHistory,
  migrations: readonly Migration[]
): MigrationRunner {
  return new ForgeMigrationRunner(adapter, history, migrations);
}
