/**
 * Handler Type Definitions
 *
 * Types for creating HTTP request handlers for CRUD operations.
 * Framework-agnostic - works with Next.js, Express, Fastify, etc.
 */

import { DatabaseAdapter } from "../adapter";
import { SchemaDefinition } from "../core/schema";
import { Result } from "../utils";
import { ParsedQuery } from "./parser";



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
 * HTTP methods
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Request context (framework-agnostic)
 */
export interface RequestContext<TUser = unknown> {
  readonly method: HttpMethod;
  readonly params: Record<string, string>; // Path parameters (e.g., { id: "123" })
  readonly query: Record<string, string | readonly string[] | undefined>; // Query string
  readonly body: unknown; // Request body (already parsed as JSON)
  readonly headers: Record<string, string | undefined>; // Request headers
  readonly user: TUser | undefined; // Authenticated user (if any)
  readonly metadata: Record<string, unknown>; // Additional metadata
}

/**
 * Response data
 */
export interface ResponseData<T = unknown> {
  readonly data: T;
  readonly meta?: ResponseMeta;
}

/**
 * Response metadata
 */
export interface ResponseMeta {
  readonly pagination?: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly pageCount: number;
  };
  readonly [key: string]: unknown;
}

/**
 * Handler response (framework-agnostic)
 */
export interface HandlerResponse<T = unknown> {
  readonly status: number;
  readonly body: ResponseData<T> | ErrorResponse;
  readonly headers?: Record<string, string>;
}

/**
 * Error response
 */
export interface ErrorResponse {
  readonly error: {
    readonly message: string;
    readonly code: string;
    readonly details?: unknown;
  };
}

/**
 * Handler function type
 */
export type HandlerFunction<TUser = unknown> = (
  context: RequestContext<TUser>
) => Promise<HandlerResponse>;

/**
 * Middleware function type
 */
export type Middleware<TUser = unknown> = (
  context: RequestContext<TUser>,
  next: () => Promise<HandlerResponse>
) => Promise<HandlerResponse>;

/**
 * Permission check function
 */
export type PermissionCheck<TUser = unknown> =
  | readonly string[] // Array of required roles
  | ((context: RequestContext<TUser>) => boolean | Promise<boolean>); // Custom function

/**
 * Handler configuration
 */
export interface HandlerConfig<TUser = unknown> {
  readonly schema: SchemaDefinition;
  readonly adapter: DatabaseAdapter;
  readonly middleware?: readonly Middleware<TUser>[];
  readonly permissions?: {
    readonly read?: PermissionCheck<TUser>;
    readonly create?: PermissionCheck<TUser>;
    readonly update?: PermissionCheck<TUser>;
    readonly delete?: PermissionCheck<TUser>;
  };
  readonly hooks?: {
    readonly beforeFind?: (
      context: RequestContext<TUser>,
      query: ParsedQuery
    ) => Promise<ParsedQuery> | ParsedQuery;
    readonly afterFind?: <T>(
      context: RequestContext<TUser>,
      data: T
    ) => Promise<T> | T;
    readonly beforeCreate?: (
      context: RequestContext<TUser>,
      data: Record<string, unknown>
    ) => Promise<Record<string, unknown>> | Record<string, unknown>;
    readonly afterCreate?: <T>(
      context: RequestContext<TUser>,
      data: T
    ) => Promise<T> | T;
    readonly beforeUpdate?: (
      context: RequestContext<TUser>,
      id: string,
      data: Record<string, unknown>
    ) => Promise<Record<string, unknown>> | Record<string, unknown>;
    readonly afterUpdate?: <T>(
      context: RequestContext<TUser>,
      data: T
    ) => Promise<T> | T;
    readonly beforeDelete?: (
      context: RequestContext<TUser>,
      id: string
    ) => Promise<void> | void;
    readonly afterDelete?: (
      context: RequestContext<TUser>,
      id: string
    ) => Promise<void> | void;
  };
  readonly options?: {
    readonly maxPageSize?: number;
    readonly defaultPageSize?: number;
    readonly maxPopulateDepth?: number;
  };
}

/**
 * CRUD operation type
 */
export type CrudOperation = 'findMany' | 'findOne' | 'create' | 'update' | 'delete' | 'count';

/**
 * CRUD handler
 */
export interface CrudHandler<TUser = unknown> {
  readonly findMany: (context: RequestContext<TUser>) => Promise<HandlerResponse>;
  readonly findOne: (context: RequestContext<TUser>) => Promise<HandlerResponse>;
  readonly create: (context: RequestContext<TUser>) => Promise<HandlerResponse>;
  readonly update: (context: RequestContext<TUser>) => Promise<HandlerResponse>;
  readonly delete: (context: RequestContext<TUser>) => Promise<HandlerResponse>;
  readonly count: (context: RequestContext<TUser>) => Promise<HandlerResponse>;
}

/**
 * Handler error
 */
export class HandlerError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown | undefined;

  constructor(
    message: string,
    options?: {
      status?: number;
      code?: string;
      details?: unknown;
    }
  ) {
    super(message);
    this.name = 'HandlerError';
    this.status = options?.status ?? 500;
    this.code = options?.code ?? 'INTERNAL_ERROR';
    this.details = options?.details;
  }
}

/**
 * Context builder function
 */
export type ContextBuilder<TUser = unknown> = (
  request: unknown
) => RequestContext<TUser> | Promise<RequestContext<TUser>>;

/**
 * Query execution result
 */
export type QueryExecutionResult<T = unknown> = Result<T, HandlerError>;

/**
 * Batch operation options
 */
export interface BatchOptions {
  readonly atomic?: boolean; // All or nothing
  readonly continueOnError?: boolean; // Continue even if some fail
}

/**
 * Batch operation result
 */
export interface BatchResult<T = unknown> {
  readonly success: readonly T[];
  readonly failed: readonly {
    readonly index: number;
    readonly error: HandlerError;
  }[];
}
