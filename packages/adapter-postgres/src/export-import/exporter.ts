import type { Pool } from "pg";
import type { ExportWriter } from "forja-types/adapter";
import type { PostgresAdapter } from "../adapter";
import { FORJA_META_MODEL } from "forja-types/core/constants";

const CHUNK_SIZE = 1000;

export class PostgresExporter {
	constructor(
		private pool: Pool,
		private adapter: PostgresAdapter,
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

	private async exportTable(tableName: string, writer: ExportWriter): Promise<void> {
		const escapedTable = `"${tableName}"`;
		let offset = 0;

		while (true) {
			const result = await this.pool.query<Record<string, unknown>>(
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
