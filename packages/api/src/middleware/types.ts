/**
 * Middleware Types
 *
 * Type definitions for middleware system
 */

import type { ParsedQuery } from "@datrix/core";
import type { SchemaDefinition } from "@datrix/core";
import type { PermissionAction } from "@datrix/core";
import type { Datrix } from "@datrix/core";
import { AuthUser, IApiPlugin } from "@datrix/core";
import { FallbackInput } from "@datrix/core";

/**
 * HTTP Methods
 *
 * QUERY is the IETF safe-method-with-body for complex reads;
 * POST /:model/query is the portable alias for runtimes that drop it.
 */
export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "QUERY";

/**
 * Request Context
 *
 * Unified context object containing all request information.
 * Single source of truth for the entire request lifecycle.
 */
export interface RequestContext<TRole extends string = string> {
	/**
	 * Resolved schema from URL (null if not found)
	 * Access model name via schema.name, table name via schema.tableName
	 */
	readonly schema: SchemaDefinition | null;

	/**
	 * Permission action derived from HTTP method
	 */
	readonly action: PermissionAction;

	/**
	 * Record ID (for single record operations)
	 */
	readonly id: number | null;

	/**
	 * HTTP method
	 */
	readonly method: HttpMethod;

	/**
	 * Parsed query parameters (for GET requests)
	 */
	readonly query: ParsedQuery | null;

	/**
	 * Request body (for POST/PATCH/PUT requests)
	 */
	readonly body: FallbackInput | null;

	/**
	 * Request headers
	 */
	readonly headers: Record<string, string>;

	/**
	 * Request URL
	 */
	readonly url: URL;

	/**
	 * Raw request object
	 */
	readonly request: Request;

	/**
	 * Authenticated user (null if not authenticated or auth disabled)
	 */
	readonly user: AuthUser | null;

	/**
	 * Datrix instance for database operations
	 */
	readonly datrix: Datrix;

	/**
	 * API plugin instance
	 */
	readonly api: IApiPlugin<TRole>;

	/**
	 * Whether authentication is enabled
	 */
	readonly authEnabled: boolean;

	/**
	 * True for QUERY requests and the POST /:model/query alias.
	 * The validated body query is exposed via `query`; `body` stays null.
	 */
	readonly isQueryRequest: boolean;

	/**
	 * Effective pagination/populate limits (plugin config or defaults)
	 */
	readonly limits: RequestLimits;
}

/**
 * Effective request limits resolved from the plugin config
 */
export interface RequestLimits {
	readonly defaultPageSize: number;
	readonly maxPageSize: number;
	readonly maxPopulateDepth: number;
}

/**
 * Context Builder Options
 */
export interface ContextBuilderOptions {
	readonly apiPrefix?: string;
	readonly defaultPageSize?: number | undefined;
	readonly maxPageSize?: number | undefined;
	readonly maxPopulateDepth?: number | undefined;
}
