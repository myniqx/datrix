/**
 * Handler Utilities
 *
 * Shared utility functions for handlers
 */

import { ParserError } from "forja-types/api/parser";

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
 * Create error response
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
 * Uses ParserError.toJSON() for rich error context
 */
export function parserErrorResponse(error: ParserError): Response {
  const serialized = error.toJSON();

  return new Response(
    JSON.stringify({
      error: {
        type: "ParserError",
        ...serialized,
      },
    }),
    {
      status: 400, // Parser errors are client errors
      headers: { "Content-Type": "application/json" },
    }
  );
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
