/**
 * Session Strategy Tests - Error Path
 *
 * Tests error handling:
 * - Expired session access
 * - Invalid session validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSessionStrategy } from '../src/session';
import type { SessionConfig } from '../src/types';
import { expectFailureError, expectSuccessData } from '../../../types/src/test/helpers';

describe('Session Strategy - Error Path', () => {
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

  describe('Session Expiration', () => {
    it('should fail if session is expired', async () => {
      const createResult = await sessionStrategy.create('user-1', 'user');
      const { id: sessionId } = expectSuccessData(createResult);

      vi.advanceTimersByTime(2 * 60 * 60 * 1000); // 2 hours

      const getResult = await sessionStrategy.get(sessionId);
      const error = expectFailureError(getResult);

      expect((error.details as any).code).toBe('SESSION_EXPIRED');
    });

    it('should mark expired session as invalid', async () => {
      const createResult = await sessionStrategy.create('user-1', 'user');
      const { id: sessionId } = expectSuccessData(createResult);

      vi.advanceTimersByTime(2 * 60 * 60 * 1000); // 2 hours

      await sessionStrategy.get(sessionId); // This should delete the expired session

      const validateResult = await sessionStrategy.validate(sessionId);
      const isValid = expectSuccessData(validateResult);
      expect(isValid).toBe(false);
    });
  });
});
