/**
 * JWT Strategy Tests - Error Path
 *
 * Tests error handling:
 * - Invalid signature detection
 * - Token expiration
 * - Issuer/Audience mismatch
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createJwtStrategy } from '../src/jwt';
import type { JwtConfig } from '../src/types';
import { expectFailureError, expectSuccessData } from '../../../types/src/test/helpers';

describe('JWT Strategy - Error Path', () => {
  const validConfig: JwtConfig = {
    secret: 'super-secret-key',
    expiresIn: '1h',
    issuer: 'forja-test',
    audience: 'test-app'
  };

  let jwtStrategy: ReturnType<typeof createJwtStrategy>;

  beforeEach(() => {
    vi.useFakeTimers();
    jwtStrategy = createJwtStrategy(validConfig);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Signature Validation', () => {
    it('should fail verification if signature is invalid', async () => {
      const userPayload = { userId: '123', role: 'user' };
      const signResult = await jwtStrategy.sign(userPayload);
      const validToken = expectSuccessData(signResult);

      const tamperedToken = validToken.slice(0, -1) + (validToken.endsWith('a') ? 'b' : 'a');

      const verifyResult = await jwtStrategy.verify(tamperedToken);
      const error = expectFailureError(verifyResult);
      expect((error.details as any).code).toBe('JWT_INVALID_SIGNATURE');
    });
  });

  describe('Token Expiration', () => {
    it('should fail if token is expired', async () => {
      const userPayload = { userId: '123', role: 'user' };
      const signResult = await jwtStrategy.sign(userPayload);
      const token = expectSuccessData(signResult);

      vi.advanceTimersByTime(2 * 60 * 60 * 1000); // 2 hours

      const verifyResult = await jwtStrategy.verify(token);
      const error = expectFailureError(verifyResult);
      expect((error.details as any).code).toBe('JWT_EXPIRED');
    });
  });

  describe('Issuer Validation', () => {
    it('should detect issuer mismatch', async () => {
      const strategy1 = createJwtStrategy({ ...validConfig, issuer: 'iss-1' });
      const strategy2 = createJwtStrategy({ ...validConfig, issuer: 'iss-2' });

      const signResult = await strategy1.sign({ userId: '1', role: 'user' });
      const token = expectSuccessData(signResult);

      const verifyResult = await strategy2.verify(token);
      const error = expectFailureError(verifyResult);
      expect((error.details as any).code).toBe('JWT_INVALID_ISSUER');
    });
  });
});
