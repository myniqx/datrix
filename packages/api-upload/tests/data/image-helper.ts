/**
 * Image Test Helpers
 *
 * Generates real PNG images using sharp for upload tests.
 * Creates checkerboard patterns at any given resolution.
 */

import sharp from "sharp";

/**
 * Generate a checkerboard (black/white) PNG image buffer at the given dimensions.
 * Each square in the pattern is squareSize×squareSize pixels.
 */
export async function createCheckerboardPng(
	width: number,
	height: number,
	squareSize = 16,
): Promise<Buffer> {
	const raw = Buffer.alloc(width * height * 3);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = (y * width + x) * 3;
			const isWhite =
				Math.floor(x / squareSize) % 2 === Math.floor(y / squareSize) % 2;
			const value = isWhite ? 255 : 0;
			raw[idx] = value;
			raw[idx + 1] = value;
			raw[idx + 2] = value;
		}
	}

	return sharp(raw, {
		raw: { width, height, channels: 3 },
	})
		.png()
		.toBuffer();
}

/**
 * Create a multipart/form-data FormData with a single "file" field
 * containing the provided buffer as a PNG file.
 */
export function createImageFormData(
	buffer: Buffer,
	filename = "test-image.png",
	mimeType = "image/png",
): FormData {
	const form = new FormData();
	const blob = new Blob([buffer], { type: mimeType });
	form.append("file", blob, filename);
	return form;
}

/**
 * Create a multipart upload Request for POST /api/upload.
 */
export function createUploadRequest(
	url: string,
	form: FormData,
	token?: string,
): Request {
	const headers: Record<string, string> = {};
	if (token !== undefined) {
		headers["Authorization"] = `Bearer ${token}`;
	}
	const fullUrl = url.startsWith("/") ? `http://localhost:3000${url}` : url;
	return new Request(fullUrl, {
		method: "POST",
		headers,
		body: form,
	});
}

/**
 * Create a JSON DELETE request for DELETE /api/upload/:id.
 */
export function createDeleteRequest(url: string, token?: string): Request {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (token !== undefined) {
		headers["Authorization"] = `Bearer ${token}`;
	}
	const fullUrl = url.startsWith("/") ? `http://localhost:3000${url}` : url;
	return new Request(fullUrl, { method: "DELETE", headers });
}

/**
 * Create a GET request for /api/upload or /api/upload/:id.
 */
export function createGetRequest(url: string, token?: string): Request {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (token !== undefined) {
		headers["Authorization"] = `Bearer ${token}`;
	}
	const fullUrl = url.startsWith("/") ? `http://localhost:3000${url}` : url;
	return new Request(fullUrl, { method: "GET", headers });
}
