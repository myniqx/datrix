import type { Pool, PoolConnection } from "mysql2/promise";
import type { ExecuteValues } from "mysql2";
import type { ImportReader } from "@datrix/core";
import type { SchemaDefinition } from "@datrix/core";
import type { MySQLAdapter } from "../adapter";
import { DATRIX_META_MODEL } from "@datrix/core";
import {
	escapeIdentifier,
	mapReferentialAction,
	clampGeneratedIdentifier,
} from "../helpers";

const CHUNK_SIZE = 1000;

/**
 * Import is a wipe-and-restore over datrix-managed tables ONLY (tables with a
 * schema entry in `_datrix`, plus the internal `_datrix*` tables). Foreign
 * (host application) tables in a shared database are never touched.
 *
 * MySQL DDL cannot run in a transaction, so the import is NOT atomic: a
 * failure mid-import leaves the datrix tables partially restored and requires
 * re-importing the archive.
 */
export class MySQLImporter {
	constructor(
		private pool: Pool,
		private adapter: MySQLAdapter,
	) {}

	async import(reader: ImportReader): Promise<void> {
		const schemas = await this.collectSchemas(reader);

		// Resolve the managed-table list BEFORE dropping anything — the list
		// lives in _datrix, which is itself dropped below
		const managedTables = await this.adapter.getManagedTables();

		// One dedicated connection for the whole import: FOREIGN_KEY_CHECKS is
		// a session variable, and pooled connections must never leak with FK
		// checks disabled
		const connection = await this.pool.getConnection();

		try {
			await connection.query("SET FOREIGN_KEY_CHECKS = 0");

			try {
				// 1. Drop existing datrix-managed tables
				for (const tableName of managedTables) {
					await this.adapter.dropTable(tableName, connection, {
						isImport: true,
					});
				}

				// 2. Create tables — isImport skips FK constraints and _datrix meta
				//    writes. _datrix data will be restored as plain rows in step 3.
				for (const schema of schemas.values()) {
					await this.adapter.createTable(schema, connection, {
						isImport: true,
					});
				}

				// 3. Insert data chunk by chunk
				const tables = await reader.getTables();
				for (const tableName of tables) {
					for await (const chunk of reader.readChunks(tableName)) {
						await this.insertChunk(connection, tableName, chunk);
					}
				}

				// 4. Add FK constraints (skip _datrix)
				for (const schema of schemas.values()) {
					if (schema.name === DATRIX_META_MODEL) continue;
					await this.addForeignKeys(connection, schema);
				}
			} finally {
				// Always re-enable FK checks on the SAME connection before it
				// returns to the pool
				await connection.query("SET FOREIGN_KEY_CHECKS = 1");
			}

			// 5. Reset AUTO_INCREMENT for all tables
			const tables = await reader.getTables();
			for (const tableName of tables) {
				await this.resetAutoIncrement(connection, tableName);
			}
		} finally {
			connection.release();
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
		connection: PoolConnection,
		tableName: string,
		rows: Record<string, unknown>[],
	): Promise<void> {
		if (rows.length === 0) return;

		// Archive content is external input — every identifier goes through
		// escapeIdentifier (validation + quoting)
		const escapedTable = escapeIdentifier(tableName);
		const columns = Object.keys(rows[0]!);
		const escapedColumns = columns
			.map((c) => escapeIdentifier(c))
			.join(", ");

		for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
			const batch = rows.slice(i, i + CHUNK_SIZE);
			const placeholders = batch
				.map(() => `(${columns.map(() => "?").join(", ")})`)
				.join(", ");
			const values: ExecuteValues[] = [];

			for (const row of batch) {
				for (const col of columns) {
					const val = row[col] ?? null;
					// mysql2 driver does not auto-serialize objects/arrays for JSON columns
					values.push(
						val !== null && typeof val === "object" && !(val instanceof Date)
							? JSON.stringify(val)
							: (val as ExecuteValues),
					);
				}
			}

			await connection.execute(
				`INSERT INTO ${escapedTable} (${escapedColumns}) VALUES ${placeholders}`,
				values,
			);
		}
	}

	private async addForeignKeys(
		connection: PoolConnection,
		schema: SchemaDefinition,
	): Promise<void> {
		const tableName = schema.tableName!;
		const escapedTable = escapeIdentifier(tableName);

		for (const [fieldName, field] of Object.entries(schema.fields)) {
			if (field.type !== "number" || !field.references) continue;

			const col = escapeIdentifier(fieldName);
			const refTable = escapeIdentifier(field.references.table);
			const refCol = escapeIdentifier(field.references.column ?? "id");
			const constraintName = escapeIdentifier(
				clampGeneratedIdentifier(`fk_${tableName}_${fieldName}`),
			);

			const onDelete = field.references.onDelete
				? ` ON DELETE ${mapReferentialAction(field.references.onDelete)}`
				: "";
			const onUpdate = field.references.onUpdate
				? ` ON UPDATE ${mapReferentialAction(field.references.onUpdate)}`
				: "";

			await connection.execute(
				`ALTER TABLE ${escapedTable} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${col}) REFERENCES ${refTable} (${refCol})${onDelete}${onUpdate}`,
			);
		}
	}

	private async resetAutoIncrement(
		connection: PoolConnection,
		tableName: string,
	): Promise<void> {
		const escapedTable = escapeIdentifier(tableName);
		const [rows] = await connection.execute(
			`SELECT MAX(\`id\`) as maxId FROM ${escapedTable}`,
		);
		const rawMaxId = (rows as Array<{ maxId: number | null }>)[0]?.maxId ?? 0;
		const maxId = Number.isInteger(rawMaxId) ? (rawMaxId as number) : 0;
		await connection.execute(
			`ALTER TABLE ${escapedTable} AUTO_INCREMENT = ${maxId + 1}`,
		);
	}
}
