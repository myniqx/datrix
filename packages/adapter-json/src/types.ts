
/**
 * JSON Adapter Configuration
 */
export interface JsonAdapterConfig {
  /**
   * Root directory to store JSON files
   */
  readonly root: string;
  /**
   * ms to wait for lock before failing (default: 5000)
   */
  lockTimeout?: number;
  /**
   * ms after which a lock is considered stale (default: 30000)
   */
  staleTimeout?: number;
  /**
   * Enable in-memory cache with mtime validation (default: true)
   * Cache stores parsed JSON data and validates against file mtime
   */
  cache?: boolean;
  /**
   * Require lock for read operations (default: false)
   * Enable this if you need strict read consistency in concurrent write scenarios
   */
  readLock?: boolean;
}

/**
 * File structure for a table
 */
export interface JsonTableFile<T = unknown> {
  meta: {
    version: number;
    lastInsertId?: number;
    updatedAt: string;
    name: string;
  };
  readonly schema?: unknown; // We can store schema definition here
  data: T[];
}
