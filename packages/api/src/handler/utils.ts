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
 * Extract session ID from request cookies
 */
export function extractSessionId(request: Request): string | null {
	const cookieHeader = request.headers.get("cookie");
	if (!cookieHeader) return null;

	const match = cookieHeader.match(/sessionId=([^;]+)/);
	return match ? match[1]! : null;
}
