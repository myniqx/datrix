/**
 * Upload Plugin
 *
 * Provides file upload functionality with multiple storage providers.
 * NO `any` types, NO type assertions.
 */

import { ForjaPlugin, PluginContext, PluginError } from "forja-types/plugin";
import type {
	UploadPluginOptions,
	UploadFile,
	UploadResult,
	StorageProvider,
	FileValidationOptions,
} from "./types";
import {
	UploadError,
	isStorageProvider,
	isUploadFile,
	validateUploadFile,
} from "./types";

/**
 * Upload plugin implementation
 */
export class UploadPlugin implements ForjaPlugin<UploadPluginOptions> {
	readonly name = "upload" as const;
	readonly version = "0.1.0";
	readonly options: UploadPluginOptions;

	private provider: StorageProvider;
	private validation: FileValidationOptions;
	private enableLogging: boolean;

	constructor(options: UploadPluginOptions) {
		this.options = options;
		this.provider = options.provider;
		this.validation = options.validation ?? {};
		this.enableLogging = options.enableLogging ?? false;
	}

	/**
	 * Initialize the plugin
	 */
	async init(_context: PluginContext): Promise<void> {
		if (!isStorageProvider(this.provider)) {
			throw new UploadError("Invalid storage provider", {
				provider: this.provider,
			});
		}

		if (this.enableLogging) {
			console.log(`[Upload] Initialized with provider: ${this.provider.name}`);
		}
	}

	/**
	 * Destroy the plugin
	 */
	async destroy(): Promise<void> {
		if (this.enableLogging) {
			console.log("[Upload] Plugin destroyed");
		}
	}

	/**
	 * Upload a file
	 */
	async upload(file: UploadFile): Promise<UploadResult> {
		if (!isUploadFile(file)) {
			throw new UploadError("Invalid file object", { file });
		}

		validateUploadFile(file, this.validation);

		if (this.enableLogging) {
			console.log(`[Upload] Uploading file: ${file.originalName}`);
		}

		const result = await this.provider.upload(file);

		if (this.enableLogging) {
			console.log(`[Upload] Upload successful: ${result.key}`);
		}

		return result;
	}

	/**
	 * Delete a file
	 */
	async delete(key: string): Promise<void> {
		if (typeof key !== "string" || key.trim().length === 0) {
			throw new UploadError("Invalid file key", { key });
		}

		if (this.enableLogging) {
			console.log(`[Upload] Deleting file: ${key}`);
		}

		await this.provider.delete(key);

		if (this.enableLogging) {
			console.log(`[Upload] Delete successful: ${key}`);
		}
	}

	/**
	 * Get URL for a file
	 */
	async getUrl(key: string): Promise<string> {
		if (typeof key !== "string" || key.trim().length === 0) {
			throw new UploadError("Invalid file key", { key });
		}

		try {
			const url = await this.provider.getUrl(key);
			return url;
		} catch (error) {
			throw new UploadError("Failed to get file URL", {
				originalError: error,
				key,
			});
		}
	}

	/**
	 * Check if a file exists
	 */
	async exists(key: string): Promise<boolean> {
		if (typeof key !== "string" || key.trim().length === 0) {
			throw new UploadError("Invalid file key", { key });
		}

		try {
			const exists = await this.provider.exists(key);
			return exists;
		} catch (error) {
			throw new UploadError("Failed to check file existence", {
				originalError: error,
				key,
			});
		}
	}

	/**
	 * Get current provider
	 */
	getProvider(): StorageProvider {
		return this.provider;
	}

	/**
	 * Get validation options
	 */
	getValidation(): FileValidationOptions {
		return this.validation;
	}

	/**
	 * Update validation options
	 */
	setValidation(validation: FileValidationOptions): void {
		this.validation = validation;
	}
}

/**
 * Create a new upload plugin instance
 */
export function createUploadPlugin(options: UploadPluginOptions): UploadPlugin {
	return new UploadPlugin(options);
}

/**
 * Re-export types
 */
export type {
	UploadPluginOptions,
	UploadFile,
	UploadResult,
	StorageProvider,
	FileValidationOptions,
	LocalProviderOptions,
	S3ProviderOptions,
} from "./types";

export {
	UploadError,
	FileValidationError,
	isStorageProvider,
	isUploadFile,
	validateUploadFile,
	generateUniqueFilename,
	sanitizeFilename,
	getFileExtension,
} from "./types";

export {
	LocalStorageProvider,
	createLocalStorageProvider,
} from "./providers/local";
export { S3StorageProvider, createS3StorageProvider } from "./providers/s3";
