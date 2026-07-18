/**
 * Local Filesystem Storage Provider
 */

import type {
	StorageProvider,
	UploadFile,
	UploadResult,
	LocalProviderOptions,
} from "@datrix/core";
import { generateUniqueFilename, sanitizeFilename } from "@datrix/core";
import { DatrixError } from "@datrix/core";

class UploadError extends DatrixError {
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
				size: file.size,
				mimetype: file.mimetype,
				uploadedAt: new Date(),
			};
		} catch (error) {
			const cause = error instanceof Error ? error : undefined;
			throw new UploadError("Failed to upload file to local filesystem", cause);
		}
	}

	/**
	 * Delete is idempotent — a missing file is treated as already deleted.
	 */
	async delete(key: string): Promise<void> {
		const fullPath = await this.resolveContainedPath(key);
		const fs = await import("fs/promises");

		try {
			await fs.unlink(fullPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return;
			}
			const cause = error instanceof Error ? error : undefined;
			throw new UploadError(
				"Failed to delete file from local filesystem",
				cause,
			);
		}
	}

	getUrl(key: string): string {
		this.assertSafeKey(key);
		return this.buildUrl(key);
	}

	async exists(key: string): Promise<boolean> {
		try {
			const fullPath = await this.resolveContainedPath(key);
			const fs = await import("fs/promises");
			await fs.access(fullPath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Keys must be relative paths that stay inside basePath — reject
	 * traversal segments and absolute paths before touching the filesystem.
	 */
	private assertSafeKey(key: string): void {
		const isAbsolute = key.startsWith("/") || /^[A-Za-z]:/.test(key);
		const hasTraversal = key.split(/[/\\]/).some((segment) => segment === "..");
		if (key === "" || isAbsolute || hasTraversal) {
			throw new UploadError(`Invalid storage key: ${key}`);
		}
	}

	private async resolveContainedPath(key: string): Promise<string> {
		this.assertSafeKey(key);
		const path = await import("path");
		const base = path.resolve(this.basePath);
		const fullPath = path.resolve(base, key);
		if (!fullPath.startsWith(base + path.sep)) {
			throw new UploadError(`Invalid storage key: ${key}`);
		}
		return fullPath;
	}

	private buildUrl(key: string): string {
		const cleanBaseUrl = this.baseUrl.replace(/\/$/, "");
		const cleanKey = key.replace(/^\//, "");
		return `${cleanBaseUrl}/${cleanKey}`;
	}
}
