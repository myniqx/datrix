/**
 * Request Context Builder
 *
 * Builds RequestContext from framework-specific request objects.
 * Provides adapters for popular frameworks (Next.js, Express, etc.)
 */

import type { RequestContext, HttpMethod } from './types';

/**
 * Next.js App Router request
 */
export interface NextAppRequest {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Headers;
  readonly nextUrl?: {
    readonly searchParams: URLSearchParams;
  };
}

/**
 * Next.js Pages Router request
 */
export interface NextPagesRequest {
  readonly method?: string;
  readonly query: Record<string, string | readonly string[]>;
  readonly body?: unknown;
  readonly headers: Record<string, string | readonly string[] | undefined>;
}

/**
 * Express-like request
 */
export interface ExpressLikeRequest {
  readonly method: string;
  readonly params: Record<string, string>;
  readonly query: Record<string, string | readonly string[] | undefined>;
  readonly body: unknown;
  readonly headers: Record<string, string | readonly string[] | undefined>;
  readonly user?: unknown;
}

/**
 * Generic HTTP request (minimum interface)
 */
export interface GenericHttpRequest {
  readonly method: string;
  readonly url?: string;
  readonly headers: Record<string, string | undefined> | Headers;
  readonly body?: unknown;
}

/**
 * Context builder options
 */
export interface ContextBuilderOptions<TUser = unknown> {
  readonly extractUser?: (request: unknown) => TUser | undefined;
  readonly extractParams?: (request: unknown) => Record<string, string>;
  readonly extractQuery?: (request: unknown) => Record<string, string | readonly string[] | undefined>;
  readonly extractBody?: (request: unknown) => Promise<unknown>;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Build RequestContext from Next.js App Router request
 */
export async function buildContextFromNextApp<TUser = unknown>(
  request: Request,
  options?: ContextBuilderOptions<TUser>
): Promise<RequestContext<TUser>> {
  const method = (request.method?.toUpperCase() ?? 'GET') as HttpMethod;

  // Extract query from URL
  const url = new URL(request.url);
  const query: Record<string, string | readonly string[] | undefined> = {};
  url.searchParams.forEach((value, key) => {
    const existing = query[key];
    if (existing === undefined) {
      query[key] = value;
    } else if (Array.isArray(existing)) {
      query[key] = [...existing, value];
    } else if (typeof existing === 'string') {
      query[key] = [existing, value];
    }
  });

  // Extract headers
  const headers: Record<string, string | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // Extract body
  let body: unknown;
  if (method !== 'GET' && method !== 'DELETE') {
    try {
      const contentType = headers['content-type'];
      if (contentType?.includes('application/json')) {
        body = await request.json();
      } else {
        body = await request.text();
      }
    } catch {
      body = undefined;
    }
  }

  // Extract user if custom extractor provided
  const user = options?.extractUser?.(request);

  // Extract params if custom extractor provided
  const params = options?.extractParams?.(request) ?? {};

  return {
    method,
    params,
    query,
    body,
    headers,
    user,
    metadata: options?.metadata ?? {}
  };
}

/**
 * Build RequestContext from Express-like request
 */
export function buildContextFromExpress<TUser = unknown>(
  request: ExpressLikeRequest,
  options?: ContextBuilderOptions<TUser>
): RequestContext<TUser> {
  const method = (request.method?.toUpperCase() ?? 'GET') as HttpMethod;

  // Normalize headers
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') {
      headers[key] = value;
    } else if (Array.isArray(value)) {
      headers[key] = value[0];
    }
  }

  // Extract user
  const user = (options?.extractUser?.(request) ?? request.user) as TUser | undefined;

  return {
    method,
    params: request.params ?? {},
    query: request.query ?? {},
    body: request.body,
    headers,
    user,
    metadata: options?.metadata ?? {}
  };
}

/**
 * Build RequestContext from generic HTTP request
 */
export function buildContextFromGeneric<TUser = unknown>(
  request: GenericHttpRequest,
  options?: ContextBuilderOptions<TUser>
): RequestContext<TUser> {
  const method = (request.method?.toUpperCase() ?? 'GET') as HttpMethod;

  // Extract headers
  const headers: Record<string, string | undefined> = {};
  if (request.headers instanceof Headers) {
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
  } else {
    Object.assign(headers, request.headers);
  }

  // Extract query from URL if available
  let query: Record<string, string | readonly string[] | undefined> = {};
  if (request.url) {
    try {
      const url = new URL(request.url);
      url.searchParams.forEach((value, key) => {
        const existing = query[key];
        if (existing === undefined) {
          query[key] = value;
        } else if (Array.isArray(existing)) {
          query[key] = [...existing, value];
        } else if (typeof existing === 'string') {
          query[key] = [existing, value];
        }
      });
    } catch {
      // Invalid URL, ignore
    }
  }

  // Use custom query extractor if provided
  if (options?.extractQuery) {
    query = options.extractQuery(request);
  }

  // Extract params
  const params = options?.extractParams?.(request) ?? {};

  // Extract user
  const user = options?.extractUser?.(request);

  return {
    method,
    params,
    query,
    body: request.body,
    headers,
    user,
    metadata: options?.metadata ?? {}
  };
}

/**
 * Type guard to check if request is Express-like
 */
export function isExpressLikeRequest(request: unknown): request is ExpressLikeRequest {
  return (
    typeof request === 'object' &&
    request !== null &&
    'method' in request &&
    'params' in request &&
    'query' in request
  );
}

/**
 * Type guard to check if request is Next.js Request
 */
export function isNextRequest(request: unknown): request is Request {
  return (
    typeof request === 'object' &&
    request !== null &&
    request instanceof Request
  );
}

/**
 * Auto-detect request type and build context
 */
export async function buildContext<TUser = unknown>(
  request: unknown,
  options?: ContextBuilderOptions<TUser>
): Promise<RequestContext<TUser>> {
  if (isNextRequest(request)) {
    return await buildContextFromNextApp(request, options);
  }

  if (isExpressLikeRequest(request)) {
    return buildContextFromExpress(request, options);
  }

  // Fallback to generic
  return buildContextFromGeneric(request as GenericHttpRequest, options);
}
