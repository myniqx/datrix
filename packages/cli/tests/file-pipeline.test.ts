/**
 * Media File Export/Import Pipeline Tests (issues 3.1–3.14)
 *
 * Regression tests that trigger the original bugs:
 * - 3.1  keys sharing a basename must not collide locally
 * - 3.2  ledger keys containing spaces must survive parsing
 * - 3.3  resumed --pack-files must not truncate existing chunks
 * - 3.5  Spinner.start() must not leak intervals; update() swaps message
 * - 3.6  ledger status updates are appended as journal lines
 * - 3.7  resumed uploads must not re-count previous uploads
 * - 3.8  missing/restricted export entries produce a warning
 * - 3.9  missing media schema fails with a clear error
 * - 3.10 --output .zip suffix is stripped with --include-files
 * - 3.12 downloads go through .part files; stray .part files are removed
 * - 3.13 confirm() resolves to the default on non-TTY stdin
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import AdmZip from "adm-zip";
import type { IUpload, IDatrix, DatabaseAdapter } from "@datrix/core";
import { Ledger } from "../src/export-import/ledger";
import { keyToFileName, findLocalFile } from "../src/export-import/file-naming";
import { FileExporter } from "../src/export-import/file-exporter";
import { FileImporter } from "../src/export-import/file-importer";
import { exportCommand } from "../src/commands/export";
import { confirm } from "../src/utils/prompt";
import { logger, Spinner } from "../src/utils/logger";

let workDir: string;

beforeEach(async () => {
	workDir = await fs.mkdtemp(path.join(os.tmpdir(), "datrix-files-"));
});

afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	await fs.rm(workDir, { recursive: true, force: true });
});

function fakeUpload(overrides: Partial<Record<string, unknown>> = {}): IUpload {
	return {
		getUrl: (key: string) => `http://files.test/${key}`,
		getModelName: () => "media",
		provider: {
			exists: vi.fn().mockResolvedValue(true),
			upload: vi.fn(),
		},
		...overrides,
	} as unknown as IUpload;
}

function fakeDatrix(): IDatrix {
	return {
		raw: {
			update: vi.fn().mockResolvedValue({}),
			findById: vi.fn().mockResolvedValue(null),
		},
	} as unknown as IDatrix;
}

function stubFetch(): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(async (url: string) => ({
		ok: true,
		status: 200,
		arrayBuffer: async () =>
			new TextEncoder().encode(`content of ${url}`).buffer,
	}));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

describe("3.1 — same-basename keys never collide", () => {
	it("keyToFileName maps distinct keys to distinct names", () => {
		expect(keyToFileName("a/1.jpg")).not.toBe(keyToFileName("b/1.jpg"));
		expect(keyToFileName("a/1.jpg")).toBe("a__1.jpg");
		expect(keyToFileName("a\\1.jpg")).toBe("a__1.jpg".replace("a__", "a__"));
	});

	it("downloads both a/1.jpg and b/1.jpg without overwriting", async () => {
		stubFetch();
		const exporter = new FileExporter(workDir, fakeUpload());
		await exporter.init();
		await exporter.appendToLedger([
			{ id: 1, key: "a/1.jpg" },
			{ id: 2, key: "b/1.jpg" },
		]);

		await exporter.downloadPending();

		const filesDir = path.join(workDir, "files");
		const fileA = await fs.readFile(path.join(filesDir, "a__1.jpg"), "utf-8");
		const fileB = await fs.readFile(path.join(filesDir, "b__1.jpg"), "utf-8");

		expect(fileA).toContain("a/1.jpg");
		expect(fileB).toContain("b/1.jpg");
	});

	it("findLocalFile falls back to basename for old exports", async () => {
		const filesDir = path.join(workDir, "files");
		await fs.mkdir(filesDir, { recursive: true });
		// Old export stored under basename only
		await fs.writeFile(path.join(filesDir, "1.jpg"), "legacy", "utf-8");

		expect(findLocalFile(filesDir, "a/1.jpg")).toBe(
			path.join(filesDir, "1.jpg"),
		);

		// Sanitized name wins when present
		await fs.writeFile(path.join(filesDir, "a__1.jpg"), "new", "utf-8");
		expect(findLocalFile(filesDir, "a/1.jpg")).toBe(
			path.join(filesDir, "a__1.jpg"),
		);

		expect(findLocalFile(filesDir, "missing/nowhere.png")).toBeNull();
	});
});

describe("3.2 / 3.6 — ledger parsing and journal updates", () => {
	it("keys containing spaces survive the round-trip", async () => {
		const ledgerPath = path.join(workDir, "test-ledger.txt");
		const ledger = new Ledger(ledgerPath, ["pending", "done"] as const);

		await ledger.append([
			{ id: "1", key: "my photo album/pic 1.jpg", status: "pending" },
			{ id: "2", key: "plain.jpg", status: "pending" },
		]);

		const entries = await ledger.read();
		expect(entries).toHaveLength(2);
		expect(entries[0]!.key).toBe("my photo album/pic 1.jpg");

		await ledger.markStatus("1", "done");

		// Re-read from disk with a fresh instance
		const reread = new Ledger(ledgerPath, ["pending", "done"] as const);
		const entries2 = await reread.read();
		expect(entries2.find((e) => e.id === "1")!.status).toBe("done");
		expect(entries2.find((e) => e.id === "1")!.key).toBe(
			"my photo album/pic 1.jpg",
		);
	});

	it("markStatus appends a journal line instead of rewriting", async () => {
		const ledgerPath = path.join(workDir, "journal-ledger.txt");
		const ledger = new Ledger(ledgerPath, ["pending", "done"] as const);

		await ledger.append([
			{ id: "1", key: "a.jpg", status: "pending" },
			{ id: "2", key: "b.jpg", status: "pending" },
		]);
		await ledger.markStatus("1", "done");

		const content = await fs.readFile(ledgerPath, "utf-8");
		const lines = content.split("\n").filter((l) => l.trim() !== "");
		expect(lines).toEqual(["1 a.jpg pending", "2 b.jpg pending", "1 done"]);
	});

	it("parses old-format ledgers written by previous versions", async () => {
		const ledgerPath = path.join(workDir, "old-ledger.txt");
		await fs.writeFile(
			ledgerPath,
			"42 1710000000-abc.jpg done\n42__thumbnail 1710000000-abc_thumb.jpg pending\n",
			"utf-8",
		);

		const ledger = new Ledger(ledgerPath, ["pending", "done"] as const);
		const entries = await ledger.read();

		expect(entries).toHaveLength(2);
		expect(entries[0]).toEqual({
			id: "42",
			key: "1710000000-abc.jpg",
			status: "done",
		});
	});
});

describe("3.3 — resumed --pack-files keeps existing chunks", () => {
	it("continues chunk numbering after the highest existing index", async () => {
		const exporter = new FileExporter(workDir, fakeUpload());
		await exporter.init();

		const filesDir = path.join(workDir, "files");

		// Previous run: an existing packed chunk
		const oldZip = new AdmZip();
		oldZip.addFile("old.bin", Buffer.from("old data"));
		oldZip.writeZip(path.join(filesDir, "chunk_0.zip"));
		const originalChunk = await fs.readFile(path.join(filesDir, "chunk_0.zip"));

		// This run: a new loose file to pack (ledger has no pending entries)
		await fs.writeFile(path.join(filesDir, "new.bin"), "new data", "utf-8");

		await exporter.downloadPending(undefined, true);

		const afterChunk0 = await fs.readFile(path.join(filesDir, "chunk_0.zip"));
		expect(afterChunk0.equals(originalChunk)).toBe(true);
		expect(fsSync.existsSync(path.join(filesDir, "chunk_1.zip"))).toBe(true);
	});
});

describe("3.5 — Spinner interval lifecycle", () => {
	it("start() twice keeps a single interval; update() swaps the message", () => {
		vi.useFakeTimers();
		const writes: string[] = [];
		const writeSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk: unknown) => {
				writes.push(String(chunk));
				return true;
			});

		const s = new Spinner();
		s.start("first");
		s.start("second");

		vi.advanceTimersByTime(80);
		const frameWrites = writes.filter((w) => w.includes("second"));
		expect(frameWrites).toHaveLength(1);
		expect(
			writes.some((w) => w.includes("first") && !w.includes("second")),
		).toBe(false);

		s.update("third");
		vi.advanceTimersByTime(80);
		expect(writes.some((w) => w.includes("third"))).toBe(true);

		s.succeed("done");
		writeSpy.mockRestore();
		vi.useRealTimers();
	});
});

describe("3.7 — resumed uploads count only this run", () => {
	it("does not report previous uploads as new", async () => {
		const filesDir = path.join(workDir, "files");
		await fs.mkdir(filesDir, { recursive: true });
		await fs.writeFile(path.join(filesDir, "b.jpg"), "b", "utf-8");
		await fs.writeFile(path.join(filesDir, "c.jpg"), "c", "utf-8");

		// Ledger from a previous run: one already done, two pending
		await fs.writeFile(
			path.join(workDir, "import-progress.txt"),
			"1 a.jpg done\n2 b.jpg pending\n3 c.jpg pending\n",
			"utf-8",
		);

		const importer = new FileImporter(workDir, fakeUpload(), fakeDatrix());
		const result = await importer.uploadPending();

		expect(result.uploaded).toBe(2);
		expect(result.skipped).toBe(0);
	});

	it("counts skipped files separately", async () => {
		const filesDir = path.join(workDir, "files");
		await fs.mkdir(filesDir, { recursive: true });
		await fs.writeFile(path.join(filesDir, "b.jpg"), "b", "utf-8");

		await fs.writeFile(
			path.join(workDir, "import-progress.txt"),
			"1 missing.jpg pending\n2 b.jpg pending\n",
			"utf-8",
		);

		const importer = new FileImporter(workDir, fakeUpload(), fakeDatrix());
		const result = await importer.uploadPending();

		expect(result.uploaded).toBe(1);
		expect(result.skipped).toBe(1);
	});
});

describe("3.8 — missing/restricted export entries are reported", () => {
	it("warns about entries that cannot be uploaded", async () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

		const importer = new FileImporter(workDir, fakeUpload(), fakeDatrix());
		await importer.buildLedger([
			{ id: "1", key: "ok.jpg", status: "done" },
			{ id: "2", key: "gone.jpg", status: "missing" },
			{ id: "3", key: "secret.jpg", status: "restricted" },
		]);

		expect(warnSpy).toHaveBeenCalledOnce();
		expect(String(warnSpy.mock.calls[0]![0])).toContain("2 file(s)");

		const entries = await importer.readLedger();
		expect(entries).toHaveLength(1);
		expect(entries[0]!.id).toBe("1");
	});
});

describe("3.9 / 3.10 — export command guards", () => {
	function exportMocks(schema: unknown): {
		datrix: IDatrix;
		adapter: DatabaseAdapter;
	} {
		const datrix = {
			getPlugin: () => ({ upload: fakeUpload() }),
			getSchema: () => schema,
		} as unknown as IDatrix;
		const adapter = {
			exportData: vi.fn().mockResolvedValue(undefined),
		} as unknown as DatabaseAdapter;
		return { datrix, adapter };
	}

	it("fails with a clear error when the media schema is missing", async () => {
		const { datrix, adapter } = exportMocks(undefined);

		await expect(
			exportCommand(adapter, { includeFiles: true, datrix }),
		).rejects.toThrow(/media model 'media' is not registered/);
	});

	it("strips a .zip suffix from --output with --include-files", async () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		const { datrix, adapter } = exportMocks({ tableName: "media" });
		const output = path.join(workDir, "backup.zip");

		await exportCommand(adapter, { includeFiles: true, datrix, output });

		expect(warnSpy).toHaveBeenCalled();
		const strippedDir = path.join(workDir, "backup");
		expect(fsSync.existsSync(strippedDir)).toBe(true);
		expect(fsSync.existsSync(output)).toBe(false);
	});
});

describe("3.12 — partial downloads never look complete", () => {
	it("stray .part files are removed before resuming", async () => {
		stubFetch();
		const exporter = new FileExporter(workDir, fakeUpload());
		await exporter.init();

		const filesDir = path.join(workDir, "files");
		await fs.writeFile(path.join(filesDir, "x.jpg.part"), "truncated", "utf-8");

		await exporter.downloadPending();

		expect(fsSync.existsSync(path.join(filesDir, "x.jpg.part"))).toBe(false);
	});

	it("completed downloads leave no .part files behind", async () => {
		stubFetch();
		const exporter = new FileExporter(workDir, fakeUpload());
		await exporter.init();
		await exporter.appendToLedger([{ id: 1, key: "photo.jpg" }]);

		await exporter.downloadPending();

		const filesDir = path.join(workDir, "files");
		const files = await fs.readdir(filesDir);
		expect(files).toContain("photo.jpg");
		expect(files.filter((f) => f.endsWith(".part"))).toEqual([]);
	});
});

describe("3.13 — confirm() on non-TTY stdin", () => {
	it("resolves to the default immediately", async () => {
		// vitest runs with non-TTY stdin — this would hang before the guard
		await expect(confirm("Continue? (Y/n): ", true)).resolves.toBe(true);
		await expect(confirm("Continue? (y/N): ", false)).resolves.toBe(false);
	});
});
