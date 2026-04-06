/**
 * Upload Basic Tests
 *
 * POST /api/upload — basic upload flow, validation errors.
 * Tests the full path: ApiPlugin.handleRequest → Upload.handleRequest → handler → provider → DB.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "@forja/core";
import fs from "node:fs/promises";
import path from "node:path";
import {
	expectApiSingle,
	expectApiError,
} from "@forja/core/types/test/helpers";
import type { MediaEntry } from "@forja/core/types/api";
import { createUploadTestConfig } from "./data/config";
import {
	createCheckerboardPng,
	createImageFormData,
	createUploadRequest,
} from "./data/image-helper";

describe("Upload Basic Tests", () => {
	let forja: Forja;
	const tmpDir = path.join(
		process.cwd(),
		"packages",
		"api-upload",
		"tests",
		".tmp-upload-basic",
	);

	async function handleRequest(request: Request): Promise<Response> {
		const apiPlugin = forja.getPlugin("api");
		if (!apiPlugin || !("handleRequest" in apiPlugin)) {
			throw new Error("API plugin not found");
		}
		const response = await (
			apiPlugin as {
				handleRequest: (req: Request, forja: Forja) => Promise<Response>;
			}
		).handleRequest(request, forja);
		return response;
	}

	beforeAll(async () => {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
		await fs.mkdir(tmpDir, { recursive: true });

		const getForja = await createUploadTestConfig(tmpDir, { format: "webp" });
		forja = await getForja();

		const adapter = forja.getAdapter();
		for (const schema of forja.getSchemas().getAll()) {
			try {
				await adapter.dropTable(schema.tableName!);
			} catch {
				// ignore
			}
			await adapter.createTable(schema);
		}
	});

	afterAll(async () => {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	// ============================================================
	// HAPPY PATH
	// ============================================================

	describe("POST /api/upload — success", () => {
		it("should upload a PNG image and return a media record", async () => {
			const buffer = await createCheckerboardPng(200, 200);
			const form = createImageFormData(buffer, "test.png");
			const request = createUploadRequest("/api/upload", form);

			const response = await handleRequest(request);

			const data = await expectApiSingle<MediaEntry>(response, 201);
			expect(data.url).toMatch(/^http:\/\/localhost:3000\/uploads\//);
			expect(data.mimeType).toBe("image/webp");
			expect(data.originalName).toBe("test.png");
			expect(data.size).toBeGreaterThan(0);
			expect(data.key).toBeDefined();
			expect(data.key).not.toBe("");
		});

		it("should store the uploaded file on disk", async () => {
			const buffer = await createCheckerboardPng(100, 100);
			const form = createImageFormData(buffer, "disk-check.png");
			const request = createUploadRequest("/api/upload", form);

			const response = await handleRequest(request);
			const data = await expectApiSingle<MediaEntry>(response, 201);

			const uploadDir = path.join(tmpDir, "uploads");
			const filePath = path.join(uploadDir, data.key as string);
			const stat = await fs.stat(filePath);
			expect(stat.isFile()).toBe(true);
			expect(stat.size).toBeGreaterThan(0);
		});

		it("should preserve originalName but generate a unique key", async () => {
			const buffer = await createCheckerboardPng(50, 50);
			const form = createImageFormData(buffer, "my photo.png");
			const request = createUploadRequest("/api/upload", form);

			const response = await handleRequest(request);
			const data = await expectApiSingle<MediaEntry>(response, 201);

			expect(data.originalName).toBe("my photo.png");
			// key is sanitized and timestamped, never equals original
			expect(data.key).not.toBe("my photo.png");
		});

		it("should return variants as null when resolutions are not configured", async () => {
			const buffer = await createCheckerboardPng(80, 80);
			const form = createImageFormData(buffer, "no-variants.png");
			const request = createUploadRequest("/api/upload", form);

			const response = await handleRequest(request);
			const data = await expectApiSingle<MediaEntry>(response, 201);

			expect(data.variants).toBeNull();
		});
	});

	// ============================================================
	// VALIDATION ERRORS
	// ============================================================

	describe("POST /api/upload — validation errors", () => {
		it("should return 400 when content-type is not multipart/form-data", async () => {
			const request = new Request("http://localhost:3000/api/upload", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ file: "not-a-file" }),
			});

			const response = await handleRequest(request);
			await expectApiError(response, 400);
		});

		it("should return 400 when no file field in form data", async () => {
			const form = new FormData();
			form.append("other", "value");
			const request = createUploadRequest("/api/upload", form);

			const response = await handleRequest(request);
			const error = await expectApiError(response, 400);
			expect(error.code).toBe("INVALID_BODY");
		});
	});

	// ============================================================
	// maxSize LIMIT
	// Default config has maxSize: 1MB — upload a >1MB image to trigger the limit
	// ============================================================

	describe("POST /api/upload — maxSize limit", () => {
		it("should return 400 when file exceeds maxSize", async () => {
			// Send a raw 2MB buffer as PNG — maxSize is 1MB so this must be rejected
			const buffer = Buffer.alloc(2 * 1024 * 1024, 0xff);
			const form = createImageFormData(buffer, "big.png", "image/png");
			const request = createUploadRequest("/api/upload", form);

			const response = await handleRequest(request);
			const error = await expectApiError(response, 400);
			expect(error.code).toBe("FILE_TOO_LARGE");
		});
	});

	// ============================================================
	// allowedMimeTypes
	// Default config has allowedMimeTypes: ["image/*"] — send an unsupported type
	// ============================================================

	describe("POST /api/upload — allowedMimeTypes", () => {
		it("should return 400 when MIME type is not allowed", async () => {
			const buffer = await createCheckerboardPng(64, 64);
			const form = createImageFormData(
				buffer,
				"test.bin",
				"application/octet-stream",
			);
			const request = createUploadRequest("/api/upload", form);

			const response = await handleRequest(request);
			const error = await expectApiError(response, 400);
			expect(error.code).toBe("INVALID_MIME_TYPE");
		});

		it("should accept file when MIME type matches wildcard", async () => {
			const buffer = await createCheckerboardPng(64, 64);
			const form = createImageFormData(buffer, "test.png", "image/png");
			const request = createUploadRequest("/api/upload", form);

			const response = await handleRequest(request);
			await expectApiSingle<MediaEntry>(response, 201);
		});
	});
});
