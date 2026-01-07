/**
 * Auth Plugin - Session Tests
 *
 * Tests the Session strategy and Memory store implementation:
 * - Session creation, retrieval, and update
 * - Expiration logic
 * - Automatic lastAccessedAt updates
 * - Store cleanup and clear
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSessionStrategy, MemorySessionStore } from '@plugins/auth/session';
import type { SessionConfig } from '@plugins/auth/types';

describe('Auth Plugin - Session Strategy', () => {
  const config: SessionConfig = {
    maxAge: 3600, // 1 hour
    checkPeriod: 60, // 1 minute
    prefix: 'test-sess:'
  };

  let strategy: ReturnType<typeof createSessionStrategy>;

  beforeEach(() => {
    vi.useFakeTimers();
    strategy = createSessionStrategy(config);
  });

  afterEach(async () => {
    await strategy.clear();
    vi.useRealTimers();
  });

  it('should create and retrieve a session', async () => {
    const createResult = await strategy.create('user-1', 'admin', { custom: 'data' });
    expect(createResult.success).toBe(true);

    if (createResult.success) {
      const session = createResult.data;
      expect(session.id).toBeDefined();
      expect(session.userId).toBe('user-1');
      expect(session.role).toBe('admin');
      expect(session.custom).toBe('data');

      const getResult = await strategy.get(session.id);
      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data.id).toBe(session.id);
      }
    }
  });

  it('should update lastAccessedAt on retrieval', async () => {
    const createResult = await strategy.create('user-1', 'user');
    if (createResult.success) {
      const sessionId = createResult.data.id;
      const initialAccessedAt = createResult.data.lastAccessedAt;

      // Advance time by 10 minutes
      vi.advanceTimersByTime(10 * 60 * 1000);

      const getResult = await strategy.get(sessionId);
      if (getResult.success) {
        expect(getResult.data.lastAccessedAt.getTime()).toBeGreaterThan(initialAccessedAt.getTime());
      }
    }
  });

  it('should fail if session is expired', async () => {
    const createResult = await strategy.create('user-1', 'user');
    if (createResult.success) {
      const sessionId = createResult.data.id;

      // Advance time by 2 hours (maxAge is 1 hour)
      vi.advanceTimersByTime(2 * 60 * 60 * 1000);

      const getResult = await strategy.get(sessionId);
      expect(getResult.success).toBe(false);
      if (!getResult.success) {
        expect((getResult.error.details as any).code).toBe('SESSION_EXPIRED');
      }

      // Check if deleted from store
      const retryResult = await strategy.validate(sessionId);
      expect(retryResult.data).toBe(false);
    }
  });

  it('should refresh and extend session expiration', async () => {
    const createResult = await strategy.create('user-1', 'user');
    if (createResult.success) {
      const sessionId = createResult.data.id;
      const initialExp = createResult.data.expiresAt;

      // Advance time by 30 mins
      vi.advanceTimersByTime(30 * 60 * 1000);

      const refreshResult = await strategy.refresh(sessionId);
      expect(refreshResult.success).toBe(true);
      if (refreshResult.success) {
        expect(refreshResult.data.expiresAt.getTime()).toBeGreaterThan(initialExp.getTime());
      }
    }
  });

  it('should handle cleanup of multiple sessions', async () => {
    // Create one session
    const s1 = await strategy.create('u1', 'r1');

    // Advance time past expiry
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);

    // Create another session (which is valid)
    const s2 = await strategy.create('u2', 'r2');

    // Run cleanup manually (MemorySessionStore.cleanup)
    const store = (strategy as any).store;
    const cleanupResult = await store.cleanup();

    expect(cleanupResult.success).toBe(true);
    expect(cleanupResult.data).toBe(1); // Deleted s1

    expect((await strategy.validate((s1 as any).data.id)).data).toBe(false);
    expect((await strategy.validate((s2 as any).data.id)).data).toBe(true);
  });

  it('should update arbitrary data in session', async () => {
    const createResult = await strategy.create('user-1', 'user', { count: 1 });
    if (createResult.success) {
      const sessionId = createResult.data.id;

      const updateResult = await strategy.update(sessionId, { count: 2, meta: 'set' });
      expect(updateResult.success).toBe(true);
      if (updateResult.success) {
        expect(updateResult.data.count).toBe(2);
        expect(updateResult.data.meta).toBe('set');
      }
    }
  });
});

describe('MemorySessionStore', () => {
  it('should respect key prefixing', async () => {
    const store = new MemorySessionStore('custom:');
    const sessionId = 'abc';
    const data: any = { id: sessionId, expiresAt: new Date(Date.now() + 1000) };

    await store.set(sessionId, data);

    // Check internal map if possible
    const sessionsMap = (store as any).sessions;
    expect(sessionsMap.has('custom:abc')).toBe(true);
    expect(sessionsMap.has('abc')).toBe(false);
  });
});
