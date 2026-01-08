/**
 * PostgreSQL Adapter - Schema Operations Tests
 *
 * Comprehensive schema operation tests (~40 tests):
 * - createTable with various field types
 * - dropTable operations
 * - alterTable operations (add/drop/modify/rename columns)
 * - Schema validation and error handling
 *
 * STRICT TESTING POLICY:
 * - If a test fails, analyze if test expectation is wrong OR implementation is buggy
 * - Present analysis before making ANY changes
 * - DO NOT weaken tests without user approval
 */

import { PostgresAdapter, PostgresConfig } from '../src';
import { AlterOperation } from '../../types/src/adapter';
import { SchemaDefinition } from '../../types/src/core/schema';
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
// Schema Operations Tests (~40 tests)
// =============================================================================

describe('PostgresAdapter - Schema Operations', () => {
  beforeAll(async () => {
    adapter = new PostgresAdapter(TEST_CONFIG);
    await adapter.connect();
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  beforeEach(async () => {
    // Clean up test tables
    await adapter.executeRawQuery('DROP TABLE IF EXISTS test_schema_table', []);
    await adapter.executeRawQuery('DROP TABLE IF EXISTS test_schema_parent', []);
  });

  it('should fail to create table when not connected', async () => {
    const disconnectedAdapter = new PostgresAdapter(TEST_CONFIG);

    const schema: SchemaDefinition = {
      name: 'test_table',
      fields: {
        id: { type: 'number', required: true },
        name: { type: 'string', required: true }
      }
    };

    const result = await disconnectedAdapter.createTable(schema);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
      expect(result.error?.name).toBe('MigrationError');
      expect(result.error?.code).toBe('MIGRATION_ERROR');
      expect(result.error?.message).toContain('Not connected to database');
    }
  });

  it('should create table with basic fields', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true },
        name: { type: 'string', required: true },
        email: { type: 'string', required: false }
      }
    };

    const result = await adapter.createTable(schema);

    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data).toBeUndefined();

    // Verify table exists
    const exists = await adapter.tableExists('test_schema_table');
    expect(exists).toBe(true);
  });

  it('should create table with all field types', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        field_string: { type: 'string', required: false },
        field_number: { type: 'number', required: false },
        field_boolean: { type: 'boolean', required: false },
        field_date: { type: 'date', required: false },
        field_json: { type: 'json', required: false },
        field_array: { type: 'array', required: false, items: null! }
      }
    };

    const result = await adapter.createTable(schema);

    expect(result.success).toBe(true);

    // Verify we can insert data
    const insertResult = await adapter.executeRawQuery(
      `INSERT INTO test_schema_table (field_string, field_number, field_boolean, field_date, field_json, field_array)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['test', 123, true, new Date(), { key: 'value' }, ['item1', 'item2']]
    );

    expect(insertResult.success).toBe(true);
  });

  it('should create table with required fields (NOT NULL)', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        required_field: { type: 'string', required: true },
        optional_field: { type: 'string', required: false }
      }
    };

    await adapter.createTable(schema);

    // Try to insert without required field (should fail)
    const result = await adapter.executeRawQuery(
      'INSERT INTO test_schema_table (optional_field) VALUES ($1)',
      ['optional']
    );

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error?.message).toContain('null value');
  });

  it('should create table with default values', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true },
        status: { type: 'string', required: false, default: 'active' },
        count: { type: 'number', required: false, default: 0 },
        enabled: { type: 'boolean', required: false, default: true }
      }
    };

    await adapter.createTable(schema);

    // Insert without default fields
    await adapter.executeRawQuery(
      'INSERT INTO test_schema_table (id) VALUES ($1)',
      [1]
    );

    // Verify defaults were applied
    const result = await adapter.executeQuery<{
      status: string;
      count: number;
      enabled: boolean;
    }>({
      type: 'select',
      table: 'test_schema_table',
      select: ['status', 'count', 'enabled']
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.rows[0]?.status).toBe('active');
      expect(result.data?.rows[0]?.count).toBe(0);
      expect(result.data?.rows[0]?.enabled).toBe(true);
    }
  });

  it('should create table with field name escaping', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        'user': { type: 'string', required: true }, // 'user' is SQL keyword
        'select': { type: 'number', required: false } // 'select' is SQL keyword
      }
    };

    const result = await adapter.createTable(schema);

    expect(result.success).toBe(true);

    // Verify we can insert
    const insertResult = await adapter.executeRawQuery(
      'INSERT INTO test_schema_table ("user", "select") VALUES ($1, $2)',
      ['test user', 42]
    );

    expect(insertResult.success).toBe(true);
  });

  it('should fail to create table that already exists', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true }
      }
    };

    // First create
    await adapter.createTable(schema);

    // Second create should fail
    const result = await adapter.createTable(schema);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Failed to create table');
    }
  });

  it('should fail to drop table when not connected', async () => {
    const disconnectedAdapter = new PostgresAdapter(TEST_CONFIG);

    const result = await disconnectedAdapter.dropTable('test_table');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.name).toBe('MigrationError');
      expect(result.error?.message).toContain('Not connected to database');
    }
  });

  it('should drop table successfully', async () => {
    // Create table first
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true }
      }
    };

    await adapter.createTable(schema);

    // Drop it
    const result = await adapter.dropTable('test_schema_table');

    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data).toBeUndefined();

    // Verify table doesn't exist
    const exists = await adapter.tableExists('test_schema_table');
    expect(exists).toBe(false);
  });

  it('should drop table with IF EXISTS (idempotent)', async () => {
    // Drop nonexistent table (should succeed with IF EXISTS)
    const result = await adapter.dropTable('nonexistent_table');

    expect(result.success).toBe(true);
  });

  it('should escape table name when dropping', async () => {
    // Create table with keyword name
    await adapter.executeRawQuery(
      'CREATE TABLE "select" (id INT)',
      []
    );

    // Drop it
    const result = await adapter.dropTable('select');

    expect(result.success).toBe(true);
  });

  it('should fail to alter table when not connected', async () => {
    const disconnectedAdapter = new PostgresAdapter(TEST_CONFIG);

    const operations: readonly AlterOperation[] = [
      {
        type: 'addColumn',
        column: 'new_field',
        definition: { type: 'string', required: false }
      }
    ];

    const result = await disconnectedAdapter.alterTable('test_table', operations);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.name).toBe('MigrationError');
      expect(result.error?.message).toContain('Not connected to database');
    }
  });

  it('should add column to table', async () => {
    // Create base table
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true }
      }
    };

    await adapter.createTable(schema);

    // Add column
    const operations: readonly AlterOperation[] = [
      {
        type: 'addColumn',
        column: 'new_field',
        definition: { type: 'string', required: false }
      }
    ];

    const result = await adapter.alterTable('test_schema_table', operations);

    expect(result.success).toBe(true);

    // Verify column exists by inserting
    const insertResult = await adapter.executeRawQuery(
      'INSERT INTO test_schema_table (id, new_field) VALUES ($1, $2)',
      [1, 'test']
    );

    expect(insertResult.success).toBe(true);
  });

  it('should add required column with default value', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true }
      }
    };

    await adapter.createTable(schema);

    // Insert existing row
    await adapter.executeRawQuery(
      'INSERT INTO test_schema_table (id) VALUES ($1)',
      [1]
    );

    // Add required column with default
    const operations: readonly AlterOperation[] = [
      {
        type: 'addColumn',
        column: 'status',
        definition: { type: 'string', required: true, default: 'active' }
      }
    ];

    const result = await adapter.alterTable('test_schema_table', operations);

    expect(result.success).toBe(true);

    // Verify existing row got default value
    const selectResult = await adapter.executeQuery<{ status: string }>({
      type: 'select',
      table: 'test_schema_table',
      select: ['status']
    });

    expect(selectResult.success).toBe(true);
    if (selectResult.success)
      expect(selectResult.data?.rows[0]?.status).toBe('active');
  });

  it('should drop column from table', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true },
        to_drop: { type: 'string', required: false }
      }
    };

    await adapter.createTable(schema);

    // Drop column
    const operations: readonly AlterOperation[] = [
      {
        type: 'dropColumn',
        column: 'to_drop'
      }
    ];

    const result = await adapter.alterTable('test_schema_table', operations);

    expect(result.success).toBe(true);

    // Verify column doesn't exist
    const insertResult = await adapter.executeRawQuery(
      'INSERT INTO test_schema_table (id, to_drop) VALUES ($1, $2)',
      [1, 'test']
    );

    expect(insertResult.success).toBe(false);
    if (!insertResult.success)
      expect(insertResult.error?.message).toContain('to_drop');
  });

  it('should modify column type', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true },
        data: { type: 'string', required: false }
      }
    };

    await adapter.createTable(schema);

    // Modify column type
    const operations: readonly AlterOperation[] = [
      {
        type: 'modifyColumn',
        column: 'data',
        newDefinition: { type: 'json', required: false }
      }
    ];

    const result = await adapter.alterTable('test_schema_table', operations);

    expect(result.success).toBe(true);

    // Verify we can insert JSON
    const insertResult = await adapter.executeRawQuery(
      'INSERT INTO test_schema_table (id, data) VALUES ($1, $2)',
      [1, JSON.stringify({ key: 'value' })]
    );

    expect(insertResult.success).toBe(true);
  });

  it('should rename column', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true },
        old_name: { type: 'string', required: false }
      }
    };

    await adapter.createTable(schema);

    // Rename column
    const operations: readonly AlterOperation[] = [
      {
        type: 'renameColumn',
        from: 'old_name',
        to: 'new_name'
      }
    ];

    const result = await adapter.alterTable('test_schema_table', operations);

    expect(result.success).toBe(true);

    // Verify old name doesn't work
    const oldResult = await adapter.executeRawQuery(
      'INSERT INTO test_schema_table (id, old_name) VALUES ($1, $2)',
      [1, 'test']
    );

    expect(oldResult.success).toBe(false);

    // Verify new name works
    const newResult = await adapter.executeRawQuery(
      'INSERT INTO test_schema_table (id, new_name) VALUES ($1, $2)',
      [2, 'test']
    );

    expect(newResult.success).toBe(true);
  });

  it('should execute multiple alter operations', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true },
        field1: { type: 'string', required: false },
        field2: { type: 'string', required: false }
      }
    };

    await adapter.createTable(schema);

    // Multiple operations
    const operations: readonly AlterOperation[] = [
      {
        type: 'addColumn',
        column: 'new_field',
        definition: { type: 'number', required: false }
      },
      {
        type: 'dropColumn',
        column: 'field1'
      },
      {
        type: 'renameColumn',
        from: 'field2',
        to: 'renamed_field'
      }
    ];

    const result = await adapter.alterTable('test_schema_table', operations);

    expect(result.success).toBe(true);

    // Verify all changes
    const insertResult = await adapter.executeRawQuery(
      'INSERT INTO test_schema_table (id, new_field, renamed_field) VALUES ($1, $2, $3)',
      [1, 42, 'test']
    );

    expect(insertResult.success).toBe(true);
  });

  it('should fail to alter nonexistent table', async () => {
    const operations: readonly AlterOperation[] = [
      {
        type: 'addColumn',
        column: 'new_field',
        definition: { type: 'string', required: false }
      }
    ];

    const result = await adapter.alterTable('nonexistent_table', operations);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Failed to alter table');
    }
  });

  it('should escape column names in alter operations', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true }
      }
    };

    await adapter.createTable(schema);

    // Add column with keyword name
    const operations: readonly AlterOperation[] = [
      {
        type: 'addColumn',
        column: 'select', // SQL keyword
        definition: { type: 'string', required: false }
      }
    ];

    const result = await adapter.alterTable('test_schema_table', operations);

    expect(result.success).toBe(true);
  });

  it('should escape table name in alter operations', async () => {
    // Create table with keyword name
    await adapter.executeRawQuery(
      'CREATE TABLE "where" (id INT)',
      []
    );

    const operations: readonly AlterOperation[] = [
      {
        type: 'addColumn',
        column: 'new_field',
        definition: { type: 'string', required: false }
      }
    ];

    const result = await adapter.alterTable('where', operations);

    expect(result.success).toBe(true);

    // Clean up
    await adapter.dropTable('where');
  });

  it('should include error details in createTable failure', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true }
      }
    };

    await adapter.createTable(schema);

    // Try to create again (should fail)
    const result = await adapter.createTable(schema);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.details).toBeDefined();
      expect(result.error?.code).toBe('MIGRATION_ERROR');
    }
  });

  it('should include table name in createTable error message', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true }
      }
    };

    await adapter.createTable(schema);

    // Try to create again
    const result = await adapter.createTable(schema);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error?.message).toContain('test_schema_table');
  });

  it('should include table name in dropTable error message', async () => {
    // Force an error by disconnecting
    await adapter.disconnect();

    const result = await adapter.dropTable('some_table');

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error?.message).toContain('some_table');

    // Reconnect for other tests
    await adapter.connect();
  });

  it('should include table name in alterTable error message', async () => {
    const operations: readonly AlterOperation[] = [
      {
        type: 'addColumn',
        column: 'field',
        definition: { type: 'string', required: false }
      }
    ];

    const result = await adapter.alterTable('nonexistent_table', operations);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error?.message).toContain('nonexistent_table');
  });

  it('should handle empty alter operations array', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true }
      }
    };

    await adapter.createTable(schema);

    // Empty operations
    const operations: readonly AlterOperation[] = [];

    const result = await adapter.alterTable('test_schema_table', operations);

    // Should succeed (no-op)
    expect(result.success).toBe(true);
  });

  it('should create table with complex schema', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true },
        email: { type: 'string', required: true },
        profile: { type: 'json', required: false },
        tags: { type: 'array', required: false, items: null! },
        created_at: { type: 'date', required: true, default: 'NOW()' },
        is_active: { type: 'boolean', required: false, default: true }
      }
    };

    const result = await adapter.createTable(schema);

    expect(result.success).toBe(true);

    // Verify we can use the table
    const insertResult = await adapter.executeQuery({
      type: 'insert',
      table: 'test_schema_table',
      data: {
        id: 1,
        email: 'test@example.com',
        profile: { name: 'Test' },
        tags: ['tag1', 'tag2']
      }
    });

    expect(insertResult.success).toBe(true);
  });

  it('should handle field with enum type (stored as VARCHAR)', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true },
        role: { type: 'enum', required: true, values: null! }
      }
    };

    const result = await adapter.createTable(schema);

    expect(result.success).toBe(true);

    // Verify we can insert enum values
    const insertResult = await adapter.executeRawQuery(
      'INSERT INTO test_schema_table (id, role) VALUES ($1, $2)',
      [1, 'admin']
    );

    expect(insertResult.success).toBe(true);
  });

  it('should handle field with file type (stored as TEXT)', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true },
        avatar: { type: 'file', required: false }
      }
    };

    const result = await adapter.createTable(schema);

    expect(result.success).toBe(true);

    // Verify we can insert file paths
    const insertResult = await adapter.executeRawQuery(
      'INSERT INTO test_schema_table (id, avatar) VALUES ($1, $2)',
      [1, '/uploads/avatar.jpg']
    );

    expect(insertResult.success).toBe(true);
  });

  it('should handle field with relation type (stored as INTEGER)', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true },
        user_id: { type: 'relation', required: false, model: null!, foreignKey: null!, kind: null! }
      }
    };

    const result = await adapter.createTable(schema);

    expect(result.success).toBe(true);

    // Verify we can insert foreign key values
    const insertResult = await adapter.executeRawQuery(
      'INSERT INTO test_schema_table (id, user_id) VALUES ($1, $2)',
      [1, 42]
    );

    expect(insertResult.success).toBe(true);
  });

  // =============================================================================
  // STRICT SCHEMA CONSTRAINT TESTS
  // =============================================================================

  it('should create table with UNIQUE constraint on single column', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true },
        email: { type: 'string', required: true, unique: true as any }
      }
    };

    await adapter.createTable(schema);

    await adapter.executeRawQuery('INSERT INTO test_schema_table (id, email) VALUES (1, \'u@e.com\')', []);
    const result = await adapter.executeRawQuery('INSERT INTO test_schema_table (id, email) VALUES (2, \'u@e.com\')', []);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error?.message).toMatch(/unique constraint/i);
  });

  it('should handle multi-column UNIQUE constraints if defined in indexes', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        provider: { type: 'string', required: true },
        provider_id: { type: 'string', required: true }
      },
      indexes: [
        { fields: ['provider', 'provider_id'], unique: true }
      ]
    };

    await adapter.createTable(schema);

    await adapter.executeRawQuery('INSERT INTO test_schema_table (provider, provider_id) VALUES (\'p1\', \'id1\')', []);
    const result = await adapter.executeRawQuery('INSERT INTO test_schema_table (provider, provider_id) VALUES (\'p1\', \'id1\')', []);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error?.message).toMatch(/unique constraint/i);
  });

  it('should support FOREIGN KEY constraints', async () => {
    const parentSchema: SchemaDefinition = {
      name: 'test_schema_parent',
      fields: {
        id: { type: 'number', required: true }
      }
    };
    await adapter.createTable(parentSchema);
    await adapter.executeRawQuery('ALTER TABLE test_schema_parent ADD PRIMARY KEY (id)', []);

    const childSchema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true },
        parent_id: { type: 'relation', required: true, model: 'test_schema_parent' } as any
      }
    };
    await adapter.createTable(childSchema);

    const result = await adapter.executeRawQuery('INSERT INTO test_schema_table (id, parent_id) VALUES (1, 999)', []);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error?.message).toMatch(/foreign key constraint/i);
  });

  it('should fail to drop table with active dependencies (RESTRICT behavior)', async () => {
    const parentSchema: SchemaDefinition = {
      name: 'test_schema_parent',
      fields: { id: { type: 'number', required: true } }
    };
    await adapter.createTable(parentSchema);
    await adapter.executeRawQuery('ALTER TABLE test_schema_parent ADD PRIMARY KEY (id)', []);

    const childSchema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        id: { type: 'number', required: true },
        parent_id: { type: 'relation', required: true, model: 'test_schema_parent' } as any
      }
    };
    await adapter.createTable(childSchema);

    const result = await adapter.dropTable('test_schema_parent');

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error?.message).toMatch(/cannot drop table .* because other objects depend on it/i);
  });

  it('should modify column constraints (e.g. adding NOT NULL to existing column)', async () => {
    const schema: SchemaDefinition = {
      name: 'test_schema_table',
      fields: {
        val: { type: 'string', required: false }
      }
    };
    await adapter.createTable(schema);
    await adapter.executeRawQuery('INSERT INTO test_schema_table (val) VALUES (NULL)', []);

    const operations: readonly AlterOperation[] = [
      {
        type: 'modifyColumn',
        column: 'val',
        newDefinition: { type: 'string', required: true }
      }
    ];

    const result = await adapter.alterTable('test_schema_table', operations);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error?.message).toMatch(/contains null values/i);
  });
});
