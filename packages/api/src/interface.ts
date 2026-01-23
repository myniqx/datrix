/**
 * API Plugin Interface
 *
 * Central interface for ApiPlugin class.
 * Used to avoid circular dependencies across the API package.
 *
 * @template TRole - Union type of valid role names
 */

import type { DefaultPermission } from "forja-types/core/permission";
import type { Forja } from "forja-core";
import type { AuthManager } from "./auth/manager";
import { AuthUser } from "forja-types/api";

/**
 * API Plugin Interface
 *
 * Defines the public contract for the API plugin.
 * All modules should depend on this interface, not the concrete class.
 */
export interface IApiPlugin<TRole extends string = string> {
  /**
   * Plugin name
   */
  readonly name: string;

  /**
   * Plugin version
   */
  readonly version: string;

  /**
   * Auth manager instance (undefined if auth is disabled)
   */
  readonly authManager?: AuthManager;

  /**
   * Currently authenticated user (null if not authenticated)
   */
  readonly user: AuthUser | null;

  /**
   * Forja instance
   */
  readonly forja: Forja;

  /**
   * Default permission for schemas without explicit permissions
   */
  readonly authDefaultPermission: DefaultPermission<TRole> | undefined;

  /**
   * Default role for new users
   */
  readonly authDefaultRole: TRole | undefined;

  /**
   * Check if API is enabled
   */
  isEnabled(): boolean;

  /**
   * Check if authentication is enabled
   */
  isAuthEnabled(): boolean;

  /**
   * Set the authenticated user for the current request
   */
  setUser(user: AuthUser | null): void;

  /**
   * Get the auth manager instance
   */
  getAuthManager(): AuthManager | undefined;

  /**
   * Handle an HTTP request
   */
  handleRequest(request: Request, forja: Forja): Promise<Response>;
}
