/**
 * JSON Adapter Configuration
 */
export interface JsonAdapterConfig extends Record<string, unknown> {
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
	/**
	 * Standalone mode: automatically creates _forja metadata table on connect (default: false)
	 * Use this when running the JSON adapter without Forja core (e.g. direct adapter usage or tests)
	 */
	standalone?: boolean;
}

/**
 * File structure for a table
 */
export interface JsonTableFile<T = Record<string, unknown>> {
	meta: {
		version: number;
		lastInsertId?: number;
		updatedAt: string;
		name: string;
	};
	data: T[];
}
