/**
 * ZipImportReader
 *
 * ImportReader implementation that reads data from a zip file.
 */

import AdmZip from "adm-zip";
import type { ImportReader, ExportMeta } from "forja-types/adapter";
import type { SchemaDefinition } from "forja-types/core/schema";
import { decodeLine } from "./csv";

interface Metadata {
	meta: ExportMeta;
	schemas: SchemaDefinition[];
	chunks: Record<string, string[]>;
}

export class ZipImportReader implements ImportReader {
	private zip: AdmZip;
	private metadata: Metadata | undefined;

	constructor(zipPath: string) {
		this.zip = new AdmZip(zipPath);
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
			yield schema;
		}
	}

	async getTables(): Promise<readonly string[]> {
		const { chunks } = this.getMetadata();
		return Object.keys(chunks);
	}

	async *readChunks(tableName: string): AsyncIterable<Record<string, unknown>[]> {
		const metadata = this.getMetadata();
		const chunkFiles = metadata.chunks[tableName] ?? [];
		const schema = metadata.schemas.find((s) => s.tableName === tableName);

		for (const fileName of chunkFiles) {
			const entry = this.zip.getEntry(fileName);
			if (!entry) continue;

			const content = entry.getData().toString("utf-8");
			const lines = content.split("\n").filter((l) => l.trim() !== "");

			if (lines.length < 2) {
				yield [];
				continue;
			}

			// First line is header
			const headerLine = lines[0]!;
			const headers = headerLine.split(",").map((h) => h.replace(/^"|"$/g, "").replace(/""/g, '"'));

			const rows: Record<string, unknown>[] = [];
			for (let i = 1; i < lines.length; i++) {
				rows.push(decodeLine(lines[i]!, headers, schema));
			}

			yield rows;
		}
	}
}
