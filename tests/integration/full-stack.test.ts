import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostgresAdapter } from '../../src/adapters/postgres/adapter';
import { SchemaRegistry, defineSchema } from '../../src/core/schema/types';
import { PluginRegistry } from '../../src/plugins/base/types';
import { createUnifiedHandler as createHandler } from '../../src/api/handler/factory';
import { Pool } from 'pg';

// Mock pg
vi.mock('pg', () => {
  const mPool = {
    connect: vi.fn(),
    query: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  };
  return { Pool: vi.fn(() => mPool) };
});

describe('Full Stack Integration', () => {
  let adapter: PostgresAdapter;
  let registry: SchemaRegistry;
  let pluginRegistry: PluginRegistry;
  let mockPool: any;

  const userSchema = defineSchema({
    name: 'user',
    fields: {
      username: { type: 'string', required: true, unique: true },
      email: { type: 'string', required: true },
      age: { type: 'number' }
    }
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup Adapter
    adapter = new PostgresAdapter({
      host: 'localhost',
      port: 5432,
      database: 'test_db',
      user: 'admin',
      password: 'password'
    });
    mockPool = new Pool();
    (adapter as any).pool = mockPool;
    (adapter as any).state = 'connected';

    // Setup Core
    registry = new SchemaRegistry();
    registry.register(userSchema);

    pluginRegistry = new PluginRegistry();
  });

  it('should handle lifecycle: Migration -> API Create -> API Find', async () => {
    // 1. Simulate Migration (Table Creation)
    mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // CREATE TABLE

    const migrationResult = await adapter.createTable(userSchema);
    expect(migrationResult.success).toBe(true);
    expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE "user"'));

    // 2. API Create (Dispatcher -> Adapter)
    mockPool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 1, username: 'johndoe', email: 'john@example.com', age: 30 }]
    });

    const handler = createHandler({
      adapter,
      schema: userSchema
    });

    const createResult = await handler({
      method: 'POST',
      body: { username: 'johndoe', email: 'john@example.com', age: 30 },
      query: {},
      params: {},
      headers: {},
      user: undefined,
      metadata: {}
    });

    if (createResult.status !== 200 && createResult.status !== 201) {
      console.error('Create failed:', JSON.stringify(createResult.body, null, 2));
    }
    expect(createResult.status).toBe(201);
    if ('data' in createResult.body) {
      expect(createResult.body.data).toMatchObject({
        username: 'johndoe',
        email: 'john@example.com'
      });
    } else {
      throw new Error('Expected success response: ' + JSON.stringify(createResult.body));
    }

    // 3. API Find (Dispatcher -> Adapter)
    mockPool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 1, username: 'johndoe', email: 'john@example.com', age: 30 }]
    });

    const findResult = await handler({
      method: 'GET',
      body: {},
      query: { 'where[username]': 'johndoe' },
      params: {},
      headers: {},
      user: undefined,
      metadata: {}
    });

    if (findResult.status !== 200) {
      console.error('Find failed:', JSON.stringify(findResult.body, null, 2));
    }
    expect(findResult.status).toBe(200);
    if ('data' in findResult.body) {
      expect(Array.isArray(findResult.body.data)).toBe(true);
      expect((findResult.body.data as any[])[0]).toMatchObject({ username: 'johndoe' });
    } else {
      throw new Error('Expected success response: ' + JSON.stringify(findResult.body));
    }

    // Verify SQL generated for Find
    const findCall = mockPool.query.mock.calls.find((call: any[]) => call[0].includes('SELECT'));
    expect(findCall[0]).toContain('WHERE "username" = $1');
    expect(findCall[1]).toEqual(['johndoe', 25, 0]);
  });

  it('should handle validation errors correctly through the stack', async () => {
    // Attempt to create user without required field
    const handler = createHandler({
      adapter,
      schema: userSchema
    });

    const result = await handler({
      method: 'POST',
      body: { age: 25 }, // Missing username/email
      query: {},
      params: {},
      headers: {},
      user: undefined,
      metadata: {}
    });

    expect(result.status).toBe(400);
    if ('error' in result.body) {
      expect(result.body.error).toBeDefined();
    } else {
      throw new Error('Expected error response');
    }
    // mockPool.query should NOT have been called due to validation failure
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});
