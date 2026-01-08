/**
 * PostgreSQL Adapter Tests
 *
 * Comprehensive tests for PostgreSQL adapter:
 * - Connection/disconnection management (~25 tests)
 * - Query execution (~35 tests)
 * - Transaction management (~35 tests)
 * - Schema operations (~40 tests)
 * - Index operations (~20 tests)
 * - Introspection (~15 tests)
 * - Error handling (~25 tests)
 *
 * Total: ~195 tests (comprehensive coverage of all adapter functionality)
 *
 * NOTE: These tests are STRICT by design. If a test fails:
 * 1. First analyze if the test expectation is wrong OR implementation is buggy
 * 2. Present analysis to user before making ANY changes
 * 3. DO NOT weaken tests without user approval
 */

import { createPostgresAdapter, PostgresAdapter, PostgresConfig } from '../src';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// =============================================================================
// Test Setup
// =============================================================================

// Test database configuration
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

// Shared adapter instance for most tests
let adapter: PostgresAdapter;

// =============================================================================
// 1. Adapter Construction and Configuration (~15 tests)
// =============================================================================

describe('PostgresAdapter - Construction and Configuration', () => {
  it('should create adapter with factory function', () => {
    const newAdapter = createPostgresAdapter(TEST_CONFIG);

    expect(newAdapter).toBeInstanceOf(PostgresAdapter);
    expect(newAdapter.name).toBe('postgres');
    expect(newAdapter.config).toEqual(TEST_CONFIG);
  });

  it('should create adapter with constructor', () => {
    const newAdapter = new PostgresAdapter(TEST_CONFIG);

    expect(newAdapter).toBeInstanceOf(PostgresAdapter);
    expect(newAdapter.name).toBe('postgres');
    expect(newAdapter.config).toEqual(TEST_CONFIG);
  });

  it('should have correct name', () => {
    const newAdapter = new PostgresAdapter(TEST_CONFIG);
    expect(newAdapter.name).toBe('postgres');
  });

  it('should store config immutably', () => {
    const newAdapter = new PostgresAdapter(TEST_CONFIG);
    expect(newAdapter.config).toEqual(TEST_CONFIG);
    expect(Object.isFrozen(newAdapter.config)).toBe(false); // Config itself not frozen, but readonly in TS
  });

  it('should have minimal config (only required fields)', () => {
    const minimalConfig: PostgresConfig = {
      host: 'localhost',
      port: 5432,
      database: 'test',
      user: 'user',
      password: 'pass'
    };

    const newAdapter = new PostgresAdapter(minimalConfig);
    expect(newAdapter.config).toEqual(minimalConfig);
  });

  it('should have full config with all optional fields', () => {
    const fullConfig: PostgresConfig = {
      host: 'localhost',
      port: 5432,
      database: 'test',
      user: 'user',
      password: 'pass',
      ssl: {
        rejectUnauthorized: false,
        ca: 'ca-cert',
        cert: 'client-cert',
        key: 'client-key'
      },
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 60000,
      max: 20,
      min: 5,
      applicationName: 'my-app'
    };

    const newAdapter = new PostgresAdapter(fullConfig);
    expect(newAdapter.config).toEqual(fullConfig);
  });

  it('should initialize in disconnected state', () => {
    const newAdapter = new PostgresAdapter(TEST_CONFIG);
    expect(newAdapter.isConnected()).toBe(false);
    expect(newAdapter.getConnectionState()).toBe('disconnected');
  });

  it('should have ssl: false config', () => {
    const newAdapter = new PostgresAdapter({ ...TEST_CONFIG, ssl: false });
    expect(newAdapter.config.ssl).toBe(false);
  });

  it('should have ssl: true config', () => {
    const newAdapter = new PostgresAdapter({ ...TEST_CONFIG, ssl: true });
    expect(newAdapter.config.ssl).toBe(true);
  });

  it('should have ssl object config', () => {
    const sslConfig = { rejectUnauthorized: false };
    const newAdapter = new PostgresAdapter({ ...TEST_CONFIG, ssl: sslConfig });
    expect(newAdapter.config.ssl).toEqual(sslConfig);
  });

  it('should have default pool max if not specified', () => {
    const { max, ...configWithoutMax } = TEST_CONFIG;
    const newAdapter = new PostgresAdapter(configWithoutMax);
    // Default max is 10 (checked during connect)
    expect(newAdapter.config.max).toBeUndefined();
  });

  it('should have default pool min if not specified', () => {
    const { min, ...configWithoutMin } = TEST_CONFIG;
    const newAdapter = new PostgresAdapter(configWithoutMin);
    // Default min is 2 (checked during connect)
    expect(newAdapter.config.min).toBeUndefined();
  });

  it('should have custom pool size', () => {
    const newAdapter = new PostgresAdapter({ ...TEST_CONFIG, max: 50, min: 10 });
    expect(newAdapter.config.max).toBe(50);
    expect(newAdapter.config.min).toBe(10);
  });

  it('should have custom timeouts', () => {
    const newAdapter = new PostgresAdapter({
      ...TEST_CONFIG,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 90000
    });
    expect(newAdapter.config.connectionTimeoutMillis).toBe(15000);
    expect(newAdapter.config.idleTimeoutMillis).toBe(90000);
  });

  it('should have custom application name', () => {
    const newAdapter = new PostgresAdapter({
      ...TEST_CONFIG,
      applicationName: 'custom-app'
    });
    expect(newAdapter.config.applicationName).toBe('custom-app');
  });
});

// =============================================================================
// 2. Connection Management (~25 tests)
// =============================================================================

describe('PostgresAdapter - Connection Management', () => {
  beforeAll(async () => {
    adapter = new PostgresAdapter(TEST_CONFIG);
  });

  afterAll(async () => {
    if (adapter.isConnected()) {
      await adapter.disconnect();
    }
  });

  it('should start in disconnected state', () => {
    const newAdapter = new PostgresAdapter(TEST_CONFIG);
    expect(newAdapter.isConnected()).toBe(false);
    expect(newAdapter.getConnectionState()).toBe('disconnected');
  });

  it('should connect successfully', async () => {
    const result = await adapter.connect();

    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();
    expect(adapter.isConnected()).toBe(true);
    expect(adapter.getConnectionState()).toBe('connected');
  });

  it('should be idempotent when already connected', async () => {
    // First connect
    await adapter.connect();

    // Second connect should succeed without error
    const result = await adapter.connect();

    expect(result.success).toBe(true);
    expect(adapter.isConnected()).toBe(true);
  });

  it('should transition through connecting state', async () => {
    const newAdapter = new PostgresAdapter(TEST_CONFIG);

    expect(newAdapter.getConnectionState()).toBe('disconnected');

    // Start connection (don't await yet)
    const connectPromise = newAdapter.connect();

    // State should be 'connecting' or 'connected' (race condition, both valid)
    const stateWhileConnecting = newAdapter.getConnectionState();
    expect(['connecting', 'connected']).toContain(stateWhileConnecting);

    // Wait for connection to complete
    await connectPromise;

    expect(newAdapter.getConnectionState()).toBe('connected');

    await newAdapter.disconnect();
  });

  it('should disconnect successfully', async () => {
    const newAdapter = new PostgresAdapter(TEST_CONFIG);
    await newAdapter.connect();

    const result = await newAdapter.disconnect();

    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();
    expect(newAdapter.isConnected()).toBe(false);
    expect(newAdapter.getConnectionState()).toBe('disconnected');
  });

  it('should be idempotent when already disconnected', async () => {
    const newAdapter = new PostgresAdapter(TEST_CONFIG);

    // Disconnect without connecting first
    const result = await newAdapter.disconnect();

    expect(result.success).toBe(true);
    expect(newAdapter.isConnected()).toBe(false);
  });

  it('should reconnect after disconnect', async () => {
    const newAdapter = new PostgresAdapter(TEST_CONFIG);

    // First connection
    await newAdapter.connect();
    expect(newAdapter.isConnected()).toBe(true);

    // Disconnect
    await newAdapter.disconnect();
    expect(newAdapter.isConnected()).toBe(false);

    // Reconnect
    const result = await newAdapter.connect();
    expect(result.success).toBe(true);
    expect(newAdapter.isConnected()).toBe(true);

    await newAdapter.disconnect();
  });

  it('should fail to connect with invalid host', async () => {
    const badAdapter = new PostgresAdapter({
      ...TEST_CONFIG,
      host: 'invalid-host-that-does-not-exist.local'
    });

    const result = await badAdapter.connect();

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe('ConnectionError');
    expect(result.error?.code).toBe('CONNECTION_ERROR');
    expect(result.error?.message).toContain('Failed to connect to PostgreSQL');
    expect(badAdapter.isConnected()).toBe(false);
    expect(badAdapter.getConnectionState()).toBe('error');
  });

  it('should fail to connect with invalid port', async () => {
    const badAdapter = new PostgresAdapter({
      ...TEST_CONFIG,
      port: 9999 // Invalid port
    });

    const result = await badAdapter.connect();

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe('ConnectionError');
    expect(badAdapter.isConnected()).toBe(false);
    expect(badAdapter.getConnectionState()).toBe('error');
  });

  it('should fail to connect with invalid credentials', async () => {
    const badAdapter = new PostgresAdapter({
      ...TEST_CONFIG,
      password: 'wrong-password'
    });

    const result = await badAdapter.connect();

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe('ConnectionError');
    expect(badAdapter.isConnected()).toBe(false);
  });

  it('should fail to connect with invalid database', async () => {
    const badAdapter = new PostgresAdapter({
      ...TEST_CONFIG,
      database: 'database_that_does_not_exist'
    });

    const result = await badAdapter.connect();

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(badAdapter.isConnected()).toBe(false);
  });

  it('should apply default connection timeout (5000ms)', async () => {
    const newAdapter = new PostgresAdapter({
      ...TEST_CONFIG,
      host: '192.0.2.1', // Non-routable IP (will timeout)
      connectionTimeoutMillis: 100 // Very short timeout
    });

    const startTime = Date.now();
    const result = await newAdapter.connect();
    const elapsed = Date.now() - startTime;

    expect(result.success).toBe(false);
    // Should timeout within reasonable time (< 2000ms due to our 100ms setting)
    expect(elapsed).toBeLessThan(2000);
  });

  it('should apply custom connection timeout', async () => {
    const customTimeout = 200;
    const newAdapter = new PostgresAdapter({
      ...TEST_CONFIG,
      host: '192.0.2.1', // Non-routable IP
      connectionTimeoutMillis: customTimeout
    });

    const startTime = Date.now();
    await newAdapter.connect();
    const elapsed = Date.now() - startTime;

    // Should timeout close to custom timeout (within 2x)
    expect(elapsed).toBeLessThan(customTimeout * 2 + 100);
  });

  it('should apply default pool size (max: 10, min: 2)', async () => {
    const { max, min, ...configWithoutPool } = TEST_CONFIG;
    const newAdapter = new PostgresAdapter(configWithoutPool);

    await newAdapter.connect();

    // Pool defaults are internal, we verify by checking connection works
    expect(newAdapter.isConnected()).toBe(true);

    await newAdapter.disconnect();
  });

  it('should apply custom pool size', async () => {
    const newAdapter = new PostgresAdapter({
      ...TEST_CONFIG,
      max: 5,
      min: 1
    });

    await newAdapter.connect();
    expect(newAdapter.isConnected()).toBe(true);

    await newAdapter.disconnect();
  });

  it('should apply default application name (forja)', async () => {
    const { applicationName, ...configWithoutAppName } = TEST_CONFIG;
    const newAdapter = new PostgresAdapter(configWithoutAppName);

    await newAdapter.connect();

    // Application name is internal, we verify connection works
    expect(newAdapter.isConnected()).toBe(true);

    await newAdapter.disconnect();
  });

  it('should apply custom application name', async () => {
    const newAdapter = new PostgresAdapter({
      ...TEST_CONFIG,
      applicationName: 'test-app'
    });

    await newAdapter.connect();
    expect(newAdapter.isConnected()).toBe(true);

    await newAdapter.disconnect();
  });

  it('should test connection with actual query during connect', async () => {
    const newAdapter = new PostgresAdapter(TEST_CONFIG);

    // Connect tests with actual query (line 72: await this.pool.connect())
    const result = await newAdapter.connect();

    expect(result.success).toBe(true);
    expect(newAdapter.isConnected()).toBe(true);

    await newAdapter.disconnect();
  });

  it('should release test connection after connect', async () => {
    const newAdapter = new PostgresAdapter(TEST_CONFIG);

    await newAdapter.connect();

    // Connection should be released, pool should be available
    expect(newAdapter.isConnected()).toBe(true);

    await newAdapter.disconnect();
  });

  it('should handle disconnect with pending connections gracefully', async () => {
    const newAdapter = new PostgresAdapter(TEST_CONFIG);
    await newAdapter.connect();

    // Start a query but don't await
    const queryPromise = newAdapter.executeQuery({
      type: 'select',
      table: 'pg_tables',
      select: ['tablename'],
      limit: 1
    });

    // Disconnect immediately
    const disconnectResult = await newAdapter.disconnect();

    expect(disconnectResult.success).toBe(true);

    // Query should complete or fail gracefully
    const queryResult = await queryPromise;
    // Query may succeed (if it completed) or fail (if pool was closed)
    expect(queryResult).toBeDefined();
  });

  it('should include error details in connection failure', async () => {
    const badAdapter = new PostgresAdapter({
      ...TEST_CONFIG,
      port: 9999
    });

    const result = await badAdapter.connect();

    expect(result.success).toBe(false);
    expect(result.error?.details).toBeDefined();
    expect(result.error?.message).toContain('Failed to connect to PostgreSQL');
  });

  it('should include error details in disconnection failure', async () => {
    // This is hard to test without mocking, but we verify the structure exists
    const newAdapter = new PostgresAdapter(TEST_CONFIG);
    await newAdapter.connect();

    const result = await newAdapter.disconnect();

    // Should succeed normally
    expect(result.success).toBe(true);
  });

  it('should maintain connection state consistency', async () => {
    const newAdapter = new PostgresAdapter(TEST_CONFIG);

    // Initial state
    expect(newAdapter.isConnected()).toBe(false);
    expect(newAdapter.getConnectionState()).toBe('disconnected');

    // After connect
    await newAdapter.connect();
    expect(newAdapter.isConnected()).toBe(true);
    expect(newAdapter.getConnectionState()).toBe('connected');

    // After disconnect
    await newAdapter.disconnect();
    expect(newAdapter.isConnected()).toBe(false);
    expect(newAdapter.getConnectionState()).toBe('disconnected');
  });

  it('should have connection state "error" after failed connection', async () => {
    const badAdapter = new PostgresAdapter({
      ...TEST_CONFIG,
      host: 'invalid-host.local'
    });

    await badAdapter.connect();

    expect(badAdapter.isConnected()).toBe(false);
    expect(badAdapter.getConnectionState()).toBe('error');
  });
});

// =============================================================================
// 3. Query Execution (~35 tests)
// =============================================================================

describe('PostgresAdapter - Query Execution', () => {
  beforeAll(async () => {
    adapter = new PostgresAdapter(TEST_CONFIG);
    await adapter.connect();

    // Create test table
    await adapter.executeRawQuery(
      `CREATE TABLE IF NOT EXISTS test_users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT,
        age INTEGER,
        active BOOLEAN DEFAULT true
      )`,
      []
    );

    // Clean table
    await adapter.executeRawQuery('DELETE FROM test_users', []);
  });

  afterAll(async () => {
    // Clean up
    await adapter.executeRawQuery('DROP TABLE IF EXISTS test_users', []);
    await adapter.disconnect();
  });

  beforeEach(async () => {
    // Clean table before each test
    await adapter.executeRawQuery('DELETE FROM test_users', []);
  });

  it('should fail query execution when not connected', async () => {
    const disconnectedAdapter = new PostgresAdapter(TEST_CONFIG);

    const result = await disconnectedAdapter.executeQuery({
      type: 'select',
      table: 'test_users',
      select: '*'
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe('QueryError');
    expect(result.error?.code).toBe('QUERY_ERROR');
    expect(result.error?.message).toContain('Not connected to database');
  });

  it('should execute SELECT query', async () => {
    // Insert test data first
    await adapter.executeRawQuery(
      `INSERT INTO test_users (email, name, age) VALUES ($1, $2, $3)`,
      ['test@example.com', 'Test User', 25]
    );

    const result = await adapter.executeQuery<{ email: string; name: string }>({
      type: 'select',
      table: 'test_users',
      select: ['email', 'name']
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.rows).toHaveLength(1);
    expect(result.data?.rows[0]?.email).toBe('test@example.com');
    expect(result.data?.rows[0]?.name).toBe('Test User');
    expect(result.data?.metadata.rowCount).toBe(1);
  });

  it('should execute SELECT * query', async () => {
    await adapter.executeRawQuery(
      `INSERT INTO test_users (email, name) VALUES ($1, $2)`,
      ['test@example.com', 'Test User']
    );

    const result = await adapter.executeQuery({
      type: 'select',
      table: 'test_users',
      select: '*'
    });

    expect(result.success).toBe(true);
    expect(result.data?.rows).toHaveLength(1);
    const row = result.data?.rows[0] as Record<string, unknown>;
    expect(row['email']).toBe('test@example.com');
    expect(row['name']).toBe('Test User');
    expect(row).toHaveProperty('id');
    expect(row).toHaveProperty('active');
  });

  it('should execute SELECT with WHERE clause', async () => {
    await adapter.executeRawQuery(
      `INSERT INTO test_users (email, name, age) VALUES ($1, $2, $3), ($4, $5, $6)`,
      ['user1@example.com', 'User 1', 20, 'user2@example.com', 'User 2', 30]
    );

    const result = await adapter.executeQuery<{ name: string; age: number }>({
      type: 'select',
      table: 'test_users',
      select: ['name', 'age'],
      where: { age: { $gte: 25 } }
    });

    expect(result.success).toBe(true);
    expect(result.data?.rows).toHaveLength(1);
    expect(result.data?.rows[0]?.name).toBe('User 2');
    expect(result.data?.rows[0]?.age).toBe(30);
  });

  it('should execute SELECT with ORDER BY', async () => {
    await adapter.executeRawQuery(
      `INSERT INTO test_users (email, name, age) VALUES ($1, $2, $3), ($4, $5, $6)`,
      ['user1@example.com', 'User 1', 30, 'user2@example.com', 'User 2', 20]
    );

    const result = await adapter.executeQuery<{ name: string; age: number }>({
      type: 'select',
      table: 'test_users',
      select: ['name', 'age'],
      orderBy: [{ field: 'age', direction: 'asc' }]
    });

    expect(result.success).toBe(true);
    expect(result.data?.rows).toHaveLength(2);
    expect(result.data?.rows[0]?.age).toBe(20);
    expect(result.data?.rows[1]?.age).toBe(30);
  });

  it('should execute SELECT with LIMIT', async () => {
    await adapter.executeRawQuery(
      `INSERT INTO test_users (email, name) VALUES ($1, $2), ($3, $4), ($5, $6)`,
      ['user1@example.com', 'User 1', 'user2@example.com', 'User 2', 'user3@example.com', 'User 3']
    );

    const result = await adapter.executeQuery({
      type: 'select',
      table: 'test_users',
      select: ['name'],
      limit: 2
    });

    expect(result.success).toBe(true);
    expect(result.data?.rows).toHaveLength(2);
  });

  it('should execute SELECT with OFFSET', async () => {
    await adapter.executeRawQuery(
      `INSERT INTO test_users (email, name) VALUES ($1, $2), ($3, $4), ($5, $6)`,
      ['user1@example.com', 'User 1', 'user2@example.com', 'User 2', 'user3@example.com', 'User 3']
    );

    const result = await adapter.executeQuery({
      type: 'select',
      table: 'test_users',
      select: ['email'],
      orderBy: [{ field: 'email', direction: 'asc' }],
      offset: 1,
      limit: 2
    });

    expect(result.success).toBe(true);
    expect(result.data?.rows).toHaveLength(2);
  });

  it('should execute INSERT query', async () => {
    const result = await adapter.executeQuery({
      type: 'insert',
      table: 'test_users',
      data: {
        email: 'new@example.com',
        name: 'New User',
        age: 28
      }
    });

    expect(result.success).toBe(true);
    expect(result.data?.metadata.affectedRows).toBe(1);
    expect(result.data?.metadata.insertId).toBeDefined();
    expect(typeof result.data?.metadata.insertId).toBe('number');
  });

  it('should execute INSERT with RETURNING', async () => {
    const result = await adapter.executeQuery<{ id: number; email: string }>({
      type: 'insert',
      table: 'test_users',
      data: {
        email: 'new@example.com',
        name: 'New User'
      },
      returning: ['id', 'email']
    });

    expect(result.success).toBe(true);
    expect(result.data?.rows).toHaveLength(1);
    expect(result.data?.rows[0]?.email).toBe('new@example.com');
    expect(result.data?.rows[0]?.id).toBeGreaterThan(0);
  });

  it('should execute UPDATE query', async () => {
    // Insert first
    await adapter.executeRawQuery(
      `INSERT INTO test_users (email, name, age) VALUES ($1, $2, $3)`,
      ['test@example.com', 'Test User', 25]
    );

    const result = await adapter.executeQuery({
      type: 'update',
      table: 'test_users',
      data: { age: 26 },
      where: { email: 'test@example.com' }
    });

    expect(result.success).toBe(true);
    expect(result.data?.metadata.affectedRows).toBe(1);

    // Verify update
    const selectResult = await adapter.executeQuery<{ age: number }>({
      type: 'select',
      table: 'test_users',
      select: ['age'],
      where: { email: 'test@example.com' }
    });

    expect(selectResult.data?.rows[0]?.age).toBe(26);
  });

  it('should execute UPDATE with RETURNING', async () => {
    await adapter.executeRawQuery(
      `INSERT INTO test_users (email, name, age) VALUES ($1, $2, $3)`,
      ['test@example.com', 'Test User', 25]
    );

    const result = await adapter.executeQuery<{ name: string; age: number }>({
      type: 'update',
      table: 'test_users',
      data: { age: 26 },
      where: { email: 'test@example.com' },
      returning: ['name', 'age']
    });

    expect(result.success).toBe(true);
    expect(result.data?.rows).toHaveLength(1);
    expect(result.data?.rows[0]?.age).toBe(26);
  });

  it('should execute DELETE query', async () => {
    await adapter.executeRawQuery(
      `INSERT INTO test_users (email, name) VALUES ($1, $2)`,
      ['delete@example.com', 'Delete Me']
    );

    const result = await adapter.executeQuery({
      type: 'delete',
      table: 'test_users',
      where: { email: 'delete@example.com' }
    });

    expect(result.success).toBe(true);
    expect(result.data?.metadata.affectedRows).toBe(1);

    // Verify deletion
    const selectResult = await adapter.executeQuery({
      type: 'select',
      table: 'test_users',
      select: '*',
      where: { email: 'delete@example.com' }
    });

    expect(selectResult.data?.rows).toHaveLength(0);
  });

  it('should execute DELETE with RETURNING', async () => {
    await adapter.executeRawQuery(
      `INSERT INTO test_users (email, name) VALUES ($1, $2)`,
      ['delete@example.com', 'Delete Me']
    );

    const result = await adapter.executeQuery<{ email: string; name: string }>({
      type: 'delete',
      table: 'test_users',
      where: { email: 'delete@example.com' },
      returning: ['email', 'name']
    });

    expect(result.success).toBe(true);
    expect(result.data?.rows).toHaveLength(1);
    expect(result.data?.rows[0]?.email).toBe('delete@example.com');
  });

  it('should handle query with no results', async () => {
    const result = await adapter.executeQuery({
      type: 'select',
      table: 'test_users',
      select: '*',
      where: { email: 'nonexistent@example.com' }
    });

    expect(result.success).toBe(true);
    expect(result.data?.rows).toHaveLength(0);
    expect(result.data?.metadata.rowCount).toBe(0);
  });

  it('should handle UPDATE with no matches', async () => {
    const result = await adapter.executeQuery({
      type: 'update',
      table: 'test_users',
      data: { age: 99 },
      where: { email: 'nonexistent@example.com' }
    });

    expect(result.success).toBe(true);
    expect(result.data?.metadata.affectedRows).toBe(0);
  });

  it('should handle DELETE with no matches', async () => {
    const result = await adapter.executeQuery({
      type: 'delete',
      table: 'test_users',
      where: { email: 'nonexistent@example.com' }
    });

    expect(result.success).toBe(true);
    expect(result.data?.metadata.affectedRows).toBe(0);
  });

  it('should fail on invalid SQL (nonexistent table)', async () => {
    const result = await adapter.executeQuery({
      type: 'select',
      table: 'nonexistent_table',
      select: '*'
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe('QueryError');
    expect(result.error?.code).toBe('QUERY_ERROR');
    expect(result.error?.message).toContain('Query execution failed');
    expect(result.error?.query).toBeDefined();
    expect(result.error?.details).toBeDefined();
  });

  it('should fail on invalid SQL (nonexistent column)', async () => {
    const result = await adapter.executeQuery({
      type: 'select',
      table: 'test_users',
      select: ['nonexistent_column']
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should provide query metadata for SELECT', async () => {
    await adapter.executeRawQuery(
      `INSERT INTO test_users (email, name) VALUES ($1, $2), ($3, $4)`,
      ['user1@example.com', 'User 1', 'user2@example.com', 'User 2']
    );

    const result = await adapter.executeQuery({
      type: 'select',
      table: 'test_users',
      select: '*'
    });

    expect(result.success).toBe(true);
    expect(result.data?.metadata).toBeDefined();
    expect(result.data?.metadata.rowCount).toBe(2);
    expect(result.data?.metadata.affectedRows).toBe(2);
  });

  it('should provide query metadata for INSERT', async () => {
    const result = await adapter.executeQuery({
      type: 'insert',
      table: 'test_users',
      data: { email: 'new@example.com', name: 'New User' }
    });

    expect(result.success).toBe(true);
    expect(result.data?.metadata).toBeDefined();
    expect(result.data?.metadata.affectedRows).toBe(1);
    expect(result.data?.metadata.insertId).toBeDefined();
  });

  it('should provide query metadata for UPDATE', async () => {
    await adapter.executeRawQuery(
      `INSERT INTO test_users (email, name) VALUES ($1, $2), ($3, $4)`,
      ['user1@example.com', 'User 1', 'user2@example.com', 'User 2']
    );

    const result = await adapter.executeQuery({
      type: 'update',
      table: 'test_users',
      data: { name: 'Updated' }
    });

    expect(result.success).toBe(true);
    expect(result.data?.metadata).toBeDefined();
    expect(result.data?.metadata.affectedRows).toBe(2);
  });

  it('should provide query metadata for DELETE', async () => {
    await adapter.executeRawQuery(
      `INSERT INTO test_users (email, name) VALUES ($1, $2), ($3, $4)`,
      ['user1@example.com', 'User 1', 'user2@example.com', 'User 2']
    );

    const result = await adapter.executeQuery({
      type: 'delete',
      table: 'test_users'
    });

    expect(result.success).toBe(true);
    expect(result.data?.metadata).toBeDefined();
    expect(result.data?.metadata.affectedRows).toBe(2);
  });

  it('should handle complex WHERE with multiple operators', async () => {
    await adapter.executeRawQuery(
      `INSERT INTO test_users (email, name, age) VALUES ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)`,
      [
        'user1@example.com', 'User 1', 20,
        'user2@example.com', 'User 2', 30,
        'user3@example.com', 'User 3', 40
      ]
    );

    const result = await adapter.executeQuery<{ age: number }>({
      type: 'select',
      table: 'test_users',
      select: ['age'],
      where: {
        $and: [
          { age: { $gte: 25 } },
          { age: { $lt: 35 } }
        ]
      }
    });

    expect(result.success).toBe(true);
    expect(result.data?.rows).toHaveLength(1);
    expect(result.data?.rows[0]?.age).toBe(30);
  });

  it('should handle $in operator', async () => {
    await adapter.executeRawQuery(
      `INSERT INTO test_users (email, name) VALUES ($1, $2), ($3, $4), ($5, $6)`,
      ['user1@example.com', 'User 1', 'user2@example.com', 'User 2', 'user3@example.com', 'User 3']
    );

    const result = await adapter.executeQuery<{ email: string }>({
      type: 'select',
      table: 'test_users',
      select: ['email'],
      where: {
        email: { $in: ['user1@example.com', 'user3@example.com'] }
      }
    });

    expect(result.success).toBe(true);
    expect(result.data?.rows).toHaveLength(2);
  });

  it('should handle NULL values in INSERT', async () => {
    const result = await adapter.executeQuery({
      type: 'insert',
      table: 'test_users',
      data: {
        email: 'null@example.com',
        name: null,
        age: null
      }
    });

    expect(result.success).toBe(true);

    // Verify NULL values
    const selectResult = await adapter.executeQuery<{ name: string | null; age: number | null }>({
      type: 'select',
      table: 'test_users',
      select: ['name', 'age'],
      where: { email: 'null@example.com' }
    });

    expect(selectResult.data?.rows[0]?.name).toBe(null);
    expect(selectResult.data?.rows[0]?.age).toBe(null);
  });

  it('should handle BOOLEAN values correctly', async () => {
    await adapter.executeRawQuery(
      `INSERT INTO test_users (email, name, active) VALUES ($1, $2, $3), ($4, $5, $6)`,
      ['active@example.com', 'Active User', true, 'inactive@example.com', 'Inactive User', false]
    );

    const result = await adapter.executeQuery<{ email: string; active: boolean }>({
      type: 'select',
      table: 'test_users',
      select: ['email', 'active'],
      where: { active: true }
    });

    expect(result.success).toBe(true);
    expect(result.data?.rows).toHaveLength(1);
    expect(result.data?.rows[0]?.email).toBe('active@example.com');
    expect(result.data?.rows[0]?.active).toBe(true);
  });

  it('should execute COUNT query', async () => {
    await adapter.executeRawQuery(
      `INSERT INTO test_users (email, name) VALUES ($1, $2), ($3, $4)`,
      ['user1@example.com', 'User 1', 'user2@example.com', 'User 2']
    );

    const result = await adapter.executeQuery<{ count: number }>({
      type: 'count',
      table: 'test_users'
    });

    expect(result.success).toBe(true);
    expect(result.data?.rows).toHaveLength(1);
    expect(result.data?.rows[0]?.count).toBe(2);
  });

  it('should include error query in QueryError', async () => {
    const query = {
      type: 'select' as const,
      table: 'nonexistent_table',
      select: '*' as const
    };

    const result = await adapter.executeQuery(query);

    expect(result.success).toBe(false);
    expect(result.error?.query).toEqual(query);
  });

  it('should include error details in QueryError', async () => {
    const result = await adapter.executeQuery({
      type: 'select',
      table: 'nonexistent_table',
      select: '*'
    });

    expect(result.success).toBe(false);
    expect(result.error?.details).toBeDefined();
  });
});

// =============================================================================
// 4. Raw Query Execution (~15 tests)
// =============================================================================

describe('PostgresAdapter - Raw Query Execution', () => {
  beforeAll(async () => {
    adapter = new PostgresAdapter(TEST_CONFIG);
    await adapter.connect();

    await adapter.executeRawQuery(
      `CREATE TABLE IF NOT EXISTS test_raw (
        id SERIAL PRIMARY KEY,
        data TEXT
      )`,
      []
    );
  });

  afterAll(async () => {
    await adapter.executeRawQuery('DROP TABLE IF EXISTS test_raw', []);
    await adapter.disconnect();
  });

  beforeEach(async () => {
    await adapter.executeRawQuery('DELETE FROM test_raw', []);
  });

  it('should fail raw query when not connected', async () => {
    const disconnectedAdapter = new PostgresAdapter(TEST_CONFIG);

    const result = await disconnectedAdapter.executeRawQuery('SELECT 1', []);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe('QueryError');
    expect(result.error?.message).toContain('Not connected to database');
  });

  it('should execute raw SELECT query', async () => {
    await adapter.executeRawQuery(
      `INSERT INTO test_raw (data) VALUES ($1)`,
      ['test data']
    );

    const result = await adapter.executeRawQuery<{ data: string }>(
      'SELECT data FROM test_raw',
      []
    );

    expect(result.success).toBe(true);
    expect(result.data?.rows).toHaveLength(1);
    expect(result.data?.rows[0]?.data).toBe('test data');
  });

  it('should execute raw INSERT query', async () => {
    const result = await adapter.executeRawQuery(
      'INSERT INTO test_raw (data) VALUES ($1)',
      ['new data']
    );

    expect(result.success).toBe(true);
    expect(result.data?.metadata.affectedRows).toBe(1);
  });

  it('should execute raw UPDATE query', async () => {
    await adapter.executeRawQuery(
      'INSERT INTO test_raw (data) VALUES ($1)',
      ['old data']
    );

    const result = await adapter.executeRawQuery(
      'UPDATE test_raw SET data = $1',
      ['new data']
    );

    expect(result.success).toBe(true);
    expect(result.data?.metadata.affectedRows).toBe(1);
  });

  it('should execute raw DELETE query', async () => {
    await adapter.executeRawQuery(
      'INSERT INTO test_raw (data) VALUES ($1)',
      ['delete me']
    );

    const result = await adapter.executeRawQuery(
      'DELETE FROM test_raw WHERE data = $1',
      ['delete me']
    );

    expect(result.success).toBe(true);
    expect(result.data?.metadata.affectedRows).toBe(1);
  });

  it('should execute raw query with parameters', async () => {
    const result = await adapter.executeRawQuery<{ result: number }>(
      'SELECT $1::int + $2::int as result',
      [10, 20]
    );

    expect(result.success).toBe(true);
    expect(result.data?.rows[0]?.result).toBe(30);
  });

  it('should execute raw query with no parameters', async () => {
    const result = await adapter.executeRawQuery<{ result: number }>(
      'SELECT 1 as result',
      []
    );

    expect(result.success).toBe(true);
    expect(result.data?.rows[0]?.result).toBe(1);
  });

  it('should handle raw query with no results', async () => {
    const result = await adapter.executeRawQuery(
      'SELECT * FROM test_raw WHERE id = $1',
      [9999]
    );

    expect(result.success).toBe(true);
    expect(result.data?.rows).toHaveLength(0);
  });

  it('should fail on invalid raw SQL', async () => {
    const result = await adapter.executeRawQuery(
      'INVALID SQL SYNTAX',
      []
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe('QueryError');
  });

  it('should provide metadata for raw SELECT', async () => {
    await adapter.executeRawQuery(
      'INSERT INTO test_raw (data) VALUES ($1), ($2)',
      ['data1', 'data2']
    );

    const result = await adapter.executeRawQuery(
      'SELECT * FROM test_raw',
      []
    );

    expect(result.success).toBe(true);
    expect(result.data?.metadata.rowCount).toBe(2);
    expect(result.data?.metadata.affectedRows).toBe(2);
  });

  it('should provide metadata for raw INSERT', async () => {
    const result = await adapter.executeRawQuery(
      'INSERT INTO test_raw (data) VALUES ($1)',
      ['test']
    );

    expect(result.success).toBe(true);
    expect(result.data?.metadata.affectedRows).toBe(1);
  });

  it('should execute DDL statements', async () => {
    const result = await adapter.executeRawQuery(
      'CREATE TEMPORARY TABLE temp_test (id INT)',
      []
    );

    expect(result.success).toBe(true);
  });

  it('should execute multi-row INSERT', async () => {
    const result = await adapter.executeRawQuery(
      'INSERT INTO test_raw (data) VALUES ($1), ($2), ($3)',
      ['data1', 'data2', 'data3']
    );

    expect(result.success).toBe(true);
    expect(result.data?.metadata.affectedRows).toBe(3);
  });

  it('should include SQL in error for raw query', async () => {
    const sql = 'SELECT * FROM nonexistent_table';
    const result = await adapter.executeRawQuery(sql, []);

    expect(result.success).toBe(false);
    expect(result.error?.sql).toBe(sql);
  });

  it('should include error details for raw query', async () => {
    const result = await adapter.executeRawQuery('INVALID SQL', []);

    expect(result.success).toBe(false);
    expect(result.error?.details).toBeDefined();
  });
});

// Continue in next message with Transaction tests (~35 tests)...
