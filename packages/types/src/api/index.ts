/**
 * API Types
 *
 * Type definitions for the API module.
 */

export * from "./handler";
export * from "./parser";

/**
 * Authenticated user
 */
export interface AuthUser {
	readonly id: number;
	readonly email: string;
	readonly role: string;
	readonly [key: string]: unknown;
}
