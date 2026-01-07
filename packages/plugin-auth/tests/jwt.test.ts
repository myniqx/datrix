/**
 * Auth Plugin - JWT Tests
 *
 * Tests the JWT strategy implementation:
 * - Token signing and verification
 * - Expiration handling
 * - Refresh logic
 * - Custom claims
 * - Security (issuer/audience validation)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createJwtStrategy } from '@plugins/auth/jwt';
import type { JwtConfig } from '@plugins/auth/types';

describe('Auth Plugin - JWT Strategy', () => {
  const config: JwtConfig = {
    secret: 'super-secret-key',
    expiresIn: '1h',
    issuer: 'forja-test',
    audience: 'test-app'
  };

  const strategy = createJwtStrategy(config);

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should sign and verify a token successfully', async () => {
    const payload = { userId: '123', role: 'admin' };
    const signResult = await strategy.sign(payload);

    expect(signResult.success).toBe(true);
    if (signResult.success) {
      const token = signResult.data;
      expect(token).toBeDefined();

      const verifyResult = await strategy.verify(token);
      expect(verifyResult.success).toBe(true);
      if (verifyResult.success) {
        expect(verifyResult.data.userId).toBe('123');
        expect(verifyResult.data.role).toBe('admin');
        expect(verifyResult.data.iss).toBe('forja-test');
        expect(verifyResult.data.aud).toBe('test-app');
      }
    }
  });

  it('should fail verification if signature is invalid', async () => {
    const payload = { userId: '123', role: 'user' };
    const signResult = await strategy.sign(payload);

    if (signResult.success) {
      const token = signResult.data;
      const tamperedToken = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');

      const verifyResult = await strategy.verify(tamperedToken);
      expect(verifyResult.success).toBe(false);
      if (!verifyResult.success) {
        expect((verifyResult.error.details as any).code).toBe('JWT_INVALID_SIGNATURE');
      }
    }
  });

  it('should fail if token is expired', async () => {
    const payload = { userId: '123', role: 'user' };
    const signResult = await strategy.sign(payload);

    if (signResult.success) {
      const token = signResult.data;

      // Fast forward time by 2 hours (token expires in 1h)
      vi.advanceTimersByTime(2 * 60 * 60 * 1000);

      const verifyResult = await strategy.verify(token);
      expect(verifyResult.success).toBe(false);
      if (!verifyResult.success) {
        expect((verifyResult.error.details as any).code).toBe('JWT_EXPIRED');
      }
    }
  });

  it('should refresh an existing token', async () => {
    const payload = { userId: '123', role: 'user' };
    const signResult = await strategy.sign(payload);

    if (signResult.success) {
      const oldToken = signResult.data;
      const oldPayload = (await strategy.verify(oldToken) as any).data;

      // Advance time slightly
      vi.advanceTimersByTime(30 * 60 * 1000); // 30 mins

      const refreshResult = await strategy.refresh(oldToken);
      expect(refreshResult.success).toBe(true);
      if (refreshResult.success) {
        const newToken = refreshResult.data;
        const newPayload = (await strategy.verify(newToken) as any).data;

        expect(newToken).not.toBe(oldToken);
        expect(newPayload.exp).toBeGreaterThan(oldPayload.exp);
        expect(newPayload.userId).toBe('123');
      }
    }
  });

  it('should support various expiry formats', () => {
    const s1 = createJwtStrategy({ ...config, expiresIn: '2h' });
    expect((s1 as any).expiresIn).toBe(7200);

    const s2 = createJwtStrategy({ ...config, expiresIn: '1d' });
    expect((s2 as any).expiresIn).toBe(86400);

    const s3 = createJwtStrategy({ ...config, expiresIn: 300 }); // seconds
    expect((s3 as any).expiresIn).toBe(300);
  });

  it('should detect issuer mismatch', async () => {
    const s1 = createJwtStrategy({ ...config, issuer: 'iss-1' });
    const s2 = createJwtStrategy({ ...config, issuer: 'iss-2' });

    const signResult = await s1.sign({ userId: '1', role: 'user' });
    if (signResult.success) {
      const verifyResult = await s2.verify(signResult.data);
      expect(verifyResult.success).toBe(false);
      if (!verifyResult.success) {
        expect((verifyResult.error.details as any).code).toBe('JWT_INVALID_ISSUER');
      }
    }
  });
});
