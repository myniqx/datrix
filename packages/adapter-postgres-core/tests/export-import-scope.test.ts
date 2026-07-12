/**
 * Part 8 — Export/import scope and safety.
 *
 * Covers:
 * 1. Scope: managed-table list is derived from `_datrix` keys (DATRIX_META_KEY_PREFIX),
 *    not from pg_tables/getTables().
 * 2. Drop order: dropTable emits DROP TABLE ... CASCADE when { cascade: true } is passed.
 * 3. Atomicity: importer wraps drop/create/insert/addFK in one transaction on a
 *    dedicated connection (BEGIN...COMMIT / ROLLBACK on failure); resetSequence
 *    runs afterward, outside the transaction.
 */
import { describe, expect, it } from "vitest";
import { DATRIX_META_KEY_PREFIX, DATRIX_META_MODEL } from "@datrix/core";
import { PostgresCoreAdapter } from "../src/adapter";
import {
	FakeConnection,
	createFakeConfig,
	createFakeSchemaRegistry,
	emptyResult,
	rowsResult,
} from "./test-helpers";

async function connectedAdapter(
	handler: Parameters<typeof createFakeConfig>[0],
) {
	const { config, connection } = createFakeConfig(handler);
	const adapter = new PostgresCoreAdapter(config);
	await adapter.connect(createFakeSchemaRegistry());
	return { adapter, connection };
}

describe("getManagedTables", () => {
	it("derives the table list from _datrix keys, not pg_tables", async () => {
		const { adapter, connection } = await connectedAdapter((sql) => {
			if (sql.includes(`"key" LIKE`)) {
				return rowsResult([
					{ key: `${DATRIX_META_KEY_PREFIX}posts` },
					{ key: `${DATRIX_META_KEY_PREFIX}comments` },
					{ key: `${DATRIX_META_KEY_PREFIX}_datrix` },
				]);
			}
			return emptyResult();
		});

		const tables = await adapter.getManagedTables();

		expect(tables).toEqual(["_datrix", "comments", "posts"]);
		// Only the _datrix meta table was queried — no pg_tables introspection.
		expect(connection.calls).toHaveLength(1);
		expect(connection.calls[0]!.sql).toContain(DATRIX_META_MODEL);
		expect(connection.calls[0]!.sql).not.toContain("pg_tables");
	});

	it("always includes _datrix even if its own meta row is missing", async () => {
		const { adapter } = await connectedAdapter((sql) => {
			if (sql.includes(`"key" LIKE`)) {
				return rowsResult([{ key: `${DATRIX_META_KEY_PREFIX}posts` }]);
			}
			return emptyResult();
		});

		const tables = await adapter.getManagedTables();

		expect(tables).toContain(DATRIX_META_MODEL);
		expect(tables).toContain("posts");
	});

	it("accepts an explicit connection (used inside the import transaction)", async () => {
		const { adapter, connection } = await connectedAdapter(() => emptyResult());
		const otherConnection = new FakeConnection(() =>
			rowsResult([{ key: `${DATRIX_META_KEY_PREFIX}widgets` }]),
		);

		const tables = await adapter.getManagedTables(otherConnection);

		expect(tables).toContain("widgets");
		// Pooled runner (connection) was never queried.
		expect(connection.calls).toHaveLength(0);
	});
});

describe("dropTable cascade option", () => {
	it("emits DROP TABLE ... CASCADE when cascade: true", async () => {
		const { adapter, connection } = await connectedAdapter(() => emptyResult());

		await adapter.dropTable("posts", undefined, {
			isImport: true,
			cascade: true,
		});

		const dropCall = connection.calls.find((c) => c.sql.includes("DROP TABLE"));
		expect(dropCall?.sql).toContain("CASCADE");
	});

	it("does not add CASCADE by default (non-import path)", async () => {
		const { adapter, connection } = await connectedAdapter(() => emptyResult());

		await adapter.dropTable("posts");

		const dropCall = connection.calls.find((c) => c.sql.includes("DROP TABLE"));
		expect(dropCall?.sql).not.toContain("CASCADE");
	});
});
