/**
 * MongoDB Test Utilities
 *
 * Helper functions for test database setup.
 * Only for development/testing - not for production use.
 */

import { MongoClient } from "mongodb";

export interface TestDatabaseConfig {
	readonly uri?: string;
}

/**
 * Create a test database (drops existing one first)
 *
 * Connects to MongoDB, drops the target DB if exists,
 * creating a fresh empty database.
 *
 * @param dbName - Database name to create
 * @param config - Connection config (defaults to localhost)
 */
export async function createTestDatabase(
	dbName: string,
	config: TestDatabaseConfig = {},
): Promise<void> {
	const uri = config.uri ?? "mongodb://localhost:27017";
	const client = new MongoClient(uri);

	try {
		await client.connect();
		const db = client.db(dbName);
		await db.dropDatabase();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to create test database: ${message}`);
	} finally {
		await client.close();
	}
}
