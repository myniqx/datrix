import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostgresAdapter } from '../../src/adapters/postgres/adapter';
import { SchemaRegistry, defineSchema } from '../../src/core/schema/types';
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

describe('SchemaRegistry validation', () => {
  let registry: SchemaRegistry;

  beforeEach(() => {
    registry = new SchemaRegistry();
  });

  const badSchema = defineSchema({
    name: 'bad_model',
    fields: {
      broken: {
        type: 'relation',
        model: 'non_existent_model', // Target does not exist
        kind: 'belongsTo'
      }
    }
  });

  it('should throw when registering a schema with broken relation', () => {
    expect(() => registry.register(badSchema)).toThrow();
  });
});

describe('Relation & Query Integration', () => {
  let adapter: PostgresAdapter;
  let registry: SchemaRegistry;
  let mockPool: any;
  const postSchema = defineSchema({
    name: 'post',
    fields: {
      title: { type: 'string', required: true },
      content: { type: 'string' },
      author: {
        type: 'relation',
        model: 'user',
        kind: 'belongsTo',
        foreignKey: 'authorId'
      }
    }
  });

  beforeEach(async () => {
    vi.clearAllMocks();

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

    registry = new SchemaRegistry();
    registry.register(postSchema);
  });

  it('1. Broken Relation: should handle request for non-existent model in schema', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const handler = createHandler({ adapter, schema: postSchema });
    const result = await handler({
      method: 'GET',
      body: {},
      query: { 'populate[invalid_relation]': 'true' },
      params: {},
      headers: {},
      user: undefined,
      metadata: {}
    });

    // Expecting strict error for invalid Populate (Validation happens before query)
    expect(result.status).toBe(400);
    expect((result.body as any).error.code).toBe('INVALID_RELATION');
  });

  it('should return 400 for non-existent fields', async () => {
    const handler = createHandler({ adapter, schema: postSchema });
    const result = await handler({
      method: 'GET',
      body: {},
      query: { 'fields[0]': 'non_existing' },
      params: {},
      headers: {},
      user: undefined,
      metadata: {}
    });

    expect(result.status).toBe(400);
    expect((result.body as any).error.code).toBe('INVALID_FIELD');
  });

  it('should NOT join when populate is absent', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const handler = createHandler({ adapter, schema: postSchema });
    await handler({
      method: 'GET',
      body: {},
      query: {},
      params: {},
      headers: {},
      user: undefined,
      metadata: {}
    });


    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).not.toContain('JOIN');

    // Snapshot verification for basic select
    expect(sql).toMatchInlineSnapshot(`
      "SELECT "post".* FROM "post" LIMIT $1 OFFSET $2"
    `);
  });

  it('2. Populate + Fields Conflict: should include FK for join even if not selected?', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ title: 'Test', author: { id: 1 } }] });

    const handler = createHandler({ adapter, schema: postSchema });

    await handler({
      method: 'GET',
      body: {},
      query: {
        'fields[0]': 'title',
        'populate[author]': 'true'
      },
      params: {},
      headers: {},
      user: undefined,
      metadata: {}
    });

    const callArgs = mockPool.query.mock.calls[0];
    const sql = callArgs[0];

    // Logic requires FK to be selected/joined properly
    expect(sql).toContain('"post"."title"');

    // Strict hardening: Checking that we attempt to join using the correct keys
    expect(sql).toContain('"post"."authorId"');
  });

  it('3. Unsupported Operator: should fail gracefully for unsupported operators', async () => {
    const handler = createHandler({ adapter, schema: postSchema });

    const result = await handler({
      method: 'GET',
      body: {},
      query: { 'where[title][$unknownOp]': 'val' },
      params: {},
      headers: {},
      user: undefined,
      metadata: {}
    });

    expect(result.status).toBe(400);
    expect((result.body as any).error.code).toBe('INVALID_VALUE');
  });

  it('4. Empty Result: should handle empty results with joins', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const handler = createHandler({ adapter, schema: postSchema });
    const result = await handler({
      method: 'GET',
      body: {},
      query: { 'populate[author]': 'true' },
      params: {},
      headers: {},
      user: undefined,
      metadata: {}
    });

    expect(result.status).toBe(200);
    if ('data' in result.body) {
      expect(result.body.data).toEqual([]);
    }
  });

  it('5. SQL Injection: should parameterize values', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const handler = createHandler({ adapter, schema: postSchema });

    await handler({
      method: 'GET',
      body: {},
      query: { 'where[title][$contains]': `%' OR 1=1 --` },
      params: {},
      headers: {},
      user: undefined,
      metadata: {}
    });

    const callArgs = mockPool.query.mock.calls[0];
    const sql = callArgs[0];
    const params = callArgs[1];

    expect(sql).not.toContain('1=1');
    expect(sql).not.toContain('--');
    expect(params[0]).toBe(`%${"%' OR 1=1 --"}%`);
    expect(sql).toMatch(/\$\d+/);
  });

  it('should handle complex query: Fields, Where, Populate', async () => {
    mockPool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: 101,
          title: 'Hello World',
          author: { id: 1, username: 'johndoe' }
        }
      ]
    });

    const handler = createHandler({
      adapter,
      schema: postSchema,
    });

    const result = await handler({
      method: 'GET',
      body: {},
      query: {
        'fields[0]': 'title',
        'where[title][$contains]': 'Hello',
        'populate[author][fields][0]': 'username'
      },
      params: {},
      headers: {},
      user: undefined,
      metadata: {}
    });

    expect(result.status).toBe(200);

    const callArgs = mockPool.query.mock.calls[0];
    const params = callArgs[1];

    // Params order might vary based on implementation but values should be present
    expect(params[0]).toBe('%Hello%');
    expect(params.at(-2)).toBe(25);
    expect(params.at(-1)).toBe(0);
  });
});
