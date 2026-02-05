/**
 * Upload Validation Tests - Happy Path
 *
 * Tests successful validation:
 * - Valid file size
 * - Valid MIME types
 * - Valid extensions
 * - Filename sanitization
 */

import { describe, it, expect } from "vitest";
import {
	validateUploadFile,
	sanitizeFilename,
	validateFileSize,
	validateMimeType,
	validateExtension,
} from "../src/types";
import type { UploadFile } from "../src/types";
import { expectSuccessData } from "../../../types/src/test/helpers";

describe("Upload Validation - Happy Path", () => {
	const validImageFile: UploadFile = {
		filename: "test.jpg",
		originalName: "test.jpg",
		mimetype: "image/jpeg",
		size: 500,
		buffer: new Uint8Array(500),
	};

	describe("File Size Validation", () => {
		it("should pass for valid size", () => {
			const validationResult = validateFileSize(500, {
				minSize: 100,
				maxSize: 1000,
			});
			expect(validationResult).toBeNull();
		});
	});

	describe("MIME Type Validation", () => {
		it("should pass for allowed mime type", () => {
			const validationResult = validateMimeType("image/png", {
				allowedMimeTypes: ["image/png", "image/jpeg"],
			});
			expect(validationResult).toBeNull();
		});
	});

	describe("Extension Validation", () => {
		it("should pass for allowed extension", () => {
			const validationResult = validateExtension("image.png", {
				allowedExtensions: ["png", "jpg"],
			});
			expect(validationResult).toBeNull();
		});
	});

	describe("Filename Sanitization", () => {
		it("should replace spaces with dashes", () => {
			const sanitizedFilename = sanitizeFilename("My Resume 2023.pdf");
			expect(sanitizedFilename).toBe("my-resume-2023.pdf");
		});
	});

	describe("Complete File Validation", () => {
		it("should pass when all rules match", () => {
			const validationResult = validateUploadFile(validImageFile, {
				maxSize: 1000,
				allowedMimeTypes: ["image/jpeg"],
			});

			expectSuccessData(validationResult);
		});
	});
});
