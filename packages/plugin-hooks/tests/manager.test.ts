/**
 * Hooks Manager Tests - Happy Path
 *
 * Tests successful manager operations:
 * - Hook registration and retrieval
 * - Synchronous hook execution
 * - Asynchronous hook execution
 * - Data modification
 * - Context passing
 * - Hook unregistration
 */

import { describe, it, expect } from 'vitest';
import { createHooksManager } from '../src/manager';
import type { HookContext } from '../src/types';
import { expectSuccessData } from '../../../types/src/test/helpers';

describe('Hooks Manager - Happy Path', () => {
  const testModelName = 'posts';
  const testContext: HookContext = { modelName: testModelName, operation: 'create' };

  describe('Hook Registration', () => {
    it('should register and retrieve hooks', () => {
      const hooksManager = createHooksManager();
      const testHooks = {
        beforeCreate: (data: any) => data
      };

      const registrationResult = hooksManager.registerHooks(testModelName, testHooks);
      expectSuccessData(registrationResult);

      expect(hooksManager.hasHook(testModelName, 'beforeCreate')).toBe(true);
      expect(hooksManager.hasHook(testModelName, 'afterCreate')).toBe(false);
    });
  });

  describe('Synchronous Hook Execution', () => {
    it('should execute synchronous hooks and modify data', async () => {
      const hooksManager = createHooksManager();
      hooksManager.registerHooks(testModelName, {
        beforeCreate: (data: any) => ({ ...data, modified: true })
      });

      const originalData = { title: 'Hello' };
      const executionResult = await hooksManager.executeHook(
        testModelName,
        'beforeCreate',
        originalData,
        testContext
      );

      const modifiedData = expectSuccessData(executionResult);
      expect((modifiedData as any).modified).toBe(true);
      expect((modifiedData as any).title).toBe('Hello');
    });
  });

  describe('Asynchronous Hook Execution', () => {
    it('should execute asynchronous hooks', async () => {
      const hooksManager = createHooksManager();
      hooksManager.registerHooks(testModelName, {
        beforeCreate: async (data: any) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { ...data, async: true };
        }
      });

      const executionResult = await hooksManager.executeHook(
        testModelName,
        'beforeCreate',
        { val: 1 },
        testContext
      );

      const asyncData = expectSuccessData(executionResult);
      expect((asyncData as any).async).toBe(true);
      expect((asyncData as any).val).toBe(1);
    });
  });

  describe('Missing Hook Handling', () => {
    it('should return original data if no hook is registered', async () => {
      const hooksManager = createHooksManager();
      const originalData = { original: true };

      hooksManager.registerHooks(testModelName, { afterDelete: (d: any) => d });
      const resultWithoutHook = await hooksManager.executeHook(
        testModelName,
        'beforeCreate',
        originalData,
        testContext
      );
      expect(resultWithoutHook.data).toBe(originalData);

      const resultWithUnknownModel = await hooksManager.executeHook(
        'unknown',
        'beforeCreate',
        originalData,
        testContext
      );
      expect(resultWithUnknownModel.data).toBe(originalData);
    });
  });

  describe('Context Passing', () => {
    it('should pass context to hook handler', async () => {
      const hooksManager = createHooksManager();
      let capturedContext: any = null;

      hooksManager.registerHooks(testModelName, {
        beforeCreate: (data: any, ctx: any) => {
          capturedContext = ctx;
          return data;
        }
      });

      await hooksManager.executeHook(
        testModelName,
        'beforeCreate',
        {},
        { modelName: 'test', operation: 'find' }
      );

      expect(capturedContext.modelName).toBe('test');
      expect(capturedContext.operation).toBe('find');
    });
  });

  describe('Hook Unregistration', () => {
    it('should unregister hooks correctly', () => {
      const hooksManager = createHooksManager();
      hooksManager.registerHooks(testModelName, { beforeCreate: (d: any) => d });
      expect(hooksManager.hasHook(testModelName, 'beforeCreate')).toBe(true);

      hooksManager.unregisterHooks(testModelName);
      expect(hooksManager.hasHook(testModelName, 'beforeCreate')).toBe(false);
    });
  });
});
