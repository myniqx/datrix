/**
 * PostgreSQL Adapter - Introspection Tests
 *
 * Comprehensive introspection tests (~15 tests):
 * - getTables: Listing all tables in public schema
 * - tableExists: Checking existence of existing and non-existing tables
 * - getTableSchema: Full schema discovery (columns, types, nullability, defaults)
 *
 * STRICT TESTING POLICY:
 * - If a test fails, analyze if test expectation is wrong OR implementation is buggy
 * - Present analysis before making ANY changes
 * - DO NOT weaken tests without user approval
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgresAdapter } from '@adapters/postgres/adapter';
import type { PostgresConfig } from '@adapters/postgres/types';
import type { SchemaDefinition } from '@core/schema/types';

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

describe('PostgresAdapter - Introspection', () => {
  beforeAll(async () => {
    adapter = new PostgresAdapter(TEST_CONFIG);
    await adapter.connect();

    // Setup test tables
    await adapter.executeRawQuery('DROP TABLE IF EXISTS test_intro_basic', []);
    await adapter.executeRawQuery('DROP TABLE IF EXISTS test_intro_complex', []);

    await adapter.executeRawQuery(`
      CREATE TABLE test_intro_basic (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        is_active BOOLEAN DEFAULT true
      )
    `, []);

    await adapter.executeRawQuery(`
      CREATE TABLE test_intro_complex (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        data JSONB,
        tags TEXT[] DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        price NUMERIC(10, 2) NOT NULL,
        status VARCHAR(20) DEFAULT 'draft'
      )
    `, []);
  });

  afterAll(async () => {
    await adapter.executeRawQuery('DROP TABLE IF EXISTS test_intro_basic', []);
    await adapter.executeRawQuery('DROP TABLE IF EXISTS test_intro_complex', []);
    await adapter.disconnect();
  });

  it('should list all tables accurately', async () => {
    const result = await adapter.getTables();
    expect(result.success).toBe(true);
    expect(result.data).toContain('test_intro_basic');
    expect(result.data).toContain('test_intro_complex');
  });

  it('should verify table existence correctly', async () => {
    expect(await adapter.tableExists('test_intro_basic')).toBe(true);
    expect(await adapter.tableExists('non_existent_table_xyz')).toBe(false);
  });

  it('should Discover basic table schema correctly', async () => {
    const result = await adapter.getTableSchema('test_intro_basic');
    expect(result.success).toBe(true);

    const schema = result.data!;
    expect(schema.name).toBe('test_intro_basic');

    // Check ID column
    expect(schema.fields.id).toBeDefined();
    expect(schema.fields.id.type).toBe('number'); // SERIAL maps to number
    expect(schema.fields.id.required).toBe(true);

    // Check name column
    expect(schema.fields.name).toBeDefined();
    expect(schema.fields.name.type).toBe('string'); // TEXT maps to string
    expect(schema.fields.name.required).toBe(true);

    // Check is_active column
    expect(schema.fields.is_active).toBeDefined();
    expect(schema.fields.is_active.type).toBe('boolean');
    expect(schema.fields.is_active.default).toBeDefined();
  });

  it('should Discover complex table schema correctly', async () => {
    const result = await adapter.getTableSchema('test_intro_complex');
    expect(result.success).toBe(true);

    const schema = result.data!;

    // JSONB
    expect(schema.fields.data.type).toBe('json');

    // Arrays
    expect(schema.fields.tags.type).toBe('array');

    // Timestamp
    expect(schema.fields.created_at.type).toBe('date');

    // Numeric/Decimal
    expect(schema.fields.price.type).toBe('number');

    // Varchar with default
    expect(schema.fields.status.type).toBe('string');
    expect(schema.fields.status.default).toBe('draft');
  });

  it('should return error for non-existent table schema', async () => {
    const result = await adapter.getTableSchema('ghost_table');
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/table .* not found/i);
  });
});
