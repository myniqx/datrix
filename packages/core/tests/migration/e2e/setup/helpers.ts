/**
 * Migration E2E Test Helpers
 *
 * Utility functions for migration testing.
 */

import { expect } from "vitest";
import type { DatabaseAdapter } from "forja-types/adapter";
import type { MigrationSession, AmbiguousChange, Forja } from "forja-core";

// ============================================
// Table Name Resolution
// ============================================

/**
 * Get table name from model name using Forja's schema registry
 */
function getTableName(forja: Forja, modelName: string): string {
	const schema = forja.getSchemas().get(modelName);
	if (!schema) {
		throw new Error(`Schema '${modelName}' not found in registry`);
	}
	return schema.tableName ?? schema.name;
}

// ============================================
// Session Helpers
// ============================================

/**
 * Auto-resolve all ambiguous changes with given strategy
 */
export function autoResolveAmbiguous(
	session: MigrationSession,
	strategy: "rename" | "drop_and_add",
): void {
	for (const change of session.ambiguous) {
		const result = session.resolveAmbiguous(change.id, strategy);
		if (!result.success) {
			throw new Error(`Failed to resolve ambiguous '${change.id}': ${result.error.message}`);
		}
	}
}

/**
 * Resolve specific ambiguous change by ID
 */
export function resolveAmbiguousById(
	session: MigrationSession,
	id: string,
	strategy: "rename" | "drop_and_add",
): void {
	const result = session.resolveAmbiguous(id, strategy);
	if (!result.success) {
		throw new Error(`Failed to resolve ambiguous '${id}': ${result.error.message}`);
	}
}

/**
 * Apply migration session with optional ambiguous resolution
 */
export async function applyMigration(
	session: MigrationSession,
	ambiguousStrategy: "rename" | "drop_and_add" = "drop_and_add",
): Promise<void> {
	// Resolve any ambiguous changes
	if (session.ambiguous.length > 0) {
		autoResolveAmbiguous(session, ambiguousStrategy);
	}

	// Apply
	const result = await session.apply();
	if (!result.success) {
		throw new Error(`Migration failed: ${result.error.message}`);
	}
}

// ============================================
// Assertion Helpers
// ============================================

/**
 * Assert table exists in database (by model name)
 */
export async function assertTableExists(
	forja: Forja,
	modelName: string,
): Promise<void> {
	const tableName = getTableName(forja, modelName);
	const adapter = forja.getAdapter();
	const exists = await adapter.tableExists(tableName);
	expect(exists, `Table '${tableName}' (model: ${modelName}) should exist`).toBe(true);
}

/**
 * Assert table does NOT exist in database (by model name)
 * Note: Uses adapter directly since schema might not be registered
 */
export async function assertTableNotExists(
	adapter: DatabaseAdapter,
	tableName: string,
): Promise<void> {
	const exists = await adapter.tableExists(tableName);
	expect(exists, `Table '${tableName}' should NOT exist`).toBe(false);
}

/**
 * Assert column exists in table (by model name)
 */
export async function assertColumnExists(
	forja: Forja,
	modelName: string,
	columnName: string,
): Promise<void> {
	const tableName = getTableName(forja, modelName);
	const adapter = forja.getAdapter();
	const schemaResult = await adapter.getTableSchema(tableName);
	expect(schemaResult.success, `Failed to get schema for '${tableName}'`).toBe(true);

	if (schemaResult.success) {
		const fields = Object.keys(schemaResult.data.fields);
		expect(
			fields.includes(columnName),
			`Column '${columnName}' should exist in '${tableName}'. Found: ${fields.join(", ")}`,
		).toBe(true);
	}
}

/**
 * Assert column does NOT exist in table (by model name)
 */
export async function assertColumnNotExists(
	forja: Forja,
	modelName: string,
	columnName: string,
): Promise<void> {
	const tableName = getTableName(forja, modelName);
	const adapter = forja.getAdapter();
	const schemaResult = await adapter.getTableSchema(tableName);
	expect(schemaResult.success, `Failed to get schema for '${tableName}'`).toBe(true);

	if (schemaResult.success) {
		const fields = Object.keys(schemaResult.data.fields);
		expect(
			fields.includes(columnName),
			`Column '${columnName}' should NOT exist in '${tableName}'`,
		).toBe(false);
	}
}

/**
 * Assert table has exactly these columns (excluding auto-generated: id, createdAt, updatedAt)
 */
export async function assertTableColumns(
	forja: Forja,
	modelName: string,
	expectedColumns: readonly string[],
): Promise<void> {
	const tableName = getTableName(forja, modelName);
	const adapter = forja.getAdapter();
	const schemaResult = await adapter.getTableSchema(tableName);
	expect(schemaResult.success, `Failed to get schema for '${tableName}'`).toBe(true);

	if (schemaResult.success) {
		const allFields = Object.keys(schemaResult.data.fields);
		// Filter out auto-generated fields
		const userFields = allFields.filter(
			(f) => !["id", "createdAt", "updatedAt"].includes(f),
		);

		expect(
			userFields.sort(),
			`Table '${tableName}' columns mismatch`,
		).toEqual([...expectedColumns].sort());
	}
}

/**
 * Get table column names (excluding auto-generated)
 */
export async function getTableColumns(
	forja: Forja,
	modelName: string,
): Promise<string[]> {
	const tableName = getTableName(forja, modelName);
	const adapter = forja.getAdapter();
	const schemaResult = await adapter.getTableSchema(tableName);
	if (!schemaResult.success) {
		throw new Error(`Failed to get schema for '${tableName}': ${schemaResult.error.message}`);
	}

	const allFields = Object.keys(schemaResult.data.fields);
	return allFields.filter((f) => !["id", "createdAt", "updatedAt"].includes(f));
}

// ============================================
// Setup Helpers
// ============================================

/**
 * Drop all tables (clean slate)
 */
export async function dropAllTables(adapter: DatabaseAdapter): Promise<void> {
	const tablesResult = await adapter.getTables();
	if (!tablesResult.success) {
		throw new Error(`Failed to get tables: ${tablesResult.error.message}`);
	}

	for (const tableName of tablesResult.data) {
		const dropResult = await adapter.dropTable(tableName);
		if (!dropResult.success) {
			// Ignore errors for non-existent tables
			console.warn(`Warning: Could not drop table '${tableName}'`);
		}
	}
}

/**
 * Setup tables from schemas (create fresh)
 */
export async function setupTablesFromSchemas(
	adapter: DatabaseAdapter,
	schemas: readonly { name: string; fields: Record<string, unknown>; indexes?: readonly unknown[] }[],
): Promise<void> {
	for (const schema of schemas) {
		// Drop if exists
		try {
			await adapter.dropTable(schema.name);
		} catch {
			// Ignore
		}

		// Create
		const result = await adapter.createTable(schema as Parameters<typeof adapter.createTable>[0]);
		if (!result.success) {
			throw new Error(`Failed to create table '${schema.name}': ${result.error.message}`);
		}
	}
}

// ============================================
// Ambiguous Assertion Helpers
// ============================================

/**
 * Assert session has specific number of ambiguous changes
 */
export function assertAmbiguousCount(
	session: MigrationSession,
	expectedCount: number,
): void {
	expect(
		session.ambiguous.length,
		`Expected ${expectedCount} ambiguous changes, got ${session.ambiguous.length}`,
	).toBe(expectedCount);
}

/**
 * Assert session has ambiguous change with specific removed/added names
 */
export function assertHasAmbiguous(
	session: MigrationSession,
	tableName: string,
	removedName: string,
	addedName: string,
): AmbiguousChange | undefined {
	const found = session.ambiguous.find(
		(a) =>
			a.tableName === tableName &&
			a.removedName === removedName &&
			a.addedName === addedName,
	);

	expect(
		found,
		`Expected ambiguous change: ${tableName}.${removedName} -> ${addedName}`,
	).toBeDefined();

	return found;
}

/**
 * Assert session has NO ambiguous changes
 */
export function assertNoAmbiguous(session: MigrationSession): void {
	expect(
		session.ambiguous.length,
		`Expected no ambiguous changes, but found: ${session.ambiguous.map((a) => a.id).join(", ")}`,
	).toBe(0);
}

// ============================================
// Plan Assertion Helpers
// ============================================

/**
 * Assert session detects specific number of tables to create
 */
export function assertTablesToCreate(
	session: MigrationSession,
	expectedCount: number,
): void {
	expect(
		session.tablesToCreate.length,
		`Expected ${expectedCount} tables to create`,
	).toBe(expectedCount);
}

/**
 * Assert session detects specific number of tables to drop
 */
export function assertTablesToDrop(
	session: MigrationSession,
	expectedCount: number,
): void {
	expect(
		session.tablesToDrop.length,
		`Expected ${expectedCount} tables to drop`,
	).toBe(expectedCount);
}

/**
 * Assert session detects specific number of tables to alter
 */
export function assertTablesToAlter(
	session: MigrationSession,
	expectedCount: number,
): void {
	expect(
		session.tablesToAlter.length,
		`Expected ${expectedCount} tables to alter`,
	).toBe(expectedCount);
}

/**
 * Assert session has changes
 */
export function assertHasChanges(session: MigrationSession): void {
	expect(session.hasChanges(), "Expected session to have changes").toBe(true);
}

/**
 * Assert session has NO changes
 */
export function assertNoChanges(session: MigrationSession): void {
	expect(session.hasChanges(), "Expected session to have NO changes").toBe(false);
}
