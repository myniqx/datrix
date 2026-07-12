import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { ImportReader } from "@datrix/core";
import type { SchemaDefinition } from "@datrix/core";
import type { JsonAdapter } from "../adapter";
import type { JsonTableFile } from "../types";

export class JsonImporter {
	constructor(
		private root: string,
		private adapter: JsonAdapter,
	) {}

	/**
	 * Import into a staging directory first, then swap it in. If anything
	 * fails while reading/writing the archive, the existing tables are left
	 * completely untouched — the old drop-everything-then-import approach
	 * lost all prior data on any mid-import failure.
	 */
	async import(reader: ImportReader): Promise<void> {
		const schemas = await this.collectSchemas(reader);
		const stagingDir = path.join(this.root, `.import-staging-${crypto.randomUUID()}`);

		await fs.mkdir(stagingDir, { recursive: true });

		try {
			// 1. Write every table file into staging (schema + rows together).
			const tables = await reader.getTables();
			for (const tableName of tables) {
				const rows: Record<string, unknown>[] = [];
				for await (const chunk of reader.readChunks(tableName)) {
					rows.push(...chunk);
				}
				await this.writeStagedTableFile(
					stagingDir,
					tableName,
					rows,
					schemas.get(tableName),
				);
			}

			// 2. Everything staged successfully — now swap it in. From here on
			// we're only moving already-validated files, which is about as
			// close to atomic as a plain filesystem gets.
			const existingTables = await this.adapter.getTables();
			for (const tableName of existingTables) {
				const filePath = path.join(this.root, `${tableName}.json`);
				await fs.unlink(filePath).catch(() => {});
			}

			for (const tableName of tables) {
				const stagedPath = path.join(stagingDir, `${tableName}.json`);
				const finalPath = path.join(this.root, `${tableName}.json`);
				await fs.rename(stagedPath, finalPath);
			}

			// Every table file on disk just changed out from under the adapter's
			// in-memory cache — drop it all rather than leave stale entries.
			this.adapter.clearCache();
		} finally {
			await fs.rm(stagingDir, { recursive: true, force: true });
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

	private async writeStagedTableFile(
		stagingDir: string,
		tableName: string,
		rows: Record<string, unknown>[],
		schema: SchemaDefinition | undefined,
	): Promise<void> {
		const filePath = path.join(stagingDir, `${tableName}.json`);

		const maxId = rows.reduce((max, row) => {
			const id = typeof row["id"] === "number" ? row["id"] : 0;
			return id > max ? id : max;
		}, 0);

		const tableFile: JsonTableFile = {
			meta: {
				version: 1,
				lastInsertId: maxId,
				updatedAt: new Date().toISOString(),
				name: schema?.name ?? tableName,
			},
			data: rows,
		};

		await fs.writeFile(filePath, JSON.stringify(tableFile, null, 2), "utf-8");
	}
}
