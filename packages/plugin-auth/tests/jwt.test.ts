/**
 * JWT Strategy Tests - Happy Path
 *
 * Tests successful JWT operations:
 * - Token signing and verification
 * - Token refresh
 * - Custom claims handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createJwtStrategy } from '../src/jwt';
import type { JwtConfig } from '../src/types';
import { expectSuccessData } from '../../../types/src/test/helpers';

describe('JWT Strategy - Happy Path', () => {
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

  describe('Token Signing', () => {
    it('should sign token successfully', async () => {
      const userPayload = { userId: '123', role: 'admin' };
      const signResult = await jwtStrategy.sign(userPayload);

      const signedToken = expectSuccessData(signResult);
      expect(signedToken).toBeDefined();
      expect(typeof signedToken).toBe('string');
    });
  });

  describe('Token Verification', () => {
    it('should verify valid token', async () => {
      const userPayload = { userId: '123', role: 'admin' };
      const signResult = await jwtStrategy.sign(userPayload);
      const token = expectSuccessData(signResult);

      const verifyResult = await jwtStrategy.verify(token);
      const decodedPayload = expectSuccessData(verifyResult);

      expect(decodedPayload.userId).toBe('123');
      expect(decodedPayload.role).toBe('admin');
      expect(decodedPayload.iss).toBe('forja-test');
      expect(decodedPayload.aud).toBe('test-app');
    });
  });

  describe('Token Refresh', () => {
    it('should refresh token successfully', async () => {
      const userPayload = { userId: '123', role: 'user' };
      const signResult = await jwtStrategy.sign(userPayload);
      const oldToken = expectSuccessData(signResult);
      const oldPayload = expectSuccessData(await jwtStrategy.verify(oldToken));

      vi.advanceTimersByTime(30 * 60 * 1000); // 30 mins

      const refreshResult = await jwtStrategy.refresh(oldToken);
      const newToken = expectSuccessData(refreshResult);
      const newPayload = expectSuccessData(await jwtStrategy.verify(newToken));

      expect(newToken).not.toBe(oldToken);
      expect(newPayload.exp).toBeGreaterThan(oldPayload.exp);
      expect(newPayload.userId).toBe('123');
    });
  });

  describe('Configuration', () => {
    it('should support hour expiry format', () => {
      const hourStrategy = createJwtStrategy({ ...validConfig, expiresIn: '2h' });
      expect((hourStrategy as any).expiresIn).toBe(7200);
    });

    it('should support day expiry format', () => {
      const dayStrategy = createJwtStrategy({ ...validConfig, expiresIn: '1d' });
      expect((dayStrategy as any).expiresIn).toBe(86400);
    });

    it('should support numeric expiry in seconds', () => {
      const numericStrategy = createJwtStrategy({ ...validConfig, expiresIn: 300 });
      expect((numericStrategy as any).expiresIn).toBe(300);
    });
  });
});
