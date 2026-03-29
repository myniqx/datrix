/**
     * Export --include-files Tests
     *
     * Tests file export/resume/pack functionality using a real LocalStorageProvider
     * and a lightweight HTTP server that serves the uploaded files.
     *
     * Setup per test:
     *  1. Forja instance with ApiPlugin + Upload (LocalStorageProvider)
     *  2. HTTP server pointing at the same upload directory
     *  3. Seed media records by calling the upload handler
     *  4. Run exportCommand with --include-files
     *  5. Assert files-progress.txt and files/ directory
     */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Forja } from "forja-core";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import http from "node:http";
import path from "node:path";
import { exportCommand } from "../src/commands/export";
import { FileExporter } from "../src/export-import/file-exporter";
import AdmZip from "adm-zip";

// ============================================================================
// Imports using vitest alias paths
// ============================================================================
import { ApiPlugin } from "forja-api";
import { Upload, LocalStorageProvider } from "@forja/api-upload";
import { JsonAdapter } from "../../adapter-json/src/index";
import type { ForjaConfig } from "forja-types";
import { defineConfig } from "forja-core";
import { IApiPlugin } from "forja-types/api";

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
      const key = decodeURIComponent((req.url ?? "").replace(/^\/uploads\//, ""));
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
  return forja
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
  tmpDir = getTmpDir(`test-${Date.now()}`);
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
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => { throw new Error("process.exit called") as never });

    try {
      await exportCommand(forja.getAdapter(), {
        includeFiles: true,
        upload: undefined!,
        output: path.join(tmpDir, "out"),
      });
    } catch {
      // ignore error thrown from exportCommand since it calls process.exit
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("should create files-progress.txt and files/ directory after export", async () => {
    const api = forja.getPlugin<IApiPlugin>("api");
    const upload = api!.upload!;

    await seedMediaRecord(forja, uploadDir, { key: "photo-001.jpg" });

    const outputDir = path.join(tmpDir, "export-out");
    await exportCommand(forja.getAdapter(), {
      includeFiles: true,
      upload,
      output: outputDir,
    });

    const ledgerPath = path.join(outputDir, "files-progress.txt");
    const filesDir = path.join(outputDir, "files");

    expect(fsSync.existsSync(ledgerPath)).toBe(true);
    expect(fsSync.existsSync(filesDir)).toBe(true);
  });

  it("should mark all entries as done in the ledger", async () => {
    const upload = forja.getPlugin<IApiPlugin>("api")!.upload!;

    await seedMediaRecord(forja, uploadDir, { key: "photo-002.jpg" });
    await seedMediaRecord(forja, uploadDir, { key: "photo-003.jpg" });

    const outputDir = path.join(tmpDir, "export-out");
    await exportCommand(forja.getAdapter(), {
      includeFiles: true,
      upload,
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
    const upload = forja.getPlugin<IApiPlugin>("api")!.upload!;

    const id = await seedMediaRecord(forja, uploadDir, { key: "photo-004.jpg" });

    const outputDir = path.join(tmpDir, "export-out");
    await exportCommand(forja.getAdapter(), {
      includeFiles: true,
      upload,
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
    const upload = forja.getPlugin<IApiPlugin>("api")!.upload!;

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
      upload,
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
    const upload = forja.getPlugin<IApiPlugin>("api")!.upload!;

    await seedMediaRecord(forja, uploadDir, {
      key: "photo-006.jpg",
      content: "real-image-bytes",
    });

    const outputDir = path.join(tmpDir, "export-out");
    await exportCommand(forja.getAdapter(), {
      includeFiles: true,
      upload,
      output: outputDir,
    });

    const downloadedPath = path.join(outputDir, "files", "photo-006.jpg");
    expect(fsSync.existsSync(downloadedPath)).toBe(true);

    const content = await fs.readFile(downloadedPath, "utf-8");
    expect(content).toBe("real-image-bytes");
  });

  it("should also create export.zip alongside files/", async () => {
    const upload = forja.getPlugin<IApiPlugin>("api")!.upload!;

    await seedMediaRecord(forja, uploadDir, { key: "photo-007.jpg" });

    const outputDir = path.join(tmpDir, "export-out");
    await exportCommand(forja.getAdapter(), {
      includeFiles: true,
      upload,
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
    const upload = forja.getPlugin<IApiPlugin>("api")!.upload!;

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await exportCommand(forja.getAdapter(), {
      includeFiles: true,
      upload,
      resume: path.join(tmpDir, "nonexistent-dir"),
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

// ============================================================================

describe("export --include-files --pack-files", () => {
  it("should pack downloaded files into a zip chunk", async () => {
    const upload = forja.getPlugin<IApiPlugin>("api")!.upload!;

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
      upload,
      output: outputDir,
    });

    const filesDir = path.join(outputDir, "files");
    const dirEntries = await fs.readdir(filesDir);

    // Original files should be gone, chunk zip should exist
    expect(dirEntries).not.toContain("pack-001.jpg");
    expect(dirEntries).not.toContain("pack-002.jpg");
    expect(dirEntries.some((f) => f.startsWith("chunk_") && f.endsWith(".zip"))).toBe(true);
  });

  it("should include original files inside the chunk zip", async () => {
    const upload = forja.getPlugin<IApiPlugin>("api")!.upload!;

    await seedMediaRecord(forja, uploadDir, {
      key: "pack-003.jpg",
      content: "zip-me",
    });

    const outputDir = path.join(tmpDir, "export-out");
    await exportCommand(forja.getAdapter(), {
      includeFiles: true,
      packFiles: true,
      upload,
      output: outputDir,
    });

    const filesDir = path.join(outputDir, "files");
    const chunkPath = path.join(filesDir, "chunk_0.zip");

    expect(fsSync.existsSync(chunkPath)).toBe(true);

    const zip = new AdmZip(chunkPath);
    const entries = zip.getEntries().map((e) => e.entryName);
    expect(entries).toContain("pack-003.jpg");
  });

  it("should split into multiple chunks when total size exceeds 1GB", async () => {
    const upload = forja.getPlugin<IApiPlugin>("api")!.upload!;

    const outputDir = path.join(tmpDir, "export-out");
    await fs.mkdir(path.join(outputDir, "files"), { recursive: true });

    // Write three fake files totalling > 1GB by mocking fs.stat
    const GB = 1024 * 1024 * 1024;
    const fakeFiles = ["big-a.jpg", "big-b.jpg", "big-c.jpg"];
    for (const f of fakeFiles) {
      await fs.writeFile(path.join(outputDir, "files", f), "x", "utf-8");
    }

    // Patch fs.stat to report 600MB per file
    const originalStat = fs.stat.bind(fs);
    vi.spyOn(fs, "stat").mockImplementation(async (p) => {
      const str = String(p);
      if (fakeFiles.some((f) => str.endsWith(f))) {
        return { size: Math.round(GB * 0.6) } as Awaited<ReturnType<typeof fs.stat>>;
      }
      return originalStat(p);
    });

    const exporter = new FileExporter(outputDir, upload);
    // Access private method via any cast for testing
    await (exporter as unknown as { packIntoZipChunks(): Promise<void> }).packIntoZipChunks?.()
      ?? (exporter as unknown as Record<string, () => Promise<void>>)["packIntoZipChunks"]?.();

    vi.restoreAllMocks();

    const filesDir = path.join(outputDir, "files");
    const chunks = (await fs.readdir(filesDir)).filter((f) => f.startsWith("chunk_"));
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });
});
