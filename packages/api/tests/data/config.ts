import { defineConfig } from "forja-core";
import { ApiPlugin } from "../../src/api";
import { testSchemas } from "./schemas";
import path from "node:path";
import { ForjaConfig } from "forja-types";
import { getAdapter, getAdapterType } from "./adapter";

/**
 * Test Configuration
 *
 * Uses configurable adapter (json, postgres, or mysql)
 * API plugin enabled WITHOUT authentication
 *
 * Switch adapter via environment variable:
 * - ADAPTER=json npm test (default, fast in-memory)
 * - ADAPTER=postgres npm test (PostgreSQL database)
 * - ADAPTER=mysql npm test (MySQL database)
 */
export async function createTestConfig(tmpDir: string) {
	const adapterType = getAdapterType();
	const adapter = await getAdapter(adapterType, tmpDir);

	return defineConfig(() => {
		const config: ForjaConfig = {
			adapter,

			schemas: testSchemas,

			plugins: [
				new ApiPlugin({
					enabled: true,
					prefix: "/api",
					defaultPageSize: 25,
					maxPageSize: 100,
					maxPopulateDepth: 5,
					autoRoutes: true,
					excludeSchemas: [],
					// auth: undefined - NO AUTHENTICATION for initial tests
				}),
			],
		};

		return config as ForjaConfig;
	});
}

/**
 * Get temporary directory path for tests
 */
export function getTmpDir(): string {
	return path.join(process.cwd(), "packages", "api", "tests", ".tmp");
}
