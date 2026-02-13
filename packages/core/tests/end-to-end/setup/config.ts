/**
 * Core End-to-End Test Configuration
 *
 * Uses the same adapter factory as API tests.
 * No API plugin - tests CRUD directly via Forja instance.
 */

import { defineConfig, Forja } from "forja-core";
import type { ForjaConfig } from "forja-types";
import path from "node:path";
import { getAdapter, getAdapterType } from "./adapter";
import { testSchemas } from "./schemas";

/**
 * Create test configuration for core e2e tests
 *
 * @param tmpDir - Temporary directory for test data
 * @returns Forja factory function
 */
export async function createTestConfig(
	tmpDir: string,
): Promise<() => Promise<Forja>> {
	const adapterType = getAdapterType();
	const adapter = await getAdapter(adapterType, tmpDir);

	return defineConfig(() => {
		const config: ForjaConfig = {
			adapter,
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
export async function setupTables(forja: Forja): Promise<void> {
	const adapter = forja.getAdapter();

	for (const schema of forja.getSchemas().getAll()) {
		try {
			await adapter.dropTable(schema.tableName!);
		} catch {
			// Table might not exist, ignore
		}

		const result = await adapter.createTable(schema);
		if (!result.success) {
			throw new Error(
				`Failed to create table ${schema.name}: ${result.error.message}`,
			);
		}
	}
}
