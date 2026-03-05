/**
 * Upload Plugin Types
 *
 * This file defines types for the file upload plugin.
 * NO `any` types, NO type assertions, ONLY Error classes.
 */

import { PluginError } from "forja-types/plugin";

/**
 * Upload file data
 */
export interface UploadFile {
	readonly filename: string;
	readonly originalName: string;
	readonly mimetype: string;
	readonly size: number;
	readonly buffer: Uint8Array;
}

/**
 * Upload result
 */
export interface UploadResult {
	readonly key: string;
	readonly url: string;
	readonly size: number;
	readonly mimetype: string;
	readonly uploadedAt: Date;
}

/**
 * Storage provider interface
 */
export interface StorageProvider {
	readonly name: string;

	upload(file: UploadFile): Promise<UploadResult>;
	delete(key: string): Promise<void>;
	getUrl(key: string): Promise<string>;
	exists(key: string): Promise<boolean>;
}

/**
 * Upload error
 */
export class UploadError extends PluginError {
	constructor(message: string, details?: unknown) {
		super(message, {
			code: "UPLOAD_ERROR",
			pluginName: "upload",
			details,
		});
		this.name = "UploadError";
	}
}

/**
 * File validation error
 */
export class FileValidationError extends UploadError {
	readonly validationErrors: readonly ValidationFailure[];

	constructor(message: string, errors: readonly ValidationFailure[]) {
		super(message, { errors });
		this.name = "FileValidationError";
		this.validationErrors = errors;
	}
}

/**
 * Validation failure
 */
export interface ValidationFailure {
	readonly field: string;
	readonly message: string;
	readonly value?: unknown;
}

/**
 * File validation options
 */
export interface FileValidationOptions {
	readonly maxSize?: number;
	readonly allowedMimeTypes?: readonly string[];
	readonly allowedExtensions?: readonly string[];
	readonly minSize?: number;
}

/**
 * Upload plugin options
 */
export interface UploadPluginOptions {
	readonly provider: StorageProvider;
	readonly validation?: FileValidationOptions;
	readonly enableLogging?: boolean;
}

/**
 * Local provider options
 */
export interface LocalProviderOptions {
	readonly basePath: string;
	readonly baseUrl: string;
	readonly ensureDirectory?: boolean;
}

/**
 * S3 provider options
 */
export interface S3ProviderOptions {
	readonly bucket: string;
	readonly region: string;
	readonly accessKeyId: string;
	readonly secretAccessKey: string;
	readonly endpoint?: string;
	readonly pathPrefix?: string;
}

/**
 * Type guard for UploadFile
 */
export function isUploadFile(value: unknown): value is UploadFile {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const obj = value as Record<string, unknown>;

	return (
		typeof obj["filename"] === "string" &&
		typeof obj["originalName"] === "string" &&
		typeof obj["mimetype"] === "string" &&
		typeof obj["size"] === "number" &&
		obj["buffer"] instanceof Uint8Array
	);
}

/**
 * Type guard for StorageProvider
 */
export function isStorageProvider(value: unknown): value is StorageProvider {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const obj = value as Record<string, unknown>;

	return (
		typeof obj["name"] === "string" &&
		typeof obj["upload"] === "function" &&
		typeof obj["delete"] === "function" &&
		typeof obj["getUrl"] === "function" &&
		typeof obj["exists"] === "function"
	);
}

/**
 * Generate unique filename
 */
export function generateUniqueFilename(originalFilename: string): string {
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 15);
	const extension = getFileExtension(originalFilename);

	return extension
		? `${timestamp}-${random}.${extension}`
		: `${timestamp}-${random}`;
}

/**
 * Get file extension
 */
export function getFileExtension(filename: string): string {
	const parts = filename.split(".");
	if (parts.length < 2) {
		return "";
	}
	return parts[parts.length - 1] ?? "";
}

/**
 * Sanitize filename
 */
export function sanitizeFilename(filename: string): string {
	return filename
		.replace(/\.\./g, "")
		.replace(/\//g, "")
		.replace(/\\/g, "")
		.replace(/[<>:"|?*]/g, "")
		.replace(/\s+/g, "-")
		.toLowerCase();
}

/**
 * Validate file size
 */
export function validateFileSize(
	size: number,
	options: FileValidationOptions,
): ValidationFailure | null {
	if (options.maxSize !== undefined && size > options.maxSize) {
		return {
			field: "size",
			message: `File size ${size} exceeds maximum allowed size ${options.maxSize}`,
			value: size,
		};
	}

	if (options.minSize !== undefined && size < options.minSize) {
		return {
			field: "size",
			message: `File size ${size} is below minimum required size ${options.minSize}`,
			value: size,
		};
	}

	return null;
}

/**
 * Validate MIME type
 */
export function validateMimeType(
	mimetype: string,
	options: FileValidationOptions,
): ValidationFailure | null {
	if (
		options.allowedMimeTypes !== undefined &&
		options.allowedMimeTypes.length > 0
	) {
		if (!options.allowedMimeTypes.includes(mimetype)) {
			return {
				field: "mimetype",
				message: `MIME type ${mimetype} is not allowed`,
				value: mimetype,
			};
		}
	}

	return null;
}

/**
 * Validate file extension
 */
export function validateExtension(
	filename: string,
	options: FileValidationOptions,
): ValidationFailure | null {
	if (
		options.allowedExtensions !== undefined &&
		options.allowedExtensions.length > 0
	) {
		const extension = getFileExtension(filename);

		if (!options.allowedExtensions.includes(extension)) {
			return {
				field: "extension",
				message: `File extension .${extension} is not allowed`,
				value: extension,
			};
		}
	}

	return null;
}

/**
 * Validate upload file — throws FileValidationError on failure
 */
export function validateUploadFile(
	file: UploadFile,
	options: FileValidationOptions,
): void {
	const errors: ValidationFailure[] = [];

	const sizeError = validateFileSize(file.size, options);
	if (sizeError !== null) {
		errors.push(sizeError);
	}

	const mimeError = validateMimeType(file.mimetype, options);
	if (mimeError !== null) {
		errors.push(mimeError);
	}

	const extError = validateExtension(file.filename, options);
	if (extError !== null) {
		errors.push(extError);
	}

	if (errors.length > 0) {
		throw new FileValidationError("File validation failed", errors);
	}
}
