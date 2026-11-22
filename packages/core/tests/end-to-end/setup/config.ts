/**
 * Core End-to-End Test Configuration
 *
 * Uses the same adapter factory as API tests.
 * No API plugin - tests CRUD directly via Datrix instance.
 */

import { defineConfig, Datrix } from "@datrix/core";
import type { DatrixConfig, IdType } from "@datrix/core";
import path from "node:path";
import { getTestEnv } from "./adapter";
import { testSchemas } from "./schemas";

/**
 * Create test configuration for core e2e tests
 *
 * @param tmpDir - Temporary directory for test data
 * @param options - idType: pin the idType instead of the test env one
 * @returns Datrix factory function
 */
export async function createTestConfig(
	tmpDir: string,
	options?: { idType?: IdType },
): Promise<() => Promise<Datrix>> {
	const env = await getTestEnv(tmpDir);
	const adapter = env.adapter;
	const idType = options?.idType ?? env.idType;

	return defineConfig(() => {
		const config: DatrixConfig = {
			adapter,
			idType,
			schemas: testSchemas,
			plugins: [],
		};

		return config;
	});
}

/**
 * Get temporary directory path for core e2e tests
 *
 * @param name - Unique name for test isolation (e.g., "single_create")
 */
export function getTmpDir(name: string): string {
	return path.join(
		process.cwd(),
		"packages",
		"core",
		"tests",
		"end-to-end",
		".tmp",
		name,
	);
}

/**
 * Setup tables for testing
 * Drops existing tables and creates fresh ones
 */
export async function setupTables(datrix: Datrix): Promise<void> {
	const adapter = datrix.getAdapter();

	for (const schema of datrix.getSchemas().getAll()) {
		try {
			await adapter.dropTable(schema.tableName!);
		} catch {
			// Table might not exist, ignore
		}

		await adapter.createTable(schema);
	}
}
