/**
 * FileExporter
 *
 * Handles downloading media files during export and maintaining a progress ledger.
 *
 * Ledger format (files-progress.txt), one entry per line:
 *   <id_or_variant_id> <key> <status>
 *
 * Examples:
 *   42 1710000000-abc.jpg pending
 *   42__thumbnail 1710000000-abc_thumb.jpg done
 *
 * The variant id uses the pattern: <media_id>__<variantName>
 * This allows import to identify exactly which DB record and variant to update.
 *
 * Files are stored locally under keyToFileName(key) so keys that share a
 * basename (a/1.jpg vs b/1.jpg) never collide.
 */

import fs from "node:fs/promises";
import path from "node:path";
import fsSync from "node:fs";
import archiver from "archiver";
import type { IUpload } from "@datrix/core";
import { logger, spinner } from "../utils/logger";
import { confirm } from "../utils/prompt";
import { Ledger } from "./ledger";
import type { LedgerRecord } from "./ledger";
import { keyToFileName } from "./file-naming";

export type ExportFileStatus = "pending" | "done" | "missing" | "restricted";

export interface LedgerEntry {
	id: string;
	key: string;
	status: ExportFileStatus;
}

export interface DownloadResult {
	stopped: boolean;
}

const LEDGER_FILENAME = "files-progress.txt";
const FILES_DIR = "files";
const DEFAULT_CHUNK_SIZE = 1024 * 1024 * 1024; // 1GB
const EXPORT_STATUSES: readonly ExportFileStatus[] = [
	"pending",
	"done",
	"missing",
	"restricted",
];

export class FileExporter {
	private readonly outputDir: string;
	private readonly filesDir: string;
	private readonly ledger: Ledger<ExportFileStatus>;
	private readonly upload: IUpload;
	private readonly chunkSizeLimit: number;

	constructor(
		outputDir: string,
		upload: IUpload,
		chunkSizeLimit = DEFAULT_CHUNK_SIZE,
	) {
		this.outputDir = outputDir;
		this.filesDir = path.join(outputDir, FILES_DIR);
		this.ledger = new Ledger(
			path.join(outputDir, LEDGER_FILENAME),
			EXPORT_STATUSES,
		);
		this.upload = upload;
		this.chunkSizeLimit = chunkSizeLimit;
	}

	async init(): Promise<void> {
		await fs.mkdir(this.filesDir, { recursive: true });
	}

	/**
	 * Append a batch of media rows to the ledger as pending entries.
	 * Entries already in the ledger are skipped (resume support).
	 */
	async appendToLedger(rows: Record<string, unknown>[]): Promise<void> {
		const records: LedgerRecord<ExportFileStatus>[] = [];

		for (const row of rows) {
			const id = String(row["id"]);
			const key = row["key"];
			if (typeof key !== "string" || !key) continue;

			records.push({ id, key, status: "pending" });

			const variants = row["variants"];
			if (variants !== null && typeof variants === "object") {
				for (const [name, variant] of Object.entries(
					variants as Record<string, unknown>,
				)) {
					if (variant !== null && typeof variant === "object") {
						const v = variant as Record<string, unknown>;
						if (typeof v["key"] === "string" && v["key"]) {
							records.push({
								id: `${id}__${name}`,
								key: v["key"],
								status: "pending",
							});
						}
					}
				}
			}
		}

		await this.ledger.append(records);
	}

	/**
	 * Download all pending files. Supports ESC to gracefully stop and
	 * Ctrl+C to abort immediately.
	 * If packFiles is true, packs downloaded files into zip chunks
	 * (size controlled by chunkSizeLimit) instead of leaving them in files/.
	 */
	async downloadPending(
		onProgress?: (done: number, total: number) => void,
		packFiles = false,
	): Promise<DownloadResult> {
		await this.cleanupPartFiles();

		const entries = await this.readLedger();
		const pending = entries.filter((e) => e.status === "pending");
		let doneCount = entries.length - pending.length;
		const total = entries.length;

		let stopped = false;
		const escListener = setupEscListener(() => {
			stopped = true;
		});

		try {
			for (const entry of pending) {
				if (stopped) break;

				const url = this.upload.getUrl(entry.key);
				const result = await this.downloadFile(url, entry.key);
				if (result === 404) {
					await this.markStatus(entry.id, "missing");
				} else if (result === 403) {
					await this.markStatus(entry.id, "restricted");
				} else {
					await this.markStatus(entry.id, "done");
				}
				doneCount++;
				onProgress?.(doneCount, total);
			}
		} finally {
			escListener.stop();
		}

		if (stopped) {
			spinner.fail(`Stopped at ${doneCount}/${total} files`);
			logger.info(`Resume with: --resume ${this.outputDir}`);
			const shouldStop = await confirm("Stop now? (Y/n): ", true);
			if (shouldStop) return { stopped: true };
			return this.downloadPending(onProgress, packFiles);
		}

		if (packFiles) {
			await this.packIntoZipChunks();
		}

		return { stopped: false };
	}

	async readLedger(): Promise<LedgerEntry[]> {
		return this.ledger.read();
	}

	async ledgerExists(): Promise<boolean> {
		return this.ledger.exists();
	}

	get outputDirectory(): string {
		return this.outputDir;
	}

	/**
	 * Remove stray .part files left behind by an interrupted download —
	 * they are incomplete by definition and will be re-downloaded.
	 */
	private async cleanupPartFiles(): Promise<void> {
		if (!fsSync.existsSync(this.filesDir)) return;

		const entries = await fs.readdir(this.filesDir);
		for (const entry of entries) {
			if (entry.endsWith(".part")) {
				await fs.unlink(path.join(this.filesDir, entry));
			}
		}
	}

	private async downloadFile(
		url: string,
		key: string,
	): Promise<404 | 403 | null> {
		const destPath = path.join(this.filesDir, keyToFileName(key));

		try {
			await fs.access(destPath);
			return null;
		} catch {
			// File doesn't exist, proceed with download
		}

		const response = await fetch(url);
		if (response.status === 404) return 404;
		if (response.status === 403) return 403;
		if (!response.ok) {
			throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
		}

		// Download to a .part file first; the final name only ever exists
		// complete, so the resume existence-check above stays sound.
		const partPath = `${destPath}.part`;
		const buffer = await response.arrayBuffer();
		await fs.writeFile(partPath, new Uint8Array(buffer));
		await fs.rename(partPath, destPath);
		return null;
	}

	private async markStatus(
		id: string,
		status: "done" | "missing" | "restricted",
	): Promise<void> {
		await this.ledger.markStatus(id, status);
	}

	/**
	 * Pack all downloaded files into zip chunks of at most chunkSizeLimit bytes.
	 * Chunk files are named chunk_0.zip, chunk_1.zip, ...
	 * Existing chunks from a previous (resumed) run are kept — numbering
	 * continues after the highest existing index.
	 * Original files are removed after packing.
	 */
	private async packIntoZipChunks(): Promise<void> {
		const entries = await fs.readdir(this.filesDir);
		const files = entries.filter(
			(f) => !f.endsWith(".zip") && !f.endsWith(".part"),
		);

		if (files.length === 0) return;

		spinner.start("Packing files into zip chunks...");

		let chunkIndex = 0;
		for (const entry of entries) {
			const match = /^chunk_(\d+)\.zip$/.exec(entry);
			if (match) {
				chunkIndex = Math.max(chunkIndex, parseInt(match[1]!, 10) + 1);
			}
		}

		let currentChunkSize = 0;
		let currentFiles: string[] = [];
		let packedChunks = 0;

		const flushChunk = async (): Promise<void> => {
			if (currentFiles.length === 0) return;
			const zipPath = path.join(this.filesDir, `chunk_${chunkIndex}.zip`);
			await createZipFromFiles(currentFiles, this.filesDir, zipPath);
			for (const f of currentFiles) {
				await fs.unlink(path.join(this.filesDir, f));
			}
			chunkIndex++;
			packedChunks++;
			currentFiles = [];
			currentChunkSize = 0;
		};

		for (const file of files) {
			const filePath = path.join(this.filesDir, file);
			const stat = await fs.stat(filePath);

			if (
				currentChunkSize + stat.size > this.chunkSizeLimit &&
				currentFiles.length > 0
			) {
				await flushChunk();
			}

			currentFiles.push(file);
			currentChunkSize += stat.size;
		}

		await flushChunk();

		spinner.succeed(`Packed into ${packedChunks} zip chunk(s)`);
	}
}

function createZipFromFiles(
	files: string[],
	baseDir: string,
	zipPath: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const output = fsSync.createWriteStream(zipPath);
		const archive = archiver("zip", { zlib: { level: 0 } });

		output.on("close", resolve);
		archive.on("error", reject);

		archive.pipe(output);
		for (const file of files) {
			archive.file(path.join(baseDir, file), { name: file });
		}
		archive.finalize();
	});
}

interface EscListener {
	stop(): void;
}

function setupEscListener(onEsc: () => void): EscListener {
	if (!process.stdin.isTTY) return { stop: () => {} };

	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.setEncoding("utf-8");

	const restore = (): void => {
		process.stdin.removeListener("data", handler);
		process.stdin.setRawMode(false);
		process.stdin.pause();
	};

	const handler = (key: string): void => {
		if (key === "\u001b") {
			// ESC — graceful stop (finish current file, offer resume)
			onEsc();
		} else if (key === "\u0003") {
			// Ctrl+C — raw mode swallows SIGINT, so abort explicitly
			restore();
			process.stdout.write("\n");
			logger.info("Aborted (Ctrl+C). Resume with --resume.");
			process.exit(130);
		}
	};

	process.stdin.on("data", handler);

	return { stop: restore };
}
