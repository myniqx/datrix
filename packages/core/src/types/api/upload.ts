/**
 * Upload Types
 *
 * Storage provider interface and related types for the upload system.
 * Moved here from plugin-upload so api package can reference it directly.
 */

import { SchemaPermission } from "../core/permission";
import type { DatrixEntry, SchemaDefinition } from "../core/schema";

/**
 * Raw file data received from multipart/form-data parsing
 */
export interface UploadFile {
	readonly filename: string;
	readonly originalName: string;
	readonly mimetype: string;
	readonly size: number;
	readonly buffer: Uint8Array;
}

/**
 * Result returned by a storage provider after a successful upload
 */
export interface UploadResult {
	readonly key: string;
	readonly size: number;
	readonly mimetype: string;
	readonly uploadedAt: Date;
}

/**
 * Storage provider interface.
 * Implement this to add a new storage backend (S3, local, GCS, etc.)
 */
export interface StorageProvider {
	readonly name: string;
	upload(file: UploadFile): Promise<UploadResult>;
	delete(key: string): Promise<void>;
	getUrl(key: string): string;
	exists(key: string): Promise<boolean>;
}

/**
 * A single processed variant (thumbnail, small, medium, etc.)
 */
export interface MediaVariant {
	readonly key: string;
	readonly url: string;
	readonly width: number;
	readonly height: number;
	readonly size: number;
	readonly mimeType: string;
}

/**
 * Map of resolution name → variant data.
 * Keys are whatever the user defines in Upload config resolutions.
 *
 * @example
 * ```ts
 * const variants: MediaVariants<"thumbnail" | "small"> = {
 *   thumbnail: { url: "...", width: 150, height: 150, size: 4200, mimeType: "image/webp" },
 *   small:     { url: "...", width: 640, height: 360,  size: 32000, mimeType: "image/webp" },
 * }
 * ```
 */
export type MediaVariants<TResolutions extends string = string> = {
	readonly [K in TResolutions]?: MediaVariant;
};

/**
 * Shape of a media record stored in the database.
 * Injected as the "media" schema by ApiPlugin when upload is configured.
 * TResolutions narrows the variants field for type-safe access.
 */
export interface MediaEntry<
	TResolutions extends string = string,
> extends DatrixEntry {
	readonly filename: string;
	readonly originalName: string;
	readonly mimeType: string;
	readonly size: number;
	readonly url: string;
	readonly key: string;
	readonly variants: MediaVariants<TResolutions> | null;
}

/**
 * Upload configuration inside ApiConfig
 */
export interface UploadConfig {
	/**
	 * Storage provider instance (S3, Local, etc.)
	 */
	readonly provider: StorageProvider;

	/**
	 * Custom table/model name for media records
	 * @default "media"
	 */
	readonly modelName?: string;

	/**
	 * Global max file size in bytes (can be overridden per FileField)
	 */
	readonly maxSize?: number;

	/**
	 * Global allowed MIME types (can be overridden per FileField)
	 */
	readonly allowedMimeTypes?: readonly string[];

	/**
	 * Permission config for the injected media schema
	 */
	readonly permission?: SchemaPermission;
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
 * Generate unique filename with timestamp and random suffix
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
 * Get file extension (without dot)
 */
export function getFileExtension(filename: string): string {
	const parts = filename.split(".");
	if (parts.length < 2) return "";
	return parts[parts.length - 1] ?? "";
}

/**
 * Sanitize filename — removes path traversal and dangerous characters
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
 * Interface that Upload implementations must satisfy.
 * ApiPlugin depends only on this — not on the concrete api-upload package.
 */
export interface IUpload {
	getSchemas(): Promise<SchemaDefinition[]> | SchemaDefinition[];
	handleRequest(request: Request, datrix: unknown): Promise<Response>;
	getModelName(): string;
	/**
	 * Traverse any response data (including populated relations) and inject
	 * url fields derived from key via the configured storage provider.
	 */
	injectUrls(data: unknown): Promise<unknown>;
	/**
	 * Resolve a public URL for the given storage key via the configured provider.
	 * Used by the CLI file exporter to download files during export.
	 */
	getUrl(key: string): string;
	/**
	 * The underlying storage provider.
	 * Used by the CLI file importer to upload files directly.
	 */
	readonly provider: StorageProvider;
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
