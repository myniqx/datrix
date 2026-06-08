/**
 * Driver-agnostic PostgreSQL connection contracts
 *
 * This package never imports `pg`. Consumers provide a `PostgresCoreConfig`
 * implementation — typically a thin wrapper around `pg`, `postgres.js`,
 * the Neon serverless driver, etc.
 */

/**
 * Minimal query result shape we rely on (subset of pg's QueryResult).
 */
export interface PgQueryResult<T = Record<string, unknown>> {
	readonly rows: T[];
	readonly rowCount: number | null;
}

/**
 * Anything that can run a parameterized SQL query.
 * Satisfied by pg's Pool, PoolClient, or any compatible wrapper.
 */
export interface PgRunner {
	query<T = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
	): Promise<PgQueryResult<T>>;
}

/**
 * A dedicated connection/session, required for transactions
 * (BEGIN/COMMIT/ROLLBACK/SAVEPOINT must run on the same session).
 */
export interface PgConnection extends PgRunner {
	release(): void | Promise<void>;
}

