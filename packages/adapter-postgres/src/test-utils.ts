/**
 * PostgreSQL Test Utilities
 *
 * Helper functions for test database setup.
 * Only for development/testing - not for production use.
 */

import { Client } from "pg";

export interface TestDatabaseConfig {
	readonly host?: string;
	readonly port?: number;
	readonly user?: string;
	readonly password?: string;
}

/**
 * Create a test database (drops existing one first)
 *
 * Connects to 'postgres' admin database, drops the target DB if exists,
 * then creates a fresh one.
 *
 * @param dbName - Database name to create
 * @param config - Connection config (defaults to localhost/postgres)
 *
 * @example
 * ```ts
 * await createTestDatabase("forja_test_abc123", {
 *   host: "localhost",
 *   user: "postgres",
 *   password: "postgres"
 * });
 * ```
 */
export async function createTestDatabase(
	dbName: string,
	config: TestDatabaseConfig = {},
): Promise<void> {
	const client = new Client({
		host: config.host ?? "localhost",
		port: config.port ?? 5432,
		user: config.user ?? "postgres",
		password: config.password ?? "postgres",
		database: "postgres",
	});

	try {
		await client.connect();

		// Terminate existing connections to the database
		await client.query(`
			SELECT pg_terminate_backend(pg_stat_activity.pid)
			FROM pg_stat_activity
			WHERE pg_stat_activity.datname = $1
			AND pid <> pg_backend_pid()
		`, [dbName]);

		// Drop and create
		await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
		await client.query(`CREATE DATABASE "${dbName}"`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to create test database: ${message}`);
	}
	finally {
		await client.end();
	}
}
