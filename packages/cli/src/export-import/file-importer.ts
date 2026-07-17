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
import { Ledger } from "./ledger";
import type { LedgerRecord } from "./ledger";
import { findLocalFile } from "./file-naming";

export type ImportFileStatus = "pending" | "done" | "skipped";

export interface ImportLedgerEntry {
	id: string;
	key: string;
	status: ImportFileStatus;
}

export interface ImportResult {
	uploaded: number;
	skipped: number;
}

const IMPORT_LEDGER_FILENAME = "import-progress.txt";
const IMPORT_STATUSES: readonly ImportFileStatus[] = [
	"pending",
	"done",
	"skipped",
];

export class FileImporter {
	private readonly filesDir: string;
	private readonly ledger: Ledger<ImportFileStatus>;
	private readonly upload: IUpload;
	private readonly datrix: IDatrix;

	constructor(importDir: string, upload: IUpload, datrix: IDatrix) {
		this.filesDir = path.join(importDir, "files");
		this.ledger = new Ledger(
			path.join(importDir, IMPORT_LEDGER_FILENAME),
			IMPORT_STATUSES,
		);
		this.upload = upload;
		this.datrix = datrix;
	}

	/**
	 * Build import ledger from the export ledger (files-progress.txt).
	 * Only includes entries that were successfully exported (done).
	 * Entries already in the import ledger are skipped (resume support).
	 * Entries that were missing/restricted at export time are reported —
	 * their DB records keep the original keys but the files are not uploaded.
	 */
	async buildLedger(
		exportLedgerEntries: LedgerEntry[],
		verbose = false,
	): Promise<void> {
		const records: LedgerRecord<ImportFileStatus>[] = [];
		const unavailable: LedgerEntry[] = [];

		for (const entry of exportLedgerEntries) {
			if (entry.status === "done") {
				records.push({ id: entry.id, key: entry.key, status: "pending" });
			} else if (entry.status === "missing" || entry.status === "restricted") {
				unavailable.push(entry);
			}
		}

		await this.ledger.append(records);

		if (unavailable.length > 0) {
			logger.warn(
				`${unavailable.length} file(s) were missing or restricted during export and will not be uploaded; ` +
					"affected DB records keep their original keys.",
			);
			if (verbose) {
				for (const entry of unavailable) {
					logger.info(`  - ${entry.key} (${entry.status})`);
				}
			}
		}
	}

	async ledgerExists(): Promise<boolean> {
		return this.ledger.exists();
	}

	async readLedger(): Promise<ImportLedgerEntry[]> {
		return this.ledger.read();
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
			if (findLocalFile(this.filesDir, entry.key) === null) {
				missing.push(entry.key);
			}
		}

		return { missing, total: pending.length };
	}

	/**
	 * Upload all pending files. Missing source files are marked as skipped.
	 * The returned counts cover THIS run only — entries already done from a
	 * previous (resumed) run are not re-counted as uploads.
	 */
	async uploadPending(
		onProgress?: (done: number, total: number) => void,
		verbose = false,
	): Promise<ImportResult> {
		const entries = await this.readLedger();
		const pending = entries.filter((e) => e.status === "pending");
		let doneCount = entries.length - pending.length;
		const total = entries.length;

		let uploadedThisRun = 0;
		let skippedThisRun = 0;

		for (const entry of pending) {
			const srcPath = findLocalFile(this.filesDir, entry.key);

			if (srcPath === null) {
				if (verbose) {
					logger.info(`  skipped (not found): ${entry.key}`);
				}
				await this.markStatus(entry.id, "skipped");
				skippedThisRun++;
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
			uploadedThisRun++;
			doneCount++;
			onProgress?.(doneCount, total);
		}

		return {
			uploaded: uploadedThisRun,
			skipped: skippedThisRun,
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
		await this.ledger.markStatus(id, status);
	}
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
