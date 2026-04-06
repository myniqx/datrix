/**
 * _forja Metadata Table Tests
 *
 * Verifies that createTable, alterTable, dropTable and renameTable
 * operations correctly maintain schema snapshots in the _forja table.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { defineSchema } from "@forja/core/types";
import { FORJA_META_MODEL } from "@forja/core";
import { DatabaseAdapter } from "@forja/core/types/adapter";
import { createForjaWithSchemas, getTmpDir } from "../e2e/setup/config";
import { dropAllTables } from "../e2e/setup/helpers";

const FORJA_META_KEY_PREFIX = "_schema_";

const tmpDir = getTmpDir("forja_meta");

// ============================================================
// Helpers
// ============================================================

async function readStoredSchema(
	adapter: DatabaseAdapter,
	tableName: string,
): Promise<Record<string, unknown>> {
	const metaKey = `${FORJA_META_KEY_PREFIX}${tableName}`;
	const queryResult = await adapter.executeQuery({
		type: "select",
		table: FORJA_META_MODEL,
		select: ["id", "key", "value"],
		where: { key: { $eq: metaKey } },
	});

	expect(
		queryResult.rows.length,
		`Expected one row for key '${metaKey}' in _forja`,
	).toBe(1);

	return JSON.parse(queryResult.rows[0]!["value"] as string) as Record<
		string,
		unknown
	>;
}

async function assertNotInForja(
	adapter: DatabaseAdapter,
	tableName: string,
): Promise<void> {
	const metaKey = `${FORJA_META_KEY_PREFIX}${tableName}`;
	const queryResult = await adapter.executeQuery({
		type: "select",
		table: FORJA_META_MODEL,
		select: ["id", "key", "value"],
		where: { key: { $eq: metaKey } },
	});

	expect(
		queryResult.rows.length,
		`Expected no row for key '${metaKey}' in _forja`,
	).toBe(0);
}

// ============================================================
// Tests
// ============================================================

describe("_forja metadata table", () => {
	let adapter: DatabaseAdapter;

	const productSchema = defineSchema({
		name: "product",
		tableName: "products",
		fields: {
			title: { type: "string", required: true },
			price: { type: "number", required: true },
		},
	} as const);

	beforeAll(async () => {
		const forja = await createForjaWithSchemas(tmpDir, []);
		adapter = forja.getAdapter();
		await dropAllTables(adapter);

		// Re-create _forja after dropping all tables
		const metaSchema = forja.getSchemas().get(FORJA_META_MODEL)!;
		await adapter.createTable(metaSchema);
	});

	afterAll(async () => {
		await adapter.disconnect();
	});

	// ============================================================
	// createTable
	// ============================================================

	it("createTable should write schema to _forja", async () => {
		await adapter.createTable(productSchema);

		const stored = await readStoredSchema(adapter, "products");
		expect(stored["name"]).toBe("product");
		const fields = stored["fields"] as Record<string, unknown>;
		expect(fields).toHaveProperty("title");
		expect(fields).toHaveProperty("price");
	});

	it("createTable should fail when _forja does not exist", async () => {
		const freshSchema = defineSchema({
			name: "orphan",
			tableName: "orphans",
			fields: {
				name: { type: "string", required: true },
			},
		} as const);

		// Drop _forja to simulate missing meta table
		await adapter.dropTable(FORJA_META_MODEL);
		let error = false;
		try {
			await adapter.createTable(freshSchema);
			error = true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			expect(message).toContain(FORJA_META_MODEL);
		}
		expect(error).toBe(false);

		// Restore _forja for subsequent tests
		const forja = await createForjaWithSchemas(tmpDir, []);
		const metaSchema = forja.getSchemas().get(FORJA_META_MODEL)!;
		await adapter.createTable(metaSchema);

		// Re-insert products schema since it was lost

		try {
			await adapter.createTable(productSchema);
		} catch {}
	});

	// ============================================================
	// dropTable
	// ============================================================

	it("dropTable should remove schema from _forja", async () => {
		await adapter.dropTable("products");

		await assertNotInForja(adapter, "products");

		// Recreate for subsequent tests
		await adapter.createTable(productSchema);
	});

	// ============================================================
	// alterTable — addColumn
	// ============================================================

	it("alterTable addColumn should add field to _forja schema", async () => {
		await adapter.alterTable("products", [
			{
				type: "addColumn",
				column: "stock",
				definition: { type: "number", required: false },
			},
		]);

		const stored = await readStoredSchema(adapter, "products");
		const fields = stored["fields"] as Record<string, unknown>;
		expect(fields).toHaveProperty("title");
		expect(fields).toHaveProperty("price");
		expect(fields).toHaveProperty("stock");
	});

	// ============================================================
	// alterTable — dropColumn
	// ============================================================

	it("alterTable dropColumn should remove field from _forja schema", async () => {
		await adapter.alterTable("products", [
			{ type: "dropColumn", column: "stock" },
		]);

		const stored = await readStoredSchema(adapter, "products");
		const fields = stored["fields"] as Record<string, unknown>;
		expect(fields).toHaveProperty("title");
		expect(fields).toHaveProperty("price");
		expect(fields).not.toHaveProperty("stock");
	});

	// ============================================================
	// alterTable — modifyColumn
	// ============================================================

	it("alterTable modifyColumn should update field definition in _forja schema", async () => {
		await adapter.alterTable("products", [
			{
				type: "modifyColumn",
				column: "price",
				newDefinition: { type: "string", required: false },
			},
		]);

		const stored = await readStoredSchema(adapter, "products");
		const fields = stored["fields"] as Record<string, { type: string }>;
		expect(fields["price"]?.type).toBe("string");
	});

	// ============================================================
	// alterTable — renameColumn
	// ============================================================

	it("alterTable renameColumn should rename field in _forja schema", async () => {
		await adapter.alterTable("products", [
			{ type: "renameColumn", from: "title", to: "name" },
		]);

		const stored = await readStoredSchema(adapter, "products");
		const fields = stored["fields"] as Record<string, unknown>;
		expect(fields).not.toHaveProperty("title");
		expect(fields).toHaveProperty("name");
	});

	// ============================================================
	// renameTable
	// ============================================================

	it("renameTable should update key in _forja", async () => {
		await adapter.renameTable("products", "items");

		await assertNotInForja(adapter, "products");
		const stored = await readStoredSchema(adapter, "items");
		expect(stored["name"]).toBe("product");
	});
});
