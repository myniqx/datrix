/**
 * Local Filesystem Storage Provider
 *
 * Stores files on the local filesystem.
 * NO `any` types, NO type assertions.
 */

import type {
	StorageProvider,
	UploadFile,
	UploadResult,
	LocalProviderOptions,
} from "../types";
import {
	UploadError,
	generateUniqueFilename,
	sanitizeFilename,
} from "../types";

/**
 * Local filesystem storage provider
 */
export class LocalStorageProvider implements StorageProvider {
	readonly name = "local" as const;

	private readonly basePath: string;
	private readonly baseUrl: string;
	private readonly ensureDirectory: boolean;

	constructor(options: LocalProviderOptions) {
		this.basePath = options.basePath;
		this.baseUrl = options.baseUrl;
		this.ensureDirectory = options.ensureDirectory ?? true;
	}

	/**
	 * Upload a file to local filesystem
	 */
	async upload(file: UploadFile): Promise<UploadResult> {
		try {
			const fs = await import("fs/promises");
			const path = await import("path");

			const sanitized = sanitizeFilename(file.originalName);
			const uniqueFilename = generateUniqueFilename(sanitized);
			const fullPath = path.join(this.basePath, uniqueFilename);

			if (this.ensureDirectory) {
				const dirPath = path.dirname(fullPath);
				await fs.mkdir(dirPath, { recursive: true });
			}

			await fs.writeFile(fullPath, file.buffer);

			const result: UploadResult = {
				key: uniqueFilename,
				url: this.getUrlSync(uniqueFilename),
				size: file.size,
				mimetype: file.mimetype,
				uploadedAt: new Date(),
			};

			return result;
		} catch (error) {
			throw new UploadError("Failed to upload file to local filesystem", {
				originalError: error,
				filename: file.originalName,
			});
		}
	}

	/**
	 * Delete a file from local filesystem
	 */
	async delete(key: string): Promise<void> {
		const fs = await import("fs/promises");
		const path = await import("path");

		const fullPath = path.join(this.basePath, key);

		try {
			await fs.access(fullPath);
		} catch {
			throw new UploadError("File not found", { key });
		}

		try {
			await fs.unlink(fullPath);
		} catch (error) {
			throw new UploadError("Failed to delete file from local filesystem", {
				originalError: error,
				key,
			});
		}
	}

	/**
	 * Get URL for a file
	 */
	async getUrl(key: string): Promise<string> {
		return this.getUrlSync(key);
	}

	/**
	 * Get URL synchronously
	 */
	private getUrlSync(key: string): string {
		const cleanBaseUrl = this.baseUrl.replace(/\/$/, "");
		const cleanKey = key.replace(/^\//, "");
		return `${cleanBaseUrl}/${cleanKey}`;
	}

	/**
	 * Check if a file exists
	 */
	async exists(key: string): Promise<boolean> {
		try {
			const fs = await import("fs/promises");
			const path = await import("path");

			const fullPath = path.join(this.basePath, key);
			await fs.access(fullPath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get base path
	 */
	getBasePath(): string {
		return this.basePath;
	}

	/**
	 * Get base URL
	 */
	getBaseUrl(): string {
		return this.baseUrl;
	}
}

/**
 * Create a new local storage provider
 */
export function createLocalStorageProvider(
	options: LocalProviderOptions,
): LocalStorageProvider {
	return new LocalStorageProvider(options);
}
