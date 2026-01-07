/**
 * Core - Dispatcher Tests
 *
 * Tests the Dispatcher:
 * - Proper hook execution order
 * - Query manipulation by plugins
 * - Result manipulation by plugins
 * - Error isolation (one plugin failing shouldn't stop others)
 * - Strict QueryObject validation (entrance and per-plugin)
 * - Cross-plugin communication via 'meta' field
 */

import { describe, it, expect, vi } from 'vitest';
import { Dispatcher } from '@core/dispatcher';
import { PluginRegistry } from '@plugins/base/types';
import type { ForjaPlugin } from '@plugins/base/types';
import type { QueryObject } from '@adapters/base/types';

describe('Core - Dispatcher', () => {
  it('should call onSchemaLoad on all plugins', async () => {
    const registry = new PluginRegistry();
    const plugin1: ForjaPlugin = {
      name: 'p1', version: '1', options: {},
      init: async () => ({ success: true, data: undefined }),
      destroy: async () => ({ success: true, data: undefined }),
      onSchemaLoad: vi.fn()
    };
    const plugin2: ForjaPlugin = {
      name: 'p2', version: '1', options: {},
      init: async () => ({ success: true, data: undefined }),
      destroy: async () => ({ success: true, data: undefined }),
      onSchemaLoad: vi.fn()
    };

    registry.register(plugin1);
    registry.register(plugin2);

    const dispatcher = new Dispatcher(registry);
    const mockSchemas: any = { name: 'Registry' };

    await dispatcher.dispatchSchemaLoad(mockSchemas);

    expect(plugin1.onSchemaLoad).toHaveBeenCalledWith(mockSchemas);
    expect(plugin2.onSchemaLoad).toHaveBeenCalledWith(mockSchemas);
  });

  it('should allow plugins to modify query in sequence', async () => {
    const registry = new PluginRegistry();
    const plugin1: ForjaPlugin = {
      name: 'p1', version: '1', options: {},
      init: async () => ({ success: true, data: undefined }),
      destroy: async () => ({ success: true, data: undefined }),
      onBeforeQuery: async (q) => ({ ...q, table: q.table + '_p1' })
    };
    const plugin2: ForjaPlugin = {
      name: 'p2', version: '1', options: {},
      init: async () => ({ success: true, data: undefined }),
      destroy: async () => ({ success: true, data: undefined }),
      onBeforeQuery: async (q) => ({ ...q, table: q.table + '_p2' })
    };

    registry.register(plugin1);
    registry.register(plugin2);

    const dispatcher = new Dispatcher(registry);
    const initialQuery: QueryObject = { type: 'select', table: 'users' };

    const finalQuery = await dispatcher.dispatchBeforeQuery(initialQuery);

    expect(finalQuery.table).toBe('users_p1_p2');
  });

  it('should allow modifying results in sequence', async () => {
    const registry = new PluginRegistry();
    const plugin1: ForjaPlugin = {
      name: 'p1', version: '1', options: {},
      init: async () => ({ success: true, data: undefined }),
      destroy: async () => ({ success: true, data: undefined }),
      onAfterQuery: async (r: any) => ({ ...r, count: (r.count || 0) + 1 })
    };

    registry.register(plugin1);

    const dispatcher = new Dispatcher(registry);
    const result = await dispatcher.dispatchAfterQuery({ count: 10 });

    expect(result.count).toBe(11);
  });

  it('should throw if entrance query is invalid', async () => {
    const registry = new PluginRegistry();
    const dispatcher = new Dispatcher(registry);

    // Invalid entrance query (missing type)
    const badQuery = { table: 'users' } as any;

    await expect(dispatcher.dispatchBeforeQuery(badQuery)).rejects.toThrow(
      'Entrance QueryObject is invalid'
    );
  });

  it('should throw if plugin returns an invalid query (now strict)', async () => {
    const registry = new PluginRegistry();
    const plugin: ForjaPlugin = {
      name: 'bad-plugin', version: '1', options: {},
      init: async () => ({ success: true, data: undefined }),
      destroy: async () => ({ success: true, data: undefined }),
      onBeforeQuery: async (q) => ({ ...q, ghostKey: 'I should not be here' } as any)
    };
    registry.register(plugin);

    const dispatcher = new Dispatcher(registry);
    const validQuery: QueryObject = { type: 'select', table: 'users' };

    await expect(dispatcher.dispatchBeforeQuery(validQuery)).rejects.toThrow(
      "Plugin 'bad-plugin' returned an invalid query"
    );
  });

  it('should allow plugins to communicate via meta field', async () => {
    const registry = new PluginRegistry();
    const p1: ForjaPlugin = {
      name: 'p1', version: '1', options: {},
      init: async () => ({ success: true, data: undefined }),
      destroy: async () => ({ success: true, data: undefined }),
      onBeforeQuery: async (q) => ({ ...q, meta: { ...q.meta, p1_data: 'hello' } })
    };
    const p2: ForjaPlugin = {
      name: 'p2', version: '1', options: {},
      init: async () => ({ success: true, data: undefined }),
      destroy: async () => ({ success: true, data: undefined }),
      onBeforeQuery: async (q) => {
        const p1Data = q.meta?.p1_data;
        return { ...q, table: q.table + '_' + p1Data };
      }
    };

    registry.register(p1);
    registry.register(p2);

    const dispatcher = new Dispatcher(registry);
    const result = await dispatcher.dispatchBeforeQuery({ type: 'select', table: 'users' });

    expect(result.table).toBe('users_hello');
    expect(result.meta?.p1_data).toBe('hello');
  });
});
