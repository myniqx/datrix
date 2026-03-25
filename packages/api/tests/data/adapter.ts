/**
 * Adapter Factory for Tests
 *
 * Provides a single place to switch between adapters
 * Useful for testing with different database backends
 */

import { JsonAdapter } from "../../../adapter-json/src/index";
import { PostgresAdapter } from "../../../adapter-postgres/src/index";
import { MySQLAdapter } from "../../../adapter-mysql/src/index";
import { MongoDBAdapter } from "../../../adapter-mongodb/src/index";
import { createTestDatabase as createPostgresTestDatabase } from "../../../adapter-postgres/src/test-utils";
import { createTestDatabase as createMySQLTestDatabase } from "../../../adapter-mysql/src/test-utils";
import { createTestDatabase as createMongoDBTestDatabase } from "../../../adapter-mongodb/src/test-utils";
import { createHash } from "node:crypto";
import { DatabaseAdapter } from "forja-types/adapter";

/**
 * Supported adapter types for testing
 */
export type AdapterType = "json" | "postgres" | "mysql" | "mariadb" | "mongodb";

/**
 * Generate a safe database name from root path
 */
function generateDbName(root: string): string {
	const hash = createHash("md5").update(root).digest("hex").slice(0, 8);
	return `forja_test_${hash}`;
}

/**
 * Get database adapter for testing
 *
 * For JSON adapter, root is used as the data directory.
 * For PostgreSQL/MySQL, root is hashed to create a unique database name.
 * The database is dropped and recreated to ensure a clean state.
 *
 * @param type - Adapter type ('json', 'postgres', or 'mysql')
 * @param root - Root directory (JSON) or unique identifier for DB name (PostgreSQL/MySQL)
 * @returns Database adapter instance
 *
 * @example
 * // Use JsonAdapter for fast in-memory tests
 * const adapter = await getAdapter('json', tmpDir);
 *
 * @example
 * // Use PostgresAdapter with isolated database
 * const adapter = await getAdapter('postgres', 'my-test-suite');
 *
 * @example
 * // Use MySQLAdapter with isolated database
 * const adapter = await getAdapter('mysql', 'my-test-suite');
 */
export async function getAdapter(
	type: AdapterType,
	root: string,
	options?: { skipCreate?: boolean },
): Promise<DatabaseAdapter> {
	switch (type) {
		case "json":
			return new JsonAdapter({
				root,
				cache: true,
				readLock: false,
				lockTimeout: 5000,
				staleTimeout: 10000,
			}) as DatabaseAdapter;

		case "postgres": {
			const dbName = generateDbName(root);

			// Parse connection config from env
			const host = process.env["POSTGRES_HOST"] ?? "localhost";
			const port = parseInt(process.env["POSTGRES_PORT"] ?? "5432", 10);
			const user = process.env["POSTGRES_USER"] ?? "forja_test";
			const password = process.env["POSTGRES_PASSWORD"] ?? "forja_test";

			// Create fresh database (skip if reusing existing)
			if (!options?.skipCreate) {
				await createPostgresTestDatabase(dbName, {
					host,
					port,
					user,
					password,
				});
			}

			return new PostgresAdapter({
				host,
				port,
				database: dbName,
				user,
				password,
				ssl: false,
				max: 10,
				min: 2,
				connectionTimeoutMillis: 5000,
				idleTimeoutMillis: 10000,
				applicationName: "forja-test",
			}) as DatabaseAdapter;
		}

		case "mysql":
		case "mariadb": {
			const dbName = generateDbName(root);
			const isMariaDB = type === "mariadb";
			const prefix = isMariaDB ? "MARIADB" : "MYSQL";

			// Parse connection config from env
			const host = process.env[`${prefix}_HOST`] ?? "localhost";
			const port = parseInt(
				process.env[`${prefix}_PORT`] ?? (isMariaDB ? "3307" : "3306"),
				10,
			);
			const user = process.env[`${prefix}_USER`] ?? "forja";
			const password = process.env[`${prefix}_PASSWORD`] ?? "forja";

			// Create fresh database (skip if reusing existing)
			if (!options?.skipCreate) {
				await createMySQLTestDatabase(dbName, { host, port, user, password });
			}

			return new MySQLAdapter({
				host,
				port,
				database: dbName,
				user,
				password,
				connectionLimit: 10,
				connectTimeout: 5000,
			}) as DatabaseAdapter;
		}

		case "mongodb": {
			const dbName = generateDbName(root);

			// Parse connection config from env
			const uri = process.env["MONGODB_URI"] ?? "mongodb://localhost:27017";

			// Create fresh database (skip if reusing existing)
			if (!options?.skipCreate) {
				await createMongoDBTestDatabase(dbName, { uri });
			}

			return new MongoDBAdapter({
				uri,
				database: dbName,
				maxPoolSize: 10,
				minPoolSize: 2,
				connectTimeoutMS: 5000,
				serverSelectionTimeoutMS: 5000,
				appName: "forja-test",
			}) as DatabaseAdapter;
		}

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
 * // ADAPTER=mysql npm test      → mysql
 * // ADAPTER=mariadb npm test   → mariadb (uses MySQLAdapter on port 3307)
 * // ADAPTER=mongodb npm test   → mongodb
 *
 * // Docker commands for test databases:
 * // docker run -d --name mysql-test -e MYSQL_ROOT_PASSWORD=forja -e MYSQL_USER=forja -e MYSQL_PASSWORD=forja -e MYSQL_DATABASE=forja -p 3306:3306 mysql:8.0
 * // docker run -d --name mariadb-test -e MYSQL_ROOT_PASSWORD=forja -e MYSQL_USER=forja -e MYSQL_PASSWORD=forja -e MYSQL_DATABASE=forja -p 3307:3306 mariadb:10.5
 * // docker run -d --name postgres-test -e POSTGRES_USER=forja_test -e POSTGRES_PASSWORD=forja_test -e POSTGRES_DB=forja_test -p 5432:5432 postgres:16
 * // docker run -d --name mongodb-test -p 27017:27017 mongo:7
 */
export function getAdapterType(): AdapterType {
	const adapterEnv = process.env["ADAPTER"]?.toLowerCase();
	if (
		adapterEnv === "postgres" ||
		adapterEnv === "mysql" ||
		adapterEnv === "mariadb" ||
		adapterEnv === "mongodb" ||
		adapterEnv === "json"
	) {
		return adapterEnv;
	}
	return "json"; // Default
}
