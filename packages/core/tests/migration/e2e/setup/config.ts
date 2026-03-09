/**
 * Migration E2E Test Configuration
 *
 * Creates Forja instances for migration testing.
 */

import { defineConfig, Forja } from "forja-core";
import type { ForjaConfig } from "forja-types";
import type { SchemaDefinition } from "forja-types/core/schema";
import path from "node:path";
import { getAdapter, getAdapterType } from "./adapter";

/**
 * Create test configuration with given schemas
 *
 * @param tmpDir - Temporary directory for test data
 * @param schemas - Schemas to register
 * @returns Forja factory function
 */
export async function createTestConfig(
	tmpDir: string,
	schemas: readonly SchemaDefinition[],
	skipCreate = false
): Promise<() => Promise<Forja>> {
	const adapterType = getAdapterType();
	// skipCreate: true because DB is created once in beforeAll via getAdapter
	const adapter = await getAdapter(adapterType, tmpDir, {
		skipCreate,
	});

	return defineConfig(() => {
		const config: ForjaConfig = {
			adapter,
			schemas: [...schemas],
			plugins: [],
			migration: {
				modelName: "_forja_migration",
			},
		};

		return config;
	});
}

/**
 * Create and initialize Forja with given schemas
 *
 * @param tmpDir - Temporary directory for test data
 * @param schemas - Schemas to register
 * @param options - Options (skipCreate: skip database drop/recreate)
 * @returns Initialized Forja instance
 */
export async function createForjaWithSchemas(
	tmpDir: string,
	schemas: readonly SchemaDefinition[],
	skipCreate = false,
): Promise<Forja> {
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
