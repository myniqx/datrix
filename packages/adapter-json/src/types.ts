
/**
 * JSON Adapter Configuration
 */
export interface JsonAdapterConfig {
  /**
   * Root directory to store JSON files
   */
  readonly root: string;
  lockTimeout?: number; // ms to wait for lock before failing (default: 5000)
  staleTimeout?: number; // ms after which a lock is considered stale (default: 30000)
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
