/**
 * Part 8 — PostgresImporter atomicity and scope.
 */
import { describe, expect, it } from "vitest";
import { DATRIX_META_KEY_PREFIX, DATRIX_META_MODEL } from "@datrix/core";
import type { ImportReader, SchemaDefinition } from "@datrix/core";
import { PostgresCoreAdapter } from "../src/adapter";
import { PostgresImporter } from "../src/export-import/importer";
import {
	createFakeConfig,
	createFakeSchemaRegistry,
	emptyResult,
	rowsResult,
} from "./test-helpers";

function schema(name: string): SchemaDefinition {
	return {
		name,
		tableName: name,
		fields: {
			id: { type: "number", autoIncrement: true },
		},
	} as unknown as SchemaDefinition;
}

function makeReader(options: {
	schemas: SchemaDefinition[];
	tables: string[];
	chunks?: Record<string, Record<string, unknown>[]>;
}): ImportReader {
	return {
		readMeta: async () => ({
			version: 1,
			exportedAt: new Date().toISOString(),
		}),
		readSchemas: async function* () {
			for (const s of options.schemas) yield s;
		},
		getTables: async () => options.tables,
		readChunks: async function* (tableName: string) {
			const rows = options.chunks?.[tableName] ?? [];
			if (rows.length > 0) yield rows;
		},
	};
}

async function connectedAdapter(
	handler: Parameters<typeof createFakeConfig>[0],
) {
	const { config, connection } = createFakeConfig(handler);
	const adapter = new PostgresCoreAdapter(config);
	await adapter.connect(createFakeSchemaRegistry());
	return { adapter, connection };
}

describe("PostgresImporter", () => {
	it("wraps drop/create/insert/addFK in a single BEGIN...COMMIT transaction", async () => {
		const { adapter, connection } = await connectedAdapter((sql) => {
			if (sql.includes(`"key" LIKE`)) {
				return rowsResult([{ key: `${DATRIX_META_KEY_PREFIX}posts` }]);
			}
			return emptyResult();
		});

		const reader = makeReader({
			schemas: [schema(DATRIX_META_MODEL), schema("posts")],
			tables: ["posts"],
		});

		const importer = new PostgresImporter(adapter.config.runner, adapter);
		await importer.import(reader);

		const sqls = connection.calls.map((c) => c.sql);
		const beginIdx = sqls.indexOf("BEGIN");
		const commitIdx = sqls.indexOf("COMMIT");
		const dropIdx = sqls.findIndex((s) => s.includes("DROP TABLE"));
		const createIdx = sqls.findIndex((s) => s.startsWith("CREATE TABLE"));

		expect(beginIdx).toBeGreaterThanOrEqual(0);
		expect(commitIdx).toBeGreaterThan(beginIdx);
		expect(dropIdx).toBeGreaterThan(beginIdx);
		expect(dropIdx).toBeLessThan(commitIdx);
		expect(createIdx).toBeGreaterThan(beginIdx);
		expect(createIdx).toBeLessThan(commitIdx);
		expect(connection.released).toBe(true);
	});

	it("drops only datrix-managed tables using CASCADE", async () => {
		const { adapter, connection } = await connectedAdapter((sql) => {
			if (sql.includes(`"key" LIKE`)) {
				return rowsResult([{ key: `${DATRIX_META_KEY_PREFIX}posts` }]);
			}
			return emptyResult();
		});

		const reader = makeReader({
			schemas: [schema(DATRIX_META_MODEL), schema("posts")],
			tables: ["posts"],
		});

		const importer = new PostgresImporter(adapter.config.runner, adapter);
		await importer.import(reader);

		const dropCalls = connection.calls.filter((c) =>
			c.sql.includes("DROP TABLE"),
		);
		// Scope = _datrix (always included) + posts (from the meta key) — never
		// a foreign/host-app table that has no _datrix entry.
		expect(dropCalls).toHaveLength(2);
		for (const call of dropCalls) {
			expect(call.sql).toContain("CASCADE");
		}
		const droppedTables = dropCalls.map((c) => c.sql);
		expect(droppedTables.some((s) => s.includes('"_datrix"'))).toBe(true);
		expect(droppedTables.some((s) => s.includes('"posts"'))).toBe(true);
	});

	it("rolls back the transaction and releases the connection on failure", async () => {
		const { adapter, connection } = await connectedAdapter((sql) => {
			if (sql.includes(`"key" LIKE`)) {
				return rowsResult([]);
			}
			if (sql.startsWith("CREATE TABLE")) {
				throw new Error("boom");
			}
			return emptyResult();
		});

		const reader = makeReader({
			schemas: [schema(DATRIX_META_MODEL)],
			tables: [],
		});

		const importer = new PostgresImporter(adapter.config.runner, adapter);

		await expect(importer.import(reader)).rejects.toThrow("boom");

		const sqls = connection.calls.map((c) => c.sql);
		expect(sqls).toContain("ROLLBACK");
		expect(sqls).not.toContain("COMMIT");
		expect(connection.released).toBe(true);
	});

	it("runs resetSequence after the transaction has committed", async () => {
		const callOrder: string[] = [];
		const { adapter, connection } = await connectedAdapter((sql) => {
			callOrder.push(sql);
			if (sql.includes(`"key" LIKE`)) {
				return rowsResult([]);
			}
			return emptyResult();
		});

		const reader = makeReader({
			schemas: [schema(DATRIX_META_MODEL)],
			tables: ["posts"],
		});

		const importer = new PostgresImporter(adapter.config.runner, adapter);
		await importer.import(reader);

		const commitIdx = callOrder.indexOf("COMMIT");
		const resetSeqIdx = callOrder.findIndex((s) =>
			s.includes("pg_get_serial_sequence"),
		);

		expect(commitIdx).toBeGreaterThanOrEqual(0);
		expect(resetSeqIdx).toBeGreaterThan(commitIdx);
		// resetSequence must run on the pooled runner, not the transaction
		// connection (both happen to be the same FakeConnection here, but the
		// call still must occur strictly after release/commit).
		expect(connection.released).toBe(true);
	});
});
