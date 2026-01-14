/**
 * Context Builder Middleware
 *
 * Builds unified request context from raw request
 * This is the SINGLE PLACE where all request preprocessing happens
 */

import type { AuthManager } from '../auth/manager';
import type { RequestContext, HttpMethod, ContextBuilderOptions } from './types';
import { authenticate } from './auth';
import { parseQuery } from '../parser';

/**
 * Extract model name from URL path
 * /api/user -> 'user'
 * /api/user/123 -> 'user'
 */
function extractModelFromPath(pathname: string, prefix: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  const prefixSegments = prefix.split('/').filter(Boolean);
  const pathSegments = segments.slice(prefixSegments.length);

  if (pathSegments.length === 0) {
    return null;
  }

  return pathSegments[0] ?? null;
}

/**
 * Extract record ID from URL path
 * /api/user/123 -> '123'
 * /api/user -> null
 */
function extractIdFromPath(pathname: string, prefix: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  const prefixSegments = prefix.split('/').filter(Boolean);
  const pathSegments = segments.slice(prefixSegments.length);

  if (pathSegments.length < 2) {
    return null;
  }

  return pathSegments[1] ?? null;
}

/**
 * Build Request Context
 *
 * This is the CENTRALIZED place where:
 * 1. Authentication happens
 * 2. URL parsing happens
 * 3. Query parsing happens
 * 4. Body parsing happens
 *
 * ALL requests go through this function ONCE
 */
export async function buildRequestContext(
  request: Request,
  authManager: AuthManager,
  options: ContextBuilderOptions = {}
): Promise<RequestContext> {
  const apiPrefix = options.apiPrefix ?? '/api';
  const url = new URL(request.url);
  const method = request.method as HttpMethod;

  // 1. AUTHENTICATE (Single place!)
  // TODO: use auth only if its enabled!
  const user = (await authManager.authenticate(request))?.user ?? null;

  // 2. EXTRACT MODEL & ID
  const model = extractModelFromPath(url.pathname, apiPrefix);
  const id = extractIdFromPath(url.pathname, apiPrefix);

  // 3. PARSE QUERY (for GET requests)
  let query = null;
  if (method === 'GET') {
    const queryParams: Record<string, string | string[]> = {};
    url.searchParams.forEach((value, key) => {
      const existing = queryParams[key];
      if (existing !== undefined) {
        if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          queryParams[key] = [existing, value];
        }
      } else {
        queryParams[key] = value;
      }
    });

    const parseResult = parseQuery(queryParams);
    query = parseResult.success ? parseResult.data : null;
  }

  // 4. PARSE BODY (for POST/PATCH/PUT requests)
  let body = null;
  if (['POST', 'PATCH', 'PUT'].includes(method)) {
    try {
      const contentType = request.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        body = await request.json() as Record<string, unknown>;
      }
    } catch {
      // Invalid JSON, body stays null
    }
  }

  // 5. EXTRACT HEADERS
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // 6. BUILD CONTEXT
  return {
    user,
    model,
    id,
    method,
    query,
    body,
    headers,
    url,
    apiPrefix,
    request,
  };
}
