/**
 * Session Strategy Tests - Happy Path
 *
 * Tests successful session operations:
 * - Session creation and retrieval
 * - Session refresh
 * - lastAccessedAt updates
 * - Session cleanup
 * - Session data updates
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSessionStrategy, MemorySessionStore } from '../src/session';
import type { SessionConfig } from '../src/types';
import { expectSuccessData } from '../../../types/src/test/helpers';

describe('Session Strategy - Happy Path', () => {
  const validConfig: SessionConfig = {
    maxAge: 3600,
    checkPeriod: 60,
    prefix: 'test-sess:'
  };

  let sessionStrategy: ReturnType<typeof createSessionStrategy>;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStrategy = createSessionStrategy(validConfig);
  });

  afterEach(async () => {
    await sessionStrategy.clear();
    vi.useRealTimers();
  });

  describe('Session Creation', () => {
    it('should create session successfully', async () => {
      const createResult = await sessionStrategy.create('user-1', 'admin', { custom: 'data' });

      const createdSession = expectSuccessData(createResult);
      expect(createdSession.id).toBeDefined();
      expect(createdSession.userId).toBe('user-1');
      expect(createdSession.role).toBe('admin');
      expect(createdSession.custom).toBe('data');
    });
  });

  describe('Session Retrieval', () => {
    it('should retrieve existing session', async () => {
      const createResult = await sessionStrategy.create('user-1', 'admin');
      const { id: sessionId } = expectSuccessData(createResult);

      const getResult = await sessionStrategy.get(sessionId);
      const retrievedSession = expectSuccessData(getResult);

      expect(retrievedSession.id).toBe(sessionId);
      expect(retrievedSession.userId).toBe('user-1');
    });

    it('should update lastAccessedAt on retrieval', async () => {
      const createResult = await sessionStrategy.create('user-1', 'user');
      const { id: sessionId, lastAccessedAt: initialAccessTime } = expectSuccessData(createResult);

      vi.advanceTimersByTime(10 * 60 * 1000); // 10 mins

      const getResult = await sessionStrategy.get(sessionId);
      const retrievedSession = expectSuccessData(getResult);

      expect(retrievedSession.lastAccessedAt.getTime()).toBeGreaterThan(initialAccessTime.getTime());
    });
  });

  describe('Session Refresh', () => {
    it('should refresh and extend session expiration', async () => {
      const createResult = await sessionStrategy.create('user-1', 'user');
      const { id: sessionId, expiresAt: initialExpiry } = expectSuccessData(createResult);

      vi.advanceTimersByTime(30 * 60 * 1000); // 30 mins

      const refreshResult = await sessionStrategy.refresh(sessionId);
      const refreshedSession = expectSuccessData(refreshResult);

      expect(refreshedSession.expiresAt.getTime()).toBeGreaterThan(initialExpiry.getTime());
    });
  });

  describe('Session Updates', () => {
    it('should update arbitrary session data', async () => {
      const createResult = await sessionStrategy.create('user-1', 'user', { count: 1 });
      const { id: sessionId } = expectSuccessData(createResult);

      const updateResult = await sessionStrategy.update(sessionId, { count: 2, meta: 'set' });
      const updatedSession = expectSuccessData(updateResult);

      expect(updatedSession.count).toBe(2);
      expect(updatedSession.meta).toBe('set');
    });
  });

  describe('Session Cleanup', () => {
    it('should cleanup expired sessions', async () => {
      const session1Result = await sessionStrategy.create('u1', 'r1');
      const session1 = expectSuccessData(session1Result);

      vi.advanceTimersByTime(2 * 60 * 60 * 1000); // 2 hours

      const session2Result = await sessionStrategy.create('u2', 'r2');
      const session2 = expectSuccessData(session2Result);

      const sessionStore = (sessionStrategy as any).store;
      const cleanupResult = await sessionStore.cleanup();
      const cleanedCount = expectSuccessData(cleanupResult);

      expect(cleanedCount).toBe(1);
      expect((await sessionStrategy.validate(session1.id)).data).toBe(false);
      expect((await sessionStrategy.validate(session2.id)).data).toBe(true);
    });
  });
});

describe('MemorySessionStore - Happy Path', () => {
  it('should respect key prefixing', async () => {
    const customPrefixStore = new MemorySessionStore('custom:');
    const testSessionId = 'abc';
    const sessionData: any = { id: testSessionId, expiresAt: new Date(Date.now() + 1000) };

    await customPrefixStore.set(testSessionId, sessionData);

    const sessionsMap = (customPrefixStore as any).sessions;
    expect(sessionsMap.has('custom:abc')).toBe(true);
    expect(sessionsMap.has('abc')).toBe(false);
  });
});
