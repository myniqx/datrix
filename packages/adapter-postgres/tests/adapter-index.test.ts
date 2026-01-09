/**
 * PostgreSQL Adapter - Index Operations Tests
 *
 * Comprehensive index operation tests (~20 tests):
 * - addIndex with various configurations
 * - dropIndex operations
 * - Index types (btree, hash, gin, gist)
 * - Unique indexes
 * - Multi-column indexes
 *
 * STRICT TESTING POLICY:
 * - If a test fails, analyze if test expectation is wrong OR implementation is buggy
 * - Present analysis before making ANY changes
 * - DO NOT weaken tests without user approval
 */

import { PostgresAdapter } from '../src';
import { PostgresConfig } from '../src/types';
import { IndexDefinition, SchemaDefinition } from '../../types/src/core/schema';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';


// =============================================================================
// Test Setup
// =============================================================================

const TEST_CONFIG: PostgresConfig = {
  host: process.env['POSTGRES_HOST'] ?? 'localhost',
  port: Number(process.env['POSTGRES_PORT']) || 5432,
  database: process.env['POSTGRES_DB'] ?? 'forja_test',
  user: process.env['POSTGRES_USER'] ?? 'postgres',
  password: process.env['POSTGRES_PASSWORD'] ?? 'postgres',
  ssl: false,
  max: 10,
  min: 2
};

let adapter: PostgresAdapter;

// =============================================================================
// Index Operations Tests (~20 tests)
// =============================================================================

describe('PostgresAdapter - Index Operations', () => {
  beforeAll(async () => {
    adapter = new PostgresAdapter(TEST_CONFIG);
    await adapter.connect();

    // Create test table
    const schema: SchemaDefinition = {
      name: 'test_index_table',
      fields: {
        id: { type: 'number', required: true },
        email: { type: 'string', required: true },
        name: { type: 'string', required: false },
        age: { type: 'number', required: false },
        data: { type: 'json', required: false }
      }
    };

    await adapter.createTable(schema);
  });

  afterAll(async () => {
    await adapter.executeRawQuery('DROP TABLE IF EXISTS test_index_table', []);
    await adapter.disconnect();
  });

  beforeEach(async () => {
    // Drop all custom indexes before each test
    // Note: We can't easily query for indexes, so we just try to drop known ones
    await adapter.executeRawQuery('DROP INDEX IF EXISTS idx_test_index_table_email', []);
    await adapter.executeRawQuery('DROP INDEX IF EXISTS "idx-special"', []);
    await adapter.executeRawQuery('DROP INDEX IF EXISTS idx_partial_active', []);
  });

  it('should fail to add index when not connected', async () => {
    const disconnectedAdapter = new PostgresAdapter(TEST_CONFIG);

    const index: IndexDefinition = {
      fields: ['email']
    };

    const result = await disconnectedAdapter.addIndex('test_table', index);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe('MigrationError');
    expect(result.error?.code).toBe('MIGRATION_ERROR');
    expect(result.error?.message).toContain('Not connected to database');
  });

  it('should add simple index on single column', async () => {
    const index: IndexDefinition = {
      fields: ['email']
    };

    const result = await adapter.addIndex('test_index_table', index);

    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();

    // Verify index exists by checking it doesn't error on duplicate
    const duplicateResult = await adapter.addIndex('test_index_table', index);
    expect(duplicateResult.success).toBe(false);
  });

  it('should add index with auto-generated name', async () => {
    const index: IndexDefinition = {
      fields: ['email']
    };

    const result = await adapter.addIndex('test_index_table', index);

    expect(result.success).toBe(true);

    // Auto-generated name should be: idx_{table}_{fields}
    // Verify by trying to drop with expected name
    const dropResult = await adapter.dropIndex(
      'test_index_table',
      'idx_test_index_table_email'
    );

    expect(dropResult.success).toBe(true);
  });

  it('should add index with custom name', async () => {
    const index: IndexDefinition = {
      name: 'idx_custom_name',
      fields: ['email']
    };

    const result = await adapter.addIndex('test_index_table', index);

    expect(result.success).toBe(true);

    // Verify by dropping with custom name
    const dropResult = await adapter.dropIndex('test_index_table', 'idx_custom_name');
    expect(dropResult.success).toBe(true);
  });

  it('should add multi-column index', async () => {
    const index: IndexDefinition = {
      name: 'idx_test_multi',
      fields: ['email', 'name']
    };

    const result = await adapter.addIndex('test_index_table', index);

    expect(result.success).toBe(true);
  });

  it('should add unique index', async () => {
    const index: IndexDefinition = {
      name: 'idx_test_email',
      fields: ['email'],
      unique: true
    };

    const result = await adapter.addIndex('test_index_table', index);

    expect(result.success).toBe(true);

    // Verify uniqueness by trying to insert duplicates
    await adapter.executeRawQuery(
      'INSERT INTO test_index_table (id, email, name) VALUES ($1, $2, $3)',
      [1, 'unique@example.com', 'User 1']
    );

    const duplicateInsert = await adapter.executeRawQuery(
      'INSERT INTO test_index_table (id, email, name) VALUES ($1, $2, $3)',
      [2, 'unique@example.com', 'User 2']
    );

    expect(duplicateInsert.success).toBe(false);
    expect(duplicateInsert.error?.message).toContain('unique');

    // Clean up
    await adapter.executeRawQuery('DELETE FROM test_index_table', []);
  });

  it('should add non-unique index (default)', async () => {
    const index: IndexDefinition = {
      name: 'idx_test_name',
      fields: ['name']
    };

    const result = await adapter.addIndex('test_index_table', index);

    expect(result.success).toBe(true);

    // Verify non-uniqueness by inserting duplicates (should succeed)
    await adapter.executeRawQuery(
      'INSERT INTO test_index_table (id, email, name) VALUES ($1, $2, $3)',
      [1, 'user1@example.com', 'Same Name']
    );

    const duplicateInsert = await adapter.executeRawQuery(
      'INSERT INTO test_index_table (id, email, name) VALUES ($1, $2, $3)',
      [2, 'user2@example.com', 'Same Name']
    );

    expect(duplicateInsert.success).toBe(true);

    // Clean up
    await adapter.executeRawQuery('DELETE FROM test_index_table', []);
  });

  it('should add BTREE index (default)', async () => {
    const index: IndexDefinition = {
      name: 'idx_test_email',
      fields: ['email'],
      type: 'btree'
    };

    const result = await adapter.addIndex('test_index_table', index);

    expect(result.success).toBe(true);
  });

  it('should add HASH index', async () => {
    const index: IndexDefinition = {
      name: 'idx_test_email',
      fields: ['email'],
      type: 'hash'
    };

    const result = await adapter.addIndex('test_index_table', index);

    expect(result.success).toBe(true);
  });

  it('should add GIN index for JSON columns', async () => {
    const index: IndexDefinition = {
      name: 'idx_test_data',
      fields: ['data'],
      type: 'gin'
    };

    const result = await adapter.addIndex('test_index_table', index);

    expect(result.success).toBe(true);

    // Clean up
    await adapter.dropIndex('test_index_table', 'idx_test_data');
  });

  it('should add GIST index', async () => {
    const index: IndexDefinition = {
      name: 'idx_test_data',
      fields: ['data'],
      type: 'gist'
    };

    const result = await adapter.addIndex('test_index_table', index);

    expect(result.success).toBe(true);

    // Clean up
    await adapter.dropIndex('test_index_table', 'idx_test_data');
  });

  it('should fail to add index on nonexistent table', async () => {
    const index: IndexDefinition = {
      fields: ['email']
    };

    const result = await adapter.addIndex('nonexistent_table', index);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Failed to add index');
  });

  it('should fail to add index on nonexistent column', async () => {
    const index: IndexDefinition = {
      fields: ['nonexistent_column']
    };

    const result = await adapter.addIndex('test_index_table', index);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should fail to drop index when not connected', async () => {
    const disconnectedAdapter = new PostgresAdapter(TEST_CONFIG);

    const result = await disconnectedAdapter.dropIndex('test_table', 'idx_name');

    expect(result.success).toBe(false);
    expect(result.error?.name).toBe('MigrationError');
    expect(result.error?.message).toContain('Not connected to database');
  });

  it('should drop index successfully', async () => {
    // Create index first
    const index: IndexDefinition = {
      name: 'idx_test_email',
      fields: ['email']
    };

    await adapter.addIndex('test_index_table', index);

    // Drop it
    const result = await adapter.dropIndex('test_index_table', 'idx_test_email');

    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it('should drop index with IF EXISTS (idempotent)', async () => {
    // Drop nonexistent index (should succeed with IF EXISTS)
    const result = await adapter.dropIndex('test_index_table', 'nonexistent_index');

    expect(result.success).toBe(true);
  });

  it('should escape index name when dropping', async () => {
    // Create index with special characters
    await adapter.executeRawQuery(
      'CREATE INDEX "idx-special" ON test_index_table (email)',
      []
    );

    // Drop it
    const result = await adapter.dropIndex('test_index_table', 'idx-special');

    expect(result.success).toBe(true);
  });

  it('should include table name in addIndex error message', async () => {
    const index: IndexDefinition = {
      fields: ['email']
    };

    const result = await adapter.addIndex('nonexistent_table', index);

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('nonexistent_table');
  });

  it('should include index name in dropIndex error message', async () => {
    // Force error by disconnecting
    await adapter.disconnect();

    const result = await adapter.dropIndex('test_table', 'idx_name');

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('idx_name');

    // Reconnect
    await adapter.connect();
  });

  it('should include error details in index operation failures', async () => {
    const index: IndexDefinition = {
      fields: ['nonexistent_column']
    };

    const result = await adapter.addIndex('test_index_table', index);

    expect(result.success).toBe(false);
    expect(result.error?.details).toBeDefined();
    expect(result.error?.code).toBe('MIGRATION_ERROR');
  });

  // =============================================================================
  // ADVANCED POSTGRES INDEX TESTS
  // =============================================================================

  it('should support expression-based (functional) indexes', async () => {
    // Note: Expression indexes often need raw SQL if the IndexDefinition doesn't support it directly
    // Let's see if we can pass an expression in fields (advanced usage)
    const index: any = {
      name: 'idx_lower_email',
      fields: ['(LOWER(email))']
    };

    const result = await adapter.addIndex('test_index_table', index);
    expect(result.success).toBe(true);

    // Verify it works by checking explain plan or just ensuring it exists
    await adapter.dropIndex('test_index_table', 'idx_lower_email');
  });

  it('should support partial indexes with WHERE clause if supported', async () => {
    // Partial indexes are great for filtering nulls or specific states
    // This requires IndexDefinition to have a 'where' property
    const index: any = {
      name: 'idx_partial_active',
      fields: ['email'],
      where: 'age > 18'
    };

    const result = await adapter.addIndex('test_index_table', index);

    // If the adapter doesn't support 'where' in IndexDefinition, it might ignore it or fail
    // We want it to support it for Postgres
    expect(result.success).toBe(true);
  });
});
