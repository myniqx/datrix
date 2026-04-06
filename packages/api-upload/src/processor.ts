/**
 * Image Processor
 *
 * Handles format conversion and resolution variant generation using sharp.
 * Only processes images — non-image files are passed through unchanged.
 */

import type {
	UploadFile,
	MediaVariant,
	MediaVariants,
} from "@forja/core/types/api";
import type { ImageFormat, ResolutionConfig } from "./types";
import { ForjaError } from "@forja/core/types/errors";

const IMAGE_MIME_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/avif",
	"image/gif",
	"image/tiff",
]);

function isImage(mimetype: string): boolean {
	return IMAGE_MIME_TYPES.has(mimetype);
}

function getMimeType(format: ImageFormat): string {
	const map: Record<ImageFormat, string> = {
		webp: "image/webp",
		jpeg: "image/jpeg",
		png: "image/png",
		avif: "image/avif",
	};
	return map[format];
}

function getExtension(format: ImageFormat): string {
	return format === "jpeg" ? "jpg" : format;
}

/**
 * Apply format conversion to a file buffer.
 * Returns the converted buffer and new mimetype.
 * If file is not an image or no format set, returns original unchanged.
 */
export async function convertFormat(
	file: UploadFile,
	format: ImageFormat,
	quality: number,
): Promise<{ buffer: Uint8Array; mimetype: string; filename: string }> {
	if (!isImage(file.mimetype)) {
		return {
			buffer: file.buffer,
			mimetype: file.mimetype,
			filename: file.filename,
		};
	}

	let sharp: typeof import("sharp");
	try {
		sharp = (await import("sharp"))
			.default as unknown as typeof import("sharp");
	} catch (error) {
		throw new ForjaError("sharp is not installed", {
			code: "SHARP_NOT_FOUND",
			operation: "upload:convertFormat",
		});
	}

	try {
		const converted = await sharp(file.buffer)
			.toFormat(format, { quality })
			.toBuffer();

		const ext = getExtension(format);
		const baseName = file.filename.replace(/\.[^.]+$/, "");
		const newFilename = `${baseName}.${ext}`;

		return {
			buffer: new Uint8Array(converted),
			mimetype: getMimeType(format),
			filename: newFilename,
		};
	} catch (error) {
		throw new ForjaError("Failed to convert image format", {
			code: "IMAGE_CONVERT_ERROR",
			operation: "upload:convertFormat",
			cause: error instanceof Error ? error : undefined,
		});
	}
}

/**
 * Generate resolution variants for an image.
 * Returns a map of resolution name → MediaVariant.
 * Uploads each variant via the provider.
 */
export async function generateVariants<TResolutions extends string>(
	file: UploadFile,
	resolutions: Record<TResolutions, ResolutionConfig>,
	format: ImageFormat | undefined,
	quality: number,
	uploadFn: (variantFile: UploadFile) => Promise<{ key: string }>,
): Promise<MediaVariants<TResolutions>> {
	if (!isImage(file.mimetype)) {
		return {};
	}

	let sharp: typeof import("sharp");
	try {
		sharp = (await import("sharp"))
			.default as unknown as typeof import("sharp");
	} catch (error) {
		throw new ForjaError("sharp is not installed", {
			code: "SHARP_NOT_FOUND",
			operation: "upload:generateVariants",
		});
	}

	const targetFormat = format ?? "jpeg";
	const outputMime = getMimeType(targetFormat);
	const outputExt = getExtension(targetFormat);

	const variants: Partial<Record<TResolutions, MediaVariant>> = {};

	for (const [name, config] of Object.entries(resolutions) as [
		TResolutions,
		ResolutionConfig,
	][]) {
		try {
			const resizeOptions: import("sharp").ResizeOptions = {
				width: config.width,
				...(config.height !== undefined && { height: config.height }),
				...(config.fit !== undefined &&
					config.height !== undefined && { fit: config.fit }),
			};

			const variantBuffer = await sharp(file.buffer)
				.resize(resizeOptions)
				.toFormat(targetFormat, { quality })
				.toBuffer({ resolveWithObject: true });

			const baseName = file.filename.replace(/\.[^.]+$/, "");
			const variantFilename = `${baseName}-${name}.${outputExt}`;

			const variantFile: UploadFile = {
				filename: variantFilename,
				originalName: variantFilename,
				mimetype: outputMime,
				size: variantBuffer.data.length,
				buffer: new Uint8Array(variantBuffer.data),
			};

			const uploaded = await uploadFn(variantFile);

			variants[name] = {
				key: uploaded.key,
				width: variantBuffer.info.width,
				height: variantBuffer.info.height,
				size: variantBuffer.data.length,
				mimeType: outputMime,
				url: undefined!,
			};
		} catch (error) {
			if (error instanceof ForjaError) throw error;
			throw new ForjaError(`Failed to generate variant: ${name}`, {
				code: "VARIANT_GENERATE_ERROR",
				operation: "upload:generateVariants",
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	return variants as MediaVariants<TResolutions>;
}

export { isImage };
