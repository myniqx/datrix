/**
 * Upload CRUD / Routing Tests
 *
 * GET /api/upload         — list with pagination (falls through to normal CRUD)
 * GET /api/upload/:id     — single record
 * Method validation       — unsupported methods return method-not-allowed errors
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import fs from "node:fs/promises";
import path from "node:path";
import {
	expectApiSingle,
	expectApiMulti,
	expectApiError,
} from "forja-types/test/helpers";
import type { MediaEntry } from "forja-types/api";
import { createUploadTestConfig } from "./data/config";
import {
	createCheckerboardPng,
	createImageFormData,
	createUploadRequest,
	createGetRequest,
} from "./data/image-helper";

describe("Upload CRUD / Routing Tests", () => {
	let forja: Forja;
	const tmpDir = path.join(
		process.cwd(),
		"packages",
		"api-upload",
		"tests",
		".tmp-upload-crud",
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

	/** Upload a checkerboard image and return the resulting media record */
	async function uploadImage(
		width: number,
		height: number,
		filename = "test.png",
	): Promise<Partial<MediaEntry>> {
		const buffer = await createCheckerboardPng(width, height);
		const form = createImageFormData(buffer, filename);
		const response = await handleRequest(
			createUploadRequest("/api/upload", form),
		);
		return expectApiSingle<MediaEntry>(response, 201);
	}

	beforeAll(async () => {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
		await fs.mkdir(tmpDir, { recursive: true });

		const getForja = await createUploadTestConfig(tmpDir);
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
	// GET /api/upload — list
	// ============================================================

	describe("GET /api/upload — list", () => {
		beforeAll(async () => {
			// Seed three records
			await uploadImage(64, 64, "alpha.png");
			await uploadImage(64, 64, "beta.png");
			await uploadImage(64, 64, "gamma.png");
		});

		it("should return a paginated list of media records", async () => {
			const response = await handleRequest(createGetRequest("/api/upload"));
			const result = await expectApiMulti<MediaEntry>(response, 200);

			expect(result.data.length).toBeGreaterThanOrEqual(3);
			expect(result.meta.total).toBeGreaterThanOrEqual(3);
			expect(result.meta.page).toBe(1);
		});

		it("each record should have expected fields", async () => {
			const response = await handleRequest(createGetRequest("/api/upload"));
			const result = await expectApiMulti<MediaEntry>(response, 200);

			const first = result.data[0];
			expect(first).toBeDefined();
			expect(first!.url).toBeDefined();
			expect(first!.mimeType).toBeDefined();
			expect(first!.size).toBeTypeOf("number");
			expect(first!.originalName).toBeDefined();
		});
	});

	// ============================================================
	// GET /api/upload/:id — single record
	// ============================================================

	describe("GET /api/upload/:id — single", () => {
		it("should return the correct media record by id", async () => {
			const created = await uploadImage(80, 80, "single-get.png");
			const id = created.id as number;

			const response = await handleRequest(
				createGetRequest(`/api/upload/${id}`),
			);
			const data = await expectApiSingle<MediaEntry>(response, 200);

			expect(data.id).toBe(id);
			expect(data.originalName).toBe("single-get.png");
		});

		it("should return 404 for a non-existent id", async () => {
			const response = await handleRequest(
				createGetRequest("/api/upload/99999"),
			);
			await expectApiError(response, 404);
		});
	});

	// ============================================================
	// Method validation
	// ============================================================

	describe("Method validation", () => {
		it("should reject PUT /api/upload/:id", async () => {
			const request = new Request("http://localhost:3000/api/upload/1", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url: "changed" }),
			});
			const response = await handleRequest(request);
			// PUT on upload is not handled — expect error (405 or 404)
			expect(response.status).toBeGreaterThanOrEqual(400);
		});

		it("should reject PATCH /api/upload/:id", async () => {
			const request = new Request("http://localhost:3000/api/upload/1", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url: "changed" }),
			});
			const response = await handleRequest(request);
			expect(response.status).toBeGreaterThanOrEqual(400);
		});

		it("should reject POST /api/upload/:id (POST with id is not valid)", async () => {
			const buffer = await createCheckerboardPng(32, 32);
			const form = createImageFormData(buffer, "extra.png");
			const request = createUploadRequest("/api/upload/99", form);

			const response = await handleRequest(request);
			expect(response.status).toBeGreaterThanOrEqual(400);
		});
	});
});
