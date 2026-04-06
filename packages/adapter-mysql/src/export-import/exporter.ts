import type { Pool, RowDataPacket } from "mysql2/promise";
import type { ExportWriter } from "@datrix/core";
import type { SchemaDefinition } from "@datrix/core";
import type { MySQLAdapter } from "../adapter";

const CHUNK_SIZE = 1000;

export class MySQLExporter {
	constructor(
		private pool: Pool,
		private adapter: MySQLAdapter,
	) { }

	async export(writer: ExportWriter): Promise<void> {
		await writer.writeMeta({
			version: 1,
			exportedAt: new Date().toISOString(),
		});

		const tables = await this.adapter.getTables();
		const schemas = new Map<string, SchemaDefinition>();

		for (const tableName of tables) {
			const schema = await this.adapter.getTableSchema(tableName);
			if (schema) {
				schemas.set(tableName, schema);
				await writer.writeSchema(schema);
			}
		}

		for (const tableName of tables) {
			await this.exportTable(tableName, schemas.get(tableName), writer);
		}

		await writer.finalize();
	}

	private async exportTable(
		tableName: string,
		schema: SchemaDefinition | undefined,
		writer: ExportWriter,
	): Promise<void> {
		const escapedTable = `\`${tableName}\``;

		// Collect bool and json field names once from schema
		const boolFields: string[] = [];
		const jsonFields: string[] = [];
		if (schema) {
			for (const [fieldName, field] of Object.entries(schema.fields)) {
				if (field.type === "boolean") {
					boolFields.push(fieldName);
				} else if (field.type === "json" || field.type === "array") {
					jsonFields.push(fieldName);
				}
			}
		}

		let offset = 0;

		while (true) {
			const [rows] = await this.pool.execute<RowDataPacket[]>(
				`SELECT * FROM ${escapedTable} ORDER BY \`id\` LIMIT ? OFFSET ?`,
				[CHUNK_SIZE, offset],
			);

			if (rows.length === 0) {
				break;
			}

			const converted = this.convertChunk(
				rows as Record<string, unknown>[],
				boolFields,
				jsonFields,
			);

			await writer.writeChunk(tableName, converted);
			offset += rows.length;

			if (rows.length < CHUNK_SIZE) {
				break;
			}
		}
	}

	private convertChunk(
		rows: Record<string, unknown>[],
		boolFields: string[],
		jsonFields: string[],
	): Record<string, unknown>[] {
		if (boolFields.length === 0 && jsonFields.length === 0) {
			return rows;
		}

		for (const row of rows) {
			for (const field of boolFields) {
				const value = row[field];
				if (value === 1 || value === 0) {
					row[field] = value === 1;
				}
			}
			for (const field of jsonFields) {
				const value = row[field];
				if (typeof value === "string") {
					try {
						row[field] = JSON.parse(value);
					} catch {
						// keep original string if not valid JSON
					}
				}
			}
		}

		return rows;
	}
}
