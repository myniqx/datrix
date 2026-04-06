/**
 * FileImporter
 *
 * Handles uploading media files during import and maintaining a progress ledger.
 *
 * Ledger format (import-progress.txt), one entry per line:
 *   <id_or_variant_id> <key> <status>
 *
 * Examples:
 *   42 1710000000-abc.jpg pending
 *   42__thumbnail 1710000000-abc_thumb.jpg done
 *
 * Status values:
 *   pending    — not yet uploaded
 *   done       — successfully uploaded, DB record updated
 *   skipped    — source file not found in files/ directory
 *
 * The variant id uses the pattern: <media_id>__<variantName>
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import type { IUpload } from "@datrix/core";
import type { IDatrix } from "@datrix/core";
import { logger } from "../utils/logger";
import type { LedgerEntry } from "./file-exporter";

export interface ImportLedgerEntry {
	id: string;
	key: string;
	status: "pending" | "done" | "skipped";
}

export interface ImportResult {
	uploaded: number;
	skipped: number;
}

const IMPORT_LEDGER_FILENAME = "import-progress.txt";

export class FileImporter {
	private readonly filesDir: string;
	private readonly ledgerPath: string;
	private readonly upload: IUpload;
	private readonly datrix: IDatrix;

	constructor(importDir: string, upload: IUpload, datrix: IDatrix) {
		this.filesDir = path.join(importDir, "files");
		this.ledgerPath = path.join(importDir, IMPORT_LEDGER_FILENAME);
		this.upload = upload;
		this.datrix = datrix;
	}

	/**
	 * Build import ledger from the export ledger (files-progress.txt).
	 * Only includes entries that were successfully exported (done).
	 * Skips entries already in the import ledger (resume support).
	 */
	async buildLedger(exportLedgerEntries: LedgerEntry[]): Promise<void> {
		const existing = await this.readLedger();
		const existingIds = new Set(existing.map((e) => e.id));

		const lines: string[] = [];
		for (const entry of exportLedgerEntries) {
			if (entry.status !== "done") continue;
			if (existingIds.has(entry.id)) continue;
			lines.push(`${entry.id} ${entry.key} pending`);
		}

		if (lines.length > 0) {
			await fs.appendFile(this.ledgerPath, lines.join("\n") + "\n", "utf-8");
		}
	}

	async ledgerExists(): Promise<boolean> {
		try {
			await fs.access(this.ledgerPath);
			return true;
		} catch {
			return false;
		}
	}

	async readLedger(): Promise<ImportLedgerEntry[]> {
		try {
			const content = await fs.readFile(this.ledgerPath, "utf-8");
			return parseImportLedger(content);
		} catch {
			return [];
		}
	}

	/**
	 * Extract chunk zips if present so all files are loose in filesDir.
	 */
	async extractChunks(): Promise<void> {
		if (!fsSync.existsSync(this.filesDir)) return;

		const entries = await fs.readdir(this.filesDir);
		const chunks = entries.filter(
			(f) => f.startsWith("chunk_") && f.endsWith(".zip"),
		);

		for (const chunk of chunks) {
			const zipPath = path.join(this.filesDir, chunk);
			const zip = new AdmZip(zipPath);
			zip.extractAllTo(this.filesDir, false);
			await fs.unlink(zipPath);
		}
	}

	/**
	 * Check which pending entries have their source file present in filesDir.
	 * Returns the count of missing files.
	 */
	async checkMissingFiles(): Promise<{ missing: string[]; total: number }> {
		const entries = await this.readLedger();
		const pending = entries.filter((e) => e.status === "pending");
		const missing: string[] = [];

		for (const entry of pending) {
			const srcPath = path.join(this.filesDir, path.basename(entry.key));
			if (!fsSync.existsSync(srcPath)) {
				missing.push(entry.key);
			}
		}

		return { missing, total: pending.length };
	}

	/**
	 * Upload all pending files. Missing source files are marked as skipped.
	 */
	async uploadPending(
		onProgress?: (done: number, total: number) => void,
		verbose = false,
	): Promise<ImportResult> {
		const entries = await this.readLedger();
		const pending = entries.filter((e) => e.status === "pending");
		let doneCount = entries.filter((e) => e.status === "done").length;
		const total = entries.length;
		let skippedCount = entries.filter((e) => e.status === "skipped").length;

		for (const entry of pending) {
			const srcPath = path.join(this.filesDir, path.basename(entry.key));

			if (!fsSync.existsSync(srcPath)) {
				if (verbose) {
					logger.info(`  skipped (not found): ${entry.key}`);
				}
				await this.markStatus(entry.id, "skipped");
				skippedCount++;
				doneCount++;
				onProgress?.(doneCount, total);
				continue;
			}

			const buffer = await fs.readFile(srcPath);
			const originalName = path.basename(entry.key);
			const mimeType = guessMimeType(originalName);

			// Check if already exists at provider to avoid redundant upload
			const alreadyExists = await this.upload.provider.exists(entry.key);
			let newKey: string;

			if (alreadyExists) {
				newKey = entry.key;
			} else {
				const result = await this.upload.provider.upload({
					filename: originalName,
					originalName,
					mimetype: mimeType,
					size: buffer.byteLength,
					buffer: new Uint8Array(buffer),
				});
				newKey = result.key;
			}

			await this.updateDbRecord(entry.id, entry.key, newKey);
			await this.markStatus(entry.id, "done");
			doneCount++;
			onProgress?.(doneCount, total);
		}

		return {
			uploaded: doneCount - skippedCount,
			skipped: skippedCount,
		};
	}

	private async updateDbRecord(
		entryId: string,
		oldKey: string,
		newKey: string,
	): Promise<void> {
		const modelName = this.upload.getModelName();

		if (entryId.includes("__")) {
			const [rawId, variantName] = entryId.split("__") as [string, string];
			const id = Number(rawId);
			const record = await this.datrix.raw.findById(modelName, id);
			if (!record) return;

			const variants = (record["variants"] ?? {}) as Record<
				string,
				Record<string, unknown>
			>;
			if (variants[variantName]) {
				variants[variantName] = { ...variants[variantName], key: newKey };
			}
			await this.datrix.raw.update(modelName, id, { variants });
		} else {
			const id = Number(entryId);
			await this.datrix.raw.update(modelName, id, { key: newKey });
		}

		void oldKey;
	}

	private async markStatus(
		id: string,
		status: "done" | "skipped",
	): Promise<void> {
		const content = await fs.readFile(this.ledgerPath, "utf-8");
		const updated = content
			.split("\n")
			.map((line) => {
				const parts = line.trim().split(" ");
				if (parts[0] === id && parts[2] === "pending") {
					return `${parts[0]} ${parts[1]} ${status}`;
				}
				return line;
			})
			.join("\n");
		await fs.writeFile(this.ledgerPath, updated, "utf-8");
	}
}

function parseImportLedger(content: string): ImportLedgerEntry[] {
	return content
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => {
			const parts = line.trim().split(" ");
			if (parts.length < 3) return null;
			const [id, key, status] = parts;
			if (
				!id ||
				!key ||
				(status !== "pending" && status !== "done" && status !== "skipped")
			)
				return null;
			return { id, key, status };
		})
		.filter((e): e is ImportLedgerEntry => e !== null);
}

function guessMimeType(filename: string): string {
	const ext = filename.split(".").pop()?.toLowerCase() ?? "";
	const map: Record<string, string> = {
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		png: "image/png",
		gif: "image/gif",
		webp: "image/webp",
		svg: "image/svg+xml",
		pdf: "application/pdf",
		mp4: "video/mp4",
		webm: "video/webm",
		mp3: "audio/mpeg",
		wav: "audio/wav",
	};
	return map[ext] ?? "application/octet-stream";
}
