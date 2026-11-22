/**
 * Adapter Factory for Tests
 *
 * Provides a single place to switch between adapters
 * Useful for testing with different database backends
 */

import { JsonAdapter } from "../../../adapter-json/src/index";
import { createPostgresAdapter } from "../../../adapter-postgres/src/index";
import { MySQLAdapter } from "../../../adapter-mysql/src/index";
import { MongoDBAdapter } from "../../../adapter-mongodb/src/index";
import { createTestDatabase as createPostgresTestDatabase } from "../../../adapter-postgres/src/test-utils";
import { createTestDatabase as createMySQLTestDatabase } from "../../../adapter-mysql/src/test-utils";
import { createTestDatabase as createMongoDBTestDatabase } from "../../../adapter-mongodb/src/test-utils";
import { createHash } from "node:crypto";
import type { DatabaseAdapter, DatrixId, IdType } from "@datrix/core";

/**
 * Supported adapter types for testing
 */
export type AdapterType = "json" | "postgres" | "mysql" | "mariadb" | "mongodb";

/**
 * Defaults used when the env vars are not set.
 * Edit these to switch every test (e.g. from the VS Code Vitest extension).
 */
const DEFAULT_ADAPTER: AdapterType = "json";
const DEFAULT_ID_TYPE: IdType = "int";

/**
 * Adapter instance + idType every test runs with
 */
export interface TestEnv {
	readonly adapter: DatabaseAdapter;
	readonly adapterType: AdapterType;
	readonly idType: IdType;
}

/**
 * Generate a safe database name from root path
 */
function generateDbName(root: string): string {
	const hash = createHash("md5").update(root).digest("hex").slice(0, 8);
	return `datrix_test_${hash}`;
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
			const port = parseInt(process.env["POSTGRES_PORT"] ?? "5433", 10);
			const user = process.env["POSTGRES_USER"] ?? "datrix_test";
			const password = process.env["POSTGRES_PASSWORD"] ?? "datrix_test";

			// Create fresh database (skip if reusing existing)
			if (!options?.skipCreate) {
				await createPostgresTestDatabase(dbName, {
					host,
					port,
					user,
					password,
				});
			}

			return createPostgresAdapter({
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
				applicationName: "datrix-test",
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
			const user = process.env[`${prefix}_USER`] ?? "datrix";
			const password = process.env[`${prefix}_PASSWORD`] ?? "datrix";

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
				appName: "datrix-test",
			}) as DatabaseAdapter;
		}

		default:
			throw new Error(`Unknown adapter type: ${type}`);
	}
}

const ADAPTER_TYPES: readonly AdapterType[] = [
	"json",
	"postgres",
	"mysql",
	"mariadb",
	"mongodb",
];
const ID_TYPES: readonly IdType[] = ["int", "uuid"];

function envValue<T extends string>(
	name: string,
	allowed: readonly T[],
	fallback: T,
): T {
	const value = process.env[name]?.toLowerCase() as T | undefined;
	return value !== undefined && allowed.includes(value) ? value : fallback;
}

/**
 * idType tests run with (`ID_TYPE` env, else DEFAULT_ID_TYPE).
 * For tests that build their own adapter.
 */
export function getTestIdType(): IdType {
	return envValue("ID_TYPE", ID_TYPES, DEFAULT_ID_TYPE);
}

/**
 * A well-formed id that matches no record, for "not found" tests.
 * Typed as DatrixId (number without the uuid augmentation).
 */
export function getMissingId(): DatrixId {
	return (
		getTestIdType() === "uuid" ? "00000000-0000-7000-8000-000000000000" : 99999
	) as DatrixId;
}

/**
 * Create the test adapter and resolve the idType tests run with
 *
 * Reads `ADAPTER` and `ID_TYPE` env vars, falling back to
 * DEFAULT_ADAPTER / DEFAULT_ID_TYPE above.
 *
 * @param root - Data directory (JSON) or unique identifier for the DB name
 * @param options - skipCreate: reuse an existing database
 *
 * @example
 * const { adapter, idType } = await getTestEnv(tmpDir);
 * defineConfig(() => ({ adapter, idType, schemas, plugins: [] }));
 *
 * // npm test                              → defaults
 * // ADAPTER=postgres npm test             → postgres
 * // ADAPTER=mysql ID_TYPE=uuid npm test   → mysql with uuid ids
 * // ADAPTER=mariadb npm test              → mariadb (MySQLAdapter on port 3307)
 * // ADAPTER=mongodb npm test              → mongodb
 *
 * // Docker commands for test databases:
 * // docker run -d --name mysql-test -e MYSQL_ROOT_PASSWORD=datrix -e MYSQL_USER=datrix -e MYSQL_PASSWORD=datrix -e MYSQL_DATABASE=datrix -p 3306:3306 mysql:8.0
 * // docker run -d --name mariadb-test -e MYSQL_ROOT_PASSWORD=datrix -e MYSQL_USER=datrix -e MYSQL_PASSWORD=datrix -e MYSQL_DATABASE=datrix -p 3307:3306 mariadb:10.5
 * // docker run -d --name postgres-test -e POSTGRES_USER=datrix_test -e POSTGRES_PASSWORD=datrix_test -e POSTGRES_DB=datrix_test -p 5432:5432 postgres:16
 * // docker run -d --name mongodb-test -p 27017:27017 mongo:7
 */
export async function getTestEnv(
	root: string,
	options?: { skipCreate?: boolean },
): Promise<TestEnv> {
	const adapterType = envValue("ADAPTER", ADAPTER_TYPES, DEFAULT_ADAPTER);
	return {
		adapter: await getAdapter(adapterType, root, options),
		adapterType,
		idType: getTestIdType(),
	};
}
