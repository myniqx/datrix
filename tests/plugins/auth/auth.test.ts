/**
 * Auth Plugin - Integration & Hashing Tests
 *
 * Tests the main AuthPlugin class:
 * - Password hashing and verification
 * - Login flow (JWT & Session integration)
 * - Plugin initialization and options validation
 * - Token and Session verification
 * - RBAC permission checks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthPlugin } from '@plugins/auth';
import type { AuthPluginOptions } from '@plugins/auth/types';
import type { PluginContext } from '@plugins/base/types';

describe('Auth Plugin - Integration', () => {
  const options: AuthPluginOptions = {
    jwt: {
      secret: 'a-very-long-and-secure-secret-key-32-chars!!',
      expiresIn: '1h'
    },
    session: {
      maxAge: 3600
    },
    rbac: {
      defaultRole: 'guest'
    },
    passwordHashIterations: 1000 // speed up tests
  };

  const mockContext: PluginContext = {
    adapter: {} as any,
    schemas: {} as any,
    config: {
      database: { adapter: 'postgres', connection: {} },
      schemas: { path: './schemas' }
    }
  };

  let auth: ReturnType<typeof createAuthPlugin>;

  beforeEach(async () => {
    auth = createAuthPlugin(options);
    await auth.init(mockContext);
  });

  describe('Password Management', () => {
    it('should hash and verify passwords correctly', async () => {
      const password = 'securePassword123';
      const hashResult = await auth.hashPassword(password);

      expect(hashResult.success).toBe(true);
      if (hashResult.success) {
        const { hash, salt } = hashResult.data;
        expect(hash).toBeDefined();
        expect(salt).toBeDefined();

        // Verify correct password
        const verifySuccess = await auth.verifyPassword(password, hash, salt);
        expect(verifySuccess.success).toBe(true);
        expect(verifySuccess.data).toBe(true);

        // Verify wrong password
        const verifyFail = await auth.verifyPassword('wrongPassword', hash, salt);
        expect(verifyFail.success).toBe(true);
        expect(verifyFail.data).toBe(false);
      }
    });

    it('should reject weak passwords', async () => {
      const result = await auth.hashPassword('weak');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result.error.details as any).code).toBe('WEAK_PASSWORD');
      }
    });
  });

  describe('Login Flow', () => {
    it('should generate both JWT and Session on login', async () => {
      const user = { id: 'u1', email: 'test@example.com', role: 'admin' };
      const loginResult = await auth.login(user);

      expect(loginResult.success).toBe(true);
      if (loginResult.success) {
        expect(loginResult.data.token).toBeDefined();
        expect(loginResult.data.sessionId).toBeDefined();
        expect(loginResult.data.user.id).toBe('u1');
      }
    });

    it('should allow login with only JWT or only Session', async () => {
      const user = { id: 'u1', email: 'test@example.com', role: 'admin' };

      const onlyJwt = await auth.login(user, true, false);
      expect(onlyJwt.data?.token).toBeDefined();
      expect(onlyJwt.data?.sessionId).toBeUndefined();

      const onlySession = await auth.login(user, false, true);
      expect(onlySession.data?.token).toBeUndefined();
      expect(onlySession.data?.sessionId).toBeDefined();
    });
  });

  describe('Verification', () => {
    it('should verify a valid JWT token', async () => {
      const user = { id: 'u1', email: 'adm@forja.io', role: 'admin' };
      const login = await auth.login(user, true, false);
      const token = login.data!.token!;

      const verifyResult = await auth.verifyToken(token);
      expect(verifyResult.success).toBe(true);
      if (verifyResult.success) {
        expect(verifyResult.data.user?.id).toBe('u1');
        expect(verifyResult.data.user?.role).toBe('admin');
      }
    });

    it('should verify a valid session', async () => {
      const user = { id: 'u1', email: 'adm@forja.io', role: 'admin' };
      const login = await auth.login(user, false, true);
      const sessionId = login.data!.sessionId!;

      const verifyResult = await auth.verifySession(sessionId);
      expect(verifyResult.success).toBe(true);
      if (verifyResult.success) {
        expect(verifyResult.data.user?.id).toBe('u1');
        expect(verifyResult.data.sessionId).toBe(sessionId);
      }
    });
  });

  describe('Initialization', () => {
    it('should fail if neither JWT nor Session is configured', async () => {
      const invalidAuth = createAuthPlugin({} as any);
      const result = await invalidAuth.init(mockContext);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('AUTH_INVALID_OPTIONS');
      }
    });
  });
});
