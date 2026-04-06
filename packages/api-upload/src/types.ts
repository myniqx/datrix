/**
 * api-upload types
 */

import type { StorageProvider } from "@datrix/core";
import type { SchemaPermission } from "@datrix/core";

/**
 * Output format for image conversion.
 * If set, all uploaded images are converted to this format before storage.
 */
export type ImageFormat = "webp" | "jpeg" | "png" | "avif";

/**
 * Sharp fit modes for resizing when both width and height are specified.
 */
export type ResizeFit = "cover" | "contain" | "fill" | "inside" | "outside";

/**
 * Config for a single resolution variant.
 * height is optional — if omitted, sharp preserves aspect ratio.
 * fit only applies when both width and height are given.
 */
export interface ResolutionConfig {
	readonly width: number;
	readonly height?: number;
	readonly fit?: ResizeFit;
}

/**
 * Upload options passed to new Upload({ ... })
 *
 * @template TResolutions - Union of resolution names defined in resolutions config
 *
 * @example
 * ```ts
 * new Upload<"thumbnail" | "small" | "medium">({
 *   provider: new S3StorageProvider({ ... }),
 *   format: "webp",
 *   quality: 80,
 *   resolutions: {
 *     thumbnail: { width: 150, height: 150, fit: "cover" },
 *     small:     { width: 640 },
 *     medium:    { width: 1280 },
 *   }
 * })
 * ```
 */
export interface UploadOptions<TResolutions extends string = string> {
	readonly provider: StorageProvider;
	readonly modelName?: string;
	readonly maxSize?: number;
	readonly allowedMimeTypes?: readonly string[];
	readonly permission?: SchemaPermission;
	/**
	 * Convert all uploaded images to this format.
	 * If not set, original format is preserved.
	 */
	readonly format?: ImageFormat;
	/**
	 * Compression quality (1–100). Applies to jpeg, webp, avif.
	 * @default 80
	 */
	readonly quality?: number;
	/**
	 * Named resolution variants to generate after upload.
	 * Only applied to images. Non-image files get null variants.
	 */
	readonly resolutions?: Record<TResolutions, ResolutionConfig>;
}
