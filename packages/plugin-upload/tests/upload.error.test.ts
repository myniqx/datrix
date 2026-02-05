/**
 * Upload Plugin Tests - Error Path
 *
 * Tests error handling:
 * - File validation failures
 * - Provider errors
 * - Invalid keys
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createUploadPlugin } from "../src";
import type { StorageProvider, UploadFile } from "../src/types";
import { UploadError } from "../src/types";
import type { PluginContext } from "../../../types/src/plugin";
import { expectFailureError } from "../../../types/src/test/helpers";

describe("Upload Plugin - Error Path", () => {
	const mockProvider: StorageProvider = {
		name: "mock",
		upload: vi.fn(),
		delete: vi.fn(),
		getUrl: vi.fn(),
		exists: vi.fn(),
	};

	const mockContext: PluginContext = {
		adapter: {} as any,
		schemas: {} as any,
		config: {} as any,
	};

	let uploadPlugin: ReturnType<typeof createUploadPlugin>;

	beforeEach(() => {
		vi.clearAllMocks();
		uploadPlugin = createUploadPlugin({
			provider: mockProvider,
			validation: {
				maxSize: 1000,
				allowedMimeTypes: ["image/jpeg"],
			},
			enableLogging: false,
		});
	});

	describe("File Validation Failures", () => {
		it("should validate file before calling provider", async () => {
			const invalidPdfFile: UploadFile = {
				filename: "test.pdf",
				originalName: "test.pdf",
				mimetype: "application/pdf",
				size: 500,
				buffer: new Uint8Array(500),
			};

			const uploadResult = await uploadPlugin.upload(invalidPdfFile);

			const error = expectFailureError(uploadResult);
			expect(error.name).toBe("FileValidationError");
			expect(mockProvider.upload).not.toHaveBeenCalled();
		});
	});

	describe("Provider Errors", () => {
		it("should propagate provider errors", async () => {
			const validFile: UploadFile = {
				filename: "test.jpg",
				originalName: "test.jpg",
				mimetype: "image/jpeg",
				size: 500,
				buffer: new Uint8Array(500),
			};

			vi.mocked(mockProvider.upload).mockResolvedValue({
				success: false,
				error: new UploadError("Provider failed"),
			});

			const uploadResult = await uploadPlugin.upload(validFile);

			const error = expectFailureError(uploadResult);
			expect(error.message).toBe("Provider failed");
		});
	});

	describe("Invalid Keys", () => {
		it("should fail for invalid keys", async () => {
			const deleteResult = await uploadPlugin.delete(" ");

			const error = expectFailureError(deleteResult);
			expect(error.message).toContain("Invalid file key");
		});
	});
});
