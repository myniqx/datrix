/**
 * Part 8 — PostgresExporter scope.
 *
 * Export must use the datrix-managed table list (derived from _datrix keys)
 * instead of getTables()/pg_tables, so foreign/host-app tables in a shared
 * database are never dumped (and never hit `ORDER BY "id"`, which assumes an
 * `id` column that only datrix-managed tables are guaranteed to have).
 */
import { describe, expect, it } from "vitest";
import { DATRIX_META_KEY_PREFIX, DATRIX_META_MODEL } from "@datrix/core";
import type { ExportWriter, SchemaDefinition } from "@datrix/core";
import { PostgresCoreAdapter } from "../src/adapter";
import { PostgresExporter } from "../src/export-import/exporter";
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
		fields: { id: { type: "number", autoIncrement: true } },
	} as unknown as SchemaDefinition;
}

class RecordingWriter implements ExportWriter {
	readonly schemas: SchemaDefinition[] = [];
	readonly chunkTables: string[] = [];

	async writeMeta(): Promise<void> {}
	async writeSchema(schema: SchemaDefinition): Promise<void> {
		this.schemas.push(schema);
	}
	async writeChunk(tableName: string): Promise<void> {
		this.chunkTables.push(tableName);
	}
	async finalize(): Promise<void> {}
}

describe("PostgresExporter", () => {
	it("exports only datrix-managed tables, not the full pg_tables list", async () => {
		const { config, connection } = createFakeConfig((sql) => {
			if (sql.includes(`"key" LIKE`)) {
				return rowsResult([{ key: `${DATRIX_META_KEY_PREFIX}posts` }]);
			}
			if (sql.startsWith("SELECT tablename FROM pg_tables")) {
				// If the exporter ever calls the broad getTables() introspection,
				// simulate a foreign host-app table leaking into scope.
				return rowsResult([
					{ tablename: "_datrix" },
					{ tablename: "posts" },
					{ tablename: "host_app_orders" },
				]);
			}
			if (sql.includes(`SELECT "value" FROM`)) {
				return rowsResult([{ value: JSON.stringify(schema("posts")) }]);
			}
			if (sql.startsWith("SELECT * FROM")) {
				return emptyResult();
			}
			return emptyResult();
		});

		const adapter = new PostgresCoreAdapter(config);
		await adapter.connect(createFakeSchemaRegistry());

		const writer = new RecordingWriter();
		const exporter = new PostgresExporter(config.runner, adapter);
		await exporter.export(writer);

		const exportedTables = writer.schemas.map((s) => s.tableName);
		expect(exportedTables).not.toContain("host_app_orders");

		const pgTablesCalled = connection.calls.some((c) =>
			c.sql.includes("pg_tables"),
		);
		expect(pgTablesCalled).toBe(false);
	});
});
