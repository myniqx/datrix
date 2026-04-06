/**
 * ZipExportWriter
 *
 * ExportWriter implementation that writes data to a zip file.
 *
 * Structure inside zip:
 *   metadata.json   — ExportMeta + schemas + chunk file list
 *   users_0.csv     — chunk files per table
 *   users_1.csv
 *   posts_0.csv
 *   ...
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import archiver from "archiver";
import type { ExportWriter, ExportMeta } from "@forja/core";
import type { SchemaDefinition } from "@forja/core";
import { sortSchemasByDependency } from "@forja/core";
import { encodeHeader, encodeRow } from "./csv";
import { logger } from "../utils/logger";

interface Metadata {
	meta: ExportMeta;
	schemas: SchemaDefinition[];
	chunks: Record<string, string[]>;
}

export class ZipExportWriter implements ExportWriter {
	private metadata: Metadata = {
		meta: { version: 1, exportedAt: "" },
		schemas: [],
		chunks: {},
	};
	private tempDir: string;
	private outputPath: string;
	private chunkCounters = new Map<string, number>();
	private readonly verbose: boolean;
	private readonly onChunk?: (
		tableName: string,
		rows: Record<string, unknown>[],
	) => Promise<void>;

	constructor(
		outputPath: string,
		verbose = false,
		onChunk?: (
			tableName: string,
			rows: Record<string, unknown>[],
		) => Promise<void>,
	) {
		this.outputPath = outputPath;
		this.verbose = verbose;
		if (onChunk) this.onChunk = onChunk;
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		this.tempDir = path.join(path.dirname(outputPath), `temp_${timestamp}`);
	}

	async writeMeta(meta: ExportMeta): Promise<void> {
		await fs.mkdir(this.tempDir, { recursive: true });
		this.metadata.meta = meta;
	}

	async writeSchema(schema: SchemaDefinition): Promise<void> {
		this.metadata.schemas.push(schema);
		if (this.verbose) {
			logger.info(`  schema: ${schema.name}`);
		}
	}

	async writeChunk(
		tableName: string,
		rows: Record<string, unknown>[],
	): Promise<void> {
		const schema = this.metadata.schemas.find((s) => s.tableName === tableName);
		const fields = schema
			? Object.entries(schema.fields)
					.filter(([, f]) => f.type !== "relation")
					.map(([name]) => name)
			: rows.length > 0
				? Object.keys(rows[0]!)
				: [];

		if (fields.length === 0) return;

		const chunkIndex = this.chunkCounters.get(tableName) ?? 0;
		const fileName = `${tableName}_${chunkIndex}.csv`;
		this.chunkCounters.set(tableName, chunkIndex + 1);

		if (!this.metadata.chunks[tableName]) {
			this.metadata.chunks[tableName] = [];
		}
		this.metadata.chunks[tableName]!.push(fileName);

		const lines = [encodeHeader(fields)];
		for (const row of rows) {
			lines.push(encodeRow(fields, row));
		}

		await fs.writeFile(
			path.join(this.tempDir, fileName),
			lines.join("\n"),
			"utf-8",
		);

		await this.onChunk?.(tableName, rows);

		if (this.verbose) {
			logger.info(`  chunk: ${fileName} (${rows.length} rows)`);
		}
	}

	async finalize(): Promise<void> {
		// Sort schemas by FK dependency order so import can create tables in the right order
		this.metadata.schemas = sortSchemasByDependency(this.metadata.schemas);

		// Write metadata.json
		await fs.writeFile(
			path.join(this.tempDir, "metadata.json"),
			JSON.stringify(this.metadata, null, 2),
			"utf-8",
		);

		// Create zip
		await this.createZip();

		// Cleanup temp dir
		await fs.rm(this.tempDir, { recursive: true, force: true });
	}

	private createZip(): Promise<void> {
		return new Promise((resolve, reject) => {
			const output = fsSync.createWriteStream(this.outputPath);
			const archive = archiver("zip", { zlib: { level: 6 } });

			output.on("close", resolve);
			archive.on("error", reject);

			archive.pipe(output);
			archive.directory(this.tempDir, false);
			archive.finalize();
		});
	}
}
