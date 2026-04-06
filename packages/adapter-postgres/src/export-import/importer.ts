import type { Pool } from "pg";
import type { ImportReader } from "@forja/core/types/adapter";
import type { SchemaDefinition } from "@forja/core/types/core/schema";
import type { PostgresAdapter } from "../adapter";
import { FORJA_META_MODEL } from "@forja/core/types/core/constants";

const CHUNK_SIZE = 1000;

export class PostgresImporter {
	constructor(
		private pool: Pool,
		private adapter: PostgresAdapter,
	) {}

	async import(reader: ImportReader): Promise<void> {
		const schemas = await this.collectSchemas(reader);

		// 1. Drop all existing tables
		const existingTables = await this.adapter.getTables();
		for (const tableName of existingTables) {
			await this.adapter.dropTable(tableName, undefined, { isImport: true });
		}

		// 2. Create tables — isImport skips FK constraints and _forja meta writes.
		//    _forja data will be restored as plain rows in step 3.
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

		// 4. Add FK constraints (skip _forja)
		for (const schema of schemas.values()) {
			if (schema.name === FORJA_META_MODEL) continue;
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

		const escapedTable = `"${tableName}"`;
		const columns = Object.keys(rows[0]!);
		const escapedColumns = columns.map((c) => `"${c}"`).join(", ");

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

			await this.pool.query(
				`INSERT INTO ${escapedTable} (${escapedColumns}) VALUES ${placeholders.join(", ")}`,
				values,
			);
		}
	}

	private async addForeignKeys(schema: SchemaDefinition): Promise<void> {
		const tableName = schema.tableName!;
		const escapedTable = `"${tableName}"`;

		for (const [fieldName, field] of Object.entries(schema.fields)) {
			if (field.type !== "number" || !field.references) continue;

			const col = `"${fieldName}"`;
			const refTable = `"${field.references.table}"`;
			const refCol = `"${field.references.column ?? "id"}"`;
			const constraintName = `"fk_${tableName}_${fieldName}"`;

			const onDelete = field.references.onDelete
				? ` ON DELETE ${field.references.onDelete === "setNull" ? "SET NULL" : field.references.onDelete.toUpperCase()}`
				: "";
			const onUpdate = field.references.onUpdate
				? ` ON UPDATE ${field.references.onUpdate.toUpperCase()}`
				: "";

			await this.pool.query(
				`ALTER TABLE ${escapedTable} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${col}) REFERENCES ${refTable} (${refCol})${onDelete}${onUpdate}`,
			);
		}
	}

	private async resetSequence(tableName: string): Promise<void> {
		const escapedTable = `"${tableName}"`;
		await this.pool.query(
			`SELECT setval(pg_get_serial_sequence('${tableName}', 'id'), COALESCE((SELECT MAX(id) FROM ${escapedTable}), 0) + 1, false)`,
		);
	}
}
