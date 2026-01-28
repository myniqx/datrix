/**
 * Adapter Factory for Tests
 *
 * Provides a single place to switch between adapters
 * Useful for testing with different database backends
 */

import { JsonAdapter } from '../../../adapter-json/src/index';
import { PostgresAdapter } from '../../../adapter-postgres/src/index';
import type { DatabaseAdapter } from 'forja-types/core/adapter';

/**
 * Supported adapter types for testing
 */
export type AdapterType = 'json' | 'postgres';

/**
 * Get database adapter for testing
 *
 * @param type - Adapter type ('json' or 'postgres')
 * @param tmpDir - Temporary directory for JsonAdapter (ignored for Postgres)
 * @returns Database adapter instance
 *
 * @example
 * // Use JsonAdapter for fast in-memory tests
 * const adapter = getAdapter('json', tmpDir);
 *
 * @example
 * // Use PostgresAdapter for real database tests
 * const adapter = getAdapter('postgres');
 */
export function getAdapter(type: AdapterType, tmpDir?: string): DatabaseAdapter {
  switch (type) {
    case 'json':
      if (!tmpDir) {
        throw new Error('tmpDir is required for JsonAdapter');
      }
      return new JsonAdapter({
        root: tmpDir,
        cache: true,
        readLock: false,
        lockTimeout: 5000,
        staleTimeout: 10000,
      });

    case 'postgres':
      // Parse DATABASE_URL or use individual env vars
      const databaseUrl = process.env.DATABASE_URL || "postgres://fc_user:Fc123@localhost:5432/forja_test";

      if (databaseUrl) {
        // Parse postgres://user:password@host:port/database
        const url = new URL(databaseUrl);
        const params = {
          host: url.hostname,
          port: parseInt(url.port || '5432', 10),
          database: url.pathname.slice(1), // Remove leading slash
          user: url.username,
          password: url.password,
          ssl: false,
          max: 10,
          min: 2,
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 10000,
          applicationName: 'forja-test',
        }
        return new PostgresAdapter(params);
      }

      // Fallback to individual env vars
      return new PostgresAdapter({
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
        database: process.env.POSTGRES_DB || 'forja_test',
        user: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || 'postgres',
        ssl: false,
        max: 10,
        min: 2,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
        applicationName: 'forja-test',
      });

    default:
      throw new Error(`Unknown adapter type: ${type}`);
  }
}

/**
 * Get current adapter type from environment
 * Defaults to 'json' for fast tests
 *
 * @example
 * // Run tests with different adapters
 * // npm test                    → json (default)
 * // ADAPTER=postgres npm test   → postgres
 */
export function getAdapterType(): AdapterType {
  const adapterEnv = process.env.ADAPTER?.toLowerCase();
  if (adapterEnv === 'postgres' || adapterEnv === 'json') {
    return adapterEnv;
  }
  return 'postgres'; // Default
}
