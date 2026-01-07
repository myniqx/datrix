import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PostgresAdapter } from 'forja-adapter-postgres';
import { SchemaRegistry, defineSchema } from 'forja-types/core/schema';
import { createUnifiedHandler as createHandler } from 'forja-api/handler/factory';
import { Pool } from 'pg';

// Mock types
interface MockPool {
  connect: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

// Test constants
const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_OFFSET = 0;

const TEST_USER = {
  id: 1,
  username: 'johndoe',
  email: 'john@example.com',
  age: 30
} as const;

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
  let mockPool: MockPool;

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
    mockPool = new Pool() as unknown as MockPool;
    (adapter as any).pool = mockPool;
    (adapter as any).state = 'connected';

    // Setup Core
    registry = new SchemaRegistry();
    registry.register(userSchema);
  });

  afterEach(async () => {
    // Cleanup
    vi.clearAllMocks();
  });

  describe('Complete Lifecycle: Migration → Create → Read', () => {
    it('should handle full workflow from table creation to data retrieval', async () => {
      // STEP 1: Migration - Table Creation
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const migrationResult = await adapter.createTable(userSchema);

      expect(migrationResult.success).toBe(true);
      expect(mockPool.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('CREATE TABLE "user"'),
        expect.any(Array)
      );

      // STEP 2: Create Operation
      mockPool.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [TEST_USER]
      });

      const handler = createHandler({
        adapter,
        schema: userSchema
      });

      const createResult = await handler({
        method: 'POST',
        body: {
          username: TEST_USER.username,
          email: TEST_USER.email,
          age: TEST_USER.age
        },
        query: {},
        params: {},
        headers: {},
        user: undefined,
        metadata: {}
      });

      expect(createResult.status).toBe(201);
      expect(createResult.body).toHaveProperty('data');

      if ('data' in createResult.body) {
        expect(createResult.body.data).toMatchObject({
          username: TEST_USER.username,
          email: TEST_USER.email,
          age: TEST_USER.age
        });
      }

      // STEP 3: Read Operation
      mockPool.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [TEST_USER]
      });

      const findResult = await handler({
        method: 'GET',
        body: {},
        query: { 'where[username]': TEST_USER.username },
        params: {},
        headers: {},
        user: undefined,
        metadata: {}
      });

      expect(findResult.status).toBe(200);
      expect(findResult.body).toHaveProperty('data');

      if ('data' in findResult.body) {
        expect(Array.isArray(findResult.body.data)).toBe(true);
        const users = findResult.body.data as any[];
        expect(users[0]).toMatchObject({
          username: TEST_USER.username,
          email: TEST_USER.email
        });
      }

      // Verify SQL query structure
      const selectCalls = mockPool.query.mock.calls.filter(
        (call: any[]) => call[0].includes('SELECT')
      );
      expect(selectCalls).toHaveLength(1);
      expect(selectCalls[0][0]).toContain('WHERE "username" = $1');
      expect(selectCalls[0][1]).toEqual([
        TEST_USER.username,
        DEFAULT_PAGE_SIZE,
        DEFAULT_OFFSET
      ]);
    });
  });

  describe('Validation Error Handling', () => {
    it('should reject invalid data before reaching database', async () => {
      const handler = createHandler({
        adapter,
        schema: userSchema
      });

      const result = await handler({
        method: 'POST',
        body: { age: 25 }, // Missing required: username, email
        query: {},
        params: {},
        headers: {},
        user: undefined,
        metadata: {}
      });

      // Debug: Log the actual response
      if (result.status !== 400) {
        console.log('❌ Validation test failed');
        console.log('Status:', result.status);
        console.log('Body:', JSON.stringify(result.body, null, 2));
      }

      // Should fail validation
      expect(result.status).toBe(400);
      expect(result.body).toHaveProperty('error');

      if ('error' in result.body) {
        expect(result.body.error).toBeDefined();
        expect(result.body.error.message).toBeDefined();
      }

      // Database should NOT be called
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should validate email field when provided', async () => {
      const handler = createHandler({
        adapter,
        schema: userSchema
      });

      const result = await handler({
        method: 'POST',
        body: {
          username: 'test',
          email: '', // Invalid: empty email
          age: 25
        },
        query: {},
        params: {},
        headers: {},
        user: undefined,
        metadata: {}
      });

      expect(result.status).toBe(400);
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('Update Operations', () => {
    it('should handle UPDATE requests', async () => {
      mockPool.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ ...TEST_USER, age: 31 }]
      });

      const handler = createHandler({
        adapter,
        schema: userSchema
      });

      const result = await handler({
        method: 'PUT',
        body: { age: 31 },
        query: {},
        params: { id: '1' },
        headers: {},
        user: undefined,
        metadata: {}
      });

      expect(result.status).toBe(200);
      if ('data' in result.body) {
        expect(result.body.data).toMatchObject({ age: 31 });
      }

      // Verify UPDATE SQL was called
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE'),
        expect.any(Array)
      );
    });
  });

  describe('Delete Operations', () => {
    it('should handle DELETE requests', async () => {
      mockPool.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [TEST_USER]
      });

      const handler = createHandler({
        adapter,
        schema: userSchema
      });

      const result = await handler({
        method: 'DELETE',
        body: {},
        query: {},
        params: { id: '1' },
        headers: {},
        user: undefined,
        metadata: {}
      });

      expect(result.status).toBe(200);

      // Verify DELETE SQL was called
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM'),
        expect.any(Array)
      );
    });
  });

  describe('Database Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      mockPool.query.mockRejectedValueOnce(
        new Error('Connection timeout')
      );

      const handler = createHandler({
        adapter,
        schema: userSchema
      });

      const result = await handler({
        method: 'GET',
        body: {},
        query: {},
        params: {},
        headers: {},
        user: undefined,
        metadata: {}
      });

      expect(result.status).toBe(500);
      expect(result.body).toHaveProperty('error');
    });

    it('should handle unique constraint violations', async () => {
      const constraintError = new Error('duplicate key value');
      (constraintError as any).code = '23505'; // PostgreSQL unique violation

      mockPool.query.mockRejectedValueOnce(constraintError);

      const handler = createHandler({
        adapter,
        schema: userSchema
      });

      const result = await handler({
        method: 'POST',
        body: TEST_USER,
        query: {},
        params: {},
        headers: {},
        user: undefined,
        metadata: {}
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.body).toHaveProperty('error');
    });
  });
});
