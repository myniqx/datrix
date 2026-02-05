/**
 * Upload Plugin Tests - Happy Path
 *
 * Tests successful upload operations:
 * - File upload with validation
 * - Provider integration
 * - File deletion
 * - Logging
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createUploadPlugin } from "../src";
import type { StorageProvider, UploadFile, UploadResult } from "../src/types";
import type { PluginContext } from "../../../types/src/plugin";
import { expectSuccessData } from "../../../types/src/test/helpers";

describe("Upload Plugin - Happy Path", () => {
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
			enableLogging: true,
		});
	});

	describe("File Upload", () => {
		it("should call provider if validation passes", async () => {
			const validImageFile: UploadFile = {
				filename: "test.jpg",
				originalName: "test.jpg",
				mimetype: "image/jpeg",
				size: 500,
				buffer: new Uint8Array(500),
			};

			const mockUploadResult: UploadResult = {
				key: "gen-key.jpg",
				url: "http://test.com/gen-key.jpg",
				size: 500,
				mimetype: "image/jpeg",
				uploadedAt: new Date(),
			};

			vi.mocked(mockProvider.upload).mockResolvedValue({
				success: true,
				data: mockUploadResult,
			});

			const uploadResult = await uploadPlugin.upload(validImageFile);

			const uploadedFile = expectSuccessData(uploadResult);
			expect(mockProvider.upload).toHaveBeenCalledWith(validImageFile);
			expect(uploadedFile.key).toBe("gen-key.jpg");
			expect(uploadedFile.url).toBe("http://test.com/gen-key.jpg");
		});
	});

	describe("File Deletion", () => {
		it("should call provider.delete with correct key", async () => {
			vi.mocked(mockProvider.delete).mockResolvedValue({
				success: true,
				data: undefined,
			});

			const deleteResult = await uploadPlugin.delete("some-key");

			expectSuccessData(deleteResult);
			expect(mockProvider.delete).toHaveBeenCalledWith("some-key");
		});
	});

	describe("Logging", () => {
		it("should log to console if enabled", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			const validFile: UploadFile = {
				filename: "test.jpg",
				originalName: "test.jpg",
				mimetype: "image/jpeg",
				size: 500,
				buffer: new Uint8Array(500),
			};

			vi.mocked(mockProvider.upload).mockResolvedValue({
				success: true,
				data: {
					key: "k",
					url: "u",
					size: 10,
					mimetype: "m",
					uploadedAt: new Date(),
				},
			});

			await uploadPlugin.upload(validFile);
			expect(consoleSpy).toHaveBeenCalled();

			consoleSpy.mockRestore();
		});
	});
});
