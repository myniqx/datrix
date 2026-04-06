/**
 * MySQL Test Utilities
 *
 * Helper functions for test database setup.
 * Only for development/testing - not for production use.
 */

import { createConnection } from "mysql2/promise";

export interface TestDatabaseConfig {
	readonly host?: string;
	readonly port?: number;
	readonly user?: string;
	readonly password?: string;
}

/**
 * Create a test database (drops existing one first)
 *
 * Connects without database, drops the target DB if exists,
 * then creates a fresh one.
 *
 * @param dbName - Database name to create
 * @param config - Connection config (defaults to localhost/root)
 *
 * @example
 * ```ts
 * await createTestDatabase("datrix_test_abc123", {
 *   host: "localhost",
 *   user: "root",
 *   password: "password"
 * });
 * ```
 */
export async function createTestDatabase(
	dbName: string,
	config: TestDatabaseConfig = {},
): Promise<void> {
	const connection = await createConnection({
		host: config.host ?? "localhost",
		port: config.port ?? 3306,
		user: config.user ?? "root",
		password: config.password ?? "",
	});

	try {
		await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
		await connection.query(`CREATE DATABASE \`${dbName}\``);
	} finally {
		await connection.end();
	}
}
