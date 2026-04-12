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
 */

import fs from "node:fs/promises";
import path from "node:path";
import fsSync from "node:fs";
import archiver from "archiver";
import type { IUpload } from "@datrix/core";
import { logger, spinner } from "../utils/logger";

export interface LedgerEntry {
	id: string;
	key: string;
	status: "pending" | "done" | "missing" | "restricted";
}

export interface DownloadResult {
	stopped: boolean;
}

const LEDGER_FILENAME = "files-progress.txt";
const FILES_DIR = "files";
const DEFAULT_CHUNK_SIZE = 1024 * 1024 * 1024; // 1GB

export class FileExporter {
	private readonly outputDir: string;
	private readonly filesDir: string;
	private readonly ledgerPath: string;
	private readonly upload: IUpload;
	private readonly chunkSizeLimit: number;

	constructor(
		outputDir: string,
		upload: IUpload,
		chunkSizeLimit = DEFAULT_CHUNK_SIZE,
	) {
		this.outputDir = outputDir;
		this.filesDir = path.join(outputDir, FILES_DIR);
		this.ledgerPath = path.join(outputDir, LEDGER_FILENAME);
		this.upload = upload;
		this.chunkSizeLimit = chunkSizeLimit;
	}

	async init(): Promise<void> {
		await fs.mkdir(this.filesDir, { recursive: true });
	}

	/**
	 * Append a batch of media rows to the ledger as pending entries.
	 * Skips entries that are already in the ledger (for resume support).
	 */
	async appendToLedger(rows: Record<string, unknown>[]): Promise<void> {
		const existing = await this.readLedger();
		const existingIds = new Set(existing.map((e) => e.id));

		const lines: string[] = [];
		for (const row of rows) {
			const id = String(row["id"]);
			const key = row["key"];
			if (typeof key !== "string" || !key) continue;

			if (!existingIds.has(id)) {
				lines.push(`${id} ${key} pending`);
				existingIds.add(id);
			}

			const variants = row["variants"];
			if (variants !== null && typeof variants === "object") {
				for (const [name, variant] of Object.entries(
					variants as Record<string, unknown>,
				)) {
					if (variant !== null && typeof variant === "object") {
						const v = variant as Record<string, unknown>;
						if (typeof v["key"] === "string" && v["key"]) {
							const variantId = `${id}__${name}`;
							if (!existingIds.has(variantId)) {
								lines.push(`${variantId} ${v["key"]} pending`);
								existingIds.add(variantId);
							}
						}
					}
				}
			}
		}

		if (lines.length > 0) {
			await fs.appendFile(this.ledgerPath, lines.join("\n") + "\n", "utf-8");
		}
	}

	/**
	 * Download all pending files. Supports ESC to gracefully stop.
	 * If packFiles is true, packs downloaded files into zip chunks
	 * (size controlled by chunkSizeLimit) instead of leaving them in files/.
	 */
	async downloadPending(
		onProgress?: (done: number, total: number) => void,
		packFiles = false,
	): Promise<DownloadResult> {
		const entries = await this.readLedger();
		const pending = entries.filter((e) => e.status === "pending");
		let doneCount = entries.filter((e) => e.status === "done").length;
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
			const shouldStop = await askConfirm("Stop now? (Y/n): ", true);
			if (shouldStop) return { stopped: true };
			return this.downloadPending(onProgress, packFiles);
		}

		if (packFiles) {
			await this.packIntoZipChunks();
		}

		return { stopped: false };
	}

	async readLedger(): Promise<LedgerEntry[]> {
		try {
			const content = await fs.readFile(this.ledgerPath, "utf-8");
			return parseLedger(content);
		} catch {
			return [];
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

	get outputDirectory(): string {
		return this.outputDir;
	}

	private async downloadFile(
		url: string,
		key: string,
	): Promise<404 | 403 | null> {
		const destPath = path.join(this.filesDir, path.basename(key));

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

		const buffer = await response.arrayBuffer();
		await fs.writeFile(destPath, new Uint8Array(buffer));
		return null;
	}

	private async markStatus(
		id: string,
		status: "done" | "missing" | "restricted",
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

	/**
	 * Pack all downloaded files into zip chunks of at most chunkSizeLimit bytes.
	 * Chunk files are named chunk_0.zip, chunk_1.zip, ...
	 * Original files are removed after packing.
	 */
	private async packIntoZipChunks(): Promise<void> {
		const entries = await fs.readdir(this.filesDir);
		const files = entries.filter((f) => !f.endsWith(".zip"));

		if (files.length === 0) return;

		spinner.start("Packing files into zip chunks...");

		let chunkIndex = 0;
		let currentChunkSize = 0;
		let currentFiles: string[] = [];

		const flushChunk = async (): Promise<void> => {
			if (currentFiles.length === 0) return;
			const zipPath = path.join(this.filesDir, `chunk_${chunkIndex}.zip`);
			await createZipFromFiles(currentFiles, this.filesDir, zipPath);
			for (const f of currentFiles) {
				await fs.unlink(path.join(this.filesDir, f));
			}
			chunkIndex++;
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

		spinner.succeed(`Packed into ${chunkIndex} zip chunk(s)`);
	}
}

function parseLedger(content: string): LedgerEntry[] {
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
				(status !== "pending" &&
					status !== "done" &&
					status !== "missing" &&
					status !== "restricted")
			)
				return null;
			return { id, key, status };
		})
		.filter((e): e is LedgerEntry => e !== null);
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

	const handler = (key: string) => {
		if (key === "\u001b") {
			onEsc();
		}
	};

	process.stdin.on("data", handler);

	return {
		stop() {
			process.stdin.removeListener("data", handler);
			process.stdin.setRawMode(false);
			process.stdin.pause();
		},
	};
}

function askConfirm(question: string, defaultYes = false): Promise<boolean> {
	return new Promise((resolve) => {
		process.stdout.write(question);
		process.stdin.setRawMode(false);
		process.stdin.resume();
		process.stdin.setEncoding("utf-8");

		process.stdin.once("data", (data) => {
			const answer = String(data).trim().toLowerCase();
			process.stdin.pause();
			if (answer === "") {
				resolve(defaultYes);
			} else {
				resolve(answer === "y");
			}
		});
	});
}
