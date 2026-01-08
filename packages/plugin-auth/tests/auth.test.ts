/**
 * Auth Plugin Tests - Happy Path
 *
 * Tests successful authentication flows:
 * - Password hashing and verification
 * - Login flow (JWT & Session integration)
 * - Token and Session verification
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createAuthPlugin } from '../src';
import type { AuthPluginOptions } from '../src/types';
import type { PluginContext } from '../../../types/src/plugin';
import { expectSuccessData } from '../../../types/src/test/helpers';

describe('Auth Plugin - Happy Path', () => {
  const validOptions: AuthPluginOptions = {
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
    passwordHashIterations: 1000
  };

  const mockContext: PluginContext = {
    adapter: {} as any,
    schemas: {} as any,
    config: {
      database: { adapter: 'postgres', connection: {} },
      schemas: { path: './schemas' }
    }
  };

  let authPlugin: ReturnType<typeof createAuthPlugin>;

  beforeEach(async () => {
    authPlugin = createAuthPlugin(validOptions);
    const initResult = await authPlugin.init(mockContext);
    expectSuccessData(initResult);
  });

  describe('Password Management', () => {
    it('should hash password successfully', async () => {
      const strongPassword = 'securePassword123';
      const hashResult = await authPlugin.hashPassword(strongPassword);

      const { hash, salt } = expectSuccessData(hashResult);
      expect(hash).toBeDefined();
      expect(salt).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(typeof salt).toBe('string');
    });

    it('should verify correct password', async () => {
      const password = 'securePassword123';
      const hashResult = await authPlugin.hashPassword(password);
      const { hash, salt } = expectSuccessData(hashResult);

      const verifyResult = await authPlugin.verifyPassword(password, hash, salt);
      const isValid = expectSuccessData(verifyResult);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const correctPassword = 'securePassword123';
      const wrongPassword = 'wrongPassword';
      const hashResult = await authPlugin.hashPassword(correctPassword);
      const { hash, salt } = expectSuccessData(hashResult);

      const verifyResult = await authPlugin.verifyPassword(wrongPassword, hash, salt);
      const isValid = expectSuccessData(verifyResult);
      expect(isValid).toBe(false);
    });
  });

  describe('Login Flow', () => {
    it('should generate both JWT and Session on login', async () => {
      const testUser = { id: 'u1', email: 'test@example.com', role: 'admin' };
      const loginResult = await authPlugin.login(testUser);

      const loginData = expectSuccessData(loginResult);
      expect(loginData.token).toBeDefined();
      expect(loginData.sessionId).toBeDefined();
      expect(loginData.user.id).toBe('u1');
      expect(loginData.user.email).toBe('test@example.com');
    });

    it('should allow login with only JWT', async () => {
      const testUser = { id: 'u1', email: 'test@example.com', role: 'admin' };
      const jwtOnlyLogin = await authPlugin.login(testUser, true, false);

      const loginData = expectSuccessData(jwtOnlyLogin);
      expect(loginData.token).toBeDefined();
      expect(loginData.sessionId).toBeUndefined();
    });

    it('should allow login with only Session', async () => {
      const testUser = { id: 'u1', email: 'test@example.com', role: 'admin' };
      const sessionOnlyLogin = await authPlugin.login(testUser, false, true);

      const loginData = expectSuccessData(sessionOnlyLogin);
      expect(loginData.token).toBeUndefined();
      expect(loginData.sessionId).toBeDefined();
    });
  });

  describe('Token Verification', () => {
    it('should verify valid JWT token', async () => {
      const testUser = { id: 'u1', email: 'admin@forja.io', role: 'admin' };
      const loginResult = await authPlugin.login(testUser, true, false);
      const { token } = expectSuccessData(loginResult);

      const verifyResult = await authPlugin.verifyToken(token!);
      const verifiedData = expectSuccessData(verifyResult);
      expect(verifiedData.user?.id).toBe('u1');
      expect(verifiedData.user?.role).toBe('admin');
    });
  });

  describe('Session Verification', () => {
    it('should verify valid session', async () => {
      const testUser = { id: 'u1', email: 'admin@forja.io', role: 'admin' };
      const loginResult = await authPlugin.login(testUser, false, true);
      const { sessionId } = expectSuccessData(loginResult);

      const verifyResult = await authPlugin.verifySession(sessionId!);
      const verifiedData = expectSuccessData(verifyResult);
      expect(verifiedData.user?.id).toBe('u1');
      expect(verifiedData.sessionId).toBe(sessionId);
    });
  });
});
