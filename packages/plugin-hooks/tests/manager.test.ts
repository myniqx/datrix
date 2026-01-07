/**
 * Hooks Plugin - Manager Tests
 *
 * Tests the HooksManager:
 * - Registration and unregistration
 * - Synchronous and asynchronous hook execution
 * - Data modification by hooks
 * - Error handling during execution
 * - Model-specific hook isolation
 */

import { describe, it, expect, vi } from 'vitest';
import { createHooksManager } from '@plugins/hooks/manager';
import type { HookContext } from '@plugins/hooks/types';

describe('Hooks Plugin - HooksManager', () => {
  const modelName = 'posts';
  const context: HookContext = { modelName, operation: 'create' };

  it('should register and retrieve hooks', () => {
    const manager = createHooksManager();
    const hooks = {
      beforeCreate: (data: any) => data
    };

    const result = manager.registerHooks(modelName, hooks);
    expect(result.success).toBe(true);
    expect(manager.hasHook(modelName, 'beforeCreate')).toBe(true);
    expect(manager.hasHook(modelName, 'afterCreate')).toBe(false);
  });

  it('should prevent duplicate registration', () => {
    const manager = createHooksManager();
    manager.registerHooks(modelName, { beforeCreate: (d: any) => d });

    const result = manager.registerHooks(modelName, { afterCreate: (d: any) => d });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('HOOK_REGISTRATION_ERROR');
  });

  it('should execute synchronous hooks and modify data', async () => {
    const manager = createHooksManager();
    manager.registerHooks(modelName, {
      beforeCreate: (data: any) => ({ ...data, modified: true })
    });

    const data = { title: 'Hello' };
    const result = await manager.executeHook(modelName, 'beforeCreate', data, context);

    expect(result.success).toBe(true);
    expect((result.data as any).modified).toBe(true);
    expect((result.data as any).title).toBe('Hello');
  });

  it('should execute asynchronous hooks', async () => {
    const manager = createHooksManager();
    manager.registerHooks(modelName, {
      beforeCreate: async (data: any) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return { ...data, async: true };
      }
    });

    const result = await manager.executeHook(modelName, 'beforeCreate', { val: 1 }, context);
    expect(result.success).toBe(true);
    expect((result.data as any).async).toBe(true);
  });

  it('should return original data if no hook is registered', async () => {
    const manager = createHooksManager();
    const data = { original: true };

    // Model exists but this specific hook doesn't
    manager.registerHooks(modelName, { afterDelete: (d: any) => d });
    const r1 = await manager.executeHook(modelName, 'beforeCreate', data, context);
    expect(r1.data).toBe(data);

    // Model doesn't exist
    const r2 = await manager.executeHook('unknown', 'beforeCreate', data, context);
    expect(r2.data).toBe(data);
  });

  it('should catch errors in hook execution', async () => {
    const manager = createHooksManager({ enableLogging: false });
    manager.registerHooks(modelName, {
      beforeCreate: () => {
        throw new Error('Hook failed');
      }
    });

    const result = await manager.executeHook(modelName, 'beforeCreate', {}, context);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Hook execution failed');
  });

  it('should unregister hooks correctly', () => {
    const manager = createHooksManager();
    manager.registerHooks(modelName, { beforeCreate: (d: any) => d });
    expect(manager.hasHook(modelName, 'beforeCreate')).toBe(true);

    manager.unregisterHooks(modelName);
    expect(manager.hasHook(modelName, 'beforeCreate')).toBe(false);
  });

  it('should pass context to hook handler', async () => {
    const manager = createHooksManager();
    let capturedContext: any = null;

    manager.registerHooks(modelName, {
      beforeCreate: (data: any, ctx: any) => {
        capturedContext = ctx;
        return data;
      }
    });

    await manager.executeHook(modelName, 'beforeCreate', {}, { modelName: 'test', operation: 'find' });
    expect(capturedContext.modelName).toBe('test');
    expect(capturedContext.operation).toBe('find');
  });
});
