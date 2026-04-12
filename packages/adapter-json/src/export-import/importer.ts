import type { ImportReader } from "@datrix/core";
import type { SchemaDefinition } from "@datrix/core";
import type { JsonAdapter } from "../adapter";
import type { JsonTableFile } from "../types";

export class JsonImporter {
	constructor(
		private root: string,
		private adapter: JsonAdapter,
	) {}

	async import(reader: ImportReader): Promise<void> {
		const schemas = await this.collectSchemas(reader);

		// 1. Drop all existing tables
		const existingTables = await this.adapter.getTables();
		for (const tableName of existingTables) {
			await this.adapter.dropTableWithOptions(tableName, { isImport: true });
		}

		// 2. Create tables — isImport skips upsertSchemaMeta so the importer
		//    can restore _datrix data as-is.
		for (const schema of schemas.values()) {
			await this.adapter.createTable(schema, { isImport: true });
		}

		// 3. Collect all rows per table then write directly to file (with correct lastInsertId)
		const tables = await reader.getTables();
		for (const tableName of tables) {
			const rows: Record<string, unknown>[] = [];

			for await (const chunk of reader.readChunks(tableName)) {
				rows.push(...chunk);
			}

			await this.writeTableFile(tableName, rows);
		}
	}

	private async collectSchemas(
		reader: ImportReader,
	): Promise<Map<string, SchemaDefinition>> {
		const schemas = new Map<string, SchemaDefinition>();
		for await (const schema of reader.readSchemas()) {
			schemas.set(schema.tableName!, schema);
		}
		return schemas;
	}

	private async writeTableFile(
		tableName: string,
		rows: Record<string, unknown>[],
	): Promise<void> {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const filePath = path.join(this.root, `${tableName}.json`);

		const maxId = rows.reduce((max, row) => {
			const id = typeof row["id"] === "number" ? row["id"] : 0;
			return id > max ? id : max;
		}, 0);

		const tableFile: JsonTableFile = {
			meta: {
				version: 1,
				lastInsertId: maxId,
				updatedAt: new Date().toISOString(),
				name: tableName,
			},
			data: rows,
		};

		await fs.writeFile(filePath, JSON.stringify(tableFile, null, 2), "utf-8");
	}
}
