import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { PostgresAdapter, PostgresConfig } from '../src';

// Mock pg Pool
vi.mock('pg', () => {
  const mPool = {
    connect: vi.fn(),
    query: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  };
  return { Pool: vi.fn(() => mPool) };
});

describe('PostgresAdapter Error Mapping', () => {
  let adapter: PostgresAdapter;
  let mockPool: any;
  const config: PostgresConfig = {
    host: 'localhost',
    port: 5432,
    database: 'test_db',
    user: 'user',
    password: 'password'
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    adapter = new PostgresAdapter(config);
    mockPool = new Pool();
    (adapter as any).pool = mockPool;
    (adapter as any).state = 'connected';
  });

  it('should map 23505 to UNIQUE_VIOLATION', async () => {
    const pgError = new Error('duplicate key value violates unique constraint');
    (pgError as any).code = '23505';
    mockPool.query.mockRejectedValueOnce(pgError);

    const result = await adapter.executeQuery({ type: 'insert', table: 'users', data: { id: 1 } });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('UNIQUE_VIOLATION');
    }
  });

  it('should map 23503 to FOREIGN_KEY_VIOLATION', async () => {
    const pgError = new Error('insert or update on table violates foreign key constraint');
    (pgError as any).code = '23503';
    mockPool.query.mockRejectedValueOnce(pgError);

    const result = await adapter.executeQuery({ type: 'insert', table: 'posts', data: { userId: 999 } });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('FOREIGN_KEY_VIOLATION');
    }
  });

  it('should map 42P01 to TABLE_NOT_FOUND', async () => {
    const pgError = new Error('relation "ghost" does not exist');
    (pgError as any).code = '42P01';
    mockPool.query.mockRejectedValueOnce(pgError);

    const result = await adapter.executeQuery({ type: 'select', table: 'ghost', select: ['*'] });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('TABLE_NOT_FOUND');
    }
  });

  it('should map 42703 to COLUMN_NOT_FOUND', async () => {
    const pgError = new Error('column "ghost_col" does not exist');
    (pgError as any).code = '42703';
    mockPool.query.mockRejectedValueOnce(pgError);

    const result = await adapter.executeQuery({ type: 'select', table: 'users', select: ['ghost_col'] });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('COLUMN_NOT_FOUND');
    }
  });

  it('should use mapping for executeRawQuery as well', async () => {
    const pgError = new Error('relation "ghost" does not exist');
    (pgError as any).code = '42P01';
    mockPool.query.mockRejectedValueOnce(pgError);

    const result = await adapter.executeRawQuery('SELECT * FROM ghost', []);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('TABLE_NOT_FOUND');
      expect(result.error.sql).toBe('SELECT * FROM ghost');
    }
  });
});
