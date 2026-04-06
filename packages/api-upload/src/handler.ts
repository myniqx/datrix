/**
 * Upload Handler
 *
 * POST /upload       — multipart/form-data parse, format conversion, variant generation, DB record
 * DELETE /upload/:id — provider delete (all variants) + DB record delete
 *
 * GET /upload and GET /upload/:id fall through to normal CRUD.
 */

import type { Datrix } from "@datrix/core";
import type { UploadFile, MediaVariants } from "@datrix/core";
import type { DatrixEntry } from "@datrix/core";
import {
	DatrixApiError,
	handlerError,
	jsonResponse,
	datrixErrorResponse,
} from "@datrix/api";
import { DatrixError, DatrixValidationError } from "@datrix/core";
import type { UploadOptions } from "./types";
import { convertFormat, generateVariants, isImage } from "./processor";

export interface UploadHandlerOptions {
	datrix: Datrix;
	uploadOptions: UploadOptions;
	injectUrls?: (data: unknown) => Promise<unknown>;
}

export async function handleUploadRequest(
	request: Request,
	options: UploadHandlerOptions,
): Promise<Response> {
	try {
		const { method } = request;
		const url = new URL(request.url);

		const pathAfterUpload = url.pathname.replace(/.*\/upload/, "");
		const idSegment = pathAfterUpload.replace(/^\//, "").split("/")[0];
		const id =
			idSegment !== undefined && idSegment !== "" ? Number(idSegment) : null;

		if (method === "POST" && id === null) {
			return await handleUpload(request, options);
		}

		if (method === "DELETE" && id !== null) {
			return await handleDeleteMedia(id, options);
		}

		return datrixErrorResponse(handlerError.methodNotAllowed(method));
	} catch (error) {
		if (error instanceof DatrixValidationError || error instanceof DatrixError) {
			return datrixErrorResponse(error);
		}

		const message = error instanceof Error ? error.message : "Upload failed";
		return datrixErrorResponse(
			handlerError.internalError(
				message,
				error instanceof Error ? error : undefined,
			),
		);
	}
}

async function handleUpload(
	request: Request,
	options: UploadHandlerOptions,
): Promise<Response> {
	const { datrix, uploadOptions } = options;
	const modelName = uploadOptions.modelName ?? "media";

	const contentType = request.headers.get("content-type") ?? "";
	if (!contentType.includes("multipart/form-data")) {
		return datrixErrorResponse(
			handlerError.invalidBody("Expected multipart/form-data"),
		);
	}

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch (error) {
		const cause = error instanceof Error ? error : undefined;
		throw new DatrixApiError("Failed to parse multipart form data", {
			code: "MULTIPART_PARSE_ERROR",
			status: 400,
			...(cause !== undefined && { cause }),
		});
	}

	const fileEntry = formData.get("file");
	if (!(fileEntry instanceof File)) {
		return datrixErrorResponse(
			handlerError.invalidBody("No file field in form data"),
		);
	}

	const buffer = await fileEntry.arrayBuffer();
	const rawFile: UploadFile = {
		filename: fileEntry.name,
		originalName: fileEntry.name,
		mimetype: fileEntry.type,
		size: fileEntry.size,
		buffer: new Uint8Array(buffer),
	};

	validateFileLimits(rawFile, uploadOptions);

	// Format conversion (if configured and file is an image)
	const quality = uploadOptions.quality ?? 80;
	const fileToUpload =
		uploadOptions.format !== undefined && isImage(rawFile.mimetype)
			? await convertFormat(rawFile, uploadOptions.format, quality)
			: rawFile;

	const uploadFile: UploadFile = {
		filename: fileToUpload.filename,
		originalName: rawFile.originalName,
		mimetype: fileToUpload.mimetype,
		size: fileToUpload.buffer.length,
		buffer: fileToUpload.buffer,
	};

	// Upload original (or converted) file
	const result = await uploadOptions.provider.upload(uploadFile);

	// Generate resolution variants (if configured and file is an image)
	let variants: MediaVariants | null = null;
	if (uploadOptions.resolutions !== undefined && isImage(uploadFile.mimetype)) {
		const generated = await generateVariants(
			uploadFile,
			uploadOptions.resolutions,
			uploadOptions.format,
			quality,
			async (variantFile) => {
				const variantResult = await uploadOptions.provider.upload(variantFile);
				return { key: variantResult.key };
			},
		);
		variants = generated;
	}

	const mediaRecord = await datrix.raw.create(modelName, {
		filename: result.key,
		originalName: uploadFile.originalName,
		mimeType: uploadFile.mimetype,
		size: uploadFile.size,
		key: result.key,
		...(variants !== null && { variants }),
	});

	const data = options.injectUrls
		? await options.injectUrls(mediaRecord)
		: mediaRecord;

	return jsonResponse({ data }, 201);
}

/**
 * DELETE /upload/:id
 * Deletes all variant keys from storage, then the main record.
 */
async function handleDeleteMedia(
	id: number,
	options: UploadHandlerOptions,
): Promise<Response> {
	const { datrix, uploadOptions } = options;
	const modelName = uploadOptions.modelName ?? "media";

	type MediaRecord = {
		key: string;
		variants: Record<string, { key: string }> | null;
	} & DatrixEntry;
	const record = await datrix.raw.findById<MediaRecord>(modelName, id);

	if (record === null) {
		return datrixErrorResponse(handlerError.recordNotFound(modelName, id));
	}

	// Delete variant files from storage
	if (record.variants !== null && record.variants !== undefined) {
		for (const variant of Object.values(record.variants)) {
			await uploadOptions.provider.delete(variant.key);
		}
	}

	// Delete main file from storage
	await uploadOptions.provider.delete(record.key);
	await datrix.raw.delete(modelName, id);

	return jsonResponse({ data: { id } });
}

function validateFileLimits(file: UploadFile, options: UploadOptions): void {
	if (options.maxSize !== undefined && file.size > options.maxSize) {
		throw new DatrixApiError(
			`File size ${file.size} exceeds maximum allowed size ${options.maxSize}`,
			{ code: "FILE_TOO_LARGE", status: 400 },
		);
	}

	if (
		options.allowedMimeTypes !== undefined &&
		options.allowedMimeTypes.length > 0 &&
		!isMimeTypeAllowed(file.mimetype, options.allowedMimeTypes)
	) {
		throw new DatrixApiError(`MIME type ${file.mimetype} is not allowed`, {
			code: "INVALID_MIME_TYPE",
			status: 400,
		});
	}
}

function isMimeTypeAllowed(
	mimetype: string,
	allowedTypes: readonly string[],
): boolean {
	for (const allowed of allowedTypes) {
		if (allowed === mimetype) return true;
		if (allowed.endsWith("/*")) {
			const prefix = allowed.slice(0, -2);
			if (mimetype.startsWith(prefix + "/")) return true;
		}
	}
	return false;
}
