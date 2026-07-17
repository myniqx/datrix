/**
 * ZipImportReader
 *
 * ImportReader implementation that reads data from a zip file.
 */

import AdmZip from "adm-zip";
import type { ImportReader, ExportMeta } from "@datrix/core";
import type { SchemaDefinition } from "@datrix/core";
import { decodeLine, parseLine, splitRecords } from "./csv";
import { logger } from "../utils/logger";

interface Metadata {
	meta: ExportMeta;
	schemas: SchemaDefinition[];
	chunks: Record<string, string[]>;
}

export class ZipImportReader implements ImportReader {
	private zip: AdmZip;
	private metadata: Metadata | undefined;
	private readonly verbose: boolean;

	constructor(zipPath: string, verbose = false) {
		this.zip = new AdmZip(zipPath);
		this.verbose = verbose;
	}

	private getMetadata(): Metadata {
		if (this.metadata) return this.metadata;

		const entry = this.zip.getEntry("metadata.json");
		if (!entry) {
			throw new Error("Invalid export file: metadata.json not found");
		}

		this.metadata = JSON.parse(entry.getData().toString("utf-8")) as Metadata;
		return this.metadata;
	}

	async readMeta(): Promise<ExportMeta> {
		return this.getMetadata().meta;
	}

	async *readSchemas(): AsyncIterable<SchemaDefinition> {
		const { schemas } = this.getMetadata();
		for (const schema of schemas) {
			if (this.verbose) {
				logger.info(`  schema: ${schema.name}`);
			}
			yield schema;
		}
	}

	async getTables(): Promise<readonly string[]> {
		const { chunks } = this.getMetadata();
		return Object.keys(chunks);
	}

	async *readChunks(
		tableName: string,
	): AsyncIterable<Record<string, unknown>[]> {
		const metadata = this.getMetadata();
		const chunkFiles = metadata.chunks[tableName] ?? [];
		const schema = metadata.schemas.find((s) => s.tableName === tableName);

		for (const fileName of chunkFiles) {
			const entry = this.zip.getEntry(fileName);
			if (!entry) {
				throw new Error(
					`Corrupt export: chunk file '${fileName}' is listed in metadata.json but missing from the zip`,
				);
			}

			const content = entry.getData().toString("utf-8");
			// Quote-aware record splitting — quoted cells may contain newlines
			const records = splitRecords(content);

			if (records.length < 2) {
				yield [];
				continue;
			}

			const headers = parseLine(records[0]!).map((cell) => cell.value);

			const rows: Record<string, unknown>[] = [];
			for (let i = 1; i < records.length; i++) {
				try {
					rows.push(decodeLine(records[i]!, headers, schema));
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					throw new Error(`${message} (chunk '${fileName}', record ${i})`);
				}
			}

			if (this.verbose) {
				logger.info(`  chunk: ${fileName} (${rows.length} rows)`);
			}

			yield rows;
		}
	}
}
