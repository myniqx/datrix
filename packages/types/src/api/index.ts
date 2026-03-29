/**
 * API Types
 *
 * Type definitions for the API module.
 */

import { DefaultPermission } from "../core/permission";
import { IForja } from "../forja";
import { IAuthManager } from "./auth";
import { IUpload } from "./upload";

export * from "./handler";
export * from "./parser";
export * from "./upload";

/**
 * Authenticated user
 */
export interface AuthUser {
	readonly id: number;
	readonly email: string;
	readonly role: string;
	readonly [key: string]: unknown;
}

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
	readonly authManager?: IAuthManager;

	/**
	 * Upload instance (undefined if upload is disabled)
	 */
	readonly upload?: IUpload;

	/**
	 * Currently authenticated user (null if not authenticated)
	 */
	readonly user: AuthUser | null;

	/**
	 * Forja instance
	 */
	readonly forja: IForja;

	/**
	 * Default permission for schemas without explicit permissions
	 */
	readonly authDefaultPermission: DefaultPermission<TRole> | undefined;

	/**
	 * Default role for new users
	 */
	readonly authDefaultRole: TRole | undefined;

	/**
	 * Schemas excluded from auto-generated routes (always includes internal Forja tables)
	 */
	readonly excludeSchemas: readonly string[];

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
	getAuthManager(): IAuthManager | undefined;

	/**
	 * Handle an HTTP request
	 */
	handleRequest(request: Request, forja: IForja): Promise<Response>;
}
