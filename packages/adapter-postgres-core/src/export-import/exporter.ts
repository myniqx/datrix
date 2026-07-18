import type { ExportWriter } from "@datrix/core";
import type { PostgresCoreAdapter } from "../adapter";
import type { PgRunner } from "../driver";

const CHUNK_SIZE = 1000;

export class PostgresExporter {
	constructor(
		private runner: PgRunner,
		private adapter: PostgresCoreAdapter,
	) {}

	async export(writer: ExportWriter): Promise<void> {
		await writer.writeMeta({
			version: 1,
			exportedAt: new Date().toISOString(),
		});

		const tables = await this.adapter.getManagedTables();

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
		const escapedTable = this.adapter
			.getTranslator()
			.escapeIdentifier(tableName);
		let offset = 0;

		while (true) {
			const result = await this.runner.query<Record<string, unknown>>(
				`SELECT * FROM ${escapedTable} ORDER BY "id" LIMIT $1 OFFSET $2`,
				[CHUNK_SIZE, offset],
			);

			if (result.rows.length === 0) {
				break;
			}

			await writer.writeChunk(tableName, result.rows);
			offset += result.rows.length;

			if (result.rows.length < CHUNK_SIZE) {
				break;
			}
		}
	}
}
