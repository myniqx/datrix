/**
 * Handler Utilities
 *
 * Shared utility functions for handlers
 */

import { ParserError } from "@datrix/core";
import { DatrixError, DatrixValidationError } from "@datrix/core";
import { DatrixApiError } from "../errors/api-error";

/**
 * Create JSON response
 */
export function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Generic DatrixError to Response converter
 * Handles ApiError (with status), DatrixValidationError (400), and base DatrixError
 */
export function datrixErrorResponse(
	error: DatrixApiError | DatrixError,
): Response {
	let status = 400;

	if (error instanceof DatrixApiError) {
		status = error.status;
	} else if (error instanceof DatrixValidationError) {
		status = 400;
	}

	const serialized = error.toJSON();

	return jsonResponse(
		{
			error: {
				...serialized,
				type: error.name,
			},
		},
		status,
	);
}

/**
 * Create error response (Legacy support - will be phased out)
 * Use ApiError/datrixErrorResponse for new code
 */
export function errorResponse(
	message: string,
	code: string,
	status = 500,
): Response {
	return jsonResponse({ error: { message, code } }, status);
}

/**
 * Create detailed parser error response
 * @deprecated Use datrixErrorResponse instead
 */
export function parserErrorResponse(error: ParserError): Response {
	return datrixErrorResponse(error);
}

/**
 * Parse a Cookie header into a name → value map.
 * Shared by all cookie consumers — exact-name lookups only.
 */
export function parseCookies(
	cookieHeader: string | null,
): Record<string, string> {
	const cookies: Record<string, string> = {};
	if (!cookieHeader) return cookies;

	for (const part of cookieHeader.split(";")) {
		const eqIndex = part.indexOf("=");
		if (eqIndex === -1) continue;
		const key = part.slice(0, eqIndex).trim();
		const value = part.slice(eqIndex + 1).trim();
		if (key) {
			cookies[key] = value;
		}
	}

	return cookies;
}

/**
 * Extract session ID from request cookies
 */
export function extractSessionId(request: Request): string | null {
	return parseCookies(request.headers.get("cookie"))["sessionId"] ?? null;
}
