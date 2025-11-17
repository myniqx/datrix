/**
 * Migration History Manager Implementation (~150 LOC)
 *
 * Manages migration execution history in the database.
 * Tracks which migrations have been applied and provides rollback support.
 */

import type { DatabaseAdapter } from '@adapters/base/types';
import type { Result } from '@utils/types';
import type {
  MigrationHistory,
  Migration,
  MigrationHistoryRecord,
  MigrationStatus
} from './types';
import { MigrationSystemError } from './types';
import { createHash } from 'crypto';

/**
 * Migration history manager implementation
 */
export class ForgeMigrationHistory implements MigrationHistory {
  private readonly adapter: DatabaseAdapter;
  private readonly tableName: string;
  private initialized = false;

  constructor(adapter: DatabaseAdapter, tableName = 'forja_migrations') {
    this.adapter = adapter;
    this.tableName = this.sanitizeIdentifier(tableName);
  }

  /**
   * Sanitize table name to prevent SQL injection
   */
  private sanitizeIdentifier(identifier: string): string {
    // Only allow alphanumeric, underscore, and must start with letter/underscore
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
      throw new Error(`Invalid table name: ${identifier}. Must match /^[a-zA-Z_][a-zA-Z0-9_]*$/`);
    }
    // PostgreSQL max identifier length
    if (identifier.length > 63) {
      throw new Error(`Table name too long: ${identifier}. Maximum 63 characters.`);
    }
    return identifier;
  }

  /**
   * Escape identifier for SQL (double-quote style)
   */
  private escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  /**
   * Initialize migrations tracking table
   */
  async initialize(): Promise<Result<void, MigrationSystemError>> {
    if (this.initialized) {
      return { success: true, data: undefined };
    }

    try {
      // Check if table exists
      const exists = await this.adapter.tableExists(this.tableName);

      if (!exists) {
        // Create migrations table (use escaped identifier)
        const escapedTable = this.escapeIdentifier(this.tableName);
        const sql = `
          CREATE TABLE ${escapedTable} (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            version VARCHAR(255) NOT NULL UNIQUE,
            applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            execution_time INTEGER NOT NULL,
            status VARCHAR(50) NOT NULL,
            checksum VARCHAR(64),
            error TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
          )
        `;

        const result = await this.adapter.executeRawQuery(sql, []);

        if (!result.success) {
          return {
            success: false,
            error: new MigrationSystemError(
              `Failed to create migrations table: ${result.error.message}`,
              'MIGRATION_ERROR',
              result.error
            )
          };
        }
      }

      this.initialized = true;
      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationSystemError(
          `Failed to initialize migration history: ${message}`,
          'MIGRATION_ERROR',
          error
        )
      };
    }
  }

  /**
   * Record migration execution
   */
  async record(
    migration: Migration,
    executionTime: number,
    status: MigrationStatus,
    error?: Error
  ): Promise<Result<void, MigrationSystemError>> {
    try {
      const checksum = this.calculateChecksum(migration);
      const errorMessage = error ? error.message : undefined;

      const escapedTable = this.escapeIdentifier(this.tableName);
      const sql = `
        INSERT INTO ${escapedTable} (name, version, execution_time, status, checksum, error)
        VALUES ($1, $2, $3, $4, $5, $6)
      `;

      const result = await this.adapter.executeRawQuery(sql, [
        migration.metadata.name,
        migration.metadata.version,
        executionTime,
        status,
        checksum,
        errorMessage
      ]);

      if (!result.success) {
        return {
          success: false,
          error: new MigrationSystemError(
            `Failed to record migration: ${result.error.message}`,
            'MIGRATION_ERROR',
            result.error
          )
        };
      }

      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationSystemError(
          `Failed to record migration: ${message}`,
          'MIGRATION_ERROR',
          error
        )
      };
    }
  }

  /**
   * Get all migration records
   */
  async getAll(): Promise<Result<readonly MigrationHistoryRecord[], MigrationSystemError>> {
    try {
      const escapedTable = this.escapeIdentifier(this.tableName);
      const sql = `
        SELECT id, name, version, applied_at, execution_time, status, checksum, error
        FROM ${escapedTable}
        ORDER BY applied_at ASC
      `;

      const result = await this.adapter.executeRawQuery<{
        id: number;
        name: string;
        version: string;
        applied_at: Date;
        execution_time: number;
        status: MigrationStatus;
        checksum: string | null;
        error: string | null;
      }>(sql, []);

      if (!result.success) {
        return {
          success: false,
          error: new MigrationSystemError(
            `Failed to get migration history: ${result.error.message}`,
            'MIGRATION_ERROR',
            result.error
          )
        };
      }

      const records: MigrationHistoryRecord[] = result.data.rows.map((row) => ({
        id: row.id,
        name: row.name,
        version: row.version,
        appliedAt: new Date(row.applied_at),
        executionTime: row.execution_time,
        status: row.status,
        ...(row.checksum !== null && { checksum: row.checksum }),
        ...(row.error !== null && { error: row.error })
      }));

      return { success: true, data: records };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationSystemError(
          `Failed to get migration history: ${message}`,
          'MIGRATION_ERROR',
          error
        )
      };
    }
  }

  /**
   * Get last applied migration
   */
  async getLast(): Promise<Result<MigrationHistoryRecord | undefined, MigrationSystemError>> {
    try {
      const escapedTable = this.escapeIdentifier(this.tableName);
      const sql = `
        SELECT id, name, version, applied_at, execution_time, status, checksum, error
        FROM ${escapedTable}
        WHERE status = 'completed'
        ORDER BY applied_at DESC
        LIMIT 1
      `;

      const result = await this.adapter.executeRawQuery<{
        id: number;
        name: string;
        version: string;
        applied_at: Date;
        execution_time: number;
        status: MigrationStatus;
        checksum: string | null;
        error: string | null;
      }>(sql, []);

      if (!result.success) {
        return {
          success: false,
          error: new MigrationSystemError(
            `Failed to get last migration: ${result.error.message}`,
            'MIGRATION_ERROR',
            result.error
          )
        };
      }

      if (result.data.rows.length === 0) {
        return { success: true, data: undefined };
      }

      const row = result.data.rows[0];
      if (!row) {
        return { success: true, data: undefined };
      }

      const record: MigrationHistoryRecord = {
        id: row.id,
        name: row.name,
        version: row.version,
        appliedAt: new Date(row.applied_at),
        executionTime: row.execution_time,
        status: row.status,
        ...(row.checksum !== null && { checksum: row.checksum }),
        ...(row.error !== null && { error: row.error })
      };

      return { success: true, data: record };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationSystemError(
          `Failed to get last migration: ${message}`,
          'MIGRATION_ERROR',
          error
        )
      };
    }
  }

  /**
   * Check if migration was applied
   */
  async isApplied(version: string): Promise<Result<boolean, MigrationSystemError>> {
    try {
      const escapedTable = this.escapeIdentifier(this.tableName);
      const sql = `
        SELECT COUNT(*) as count
        FROM ${escapedTable}
        WHERE version = $1 AND status = 'completed'
      `;

      const result = await this.adapter.executeRawQuery<{ count: number }>(
        sql,
        [version]
      );

      if (!result.success) {
        return {
          success: false,
          error: new MigrationSystemError(
            `Failed to check migration status: ${result.error.message}`,
            'MIGRATION_ERROR',
            result.error
          )
        };
      }

      const row = result.data.rows[0];
      const count = row ? row.count : 0;
      return { success: true, data: count > 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationSystemError(
          `Failed to check migration status: ${message}`,
          'MIGRATION_ERROR',
          error
        )
      };
    }
  }

  /**
   * Remove migration record (for rollback)
   */
  async remove(version: string): Promise<Result<void, MigrationSystemError>> {
    try {
      const escapedTable = this.escapeIdentifier(this.tableName);
      const sql = `
        DELETE FROM ${escapedTable}
        WHERE version = $1
      `;

      const result = await this.adapter.executeRawQuery(sql, [version]);

      if (!result.success) {
        return {
          success: false,
          error: new MigrationSystemError(
            `Failed to remove migration record: ${result.error.message}`,
            'MIGRATION_ERROR',
            result.error
          )
        };
      }

      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationSystemError(
          `Failed to remove migration record: ${message}`,
          'MIGRATION_ERROR',
          error
        )
      };
    }
  }

  /**
   * Calculate migration checksum
   */
  calculateChecksum(migration: Migration): string {
    const content = JSON.stringify({
      up: migration.up,
      down: migration.down
    });

    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Verify migration integrity
   */
  verifyChecksum(migration: Migration, record: MigrationHistoryRecord): boolean {
    if (!record.checksum) {
      return true; // No checksum to verify
    }

    const currentChecksum = this.calculateChecksum(migration);
    return currentChecksum === record.checksum;
  }
}

/**
 * Create migration history manager
 */
export function createMigrationHistory(
  adapter: DatabaseAdapter,
  tableName?: string
): MigrationHistory {
  return new ForgeMigrationHistory(adapter, tableName);
}
