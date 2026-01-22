/**
 * Middleware Types
 *
 * Type definitions for middleware system
 */

import type { ParsedQuery } from "forja-types/api/parser";
import type { SchemaDefinition } from "forja-types/core/schema";
import type { PermissionAction } from "forja-types/core/permission";
import type { Forja } from "forja-core";
import type { IApiPlugin } from "../interface";
import { AuthenticatedUser } from "forja-types/api/auth";

/**
 * HTTP Methods
 */
export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

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
  readonly id: string | null;

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
  readonly body: Record<string, unknown> | null;

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
  readonly user: AuthenticatedUser | null;

  /**
   * Forja instance for database operations
   */
  readonly forja: Forja;

  /**
   * API plugin instance
   */
  readonly api: IApiPlugin<TRole>;

  /**
   * Whether authentication is enabled
   */
  readonly authEnabled: boolean;
}

/**
 * Context Builder Options
 */
export interface ContextBuilderOptions {
  readonly apiPrefix?: string;
}
