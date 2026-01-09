/**
 * Relation & Populate Integration Tests - Happy Path
 *
 * Tests successful relation and populate operations:
 * - Basic SELECT without JOIN
 * - Populate with field selection
 * - Complex queries with fields, where, and populate
 * - Empty result handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostgresAdapter } from '../../packages/adapter-postgres/src';
import { SchemaRegistry, defineSchema } from '../../packages/types/src/core/schema';
import { createUnifiedHandler as createHandler } from '../../packages/api/src/handler/factory';
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

describe('Relation & Populate Integration - Happy Path', () => {
  let adapter: PostgresAdapter;
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
  });

  describe('Basic SELECT Operations', () => {
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

      const generatedSql = mockPool.query.mock.calls[0][0];
      expect(generatedSql).not.toContain('JOIN');

      // Snapshot verification for basic select
      expect(generatedSql).toMatchInlineSnapshot(`
        "SELECT "post".* FROM "post" LIMIT $1 OFFSET $2"
      `);
    });
  });

  describe('Populate with Field Selection', () => {
    it('should include FK for join even if not explicitly selected', async () => {
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
      const generatedSql = callArgs[0];

      // Logic requires FK to be selected/joined properly
      expect(generatedSql).toContain('"post"."title"');

      // Strict hardening: Checking that we attempt to join using the correct keys
      expect(generatedSql).toContain('"post"."authorId"');
    });
  });

  describe('Empty Results', () => {
    it('should handle empty results with joins', async () => {
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
  });

  describe('Complex Queries', () => {
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
});
