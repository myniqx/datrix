/**
 * Auth Plugin Tests - Error Path
 *
 * Tests error handling and validation:
 * - Weak password rejection
 * - Invalid configuration
 */

import { describe, it, expect } from 'vitest';
import { createAuthPlugin } from '../src';
import { expectFailureError } from '../../../types/src/test/helpers';
import type { PluginContext } from '../../../types/src/plugin';

describe('Auth Plugin - Error Path', () => {
  const mockContext: PluginContext = {
    adapter: {} as any,
    schemas: {} as any,
    config: {
      database: { adapter: 'postgres', connection: {} },
      schemas: { path: './schemas' }
    }
  };

  describe('Password Validation', () => {
    it('should reject weak passwords', async () => {
      const validOptions = {
        jwt: { secret: 'a-very-long-and-secure-secret-key-32-chars!!', expiresIn: '1h' },
        passwordHashIterations: 1000
      };

      const authPlugin = createAuthPlugin(validOptions);
      await authPlugin.init(mockContext);

      const weakPassword = 'weak';
      const hashResult = await authPlugin.hashPassword(weakPassword);

      const error = expectFailureError(hashResult);
      expect((error.details as any).code).toBe('WEAK_PASSWORD');
    });
  });

  describe('Initialization', () => {
    it('should fail if neither JWT nor Session is configured', async () => {
      const invalidAuthPlugin = createAuthPlugin({} as any);
      const initResult = await invalidAuthPlugin.init(mockContext);

      const error = expectFailureError(initResult);
      expect(error.code).toBe('AUTH_INVALID_OPTIONS');
    });
  });
});
