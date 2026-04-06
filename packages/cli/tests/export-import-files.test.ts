/**
 * Export/Import --include-files Tests
 *
 * Tests file export/resume/pack and import/resume functionality using a real
 * LocalStorageProvider and a lightweight HTTP server that serves the uploaded files.
 *
 * Export setup per test:
 *  1. Forja instance with ApiPlugin + Upload (LocalStorageProvider)
 *  2. HTTP server pointing at the same upload directory
 *  3. Seed media records by calling the upload handler
 *  4. Run exportCommand with --include-files
 *  5. Assert files-progress.txt and files/ directory
 *
 * Import setup per test:
 *  1. Run exportCommand first to produce an export directory
 *  2. Create a second Forja instance with a separate upload directory (target)
 *  3. Run importCommand --with-files or --only-files against the export directory
 *  4. Assert files landed in target storage and DB records updated
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Forja } from "@forja/core";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import http from "node:http";
import path from "node:path";
import { exportCommand } from "../src/commands/export";
import { importCommand } from "../src/commands/import";
import { FileExporter } from "../src/export-import/file-exporter";
import AdmZip from "adm-zip";

// ============================================================================
// Imports using vitest alias paths
// ============================================================================
import { ApiPlugin } from "@forja/api";
import { Upload, LocalStorageProvider } from "@forja/api-upload";
import { JsonAdapter } from "../../adapter-json/src/index";
import type { ForjaConfig } from "@forja/core/types";
import { defineConfig } from "@forja/core";
import { IApiPlugin } from "@forja/core/types/api";

// ============================================================================
// Constants
// ============================================================================

const TEST_ROOT = path.join(
	process.cwd(),
	"packages",
	"cli",
	"tests",
	".tmp-cli-files-test",
);

const HTTP_PORT = 19876;
const BASE_URL = `http://localhost:${HTTP_PORT}/uploads`;

// ============================================================================
// Helpers
// ============================================================================

function getTmpDir(name: string): string {
	return path.join(TEST_ROOT, name);
}

/**
 * Start a simple static file server over the upload directory.
 * Returns a cleanup function.
 */
function startFileServer(uploadDir: string): Promise<http.Server> {
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			const key = decodeURIComponent(
				(req.url ?? "").replace(/^\/uploads\//, ""),
			);
			const filePath = path.join(uploadDir, key);
			try {
				const data = fsSync.readFileSync(filePath);
				res.writeHead(200, { "Content-Type": "application/octet-stream" });
				res.end(data);
			} catch {
				res.writeHead(404);
				res.end("Not found");
			}
		});

		server.listen(HTTP_PORT, "localhost", () => resolve(server));
		server.on("error", reject);
	});
}

async function stopServer(server: http.Server): Promise<void> {
	return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Build a Forja instance with ApiPlugin + Upload configured.
 */
async function createForjaWithUpload(tmpDir: string): Promise<Forja> {
	const uploadDir = path.join(tmpDir, "uploads");
	const dbDir = path.join(tmpDir, "db");

	await fs.mkdir(uploadDir, { recursive: true });
	await fs.mkdir(dbDir, { recursive: true });

	const provider = new LocalStorageProvider({
		basePath: uploadDir,
		baseUrl: BASE_URL,
		ensureDirectory: true,
	});

	const upload = new Upload({
		provider,
		permission: { create: true, read: true, update: true, delete: true },
	});

	const adapter = new JsonAdapter({
		root: dbDir,
		cache: true,
		readLock: false,
		lockTimeout: 5000,
		staleTimeout: 10000,
	});

	const getForja = defineConfig(() => {
		const config: ForjaConfig = {
			adapter: adapter as unknown as ForjaConfig["adapter"],
			schemas: [],
			plugins: [
				new ApiPlugin({
					enabled: true,
					prefix: "/api",
					defaultPageSize: 25,
					maxPageSize: 100,
					maxPopulateDepth: 3,
					autoRoutes: true,
					excludeSchemas: [],
					upload,
				}),
			],
		};
		return config;
	});

	const forja = await getForja();
	const migrator = await forja.beginMigrate();
	await migrator.apply();
	return forja;
}

/**
 * Seed a fake media record directly into the DB (bypasses file upload).
 * The file is written to uploadDir so the HTTP server can serve it.
 */
async function seedMediaRecord(
	forja: Forja,
	uploadDir: string,
	opts: {
		key: string;
		content?: string;
		variants?: Record<string, { key: string }>;
	},
): Promise<number> {
	const content = opts.content ?? `fake-file-content-${opts.key}`;
	await fs.writeFile(path.join(uploadDir, opts.key), content, "utf-8");

	if (opts.variants) {
		for (const v of Object.values(opts.variants)) {
			await fs.writeFile(
				path.join(uploadDir, v.key),
				`variant-content-${v.key}`,
				"utf-8",
			);
		}
	}

	const record = await forja.raw.create("media", {
		filename: opts.key,
		originalName: opts.key,
		mimeType: "image/jpeg",
		size: content.length,
		key: opts.key,
		variants: opts.variants ?? null,
	});

	return record.id as number;
}

// ============================================================================
// Test state (reset per test)
// ============================================================================

let forja: Forja;
let server: http.Server;
let tmpDir: string;
let uploadDir: string;

beforeEach(async () => {
	tmpDir = getTmpDir(`test-export-import-files`);
	uploadDir = path.join(tmpDir, "uploads");
	await fs.rm(tmpDir, { recursive: true, force: true });

	forja = await createForjaWithUpload(tmpDir);
	server = await startFileServer(uploadDir);
});

afterEach(async () => {
	await forja.shutdown();
	await stopServer(server);
	await fs.rm(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// Tests
// ============================================================================

describe("export --include-files", () => {
	it("should fail if upload plugin is not configured", async () => {
		await expect(
			exportCommand(forja.getAdapter(), {
				includeFiles: true,
				forja: undefined!,
				output: path.join(tmpDir, "out"),
			}),
		).rejects.toThrow("api-upload plugin");
	});

	it("should create files-progress.txt and files/ directory after export", async () => {
		await seedMediaRecord(forja, uploadDir, { key: "photo-001.jpg" });

		const outputDir = path.join(tmpDir, "export-out");
		await exportCommand(forja.getAdapter(), {
			includeFiles: true,
			forja,
			output: outputDir,
		});

		const ledgerPath = path.join(outputDir, "files-progress.txt");
		const filesDir = path.join(outputDir, "files");

		expect(fsSync.existsSync(ledgerPath)).toBe(true);
		expect(fsSync.existsSync(filesDir)).toBe(true);
	});

	it("should mark all entries as done in the ledger", async () => {
		await seedMediaRecord(forja, uploadDir, { key: "photo-002.jpg" });
		await seedMediaRecord(forja, uploadDir, { key: "photo-003.jpg" });

		const outputDir = path.join(tmpDir, "export-out");
		await exportCommand(forja.getAdapter(), {
			includeFiles: true,
			forja,
			output: outputDir,
		});

		const ledger = await fs.readFile(
			path.join(outputDir, "files-progress.txt"),
			"utf-8",
		);
		const lines = ledger.split("\n").filter((l) => l.trim() !== "");

		expect(lines.length).toBe(2);
		for (const line of lines) {
			expect(line.endsWith("done")).toBe(true);
		}
	});

	it("should write correct ledger format: <id> <key> <status>", async () => {
		const id = await seedMediaRecord(forja, uploadDir, {
			key: "photo-004.jpg",
		});

		const outputDir = path.join(tmpDir, "export-out");
		await exportCommand(forja.getAdapter(), {
			includeFiles: true,
			forja,
			output: outputDir,
		});

		const ledger = await fs.readFile(
			path.join(outputDir, "files-progress.txt"),
			"utf-8",
		);
		const lines = ledger.split("\n").filter((l) => l.trim() !== "");
		const parts = lines[0]!.split(" ");

		expect(parts[0]).toBe(String(id));
		expect(parts[1]).toBe("photo-004.jpg");
		expect(parts[2]).toBe("done");
	});

	it("should include variant entries in the ledger", async () => {
		const id = await seedMediaRecord(forja, uploadDir, {
			key: "photo-005.jpg",
			variants: {
				thumbnail: { key: "photo-005-thumb.jpg" },
				small: { key: "photo-005-small.jpg" },
			},
		});

		const outputDir = path.join(tmpDir, "export-out");
		await exportCommand(forja.getAdapter(), {
			includeFiles: true,
			forja,
			output: outputDir,
		});

		const ledger = await fs.readFile(
			path.join(outputDir, "files-progress.txt"),
			"utf-8",
		);
		const lines = ledger.split("\n").filter((l) => l.trim() !== "");

		// 1 main + 2 variants = 3 lines
		expect(lines.length).toBe(3);

		const ids = lines.map((l) => l.split(" ")[0]);
		expect(ids).toContain(String(id));
		expect(ids).toContain(`${id}__thumbnail`);
		expect(ids).toContain(`${id}__small`);
	});

	it("should download files into files/ directory", async () => {
		await seedMediaRecord(forja, uploadDir, {
			key: "photo-006.jpg",
			content: "real-image-bytes",
		});

		const outputDir = path.join(tmpDir, "export-out");
		await exportCommand(forja.getAdapter(), {
			includeFiles: true,
			forja,
			output: outputDir,
		});

		const downloadedPath = path.join(outputDir, "files", "photo-006.jpg");
		expect(fsSync.existsSync(downloadedPath)).toBe(true);

		const content = await fs.readFile(downloadedPath, "utf-8");
		expect(content).toBe("real-image-bytes");
	});

	it("should also create export.zip alongside files/", async () => {
		await seedMediaRecord(forja, uploadDir, { key: "photo-007.jpg" });

		const outputDir = path.join(tmpDir, "export-out");
		await exportCommand(forja.getAdapter(), {
			includeFiles: true,
			forja,
			output: outputDir,
		});

		expect(fsSync.existsSync(path.join(outputDir, "export.zip"))).toBe(true);
	});
});

// ============================================================================

describe("export --include-files --resume", () => {
	it("should skip already-done entries and only download pending ones", async () => {
		const upload = forja.getPlugin<IApiPlugin>("api")!.upload!;

		const outputDir = path.join(tmpDir, "export-out");
		await fs.mkdir(path.join(outputDir, "files"), { recursive: true });

		// Write a ledger with one done and one pending entry
		await fs.writeFile(
			path.join(outputDir, "files-progress.txt"),
			"1 already-done.jpg done\n2 needs-download.jpg pending\n",
			"utf-8",
		);

		// Only the pending file needs to exist on the server
		await fs.writeFile(
			path.join(uploadDir, "needs-download.jpg"),
			"pending-content",
			"utf-8",
		);

		const exporter = new FileExporter(outputDir, upload);
		await exporter.downloadPending();

		// pending file downloaded
		expect(
			fsSync.existsSync(path.join(outputDir, "files", "needs-download.jpg")),
		).toBe(true);

		// done file was NOT re-downloaded
		expect(
			fsSync.existsSync(path.join(outputDir, "files", "already-done.jpg")),
		).toBe(false);

		// ledger updated
		const ledger = await fs.readFile(
			path.join(outputDir, "files-progress.txt"),
			"utf-8",
		);
		expect(ledger).toContain("needs-download.jpg done");
	});

	it("should fail with error if resume dir has no ledger", async () => {
		await expect(
			exportCommand(forja.getAdapter(), {
				includeFiles: true,
				forja,
				resume: path.join(tmpDir, "nonexistent-dir"),
			}),
		).rejects.toThrow("files-progress.txt");
	});
});

// ============================================================================

describe("export --include-files --pack-files", () => {
	it("should pack downloaded files into a zip chunk", async () => {
		await seedMediaRecord(forja, uploadDir, {
			key: "pack-001.jpg",
			content: "bytes-a",
		});
		await seedMediaRecord(forja, uploadDir, {
			key: "pack-002.jpg",
			content: "bytes-b",
		});

		const outputDir = path.join(tmpDir, "export-out");
		await exportCommand(forja.getAdapter(), {
			includeFiles: true,
			packFiles: true,
			forja,
			output: outputDir,
		});

		const filesDir = path.join(outputDir, "files");
		const dirEntries = await fs.readdir(filesDir);

		// Original files should be gone, chunk zip should exist
		expect(dirEntries).not.toContain("pack-001.jpg");
		expect(dirEntries).not.toContain("pack-002.jpg");
		expect(
			dirEntries.some((f) => f.startsWith("chunk_") && f.endsWith(".zip")),
		).toBe(true);
	});

	it("should include original files inside the chunk zip", async () => {
		await seedMediaRecord(forja, uploadDir, {
			key: "pack-003.jpg",
			content: "zip-me",
		});

		const outputDir = path.join(tmpDir, "export-out");
		await exportCommand(forja.getAdapter(), {
			includeFiles: true,
			packFiles: true,
			forja,
			output: outputDir,
		});

		const filesDir = path.join(outputDir, "files");
		const chunkPath = path.join(filesDir, "chunk_0.zip");

		expect(fsSync.existsSync(chunkPath)).toBe(true);

		const zip = new AdmZip(chunkPath);
		const entries = zip.getEntries().map((e) => e.entryName);
		expect(entries).toContain("pack-003.jpg");
	});

	it("should split into multiple chunks when total size exceeds chunk limit", async () => {
		// Seed 3 files with 6 bytes each, chunk limit = 10 bytes → 2 chunks
		await seedMediaRecord(forja, uploadDir, {
			key: "big-a.jpg",
			content: "aaaaaa",
		});
		await seedMediaRecord(forja, uploadDir, {
			key: "big-b.jpg",
			content: "bbbbbb",
		});
		await seedMediaRecord(forja, uploadDir, {
			key: "big-c.jpg",
			content: "cccccc",
		});

		const outputDir = path.join(tmpDir, "export-out");
		await exportCommand(forja.getAdapter(), {
			includeFiles: true,
			packFiles: true,
			packFilesChunkSize: 10,
			forja,
			output: outputDir,
		});

		const filesDir = path.join(outputDir, "files");
		const chunks = (await fs.readdir(filesDir)).filter((f) =>
			f.startsWith("chunk_"),
		);
		expect(chunks.length).toBeGreaterThanOrEqual(2);
	});
});

// ============================================================================

describe("import --with-files", () => {
	it("should fail if upload plugin is not configured", async () => {
		await expect(
			importCommand(forja.getAdapter(), path.join(tmpDir, "export-out"), {
				withFiles: true,
				agree: true,
			}),
		).rejects.toThrow("api-upload plugin");
	});

	it("should fail if files/ directory does not exist", async () => {
		const exportDir = path.join(tmpDir, "export-out");
		await fs.mkdir(exportDir, { recursive: true });
		await fs.writeFile(path.join(exportDir, "export.zip"), "fake", "utf-8");

		await expect(
			importCommand(forja.getAdapter(), exportDir, {
				withFiles: true,
				agree: true,
				forja,
			}),
		).rejects.toThrow("No files/ directory found");
	});

	it("should upload files to storage and mark ledger as done", async () => {
		await seedMediaRecord(forja, uploadDir, {
			key: "import-001.jpg",
			content: "hello-import",
		});

		const exportDir = path.join(tmpDir, "export-out");
		await exportCommand(forja.getAdapter(), {
			includeFiles: true,
			forja,
			output: exportDir,
		});

		// Clear storage — simulate moving to a new server
		await fs.rm(uploadDir, { recursive: true, force: true });
		await fs.mkdir(uploadDir, { recursive: true });

		await importCommand(forja.getAdapter(), exportDir, {
			withFiles: true,
			agree: true,
			forja,
		});

		// File should be back in storage
		const storageFiles = await fs.readdir(uploadDir);
		expect(storageFiles.length).toBeGreaterThan(0);

		// import-progress.txt should have all entries as done
		const ledger = await fs.readFile(
			path.join(exportDir, "import-progress.txt"),
			"utf-8",
		);
		const lines = ledger.split("\n").filter((l) => l.trim() !== "");
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) {
			expect(line.endsWith("done")).toBe(true);
		}
	});

	it("should update DB record key after upload", async () => {
		await seedMediaRecord(forja, uploadDir, {
			key: "import-002.jpg",
			content: "update-my-key",
		});

		const exportDir = path.join(tmpDir, "export-out");
		await exportCommand(forja.getAdapter(), {
			includeFiles: true,
			forja,
			output: exportDir,
		});

		// Clear storage
		await fs.rm(uploadDir, { recursive: true, force: true });
		await fs.mkdir(uploadDir, { recursive: true });

		await importCommand(forja.getAdapter(), exportDir, {
			withFiles: true,
			agree: true,
			forja,
		});

		// DB record key should now point to the newly uploaded file
		const records = await forja.raw.findMany("media");
		expect(records.length).toBe(1);
		const newKey = records[0]!["key"] as string;
		// New key should exist in storage
		expect(fsSync.existsSync(path.join(uploadDir, newKey))).toBe(true);
	});

	it("should update variant keys in DB after upload", async () => {
		await seedMediaRecord(forja, uploadDir, {
			key: "import-003.jpg",
			content: "main-file",
			variants: {
				thumbnail: { key: "import-003-thumb.jpg" },
			},
		});

		const exportDir = path.join(tmpDir, "export-out");
		await exportCommand(forja.getAdapter(), {
			includeFiles: true,
			forja,
			output: exportDir,
		});

		// Clear storage
		await fs.rm(uploadDir, { recursive: true, force: true });
		await fs.mkdir(uploadDir, { recursive: true });

		await importCommand(forja.getAdapter(), exportDir, {
			withFiles: true,
			agree: true,
			forja,
		});

		const records = await forja.raw.findMany("media");
		expect(records.length).toBe(1);
		const variants = records[0]!["variants"] as Record<
			string,
			{ key: string }
		> | null;
		expect(variants).not.toBeNull();
		// Variant key should exist in storage
		expect(
			fsSync.existsSync(path.join(uploadDir, variants!["thumbnail"]!.key)),
		).toBe(true);
	});

	it("should skip missing files and mark them as skipped in ledger", async () => {
		await seedMediaRecord(forja, uploadDir, {
			key: "import-004.jpg",
			content: "present",
		});
		await seedMediaRecord(forja, uploadDir, {
			key: "import-005.jpg",
			content: "also-present",
		});

		const exportDir = path.join(tmpDir, "export-out");
		await exportCommand(forja.getAdapter(), {
			includeFiles: true,
			forja,
			output: exportDir,
		});

		// Remove one file from export dir to simulate missing source
		await fs.unlink(path.join(exportDir, "files", "import-005.jpg"));

		// Clear storage
		await fs.rm(uploadDir, { recursive: true, force: true });
		await fs.mkdir(uploadDir, { recursive: true });

		await importCommand(forja.getAdapter(), exportDir, {
			withFiles: true,
			agree: true,
			forja,
		});

		const ledger = await fs.readFile(
			path.join(exportDir, "import-progress.txt"),
			"utf-8",
		);
		expect(ledger).toContain("import-004.jpg done");
		expect(ledger).toContain("import-005.jpg skipped");
	});

	it("should skip re-upload if file already exists in storage", async () => {
		await seedMediaRecord(forja, uploadDir, {
			key: "import-006.jpg",
			content: "already-there",
		});

		const exportDir = path.join(tmpDir, "export-out");
		await exportCommand(forja.getAdapter(), {
			includeFiles: true,
			forja,
			output: exportDir,
		});

		// Clear storage except keep the original file to trigger exists check
		const filesToDelete = (await fs.readdir(uploadDir)).filter(
			(f) => f !== "import-006.jpg",
		);
		for (const f of filesToDelete) {
			await fs.unlink(path.join(uploadDir, f));
		}

		const upload = forja.getPlugin<IApiPlugin>("api")!.upload!;
		const uploadSpy = vi.spyOn(upload.provider, "upload");

		await importCommand(forja.getAdapter(), exportDir, {
			withFiles: true,
			agree: true,
			forja,
		});

		expect(uploadSpy).not.toHaveBeenCalled();
		uploadSpy.mockRestore();
	});
});

// ============================================================================

describe("import --only-files", () => {
	it("should upload files without re-importing DB data", async () => {
		await seedMediaRecord(forja, uploadDir, {
			key: "only-001.jpg",
			content: "only-files-content",
		});

		const exportDir = path.join(tmpDir, "export-out");
		await exportCommand(forja.getAdapter(), {
			includeFiles: true,
			forja,
			output: exportDir,
		});

		// Clear storage — DB stays intact
		await fs.rm(uploadDir, { recursive: true, force: true });
		await fs.mkdir(uploadDir, { recursive: true });

		const recordsBefore = await forja.raw.findMany("media");
		expect(recordsBefore.length).toBe(1);

		await importCommand(forja.getAdapter(), exportDir, {
			onlyFiles: true,
			agree: true,
			forja,
		});

		// File should be back in storage
		const storageFiles = await fs.readdir(uploadDir);
		expect(storageFiles.length).toBeGreaterThan(0);

		// DB record count unchanged
		const recordsAfter = await forja.raw.findMany("media");
		expect(recordsAfter.length).toBe(1);
	});
});

// ============================================================================

describe("import --with-files --resume", () => {
	it("should fail if resume dir has no import ledger", async () => {
		await expect(
			importCommand(forja.getAdapter(), path.join(tmpDir, "export-out"), {
				withFiles: true,
				agree: true,
				resume: path.join(tmpDir, "nonexistent-dir"),
				forja,
			}),
		).rejects.toThrow("No import-progress.txt found");
	});

	it("should skip already-done entries on resume", async () => {
		await seedMediaRecord(forja, uploadDir, {
			key: "resume-001.jpg",
			content: "resume-a",
		});
		await seedMediaRecord(forja, uploadDir, {
			key: "resume-002.jpg",
			content: "resume-b",
		});

		const exportDir = path.join(tmpDir, "export-out");
		await exportCommand(forja.getAdapter(), {
			includeFiles: true,
			forja,
			output: exportDir,
		});

		// Clear storage
		await fs.rm(uploadDir, { recursive: true, force: true });
		await fs.mkdir(uploadDir, { recursive: true });

		// Build partial import ledger — first entry done, second pending
		const exportLedger = await fs.readFile(
			path.join(exportDir, "files-progress.txt"),
			"utf-8",
		);
		const exportLines = exportLedger.split("\n").filter((l) => l.trim() !== "");
		const [id0, key0] = exportLines[0]!.split(" ");
		const [id1, key1] = exportLines[1]!.split(" ");
		await fs.writeFile(
			path.join(exportDir, "import-progress.txt"),
			`${id0} ${key0} done\n${id1} ${key1} pending\n`,
			"utf-8",
		);

		const upload = forja.getPlugin<IApiPlugin>("api")!.upload!;
		const uploadSpy = vi.spyOn(upload.provider, "upload");

		await importCommand(forja.getAdapter(), exportDir, {
			withFiles: true,
			agree: true,
			resume: exportDir,
			forja,
		});

		// Only the pending entry should have been uploaded
		expect(uploadSpy).toHaveBeenCalledTimes(1);
		uploadSpy.mockRestore();
	});
});

// ============================================================================

describe("import --with-files + packed export", () => {
	it("should extract chunk zips and upload files", async () => {
		await seedMediaRecord(forja, uploadDir, {
			key: "packed-001.jpg",
			content: "packed-content-a",
		});
		await seedMediaRecord(forja, uploadDir, {
			key: "packed-002.jpg",
			content: "packed-content-b",
		});

		const exportDir = path.join(tmpDir, "export-out");
		await exportCommand(forja.getAdapter(), {
			includeFiles: true,
			packFiles: true,
			forja,
			output: exportDir,
		});

		// Verify files are packed
		const filesBeforeImport = await fs.readdir(path.join(exportDir, "files"));
		expect(filesBeforeImport.every((f) => f.startsWith("chunk_"))).toBe(true);

		// Clear storage
		await fs.rm(uploadDir, { recursive: true, force: true });
		await fs.mkdir(uploadDir, { recursive: true });

		await importCommand(forja.getAdapter(), exportDir, {
			withFiles: true,
			agree: true,
			forja,
		});

		// Both files should be back in storage
		const storageFiles = await fs.readdir(uploadDir);
		expect(storageFiles.length).toBe(2);
	});
});
