import { defineConfig } from 'forja-core';
import { JsonAdapter } from '../../../adapter-json/src/index';
import { ApiPlugin } from '../../src/api';
import { testSchemas } from './schemas';
import path from 'node:path';
import { ForjaConfig } from 'forja-types';

/**
 * Test Configuration
 *
 * Uses JsonAdapter with temporary directory for testing
 * API plugin enabled WITHOUT authentication
 */
export function createTestConfig(tmpDir: string) {
  return defineConfig(() => {

    const config: ForjaConfig<JsonAdapter> = {
      adapter: new JsonAdapter({
        root: tmpDir,
        cache: true,
        readLock: false,
        lockTimeout: 5000,
        staleTimeout: 10000,
      }),

      schemas: testSchemas,

      plugins: [
        new ApiPlugin({
          enabled: true,
          prefix: '/api',
          defaultPageSize: 25,
          maxPageSize: 100,
          maxPopulateDepth: 5,
          autoRoutes: true,
          excludeSchemas: [],
          // auth: undefined - NO AUTHENTICATION for initial tests
        }),
      ],
    }

    return config as ForjaConfig;
  });
}

/**
 * Get temporary directory path for tests
 */
export function getTmpDir(): string {
  return path.join(process.cwd(), 'packages', 'api', 'tests', '.tmp');
}
