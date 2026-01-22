/**
 * Handler Utilities
 *
 * Shared utility functions for handlers
 */

import { ParserError } from "forja-types/api/parser";
import { ForjaError } from "forja-types/errors/base";
import { ApiError } from "../errors/api-error";
import { Result } from "forja-types";

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
 * Generic ForjaError to Response converter
 * Handles ApiError (with status), ParserError, and base ForjaError
 */
export function forjaErrorResponse({ error }: Result<never, ForjaError>): Response {
  const status = error instanceof ApiError ? error.status : 400;
  const serialized = error.toJSON();

  return jsonResponse(
    {
      error: {
        type: error.name,
        ...serialized,
      },
    },
    status
  );
}

/**
 * Create error response (Legacy support - will be phased out)
 * Use ApiError/forjaErrorResponse for new code
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
 * @deprecated Use forjaErrorResponse instead
 */
export function parserErrorResponse(error: ParserError): Response {
  return forjaErrorResponse({ error, success: false });
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
