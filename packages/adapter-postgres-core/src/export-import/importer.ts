import type { ImportReader } from "@datrix/core";
import type { SchemaDefinition } from "@datrix/core";
import type { PostgresCoreAdapter } from "../adapter";
import type { PgRunner } from "../driver";
import { DATRIX_META_MODEL } from "@datrix/core";

const CHUNK_SIZE = 1000;

export class PostgresImporter {
	constructor(
		private runner: PgRunner,
		private adapter: PostgresCoreAdapter,
	) {}

	async import(reader: ImportReader): Promise<void> {
		const schemas = await this.collectSchemas(reader);

		// 1. Drop all existing tables
		const existingTables = await this.adapter.getTables();
		for (const tableName of existingTables) {
			await this.adapter.dropTable(tableName, undefined, { isImport: true });
		}

		// 2. Create tables — isImport skips FK constraints and _datrix meta writes.
		//    _datrix data will be restored as plain rows in step 3.
		for (const schema of schemas.values()) {
			await this.adapter.createTable(schema, undefined, { isImport: true });
		}

		// 3. Insert data chunk by chunk
		const tables = await reader.getTables();
		for (const tableName of tables) {
			for await (const chunk of reader.readChunks(tableName)) {
				await this.insertChunk(tableName, chunk);
			}
		}

		// 4. Add FK constraints (skip _datrix)
		for (const schema of schemas.values()) {
			if (schema.name === DATRIX_META_MODEL) continue;
			await this.addForeignKeys(schema);
		}

		// 5. Reset sequences for all tables
		for (const tableName of tables) {
			await this.resetSequence(tableName);
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

	private async insertChunk(
		tableName: string,
		rows: Record<string, unknown>[],
	): Promise<void> {
		if (rows.length === 0) return;

		const translator = this.adapter.getTranslator();
		const escapedTable = translator.escapeIdentifier(tableName);
		const columns = Object.keys(rows[0]!);
		const escapedColumns = columns
			.map((c) => translator.escapeIdentifier(c))
			.join(", ");

		for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
			const batch = rows.slice(i, i + CHUNK_SIZE);
			const placeholders: string[] = [];
			const values: unknown[] = [];
			let paramIndex = 1;

			for (const row of batch) {
				const rowPlaceholders = columns.map(() => `$${paramIndex++}`);
				placeholders.push(`(${rowPlaceholders.join(", ")})`);
				for (const col of columns) {
					const val = row[col] ?? null;
					// pg driver does not auto-serialize objects/arrays for JSONB columns
					values.push(
						val !== null && typeof val === "object" && !(val instanceof Date)
							? JSON.stringify(val)
							: val,
					);
				}
			}

			await this.runner.query(
				`INSERT INTO ${escapedTable} (${escapedColumns}) VALUES ${placeholders.join(", ")}`,
				values,
			);
		}
	}

	private async addForeignKeys(schema: SchemaDefinition): Promise<void> {
		const tableName = schema.tableName!;
		const translator = this.adapter.getTranslator();
		const escapedTable = translator.escapeIdentifier(tableName);

		for (const [fieldName, field] of Object.entries(schema.fields)) {
			if (field.type !== "number" || !field.references) continue;

			const col = translator.escapeIdentifier(fieldName);
			const refTable = translator.escapeIdentifier(field.references.table);
			const refCol = translator.escapeIdentifier(
				field.references.column ?? "id",
			);
			const constraintName = translator.escapeIdentifier(
				`fk_${tableName}_${fieldName}`,
			);

			const onDelete = field.references.onDelete
				? ` ON DELETE ${field.references.onDelete === "setNull" ? "SET NULL" : field.references.onDelete.toUpperCase()}`
				: "";
			const onUpdate = field.references.onUpdate
				? ` ON UPDATE ${field.references.onUpdate.toUpperCase()}`
				: "";

			await this.runner.query(
				`ALTER TABLE ${escapedTable} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${col}) REFERENCES ${refTable} (${refCol})${onDelete}${onUpdate}`,
			);
		}
	}

	private async resetSequence(tableName: string): Promise<void> {
		const escapedTable = this.adapter.getTranslator().escapeIdentifier(tableName);
		await this.runner.query(
			`SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${escapedTable}), 0) + 1, false)`,
			[tableName],
		);
	}
}
