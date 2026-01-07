/**
 * Core - Dispatcher Tests
 *
 * Tests the Dispatcher:
 * - Proper hook execution order
 * - Query manipulation by plugins
 * - Result manipulation by plugins
 * - Error isolation (one plugin failing shouldn't stop others)
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

  it('should isolate errors in plugins', async () => {
    const registry = new PluginRegistry();
    const plugin1: ForjaPlugin = {
      name: 'failing', version: '1', options: {},
      init: async () => ({ success: true, data: undefined }),
      destroy: async () => ({ success: true, data: undefined }),
      onBeforeQuery: async () => { throw new Error('Boom'); }
    };
    const plugin2: ForjaPlugin = {
      name: 'working', version: '1', options: {},
      init: async () => ({ success: true, data: undefined }),
      destroy: async () => ({ success: true, data: undefined }),
      onBeforeQuery: async (q) => ({ ...q, table: 'fixed' })
    };

    registry.register(plugin1);
    registry.register(plugin2);

    const dispatcher = new Dispatcher(registry);

    // Should not throw
    const result = await dispatcher.dispatchBeforeQuery({ type: 'select', table: 'initial' });
    expect(result.table).toBe('fixed');
  });

  it('should allow modifying results in sequence', async () => {
    const registry = new PluginRegistry();
    const plugin1: ForjaPlugin = {
      name: 'p1', version: '1', options: {},
      init: async () => ({ success: true, data: undefined }),
      destroy: async () => ({ success: true, data: undefined }),
      onAfterQuery: async (r: any) => ({ ...r, count: r.count + 1 })
    };

    registry.register(plugin1);

    const dispatcher = new Dispatcher(registry);
    const result = await dispatcher.dispatchAfterQuery({ count: 10 });

    expect(result.count).toBe(11);
  });
});
