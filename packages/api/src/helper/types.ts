/**
 * Handler Type Definitions
 *
 * Types for creating HTTP request handlers for CRUD operations.
 * Framework-agnostic - works with Next.js, Express, Fastify, etc.
 */

import { ForjaError } from "@forja/core/types/errors";
import { ForjaEntry } from "@forja/core/types";

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
	readonly url?: string;
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
	readonly extractQuery?: (
		request: unknown,
	) => Record<string, string | readonly string[] | undefined>;
	readonly extractBody?: (request: unknown) => Promise<unknown>;
	readonly metadata?: Record<string, unknown>;
}

/**
 * HTTP methods
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Request context (framework-agnostic)
 */
export interface RequestContext<TUser = unknown> {
	readonly method: HttpMethod;
	readonly params?: Record<string, string>; // Path parameters (e.g., { id: "123" })
	readonly query?: Record<string, string | readonly string[] | undefined>; // Query string
	readonly body?: unknown; // Request body (already parsed as JSON)
	readonly headers?: Record<string, string | undefined>; // Request headers
	readonly user?: TUser | undefined; // Authenticated user (if any)
	readonly metadata?: Record<string, unknown>; // Additional metadata
}

/**
 * Response data
 */
export interface ResponseMultiData<T extends ForjaEntry> {
	readonly data: Partial<T>[];
	readonly meta?: PaginationMeta;
}

export interface ExportSingleData<T extends ForjaEntry> {
	readonly data: Partial<T>;
}

/**
 * Pagination metadata for list responses
 */
export interface PaginationMeta {
	readonly total: number;
	readonly page: number;
	readonly pageSize: number;
	readonly totalPages: number;
}

/**
 * Handler response (framework-agnostic)
 */
export interface HandlerResponse<T extends ForjaEntry> {
	readonly status: number;
	readonly body: ResponseMultiData<T> | ForjaError;
	readonly headers?: Record<string, string>;
}
