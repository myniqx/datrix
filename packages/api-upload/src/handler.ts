/**
 * Upload Handler
 *
 * POST /upload       — multipart/form-data parse, format conversion, variant generation, DB record
 * DELETE /upload/:id — DB record delete + provider delete (all variants, best-effort)
 *
 * GET /upload and GET /upload/:id fall through to normal CRUD.
 * Auth/permission for these endpoints is enforced by the API plugin before
 * this handler is invoked.
 */

import type { Datrix, StorageProvider } from "@datrix/core";
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
import {
	convertFormat,
	detectImageMime,
	generateVariants,
	isImage,
} from "./processor";

/**
 * Allowance on top of maxSize when pre-checking Content-Length —
 * covers multipart boundaries and non-file form fields.
 */
const MULTIPART_OVERHEAD = 64 * 1024;

export interface UploadHandlerOptions {
	datrix: Datrix;
	modelName: string;
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
		const segments = pathAfterUpload.split("/").filter(Boolean);
		const idSegment = segments[0];

		if (segments.length > 1) {
			return datrixErrorResponse(
				handlerError.recordNotFound(options.modelName, segments.join("/")),
			);
		}

		if (method === "POST") {
			// POST with an id segment is not a valid route
			if (idSegment !== undefined) {
				return datrixErrorResponse(
					handlerError.recordNotFound(options.modelName, idSegment),
				);
			}
			return await handleUpload(request, options);
		}

		if (method === "DELETE") {
			if (idSegment === undefined) {
				return datrixErrorResponse(handlerError.missingId("delete"));
			}
			if (!/^\d+$/.test(idSegment)) {
				return datrixErrorResponse(
					handlerError.recordNotFound(options.modelName, idSegment),
				);
			}
			return await handleDeleteMedia(parseInt(idSegment, 10), options);
		}

		return datrixErrorResponse(handlerError.methodNotAllowed(method));
	} catch (error) {
		if (
			error instanceof DatrixValidationError ||
			error instanceof DatrixError
		) {
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

/**
 * FormData.get returns string | File, but the File global only exists from
 * Node 20 — duck-type the entry instead of using instanceof.
 */
function isFileEntry(entry: unknown): entry is File {
	return (
		entry !== null &&
		typeof entry === "object" &&
		typeof (entry as File).arrayBuffer === "function" &&
		typeof (entry as File).name === "string" &&
		typeof (entry as File).size === "number" &&
		typeof (entry as File).type === "string"
	);
}

async function handleUpload(
	request: Request,
	options: UploadHandlerOptions,
): Promise<Response> {
	const { datrix, modelName, uploadOptions } = options;

	const contentType = request.headers.get("content-type") ?? "";
	if (!contentType.includes("multipart/form-data")) {
		return datrixErrorResponse(
			handlerError.invalidBody("Expected multipart/form-data"),
		);
	}

	// Reject oversized requests before buffering the body. A hard streaming
	// limit must still be enforced at the server/proxy level — formData()
	// cannot stream-abort.
	if (uploadOptions.maxSize !== undefined) {
		const contentLength = Number(request.headers.get("content-length"));
		if (
			Number.isFinite(contentLength) &&
			contentLength > uploadOptions.maxSize + MULTIPART_OVERHEAD
		) {
			throw new DatrixApiError(
				`Request size ${contentLength} exceeds maximum allowed size ${uploadOptions.maxSize}`,
				{ code: "FILE_TOO_LARGE", status: 413 },
			);
		}
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

	const fileEntries = formData.getAll("file");
	if (fileEntries.length === 0 || !isFileEntry(fileEntries[0])) {
		return datrixErrorResponse(
			handlerError.invalidBody("No file field in form data"),
		);
	}
	if (fileEntries.length > 1) {
		return datrixErrorResponse(
			handlerError.invalidBody(
				"Multiple file entries — upload a single file per request",
			),
		);
	}
	const fileEntry = fileEntries[0];

	// Size and declared-type limits are checked before buffering the file
	validateFileLimits(fileEntry.size, fileEntry.type, uploadOptions);

	const buffer = new Uint8Array(await fileEntry.arrayBuffer());
	const declaredMime = fileEntry.type;

	// The declared MIME type is client-controlled: verify image claims against
	// the actual content so e.g. HTML cannot be stored as image/png.
	if (declaredMime.startsWith("image/")) {
		const actualMime = await detectImageMime(buffer);
		if (actualMime !== declaredMime) {
			throw new DatrixApiError(
				`Declared MIME type ${declaredMime} does not match file content`,
				{ code: "INVALID_MIME_TYPE", status: 400 },
			);
		}
	}

	const rawFile: UploadFile = {
		filename: fileEntry.name,
		originalName: fileEntry.name,
		mimetype: declaredMime,
		size: fileEntry.size,
		buffer,
	};

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

	// Track every uploaded key so a later failure can clean up storage
	const uploadedKeys: string[] = [];

	// Upload original (or converted) file
	const result = await uploadOptions.provider.upload(uploadFile);
	uploadedKeys.push(result.key);

	try {
		// Generate resolution variants (if configured and file is an image)
		let variants: MediaVariants | null = null;
		if (
			uploadOptions.resolutions !== undefined &&
			isImage(uploadFile.mimetype)
		) {
			variants = await generateVariants(
				uploadFile,
				uploadOptions.resolutions,
				uploadOptions.format,
				quality,
				async (variantFile) => {
					const variantResult =
						await uploadOptions.provider.upload(variantFile);
					uploadedKeys.push(variantResult.key);
					return { key: variantResult.key };
				},
			);
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
	} catch (error) {
		// No DB record exists — remove already-uploaded storage objects
		await cleanupKeys(uploadOptions.provider, uploadedKeys);
		throw error;
	}
}

/**
 * DELETE /upload/:id
 * Deletes the DB record first, then storage objects best-effort — an
 * orphaned file is recoverable, a record pointing at deleted storage is not.
 */
async function handleDeleteMedia(
	id: number,
	options: UploadHandlerOptions,
): Promise<Response> {
	const { datrix, modelName, uploadOptions } = options;

	type MediaRecord = {
		key: string;
		variants: Record<string, { key: string }> | null;
	} & DatrixEntry;
	const record = await datrix.raw.findById<MediaRecord>(modelName, id);

	if (record === null) {
		return datrixErrorResponse(handlerError.recordNotFound(modelName, id));
	}

	await datrix.raw.delete(modelName, id);

	const keys: string[] = [record.key];
	if (record.variants !== null && record.variants !== undefined) {
		for (const variant of Object.values(record.variants)) {
			if (typeof variant?.key === "string") {
				keys.push(variant.key);
			}
		}
	}
	await cleanupKeys(uploadOptions.provider, keys);

	return jsonResponse({ data: { id } });
}

/**
 * Best-effort storage cleanup — failures are logged, never thrown.
 */
async function cleanupKeys(
	provider: StorageProvider,
	keys: readonly string[],
): Promise<void> {
	for (const key of keys) {
		try {
			await provider.delete(key);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(
				`[Datrix Upload] Failed to delete storage object '${key}': ${message}`,
			);
		}
	}
}

function validateFileLimits(
	size: number,
	mimetype: string,
	options: UploadOptions,
): void {
	if (options.maxSize !== undefined && size > options.maxSize) {
		throw new DatrixApiError(
			`File size ${size} exceeds maximum allowed size ${options.maxSize}`,
			{ code: "FILE_TOO_LARGE", status: 400 },
		);
	}

	if (
		options.allowedMimeTypes !== undefined &&
		options.allowedMimeTypes.length > 0 &&
		!isMimeTypeAllowed(mimetype, options.allowedMimeTypes)
	) {
		throw new DatrixApiError(`MIME type ${mimetype} is not allowed`, {
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
