import { defineConfig } from "@datrix/core";
import { ApiPlugin } from "../../src/api";
import { testSchemas } from "./schemas";
import path from "node:path";
import { DatrixConfig } from "@datrix/core";
import { getTestEnv } from "./adapter";

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
	const { adapter, idType } = await getTestEnv(tmpDir);

	return defineConfig(() => {
		const config: DatrixConfig = {
			adapter,
			idType,

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

		return config as DatrixConfig;
	});
}

/**
 * Get temporary directory path for tests
 */
export function getTmpDir(test: string): string {
	return path.join(
		process.cwd(),
		"packages",
		"api",
		"tests",
		"." + test + "_tmp",
	);
}
