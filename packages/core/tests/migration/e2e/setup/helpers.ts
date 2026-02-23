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
 *
 * Maps generic strategies to specific action types:
 * - "rename" → rename, confirm_drop (for drops)
 * - "drop_and_add" → drop_and_add, fresh_start, drop_and_recreate, confirm_drop
 * - "migrate" → migrate_to_junction, migrate_first
 * - "fresh_start" → fresh_start
 */
export function autoResolveAmbiguous(
	session: MigrationSession,
	strategy: "rename" | "drop_and_add" | "migrate" | "fresh_start",
): void {
	for (const change of session.ambiguous) {
		let action: string;

		switch (change.type) {
			case "column_rename_or_replace":
			case "table_rename_or_replace":
			case "junction_table_rename_or_replace":
				action = strategy === "rename" ? "rename" : "drop_and_add";
				if (change.type === "junction_table_rename_or_replace" && strategy !== "rename") {
					action = "drop_and_recreate";
				}
				break;

			case "fk_column_drop":
			case "junction_table_drop":
				action = "confirm_drop";
				break;

			case "relation_upgrade_single_to_many":
				action = strategy === "migrate" ? "migrate_to_junction" : "fresh_start";
				break;

			case "relation_downgrade_many_to_single":
				action = strategy === "migrate" ? "migrate_first" : "fresh_start";
				break;

			case "fk_model_change":
				action = strategy === "rename" ? "keep_column" : "drop_and_recreate";
				break;

			case "relation_direction_flip":
				action = "drop_and_add";
				break;

			default:
				action = strategy;
		}

		const result = session.resolveAmbiguous(change.id, action as Parameters<typeof session.resolveAmbiguous>[1]);
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
	action: Parameters<typeof session.resolveAmbiguous>[1],
): ReturnType<typeof session.resolveAmbiguous> {
	return session.resolveAmbiguous(id, action);
}

/**
 * Apply migration session with optional ambiguous resolution
 */
export async function applyMigration(
	session: MigrationSession,
	ambiguousStrategy: "rename" | "drop_and_add" | "migrate" | "fresh_start" = "drop_and_add",
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
	const hasChanges = session.hasChanges();
	if (hasChanges) {
		console.warn("Session has changes: ", session.differences);
	}
	expect(hasChanges, "Expected session to have NO changes").toBe(false);
}

// ============================================
// Ambiguous Type Helpers
// ============================================

/**
 * Assert ambiguous change exists with specific type
 */
export function assertAmbiguousExists(
	session: MigrationSession,
	type: string,
	tableName?: string,
): AmbiguousChange {
	const found = session.ambiguous.find(
		(a) => a.type === type && (tableName === undefined || a.tableName === tableName),
	);

	if (!found) {
		console.log("Ambiguous Changes: ", session.ambiguous.map((a) => a.possibleActions = JSON.stringify(a.possibleActions)));
	}

	expect(
		found,
		`Expected ambiguous change of type '${type}'${tableName ? ` for table '${tableName}'` : ""}`,
	).toBeDefined();

	return found!;
}

/**
 * Get ambiguous changes by type
 */
export function getAmbiguousByType(
	session: MigrationSession,
	type: string,
): AmbiguousChange[] {
	return session.ambiguous.filter((a) => a.type === type) as AmbiguousChange[];
}

/**
 * Assert session has specific table in tablesToCreate
 */
export function assertTableInCreate(
	session: MigrationSession,
	tableName: string,
): void {
	const found = session.tablesToCreate.find(
		(s) => s.tableName === tableName || s.name === tableName,
	);
	expect(
		found,
		`Expected '${tableName}' in tablesToCreate. Found: ${session.tablesToCreate.map((s) => s.tableName).join(", ")}`,
	).toBeDefined();
}

/**
 * Assert session has specific table in tablesToDrop
 */
export function assertTableInDrop(
	session: MigrationSession,
	tableName: string,
): void {
	const found = session.tablesToDrop.includes(tableName);
	expect(
		found,
		`Expected '${tableName}' in tablesToDrop. Found: ${session.tablesToDrop.join(", ")}`,
	).toBe(true);
}

/**
 * Assert specific column is being added to a table
 */
export function assertColumnInAdd(
	session: MigrationSession,
	tableName: string,
	columnName: string,
): void {
	const tableAlter = session.tablesToAlter.find((t) => t.tableName === tableName);
	expect(tableAlter, `Table '${tableName}' not found in tablesToAlter`).toBeDefined();

	if (tableAlter) {
		const fieldAdd = tableAlter.changes.find(
			(c) => c.type === "fieldAdded" && c.fieldName === columnName,
		);
		expect(
			fieldAdd,
			`Column '${columnName}' not found in fieldAdded changes for '${tableName}'`,
		).toBeDefined();
	}
}

/**
 * Assert specific column is being dropped from a table
 */
export function assertColumnInDrop(
	session: MigrationSession,
	tableName: string,
	columnName: string,
): void {
	const tableAlter = session.tablesToAlter.find((t) => t.tableName === tableName);
	expect(tableAlter, `Table '${tableName}' not found in tablesToAlter`).toBeDefined();

	if (tableAlter) {
		const fieldRemove = tableAlter.changes.find(
			(c) => c.type === "fieldRemoved" && c.fieldName === columnName,
		);
		expect(
			fieldRemove,
			`Column '${columnName}' not found in fieldRemoved changes for '${tableName}'`,
		).toBeDefined();
	}
}
