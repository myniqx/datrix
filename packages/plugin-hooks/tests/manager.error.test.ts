/**
 * Hooks Manager Tests - Error Path
 *
 * Tests error handling:
 * - Duplicate registration prevention
 * - Hook execution errors
 */

import { describe, it, expect } from 'vitest';
import { createHooksManager } from '../src/manager';
import type { HookContext } from '../src/types';
import { expectFailureError } from '../../../types/src/test/helpers';

describe('Hooks Manager - Error Path', () => {
  const testModelName = 'posts';
  const testContext: HookContext = { modelName: testModelName, operation: 'create' };

  describe('Duplicate Registration', () => {
    it('should prevent duplicate registration', () => {
      const hooksManager = createHooksManager();
      hooksManager.registerHooks(testModelName, { beforeCreate: (d: any) => d });

      const duplicateResult = hooksManager.registerHooks(testModelName, { afterCreate: (d: any) => d });

      const error = expectFailureError(duplicateResult);
      expect(error.code).toBe('HOOK_REGISTRATION_ERROR');
    });
  });

  describe('Hook Execution Errors', () => {
    it('should catch errors in hook execution', async () => {
      const hooksManager = createHooksManager({ enableLogging: false });
      hooksManager.registerHooks(testModelName, {
        beforeCreate: () => {
          throw new Error('Hook failed');
        }
      });

      const executionResult = await hooksManager.executeHook(
        testModelName,
        'beforeCreate',
        {},
        testContext
      );

      const error = expectFailureError(executionResult);
      expect(error.message).toContain('Hook execution failed');
    });
  });
});
