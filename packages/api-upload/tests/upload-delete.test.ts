/**
 * Upload Delete Tests
 *
 * DELETE /api/upload/:id
 *
 * Tests:
 *   - Delete a record with variants → all variant files + main file removed, DB record deleted
 *   - Deleted record no longer accessible via GET
 *   - Delete non-existent id → 404
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import fs from "node:fs/promises";
import path from "node:path";
import { expectApiSingle, expectApiError } from "forja-types/test/helpers";
import type { MediaEntry, MediaVariant } from "forja-types/api";
import { createUploadTestConfig, type TestResolutions } from "./data/config";
import {
	createCheckerboardPng,
	createImageFormData,
	createUploadRequest,
	createDeleteRequest,
	createGetRequest,
} from "./data/image-helper";

describe("Upload Delete Tests", () => {
	let forja: Forja;
	const tmpDir = path.join(
		process.cwd(),
		"packages",
		"api-upload",
		"tests",
		".tmp-upload-delete",
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

		const getForja = await createUploadTestConfig(tmpDir, {
			format: "webp",
			withResolutions: true,
		});
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
	// DELETE — with variants
	// ============================================================

	describe("DELETE /api/upload/:id — with variants", () => {
		it("should delete main file and all variant files from disk", async () => {
			const buffer = await createCheckerboardPng(800, 600);
			const form = createImageFormData(buffer, "variants-delete.png");
			const uploadResponse = await handleRequest(
				createUploadRequest("/api/upload", form),
			);
			const uploaded = await expectApiSingle<MediaEntry<TestResolutions>>(
				uploadResponse,
				201,
			);

			const id = uploaded.id as number;
			const key = uploaded.key as string;
			const variants = uploaded.variants as Record<
				TestResolutions,
				MediaVariant
			>;
			const uploadDir = path.join(tmpDir, "uploads");

			const mainPath = path.join(uploadDir, key);
			const variantPaths = Object.values(variants).map((v) => {
				const filename = v.url.split("/").at(-1)!;
				return path.join(uploadDir, filename);
			});

			// Confirm all files exist before delete
			await expect(fs.access(mainPath)).resolves.toBeUndefined();
			for (const vPath of variantPaths) {
				await expect(fs.access(vPath)).resolves.toBeUndefined();
			}

			// Delete
			const deleteResponse = await handleRequest(
				createDeleteRequest(`/api/upload/${id}`),
			);
			const deleteData = await expectApiSingle(
				deleteResponse,
				200,
			);
			expect(deleteData.id).toBe(id);

			// All files should be gone
			await expect(fs.access(mainPath)).rejects.toThrow();
			for (const vPath of variantPaths) {
				await expect(fs.access(vPath)).rejects.toThrow();
			}
		});

		it("should remove the DB record (GET after DELETE returns 404)", async () => {
			const buffer = await createCheckerboardPng(60, 60);
			const form = createImageFormData(buffer, "db-delete-check.png");
			const uploadResponse = await handleRequest(
				createUploadRequest("/api/upload", form),
			);
			const uploaded = await expectApiSingle<MediaEntry>(uploadResponse, 201);
			const id = uploaded.id as number;

			await handleRequest(createDeleteRequest(`/api/upload/${id}`));

			const getResponse = await handleRequest(
				createGetRequest(`/api/upload/${id}`),
			);
			await expectApiError(getResponse, 404);
		});
	});

	// ============================================================
	// DELETE — not found
	// ============================================================

	describe("DELETE /api/upload/:id — not found", () => {
		it("should return 404 when record does not exist", async () => {
			const response = await handleRequest(
				createDeleteRequest("/api/upload/99999"),
			);
			await expectApiError(response, 404);
		});
	});
});
