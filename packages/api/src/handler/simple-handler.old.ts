/**
 * Forja API Handlers
 *
 * Simple HTTP handlers that connect REST API to Forja core.
 * Designed for Next.js App Router but framework-agnostic.
 */

import { getForja } from 'forja-core';
import { parseQuery } from '../parser';

/**
 * Extract model name from URL path
 * /api/users -> user
 * /api/users/123 -> user
 * /api/topics -> topic
 */
function extractModelFromPath(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);

  // Find segment after 'api'
  const apiIndex = segments.indexOf('api');
  if (apiIndex === -1 || apiIndex + 1 >= segments.length) {
    return null;
  }

  const modelPlural = segments[apiIndex + 1];
  if (!modelPlural) return null;

  // Plural to singular: users -> user, topics -> topic
  return modelPlural.endsWith('s') ? modelPlural.slice(0, -1) : modelPlural;
}

/**
 * Extract record ID from URL path
 * /api/users/123 -> "123"
 * /api/users -> null
 */
function extractIdFromPath(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);

  const apiIndex = segments.indexOf('api');
  if (apiIndex === -1 || apiIndex + 2 >= segments.length) {
    return null;
  }

  return segments[apiIndex + 2] ?? null;
}

/**
 * Parse query string from URL
 */
function parseQueryString(url: string): Record<string, string | string[]> {
  const urlObj = new URL(url, 'http://localhost');
  const params: Record<string, string | string[]> = {};

  urlObj.searchParams.forEach((value, key) => {
    const existing = params[key];
    if (existing !== undefined) {
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        params[key] = [existing, value];
      }
    } else {
      params[key] = value;
    }
  });

  return params;
}

/**
 * Create JSON response
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Create error response
 */
function errorResponse(message: string, code: string, status = 500): Response {
  return jsonResponse({ error: { message, code } }, status);
}

/**
 * GET handler - findMany or findOne
 */
export async function handleGet(request: Request): Promise<Response> {
  try {
    const forja = await getForja();
    const url = request.url;
    const model = extractModelFromPath(new URL(url).pathname);

    if (!model) {
      return errorResponse('Model not found in URL', 'MODEL_NOT_FOUND', 404);
    }

    if (!forja.hasSchema(model)) {
      return errorResponse(`Schema '${model}' not found`, 'SCHEMA_NOT_FOUND', 404);
    }

    const id = extractIdFromPath(new URL(url).pathname);
    const queryParams = parseQueryString(url);
    const parseResult = parseQuery(queryParams);

    if (!parseResult.success) {
      return errorResponse(parseResult.error.message, 'INVALID_QUERY', 400);
    }

    const { select, where, populate, orderBy, limit, offset } = parseResult.data;

    if (id) {
      // findOne by ID
      const record = await forja.findById(model, id, { select, populate });

      if (!record) {
        return errorResponse('Record not found', 'NOT_FOUND', 404);
      }

      return jsonResponse({ data: record });
    } else {
      // findMany
      const records = await forja.findMany(model, {
        where,
        select,
        populate,
        orderBy,
        limit,
        offset,
      });

      // Get total count for pagination
      const total = await forja.count(model, where);

      return jsonResponse({
        data: records,
        meta: {
          total,
          count: records.length,
          limit,
          offset,
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return errorResponse(message, 'INTERNAL_ERROR', 500);
  }
}

/**
 * POST handler - create
 */
export async function handlePost(request: Request): Promise<Response> {
  try {
    const forja = await getForja();
    const url = request.url;
    const model = extractModelFromPath(new URL(url).pathname);

    if (!model) {
      return errorResponse('Model not found in URL', 'MODEL_NOT_FOUND', 404);
    }

    if (!forja.hasSchema(model)) {
      return errorResponse(`Schema '${model}' not found`, 'SCHEMA_NOT_FOUND', 404);
    }

    const body = await request.json();

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return errorResponse('Invalid request body', 'INVALID_BODY', 400);
    }

    const record = await forja.create(model, body as Record<string, unknown>);

    return jsonResponse({ data: record }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return errorResponse(message, 'INTERNAL_ERROR', 500);
  }
}

/**
 * PATCH handler - update
 */
export async function handlePatch(request: Request): Promise<Response> {
  try {
    const forja = await getForja();
    const url = request.url;
    const model = extractModelFromPath(new URL(url).pathname);

    if (!model) {
      return errorResponse('Model not found in URL', 'MODEL_NOT_FOUND', 404);
    }

    if (!forja.hasSchema(model)) {
      return errorResponse(`Schema '${model}' not found`, 'SCHEMA_NOT_FOUND', 404);
    }

    const id = extractIdFromPath(new URL(url).pathname);

    if (!id) {
      return errorResponse('ID is required for update', 'MISSING_ID', 400);
    }

    const body = await request.json();

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return errorResponse('Invalid request body', 'INVALID_BODY', 400);
    }

    const record = await forja.update(model, id, body as Record<string, unknown>);

    return jsonResponse({ data: record });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return errorResponse(message, 'INTERNAL_ERROR', 500);
  }
}

/**
 * PUT handler - update (alias for PATCH)
 */
export const handlePut = handlePatch;

/**
 * DELETE handler - delete
 */
export async function handleDelete(request: Request): Promise<Response> {
  try {
    const forja = await getForja();
    const url = request.url;
    const model = extractModelFromPath(new URL(url).pathname);

    if (!model) {
      return errorResponse('Model not found in URL', 'MODEL_NOT_FOUND', 404);
    }

    if (!forja.hasSchema(model)) {
      return errorResponse(`Schema '${model}' not found`, 'SCHEMA_NOT_FOUND', 404);
    }

    const id = extractIdFromPath(new URL(url).pathname);

    if (!id) {
      return errorResponse('ID is required for delete', 'MISSING_ID', 400);
    }

    const deleted = await forja.delete(model, id);

    if (!deleted) {
      return errorResponse('Record not found', 'NOT_FOUND', 404);
    }

    return jsonResponse({ data: { id, deleted: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return errorResponse(message, 'INTERNAL_ERROR', 500);
  }
}
