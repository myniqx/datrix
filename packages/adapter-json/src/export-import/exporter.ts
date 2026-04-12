import type { ExportWriter } from "@datrix/core";
import type { JsonAdapter } from "../adapter";

const CHUNK_SIZE = 1000;

export class JsonExporter {
	constructor(
		private root: string,
		private adapter: JsonAdapter,
	) {}

	async export(writer: ExportWriter): Promise<void> {
		await writer.writeMeta({
			version: 1,
			exportedAt: new Date().toISOString(),
		});

		const tables = await this.adapter.getTables();

		for (const tableName of tables) {
			const schema = await this.adapter.getTableSchema(tableName);
			if (schema) {
				await writer.writeSchema(schema);
			}
		}

		for (const tableName of tables) {
			await this.exportTable(tableName, writer);
		}

		await writer.finalize();
	}

	private async exportTable(
		tableName: string,
		writer: ExportWriter,
	): Promise<void> {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const filePath = path.join(this.root, `${tableName}.json`);

		const content = await fs.readFile(filePath, "utf-8");
		const tableFile = JSON.parse(content) as {
			data: Record<string, unknown>[];
		};
		const rows = tableFile.data;

		for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
			await writer.writeChunk(tableName, rows.slice(i, i + CHUNK_SIZE));
		}

		if (rows.length === 0) {
			await writer.writeChunk(tableName, []);
		}
	}
}
