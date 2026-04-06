/**
 * Migration E2E Test Configuration
 *
 * Creates Datrix instances for migration testing.
 */

import { defineConfig, Datrix } from "@datrix/core";
import type { DatrixConfig } from "@datrix/core";
import type { SchemaDefinition } from "@datrix/core";
import path from "node:path";
import { getAdapter, getAdapterType } from "./adapter";

/**
 * Create test configuration with given schemas
 *
 * @param tmpDir - Temporary directory for test data
 * @param schemas - Schemas to register
 * @returns Datrix factory function
 */
export async function createTestConfig(
	tmpDir: string,
	schemas: readonly SchemaDefinition[],
	skipCreate = false,
): Promise<() => Promise<Datrix>> {
	const adapterType = getAdapterType();
	// skipCreate: true because DB is created once in beforeAll via getAdapter
	const adapter = await getAdapter(adapterType, tmpDir, {
		skipCreate,
	});

	return defineConfig(() => {
		const config: DatrixConfig = {
			adapter,
			schemas: [...schemas],
			plugins: [],
			migration: {
				modelName: "_datrix_migration",
			},
		};

		return config;
	});
}

/**
 * Create and initialize Datrix with given schemas
 *
 * @param tmpDir - Temporary directory for test data
 * @param schemas - Schemas to register
 * @param options - Options (skipCreate: skip database drop/recreate)
 * @returns Initialized Datrix instance
 */
export async function createDatrixWithSchemas(
	tmpDir: string,
	schemas: readonly SchemaDefinition[],
	skipCreate = false,
): Promise<Datrix> {
	const factory = await createTestConfig(tmpDir, schemas, skipCreate);
	return await factory();
}

/**
 * Get temporary directory path for migration e2e tests
 *
 * @param name - Unique name for test isolation
 */
export function getTmpDir(name: string): string {
	return path.join(
		process.cwd(),
		"packages",
		"core",
		"tests",
		"migration",
		"e2e",
		".tmp",
		name,
	);
}
