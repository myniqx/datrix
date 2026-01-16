/**
 * Middleware Types
 *
 * Type definitions for middleware system
 */

import type { ParsedQuery } from 'forja-types/api/parser';

/**
 * HTTP Methods
 */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

// PermissionAction is now imported from forja-types/core/permission

/**
 * Authenticated User (from token/session)
 */
export interface AuthenticatedUser {
  readonly id: string;
  readonly role: string;
  readonly email?: string;
  readonly [key: string]: unknown;
}

/**
 * Request Context
 *
 * Centralized context object containing all request information
 */
export interface RequestContext {
  /**
   * Authenticated user (null if not authenticated)
   */
  readonly user: AuthenticatedUser | null;

  /**
   * Model name extracted from URL
   */
  readonly model: string | null;

  /**
   * Table name extracted from URL
   */
  readonly tableName: string | null;

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
   * API prefix (e.g., '/api')
   */
  readonly apiPrefix: string;

  /**
   * Raw request object
   */
  readonly request: Request;
}

/**
 * Context Builder Options
 */
export interface ContextBuilderOptions {
  readonly apiPrefix?: string;
}
