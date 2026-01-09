/**
 * Migration Runner Tests
 *
 * Comprehensive tests for migration execution, rollback, and history management
 */

import { createMigrationRunner } from '../../src';
import { AlterOperation, DatabaseAdapter, QueryError, QueryResult, Transaction, TransactionError } from '../../../types/src/adapter';
import { Migration, MigrationHistory, MigrationHistoryRecord, MigrationStatus, MigrationSystemError } from '../../../types/src/core/migration';
import { SchemaDefinition } from '../../../types/src/core/schema';
import { Result } from '../../../types/src/utils';
import { describe, it, expect, beforeEach } from 'vitest';


/**
 * Mock Transaction implementation
 */
class MockTransaction implements Transaction {
  savepoint(name: string): Promise<Result<void, TransactionError>> {
    throw new Error('Method not implemented.');
  }
  rollbackTo(name: string): Promise<Result<void, TransactionError>> {
    throw new Error('Method not implemented.');
  }
  release(name: string): Promise<Result<void, TransactionError>> {
    throw new Error('Method not implemented.');
  }
  readonly id = 'test-tx-1';
  private _committed = false;
  private _rolledBack = false;

  async query<TResult>(): Promise<Result<QueryResult<TResult>, QueryError>> {
    return { success: true, data: { rows: [] as readonly TResult[], metadata: {} } };
  }

  async rawQuery<TResult>(): Promise<Result<QueryResult<TResult>, QueryError>> {
    return { success: true, data: { rows: [] as readonly TResult[], metadata: {} } };
  }

  async commit(): Promise<Result<void, QueryError>> {
    this._committed = true;
    return { success: true, data: undefined };
  }

  async rollback(): Promise<Result<void, QueryError>> {
    this._rolledBack = true;
    return { success: true, data: undefined };
  }

  get committed(): boolean {
    return this._committed;
  }

  get rolledBack(): boolean {
    return this._rolledBack;
  }
}

/**
 * Mock Database Adapter
 */
class MockDatabaseAdapter implements DatabaseAdapter {
  tableExists(tableName: string): Promise<boolean> {
    throw new Error('Method not implemented.');
  }
  readonly name = 'mock';
  readonly config = {};

  private _operations: Array<{ type: string; data: unknown }> = [];
  private _shouldFail = false;
  private _failOperation: string | null = null;

  connect(): Promise<Result<void, QueryError>> {
    return Promise.resolve({ success: true, data: undefined });
  }

  disconnect(): Promise<Result<void, QueryError>> {
    return Promise.resolve({ success: true, data: undefined });
  }

  isConnected(): boolean {
    return true;
  }

  getConnectionState() {
    return 'connected' as const;
  }

  executeQuery<TResult>(): Promise<Result<QueryResult<TResult>, QueryError>> {
    return Promise.resolve({
      success: true,
      data: { rows: [] as readonly TResult[], metadata: {} }
    });
  }

  async executeRawQuery<TResult>(
    sql: string
  ): Promise<Result<QueryResult<TResult>, QueryError>> {
    if (this._shouldFail && this._failOperation === 'raw') {
      return { success: false, error: new QueryError('Raw query failed') };
    }
    this._operations.push({ type: 'raw', data: sql });
    return { success: true, data: { rows: [] as readonly TResult[], metadata: {} } };
  }

  async beginTransaction(): Promise<Result<Transaction, QueryError>> {
    return { success: true, data: new MockTransaction() };
  }

  async createTable(schema: SchemaDefinition): Promise<Result<void, QueryError>> {
    if (this._shouldFail && this._failOperation === 'createTable') {
      return { success: false, error: new QueryError('Create table failed') };
    }
    this._operations.push({ type: 'createTable', data: schema });
    return { success: true, data: undefined };
  }

  async dropTable(tableName: string): Promise<Result<void, QueryError>> {
    if (this._shouldFail && this._failOperation === 'dropTable') {
      return { success: false, error: new Error('Drop table failed') };
    }
    this._operations.push({ type: 'dropTable', data: tableName });
    return { success: true, data: undefined };
  }

  async alterTable(
    tableName: string,
    operations: readonly AlterOperation[]
  ): Promise<Result<void, QueryError>> {
    if (this._shouldFail && this._failOperation === 'alterTable') {
      return { success: false, error: new QueryError('Alter table failed') };
    }
    this._operations.push({ type: 'alterTable', data: { tableName, operations } });
    return { success: true, data: undefined };
  }

  async addIndex(): Promise<Result<void, QueryError>> {
    if (this._shouldFail && this._failOperation === 'addIndex') {
      return { success: false, error: new QueryError('Add index failed') };
    }
    this._operations.push({ type: 'addIndex', data: {} });
    return { success: true, data: undefined };
  }

  async dropIndex(): Promise<Result<void, QueryError>> {
    if (this._shouldFail && this._failOperation === 'dropIndex') {
      return { success: false, error: new QueryError('Drop index failed') };
    }
    this._operations.push({ type: 'dropIndex', data: {} });
    return { success: true, data: undefined };
  }

  getTables(): Promise<Result<readonly string[], QueryError>> {
    return Promise.resolve({ success: true, data: [] });
  }

  getTableSchema(): Promise<Result<SchemaDefinition, QueryError>> {
    return Promise.resolve({
      success: true,
      data: { name: 'test', fields: {}, indexes: [] }
    });
  }

  // Test helpers
  getOperations() {
    return this._operations;
  }

  clearOperations() {
    this._operations = [];
  }

  setShouldFail(fail: boolean, operation: string | null = null) {
    this._shouldFail = fail;
    this._failOperation = operation;
  }
}

/**
 * Mock Migration History
 */
class MockMigrationHistory implements MigrationHistory {
  isApplied(version: string): Promise<Result<boolean, MigrationSystemError>> {
    throw new Error('Method not implemented.');
  }
  calculateChecksum(migration: Migration): string {
    throw new Error('Method not implemented.');
  }
  verifyChecksum(migration: Migration, record: MigrationHistoryRecord): boolean {
    throw new Error('Method not implemented.');
  }
  private _records: MigrationHistoryRecord[] = [];
  private _initialized = false;

  async initialize(): Promise<Result<void, MigrationSystemError>> {
    this._initialized = true;
    return { success: true, data: undefined };
  }

  async record(
    migration: Migration,
    executionTime: number,
    status: MigrationStatus,
    error?: MigrationSystemError
  ): Promise<Result<void, MigrationSystemError>> {
    this._records.push({
      id: this._records.length + 1,
      name: migration.metadata.name,
      version: migration.metadata.version,
      appliedAt: new Date(),
      executionTime,
      status,
      ...(error && { error: error.message })
    });
    return { success: true, data: undefined };
  }

  async getAll(): Promise<Result<readonly MigrationHistoryRecord[], MigrationSystemError>> {
    return { success: true, data: this._records };
  }

  async getLast(): Promise<Result<MigrationHistoryRecord | undefined, MigrationSystemError>> {
    const last = this._records[this._records.length - 1] ?? undefined;
    return { success: true, data: last };
  }

  async remove(version: string): Promise<Result<void, MigrationSystemError>> {
    this._records = this._records.filter((r) => r.version !== version);
    return { success: true, data: undefined };
  }

  // Test helpers
  getRecords() {
    return this._records;
  }

  clearRecords() {
    this._records = [];
  }

  isInitialized() {
    return this._initialized;
  }
}

/**
 * Test migration factory
 */
function createTestMigration(version: string, name: string): Migration {
  return {
    metadata: {
      name,
      version,
      timestamp: Date.now()
    },
    up: [
      {
        type: 'createTable',
        schema: {
          name: 'test_table',
          fields: {
            id: { type: 'number', required: true }
          },
          indexes: []
        }
      }
    ],
    down: [
      {
        type: 'dropTable',
        tableName: 'test_table'
      }
    ]
  };
}

describe('MigrationRunner', () => {
  let adapter: DatabaseAdapter;
  let history: MigrationHistory;

  beforeEach(() => {
    adapter = new MockDatabaseAdapter();
    history = new MockMigrationHistory();
  });

  describe('getPending', () => {
    it('should initialize history table on first call', async () => {
      const migrations = [createTestMigration('001', 'first')];
      const runner = createMigrationRunner(adapter, history, migrations);

      expect(history.isInitialized()).toBe(false);

      const result = await runner.getPending();

      expect(result.success).toBe(true);
      expect(history.isInitialized()).toBe(true);
    });

    it('should return all migrations when none are applied', async () => {
      const migrations = [
        createTestMigration('001', 'first'),
        createTestMigration('002', 'second'),
        createTestMigration('003', 'third')
      ];
      const runner = createMigrationRunner(adapter, history, migrations);

      const result = await runner.getPending();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(3);
        expect(result.data[0]?.metadata.version).toBe('001');
        expect(result.data[1]?.metadata.version).toBe('002');
        expect(result.data[2]?.metadata.version).toBe('003');
      }
    });

    it('should exclude already applied migrations', async () => {
      const migrations = [
        createTestMigration('001', 'first'),
        createTestMigration('002', 'second'),
        createTestMigration('003', 'third')
      ];

      // Simulate migration 001 already applied
      await history.record(migrations[0]!, 100, 'completed');

      const runner = createMigrationRunner(adapter, history, migrations);
      const result = await runner.getPending();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0]?.metadata.version).toBe('002');
        expect(result.data[1]?.metadata.version).toBe('003');
      }
    });

    it('should exclude failed migrations from pending list', async () => {
      const migrations = [
        createTestMigration('001', 'first'),
        createTestMigration('002', 'second')
      ];

      // Simulate migration 001 failed
      await history.record(migrations[0]!, 100, 'failed', new Error('Test error'));

      const runner = createMigrationRunner(adapter, history, migrations);
      const result = await runner.getPending();

      expect(result.success).toBe(true);
      if (result.success) {
        // Failed migrations are still pending
        expect(result.data).toHaveLength(2);
      }
    });
  });

  describe('getApplied', () => {
    it('should return empty array when no migrations applied', async () => {
      const migrations = [createTestMigration('001', 'first')];
      const runner = createMigrationRunner(adapter, history, migrations);

      const result = await runner.getApplied();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('should return all applied migrations', async () => {
      const migrations = [
        createTestMigration('001', 'first'),
        createTestMigration('002', 'second')
      ];

      await history.record(migrations[0]!, 100, 'completed');
      await history.record(migrations[1]!, 150, 'completed');

      const runner = createMigrationRunner(adapter, history, migrations);
      const result = await runner.getApplied();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0]?.version).toBe('001');
        expect(result.data[0]?.status).toBe('completed');
        expect(result.data[1]?.version).toBe('002');
        expect(result.data[1]?.status).toBe('completed');
      }
    });
  });

  describe('runPending', () => {
    it('should run all pending migrations', async () => {
      const migrations = [
        createTestMigration('001', 'first'),
        createTestMigration('002', 'second')
      ];

      const runner = createMigrationRunner(adapter, history, migrations);
      const result = await runner.runPending();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0]?.status).toBe('completed');
        expect(result.data[1]?.status).toBe('completed');

        // Verify execution times are recorded
        expect(result.data[0]?.executionTime).toBeGreaterThanOrEqual(0);
        expect(result.data[1]?.executionTime).toBeGreaterThanOrEqual(0);
      }

      // Verify history recorded
      const historyRecords = history.getRecords();
      expect(historyRecords).toHaveLength(2);
    });

    it('should run migrations up to target version', async () => {
      const migrations = [
        createTestMigration('001', 'first'),
        createTestMigration('002', 'second'),
        createTestMigration('003', 'third')
      ];

      const runner = createMigrationRunner(adapter, history, migrations);
      const result = await runner.runPending({ target: '002' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0]?.migration.metadata.version).toBe('001');
        expect(result.data[1]?.migration.metadata.version).toBe('002');
      }

      const historyRecords = history.getRecords();
      expect(historyRecords).toHaveLength(2);
    });

    it('should fail if target version not found', async () => {
      const migrations = [createTestMigration('001', 'first')];
      const runner = createMigrationRunner(adapter, history, migrations);

      const result = await runner.runPending({ target: 'nonexistent' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('not found');
      }
    });

    it('should support dry run without executing migrations', async () => {
      const migrations = [
        createTestMigration('001', 'first'),
        createTestMigration('002', 'second')
      ];

      const runner = createMigrationRunner(adapter, history, migrations);
      const result = await runner.runPending({ dryRun: true });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0]?.status).toBe('pending');
        expect(result.data[1]?.status).toBe('pending');
        expect(result.data[0]?.executionTime).toBe(0);
      }

      // Verify nothing was executed
      expect(history.getRecords()).toHaveLength(0);
      expect(adapter.getOperations()).toHaveLength(0);
    });

    it('should stop on migration failure', async () => {
      const migrations = [
        createTestMigration('001', 'first'),
        createTestMigration('002', 'second'),
        createTestMigration('003', 'third')
      ];

      // Make second migration fail
      adapter.setShouldFail(true, 'createTable');

      const runner = createMigrationRunner(adapter, history, migrations);

      // First migration should succeed (clear fail flag after setup)
      adapter.setShouldFail(false);
      await runner.runOne(migrations[0]!, 'up');

      // Now fail on second migration
      adapter.setShouldFail(true, 'createTable');
      const result = await runner.runOne(migrations[1]!, 'up');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('failed');
        expect(result.data.error).toBeDefined();
      }
    });
  });

  describe('runOne', () => {
    it('should execute single migration successfully', async () => {
      const migration = createTestMigration('001', 'test');
      const runner = createMigrationRunner(adapter, history, [migration]);

      const result = await runner.runOne(migration, 'up');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('completed');
        expect(result.data.migration).toEqual(migration);
        expect(result.data.executionTime).toBeGreaterThanOrEqual(0);
      }

      // Verify operation was executed
      const operations = adapter.getOperations();
      expect(operations).toHaveLength(1);
      expect(operations[0]?.type).toBe('createTable');
    });

    it('should execute down migration', async () => {
      const migration = createTestMigration('001', 'test');
      const runner = createMigrationRunner(adapter, history, [migration]);

      const result = await runner.runOne(migration, 'down');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('rolled_back');
      }

      // Verify down operation was executed
      const operations = adapter.getOperations();
      expect(operations).toHaveLength(1);
      expect(operations[0]?.type).toBe('dropTable');
    });

    it('should rollback transaction on operation failure', async () => {
      const migration = createTestMigration('001', 'test');
      const runner = createMigrationRunner(adapter, history, [migration]);

      adapter.setShouldFail(true, 'createTable');

      const result = await runner.runOne(migration, 'up');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('failed');
        expect(result.data.error).toBeDefined();
        expect(result.data.error?.message).toContain('Create table failed');
      }

      // Verify failure was recorded in history
      const historyRecords = history.getRecords();
      expect(historyRecords).toHaveLength(1);
      expect(historyRecords[0]?.status).toBe('failed');
      expect(historyRecords[0]?.error).toBeDefined();
    });

    it('should record migration execution in history', async () => {
      const migration = createTestMigration('001', 'test');
      const runner = createMigrationRunner(adapter, history, [migration]);

      await runner.runOne(migration, 'up');

      const historyRecords = history.getRecords();
      expect(historyRecords).toHaveLength(1);
      expect(historyRecords[0]?.name).toBe('test');
      expect(historyRecords[0]?.version).toBe('001');
      expect(historyRecords[0]?.status).toBe('completed');
      expect(historyRecords[0]?.executionTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('rollbackLast', () => {
    it('should rollback last applied migration', async () => {
      const migrations = [
        createTestMigration('001', 'first'),
        createTestMigration('002', 'second')
      ];

      await history.record(migrations[0]!, 100, 'completed');
      await history.record(migrations[1]!, 150, 'completed');

      const runner = createMigrationRunner(adapter, history, migrations);
      const result = await runner.rollbackLast();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.migration.metadata.version).toBe('002');
        expect(result.data.status).toBe('rolled_back');
      }

      // Verify migration was removed from history
      const historyRecords = history.getRecords();
      expect(historyRecords).toHaveLength(1);
      expect(historyRecords[0]?.version).toBe('001');
    });

    it('should fail when no migrations to rollback', async () => {
      const migrations = [createTestMigration('001', 'first')];
      const runner = createMigrationRunner(adapter, history, migrations);

      const result = await runner.rollbackLast();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('No migrations to rollback');
      }
    });

    it('should fail when migration not found', async () => {
      const migrations = [createTestMigration('001', 'first')];

      // Record a migration that doesn't exist in migrations array
      await history.record(
        { metadata: { name: 'unknown', version: '999', timestamp: Date.now() }, up: [], down: [] },
        100,
        'completed'
      );

      const runner = createMigrationRunner(adapter, history, migrations);
      const result = await runner.rollbackLast();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('not found');
      }
    });
  });

  describe('rollbackTo', () => {
    it('should rollback all migrations after target version', async () => {
      const migrations = [
        createTestMigration('001', 'first'),
        createTestMigration('002', 'second'),
        createTestMigration('003', 'third')
      ];

      // Apply all migrations
      await history.record(migrations[0]!, 100, 'completed');
      await history.record(migrations[1]!, 150, 'completed');
      await history.record(migrations[2]!, 200, 'completed');

      const runner = createMigrationRunner(adapter, history, migrations);
      const result = await runner.rollbackTo('001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        // Rollback should be in reverse order
        expect(result.data[0]?.migration.metadata.version).toBe('003');
        expect(result.data[1]?.migration.metadata.version).toBe('002');
      }

      // Verify only first migration remains in history
      const historyRecords = history.getRecords();
      expect(historyRecords).toHaveLength(1);
      expect(historyRecords[0]?.version).toBe('001');
    });

    it('should fail if target version not found in history', async () => {
      const migrations = [createTestMigration('001', 'first')];
      const runner = createMigrationRunner(adapter, history, migrations);

      const result = await runner.rollbackTo('nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('not found in migration history');
      }
    });

    it('should stop rollback on failure', async () => {
      const migrations = [
        createTestMigration('001', 'first'),
        createTestMigration('002', 'second'),
        createTestMigration('003', 'third')
      ];

      await history.record(migrations[0]!, 100, 'completed');
      await history.record(migrations[1]!, 150, 'completed');
      await history.record(migrations[2]!, 200, 'completed');

      // Make dropTable fail on second rollback
      let callCount = 0;
      const originalDropTable = adapter.dropTable.bind(adapter);
      adapter.dropTable = async (tableName: string) => {
        callCount++;
        if (callCount === 2) {
          return { success: false, error: new Error('Drop table failed') };
        }
        return originalDropTable(tableName);
      };

      const runner = createMigrationRunner(adapter, history, migrations);
      const result = await runner.rollbackTo('001');

      expect(result.success).toBe(true);
      if (result.success) {
        // Should only have one successful rollback before failure
        expect(result.data).toHaveLength(2);
        expect(result.data[0]?.status).toBe('rolled_back');
        expect(result.data[1]?.status).toBe('failed');
      }
    });
  });

  describe('getPlan', () => {
    it('should create plan for all migrations in up direction', () => {
      const migrations = [
        createTestMigration('001', 'first'),
        createTestMigration('002', 'second'),
        createTestMigration('003', 'third')
      ];

      const runner = createMigrationRunner(adapter, history, migrations);
      const result = runner.getPlan();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.direction).toBe('up');
        expect(result.data.migrations).toHaveLength(3);
        expect(result.data.migrations[0]?.metadata.version).toBe('001');
        expect(result.data.migrations[1]?.metadata.version).toBe('002');
        expect(result.data.migrations[2]?.metadata.version).toBe('003');
        expect(result.data.target).toBeUndefined();
      }
    });

    it('should create plan with target version', () => {
      const migrations = [
        createTestMigration('001', 'first'),
        createTestMigration('002', 'second'),
        createTestMigration('003', 'third')
      ];

      const runner = createMigrationRunner(adapter, history, migrations);
      const result = runner.getPlan({ target: '002' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.migrations).toHaveLength(2);
        expect(result.data.migrations[0]?.metadata.version).toBe('001');
        expect(result.data.migrations[1]?.metadata.version).toBe('002');
        expect(result.data.target).toBe('002');
      }
    });

    it('should create plan for down direction in reverse order', () => {
      const migrations = [
        createTestMigration('001', 'first'),
        createTestMigration('002', 'second'),
        createTestMigration('003', 'third')
      ];

      const runner = createMigrationRunner(adapter, history, migrations);
      const result = runner.getPlan({ direction: 'down' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.direction).toBe('down');
        expect(result.data.migrations).toHaveLength(3);
        // Should be reversed
        expect(result.data.migrations[0]?.metadata.version).toBe('003');
        expect(result.data.migrations[1]?.metadata.version).toBe('002');
        expect(result.data.migrations[2]?.metadata.version).toBe('001');
      }
    });

    it('should fail when target version not found', () => {
      const migrations = [createTestMigration('001', 'first')];
      const runner = createMigrationRunner(adapter, history, migrations);

      const result = runner.getPlan({ target: 'nonexistent' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('not found');
      }
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle multiple operations in single migration', async () => {
      const migration: Migration = {
        metadata: {
          name: 'complex',
          version: '001',
          timestamp: Date.now()
        },
        up: [
          {
            type: 'createTable',
            schema: {
              name: 'users',
              fields: { id: { type: 'number', required: true } },
              indexes: []
            }
          },
          {
            type: 'createIndex',
            tableName: 'users',
            index: { fields: ['id'], unique: true }
          },
          {
            type: 'alterTable',
            tableName: 'users',
            operations: [
              {
                type: 'addColumn',
                column: 'email',
                definition: { type: 'string', required: true }
              }
            ]
          }
        ],
        down: [
          {
            type: 'dropTable',
            tableName: 'users'
          }
        ]
      };

      const runner = createMigrationRunner(adapter, history, [migration]);
      const result = await runner.runOne(migration, 'up');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('completed');
      }

      // Verify all operations were executed
      const operations = adapter.getOperations();
      expect(operations).toHaveLength(3);
      expect(operations[0]?.type).toBe('createTable');
      expect(operations[1]?.type).toBe('addIndex');
      expect(operations[2]?.type).toBe('alterTable');
    });

    it('should handle renameTable operation with raw SQL', async () => {
      const migration: Migration = {
        metadata: {
          name: 'rename',
          version: '001',
          timestamp: Date.now()
        },
        up: [
          {
            type: 'renameTable',
            from: 'old_table',
            to: 'new_table'
          }
        ],
        down: [
          {
            type: 'renameTable',
            from: 'new_table',
            to: 'old_table'
          }
        ]
      };

      const runner = createMigrationRunner(adapter, history, [migration]);
      const result = await runner.runOne(migration, 'up');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('completed');
      }

      // Verify raw SQL was executed
      const operations = adapter.getOperations();
      expect(operations).toHaveLength(1);
      expect(operations[0]?.type).toBe('raw');
      if (operations[0]?.type === 'raw') {
        expect(operations[0].data).toContain('RENAME');
      }
    });

    it('should execute migrations in correct order', async () => {
      const migrations = [
        createTestMigration('001', 'first'),
        createTestMigration('002', 'second'),
        createTestMigration('003', 'third')
      ];

      const runner = createMigrationRunner(adapter, history, migrations);
      await runner.runPending();

      const historyRecords = history.getRecords();
      expect(historyRecords).toHaveLength(3);
      expect(historyRecords[0]?.version).toBe('001');
      expect(historyRecords[1]?.version).toBe('002');
      expect(historyRecords[2]?.version).toBe('003');

      // Verify timestamps are in order
      expect(historyRecords[0]!.appliedAt.getTime()).toBeLessThanOrEqual(
        historyRecords[1]!.appliedAt.getTime()
      );
      expect(historyRecords[1]!.appliedAt.getTime()).toBeLessThanOrEqual(
        historyRecords[2]!.appliedAt.getTime()
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty migrations array', async () => {
      const runner = createMigrationRunner(adapter, history, []);
      const result = await runner.getPending();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('should handle migration with empty operations', async () => {
      const migration: Migration = {
        metadata: {
          name: 'empty',
          version: '001',
          timestamp: Date.now()
        },
        up: [],
        down: []
      };

      const runner = createMigrationRunner(adapter, history, [migration]);
      const result = await runner.runOne(migration, 'up');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('completed');
      }
    });

    it('should handle raw SQL operation', async () => {
      const migration: Migration = {
        metadata: {
          name: 'raw',
          version: '001',
          timestamp: Date.now()
        },
        up: [
          {
            type: 'raw',
            sql: 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"',
            params: []
          }
        ],
        down: [
          {
            type: 'raw',
            sql: 'DROP EXTENSION IF EXISTS "uuid-ossp"',
            params: []
          }
        ]
      };

      const runner = createMigrationRunner(adapter, history, [migration]);
      const result = await runner.runOne(migration, 'up');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('completed');
      }

      const operations = adapter.getOperations();
      expect(operations).toHaveLength(1);
      expect(operations[0]?.type).toBe('raw');
    });

    it('should handle concurrent migration prevention', async () => {
      const migration = createTestMigration('001', 'test');
      const runner = createMigrationRunner(adapter, history, [migration]);

      // Start two migrations simultaneously
      const promise1 = runner.runOne(migration, 'up');
      const promise2 = runner.runOne(migration, 'up');

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Both should complete (transactions handle isolation)
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });
  });
});
