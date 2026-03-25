/**
 * Local Filesystem Storage Provider
 */

import type {
	StorageProvider,
	UploadFile,
	UploadResult,
	LocalProviderOptions,
} from "forja-types/api";
import { generateUniqueFilename, sanitizeFilename } from "forja-types/api";
import { ForjaError } from "forja-types/errors";

class UploadError extends ForjaError {
	constructor(message: string, cause?: Error) {
		super(message, {
			code: "UPLOAD_ERROR",
			operation: "upload:local",
			...(cause !== undefined && { cause }),
		});
		this.name = "UploadError";
	}
}

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

			return {
				key: uniqueFilename,
				url: this.buildUrl(uniqueFilename),
				size: file.size,
				mimetype: file.mimetype,
				uploadedAt: new Date(),
			};
		} catch (error) {
			const cause = error instanceof Error ? error : undefined;
			throw new UploadError("Failed to upload file to local filesystem", cause);
		}
	}

	async delete(key: string): Promise<void> {
		const fs = await import("fs/promises");
		const path = await import("path");

		const fullPath = path.join(this.basePath, key);

		try {
			await fs.access(fullPath);
		} catch (error) {
			const cause = error instanceof Error ? error : undefined;
			throw new UploadError("File not found", cause);
		}

		try {
			await fs.unlink(fullPath);
		} catch (error) {
			const cause = error instanceof Error ? error : undefined;
			throw new UploadError(
				"Failed to delete file from local filesystem",
				cause,
			);
		}
	}

	async getUrl(key: string): Promise<string> {
		return this.buildUrl(key);
	}

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

	private buildUrl(key: string): string {
		const cleanBaseUrl = this.baseUrl.replace(/\/$/, "");
		const cleanKey = key.replace(/^\//, "");
		return `${cleanBaseUrl}/${cleanKey}`;
	}
}
