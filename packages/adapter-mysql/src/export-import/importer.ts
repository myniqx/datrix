import type { Pool } from "mysql2/promise";
import type { ImportReader } from "@datrix/core";
import type { SchemaDefinition } from "@datrix/core";
import type { MySQLAdapter } from "../adapter";
import { DATRIX_META_MODEL } from "@datrix/core";

const CHUNK_SIZE = 1000;

export class MySQLImporter {
	constructor(
		private pool: Pool,
		private adapter: MySQLAdapter,
	) {}

	async import(reader: ImportReader): Promise<void> {
		const schemas = await this.collectSchemas(reader);

		// 1. Disable FK checks for the session
		await this.pool.execute("SET FOREIGN_KEY_CHECKS = 0");

		try {
			// 2. Drop all existing tables
			const existingTables = await this.adapter.getTables();
			for (const tableName of existingTables) {
				await this.adapter.dropTable(tableName, undefined, { isImport: true });
			}

			// 3. Create tables — isImport skips FK constraints and _datrix meta writes.
			//    _datrix data will be restored as plain rows in step 4.
			for (const schema of schemas.values()) {
				await this.adapter.createTable(schema, undefined, { isImport: true });
			}

			// 4. Insert data chunk by chunk
			const tables = await reader.getTables();
			for (const tableName of tables) {
				for await (const chunk of reader.readChunks(tableName)) {
					await this.insertChunk(tableName, chunk);
				}
			}

			// 5. Add FK constraints (skip _datrix)
			for (const schema of schemas.values()) {
				if (schema.name === DATRIX_META_MODEL) continue;
				await this.addForeignKeys(schema);
			}
		} finally {
			// Always re-enable FK checks
			await this.pool.execute("SET FOREIGN_KEY_CHECKS = 1");
		}

		// 6. Reset AUTO_INCREMENT for all tables
		const tables = await reader.getTables();
		for (const tableName of tables) {
			await this.resetAutoIncrement(tableName);
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

		const escapedTable = `\`${tableName}\``;
		const columns = Object.keys(rows[0]!);
		const escapedColumns = columns.map((c) => `\`${c}\``).join(", ");

		for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
			const batch = rows.slice(i, i + CHUNK_SIZE);
			const placeholders = batch
				.map(() => `(${columns.map(() => "?").join(", ")})`)
				.join(", ");
			const values: unknown[] = [];

			for (const row of batch) {
				for (const col of columns) {
					const val = row[col] ?? null;
					// mysql2 driver does not auto-serialize objects/arrays for JSON columns
					values.push(
						val !== null && typeof val === "object" && !(val instanceof Date)
							? JSON.stringify(val)
							: val,
					);
				}
			}

			await this.pool.execute(
				`INSERT INTO ${escapedTable} (${escapedColumns}) VALUES ${placeholders}`,
				values,
			);
		}
	}

	private async addForeignKeys(schema: SchemaDefinition): Promise<void> {
		const tableName = schema.tableName!;
		const escapedTable = `\`${tableName}\``;

		for (const [fieldName, field] of Object.entries(schema.fields)) {
			if (field.type !== "number" || !field.references) continue;

			const col = `\`${fieldName}\``;
			const refTable = `\`${field.references.table}\``;
			const refCol = `\`${field.references.column ?? "id"}\``;
			const constraintName = `\`fk_${tableName}_${fieldName}\``;

			const onDelete = field.references.onDelete
				? ` ON DELETE ${field.references.onDelete === "setNull" ? "SET NULL" : field.references.onDelete.toUpperCase()}`
				: "";
			const onUpdate = field.references.onUpdate
				? ` ON UPDATE ${field.references.onUpdate.toUpperCase()}`
				: "";

			await this.pool.execute(
				`ALTER TABLE ${escapedTable} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${col}) REFERENCES ${refTable} (${refCol})${onDelete}${onUpdate}`,
			);
		}
	}

	private async resetAutoIncrement(tableName: string): Promise<void> {
		const escapedTable = `\`${tableName}\``;
		const [rows] = await this.pool.execute(
			`SELECT MAX(\`id\`) as maxId FROM ${escapedTable}`,
		);
		const maxId = (rows as Array<{ maxId: number | null }>)[0]?.maxId ?? 0;
		await this.pool.execute(
			`ALTER TABLE ${escapedTable} AUTO_INCREMENT = ${maxId + 1}`,
		);
	}
}
