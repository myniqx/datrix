/**
 * MySQL Adapter Tests
 *
 * Unit tests for MySQL adapter construction, configuration, and connection string parsing.
 * Integration tests require a running MySQL server and are in adapter.integration.test.ts
 */

import { createMySQLAdapter, MySQLAdapter, MySQLConfig } from '../src';
import { describe, it, expect } from 'vitest';

// =============================================================================
// Test Configuration
// =============================================================================

const TEST_CONFIG: MySQLConfig = {
  host: 'localhost',
  port: 3306,
  database: 'forja_test',
  user: 'root',
  password: 'password'
};

// =============================================================================
// 1. Adapter Construction and Configuration
// =============================================================================

describe('MySQLAdapter - Construction and Configuration', () => {
  it('should create adapter with factory function', () => {
    const adapter = createMySQLAdapter(TEST_CONFIG);

    expect(adapter).toBeInstanceOf(MySQLAdapter);
    expect(adapter.name).toBe('mysql');
  });

  it('should create adapter with constructor', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);

    expect(adapter).toBeInstanceOf(MySQLAdapter);
    expect(adapter.name).toBe('mysql');
  });

  it('should have correct name', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(adapter.name).toBe('mysql');
  });

  it('should store config', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(adapter.config.database).toBe(TEST_CONFIG.database);
    expect(adapter.config.user).toBe(TEST_CONFIG.user);
  });

  it('should have minimal config (only required fields)', () => {
    const minimalConfig: MySQLConfig = {
      database: 'test',
      user: 'user',
      password: 'pass'
    };

    const adapter = new MySQLAdapter(minimalConfig);
    expect(adapter.config.database).toBe('test');
    expect(adapter.config.user).toBe('user');
  });

  it('should have full config with all optional fields', () => {
    const fullConfig: MySQLConfig = {
      host: 'localhost',
      port: 3306,
      database: 'test',
      user: 'user',
      password: 'pass',
      ssl: {
        rejectUnauthorized: false,
        ca: 'ca-cert',
        cert: 'client-cert',
        key: 'client-key'
      },
      connectionLimit: 20,
      queueLimit: 100,
      waitForConnections: true,
      connectTimeout: 15000,
      charset: 'utf8mb4',
      timezone: 'UTC'
    };

    const adapter = new MySQLAdapter(fullConfig);
    expect(adapter.config.connectionLimit).toBe(20);
    expect(adapter.config.charset).toBe('utf8mb4');
  });

  it('should initialize in disconnected state', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(adapter.isConnected()).toBe(false);
    expect(adapter.getConnectionState()).toBe('disconnected');
  });

  it('should have ssl: false config', () => {
    const adapter = new MySQLAdapter({ ...TEST_CONFIG, ssl: false });
    expect(adapter.config.ssl).toBe(false);
  });

  it('should have ssl: true config', () => {
    const adapter = new MySQLAdapter({ ...TEST_CONFIG, ssl: true });
    expect(adapter.config.ssl).toBe(true);
  });

  it('should have ssl object config', () => {
    const sslConfig = { rejectUnauthorized: false };
    const adapter = new MySQLAdapter({ ...TEST_CONFIG, ssl: sslConfig });
    expect(adapter.config.ssl).toEqual(sslConfig);
  });

  it('should use default connectionLimit if not specified', () => {
    const { connectionLimit, ...configWithoutLimit } = { ...TEST_CONFIG, connectionLimit: undefined };
    const adapter = new MySQLAdapter(configWithoutLimit);
    expect(adapter.config.connectionLimit).toBeUndefined();
  });

  it('should have custom connection limit', () => {
    const adapter = new MySQLAdapter({ ...TEST_CONFIG, connectionLimit: 50 });
    expect(adapter.config.connectionLimit).toBe(50);
  });

  it('should have custom timeouts', () => {
    const adapter = new MySQLAdapter({
      ...TEST_CONFIG,
      connectTimeout: 15000
    });
    expect(adapter.config.connectTimeout).toBe(15000);
  });

  it('should have custom charset', () => {
    const adapter = new MySQLAdapter({
      ...TEST_CONFIG,
      charset: 'utf8mb4'
    });
    expect(adapter.config.charset).toBe('utf8mb4');
  });

  it('should have custom timezone', () => {
    const adapter = new MySQLAdapter({
      ...TEST_CONFIG,
      timezone: 'UTC'
    });
    expect(adapter.config.timezone).toBe('UTC');
  });
});

// =============================================================================
// 2. Connection String Parsing
// =============================================================================

describe('MySQLAdapter - Connection String', () => {
  it('should parse connection string and merge with config', () => {
    const adapter = new MySQLAdapter({
      connectionString: 'mysql://testuser:testpass@testhost:3307/testdb',
      database: 'ignored',
      user: 'ignored',
      password: 'ignored'
    });

    expect(adapter.config.host).toBe('testhost');
    expect(adapter.config.port).toBe(3307);
    expect(adapter.config.database).toBe('testdb');
    expect(adapter.config.user).toBe('testuser');
    expect(adapter.config.password).toBe('testpass');
  });

  it('should use default port from connection string', () => {
    const adapter = new MySQLAdapter({
      connectionString: 'mysql://user:pass@host/db',
      database: 'ignored',
      user: 'ignored',
      password: 'ignored'
    });

    expect(adapter.config.port).toBe(3306);
  });

  it('should handle URL-encoded credentials', () => {
    const adapter = new MySQLAdapter({
      connectionString: 'mysql://user%40domain:pass%23word@host/db',
      database: 'ignored',
      user: 'ignored',
      password: 'ignored'
    });

    expect(adapter.config.user).toBe('user@domain');
    expect(adapter.config.password).toBe('pass#word');
  });

  it('should handle connection string with query params', () => {
    const adapter = new MySQLAdapter({
      connectionString: 'mysql://user:pass@host/db?charset=utf8mb4&connectionLimit=20',
      database: 'ignored',
      user: 'ignored',
      password: 'ignored'
    });

    expect(adapter.config['charset']).toBe('utf8mb4');
    expect(adapter.config['connectionLimit']).toBe(20);
  });
});

// =============================================================================
// 3. Connection State (Without actual connection)
// =============================================================================

describe('MySQLAdapter - Connection State', () => {
  it('should start in disconnected state', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(adapter.isConnected()).toBe(false);
    expect(adapter.getConnectionState()).toBe('disconnected');
  });

  it('should report not connected before connect()', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(adapter.isConnected()).toBe(false);
  });

  it('should have getConnectionState method', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(typeof adapter.getConnectionState).toBe('function');
  });

  it('should have isConnected method', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(typeof adapter.isConnected).toBe('function');
  });

  it('should have connect method', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(typeof adapter.connect).toBe('function');
  });

  it('should have disconnect method', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(typeof adapter.disconnect).toBe('function');
  });

  it('should have executeQuery method', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(typeof adapter.executeQuery).toBe('function');
  });

  it('should have executeRawQuery method', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(typeof adapter.executeRawQuery).toBe('function');
  });

  it('should have beginTransaction method', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(typeof adapter.beginTransaction).toBe('function');
  });

  it('should have createTable method', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(typeof adapter.createTable).toBe('function');
  });

  it('should have dropTable method', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(typeof adapter.dropTable).toBe('function');
  });

  it('should have alterTable method', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(typeof adapter.alterTable).toBe('function');
  });

  it('should have addIndex method', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(typeof adapter.addIndex).toBe('function');
  });

  it('should have dropIndex method', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(typeof adapter.dropIndex).toBe('function');
  });

  it('should have getTables method', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(typeof adapter.getTables).toBe('function');
  });

  it('should have getTableSchema method', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(typeof adapter.getTableSchema).toBe('function');
  });

  it('should have tableExists method', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(typeof adapter.tableExists).toBe('function');
  });
});

// =============================================================================
// 4. Query Execution Without Connection (Error cases)
// =============================================================================

describe('MySQLAdapter - Query Execution Without Connection', () => {
  it('should fail executeQuery when not connected', async () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);

    const result = await adapter.executeQuery({
      type: 'select',
      table: 'users'
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe('QueryError');
    expect(result.error?.message).toContain('Not connected');
  });

  it('should fail executeRawQuery when not connected', async () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);

    const result = await adapter.executeRawQuery('SELECT 1', []);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe('QueryError');
    expect(result.error?.message).toContain('Not connected');
  });

  it('should fail beginTransaction when not connected', async () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);

    const result = await adapter.beginTransaction();

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe('TransactionError');
    expect(result.error?.message).toContain('Not connected');
  });

  it('should fail createTable when not connected', async () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);

    const result = await adapter.createTable({
      name: 'test',
      fields: { id: { type: 'number', required: true } }
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe('MigrationError');
    expect(result.error?.message).toContain('Not connected');
  });

  it('should fail dropTable when not connected', async () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);

    const result = await adapter.dropTable('test');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe('MigrationError');
  });

  it('should fail alterTable when not connected', async () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);

    const result = await adapter.alterTable('test', [
      { type: 'addColumn', column: 'new_col', definition: { type: 'string' } }
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe('MigrationError');
  });

  it('should fail addIndex when not connected', async () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);

    const result = await adapter.addIndex('test', { fields: ['col1'] });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe('MigrationError');
  });

  it('should fail dropIndex when not connected', async () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);

    const result = await adapter.dropIndex('test', 'idx_test');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe('MigrationError');
  });

  it('should fail getTables when not connected', async () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);

    const result = await adapter.getTables();

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe('QueryError');
  });

  it('should fail getTableSchema when not connected', async () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);

    const result = await adapter.getTableSchema('test');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe('QueryError');
  });

  it('should return false for tableExists when not connected', async () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);

    const exists = await adapter.tableExists('test');

    expect(exists).toBe(false);
  });
});

// =============================================================================
// 5. Disconnect Behavior
// =============================================================================

describe('MySQLAdapter - Disconnect Behavior', () => {
  it('should succeed disconnect when already disconnected', async () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);

    const result = await adapter.disconnect();

    expect(result.success).toBe(true);
    expect(adapter.isConnected()).toBe(false);
  });

  it('should be idempotent for disconnect', async () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);

    const result1 = await adapter.disconnect();
    const result2 = await adapter.disconnect();

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
  });
});

// =============================================================================
// 6. MySQL-Specific Features
// =============================================================================

describe('MySQLAdapter - MySQL Specific', () => {
  it('should have mysql as adapter name', () => {
    const adapter = new MySQLAdapter(TEST_CONFIG);
    expect(adapter.name).toBe('mysql');
  });

  it('should support utf8mb4 charset', () => {
    const adapter = new MySQLAdapter({
      ...TEST_CONFIG,
      charset: 'utf8mb4'
    });
    expect(adapter.config.charset).toBe('utf8mb4');
  });

  it('should support timezone configuration', () => {
    const adapter = new MySQLAdapter({
      ...TEST_CONFIG,
      timezone: '+00:00'
    });
    expect(adapter.config.timezone).toBe('+00:00');
  });

  it('should support waitForConnections option', () => {
    const adapter = new MySQLAdapter({
      ...TEST_CONFIG,
      waitForConnections: false
    });
    expect(adapter.config.waitForConnections).toBe(false);
  });

  it('should support queueLimit option', () => {
    const adapter = new MySQLAdapter({
      ...TEST_CONFIG,
      queueLimit: 100
    });
    expect(adapter.config.queueLimit).toBe(100);
  });
});
