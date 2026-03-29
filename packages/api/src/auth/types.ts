/**
 * Authentication Plugin Types
 *
 * Type definitions for the authentication plugin including JWT and Session.
 * Permission/RBAC types are now in forja-types/core/permission.
 */

import type { DefaultPermission } from "forja-types/core/permission";
import type { PasswordConfig } from "./password";
import { AuthUser } from "forja-types/api";

/**
 * JWT payload (base)
 */
export interface JwtPayload {
	readonly userId: number;
	readonly role: string;
	readonly iat: number;
	readonly exp: number;
	readonly iss?: string;
	readonly aud?: string;
	readonly [key: string]: unknown;
}

/**
 * Session store interface
 *
 * Implement this to use a custom session backend (Redis, database, etc.)
 */
export interface SessionStore {
	get(sessionId: string): Promise<SessionData | undefined>;
	set(sessionId: string, data: SessionData): Promise<void>;
	delete(sessionId: string): Promise<void>;
	cleanup(): Promise<number>;
	clear(): Promise<void>;
}

/**
 * Session data
 */
export interface SessionData {
	readonly id: string;
	readonly userId: number;
	readonly role: string;
	readonly createdAt: Date;
	readonly expiresAt: Date;
	readonly lastAccessedAt: Date;
	readonly [key: string]: unknown;
}

/**
 * JWT algorithm types
 */
export type JwtAlgorithm = "HS256" | "HS512";

/**
 * Time unit for expiration
 */
export type TimeUnit = "s" | "m" | "h" | "d";

/**
 * Expiry string format (e.g., "1h", "7d", "30m")
 */
export type ExpiryString = `${number}${TimeUnit}`;

/**
 * JWT configuration
 */
export interface JwtConfig {
	readonly secret: string;
	readonly expiresIn?: ExpiryString | number; // String like "1h" or seconds as number
	readonly algorithm?: JwtAlgorithm;
	readonly issuer?: string;
	readonly audience?: string;
}

/**
 * JWT token parts
 */
export interface JwtToken {
	readonly header: JwtHeader;
	readonly payload: JwtPayload;
	readonly signature: string;
}

/**
 * JWT header
 */
export interface JwtHeader {
	readonly alg: JwtAlgorithm;
	readonly typ: "JWT";
}

/**
 * Session configuration
 */
export interface SessionConfig {
	/**
	 * Session storage backend.
	 * Pass a custom SessionStore implementation for Redis, database, etc.
	 * Defaults to in-memory store.
	 */
	readonly store?: "memory" | SessionStore;
	readonly maxAge?: number; // seconds
	readonly checkPeriod?: number; // cleanup interval in seconds
	readonly prefix?: string; // session key prefix (only used with default memory store)
}

/**
 * Authentication configuration
 *
 * When auth is defined in ApiConfig, authentication is enabled.
 * When auth is undefined, authentication is disabled.
 *
 * @template TRole - Union type of valid role names
 */
export interface AuthConfig<TRole extends string = string> {
	/**
	 * Available roles in the application
	 */
	readonly roles: readonly TRole[];

	/**
	 * Default role for new users
	 */
	readonly defaultRole: TRole;

	/**
	 * Default permission applied to schemas without explicit permissions
	 */
	readonly defaultPermission?: DefaultPermission<TRole>;

	/**
	 * JWT configuration (required if not using session)
	 */
	readonly jwt?: JwtConfig;

	/**
	 * Session configuration (required if not using JWT)
	 */
	readonly session?: SessionConfig;

	/**
	 * Password hashing configuration (PBKDF2)
	 * @default { iterations: 100000, keyLength: 64, minLength: 8 }
	 */
	readonly password?: PasswordConfig;

	/**
	 * Name for the authentication schema/table
	 * @default 'authentication'
	 */
	readonly authSchemaName?: string;

	/**
	 * User schema configuration
	 */
	readonly userSchema?: {
		/** User schema name @default 'user' */
		readonly name?: string;
		/** Email field name @default 'email' */
		readonly email?: string;
	};

	/**
	 * Auth endpoint configuration
	 */
	readonly endpoints?: {
		readonly login?: string;
		readonly register?: string;
		readonly logout?: string;
		readonly me?: string;
		readonly disableRegister?: boolean;
	};
}

/**
 * @deprecated Use AuthConfig instead
 */
export type AuthPluginOptions = AuthConfig<string>;

/**
 * Login credentials
 */
export interface LoginCredentials {
	readonly email: string;
	readonly password: string;
}

/**
 * Password hash result
 */
export interface PasswordHash {
	readonly hash: string;
	readonly salt: string;
}

/**
 * Type guard for JWT payload
 */
export function isJwtPayload(value: unknown): value is JwtPayload {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const obj = value as Record<string, unknown>;

	return (
		"userId" in obj &&
		"role" in obj &&
		"iat" in obj &&
		"exp" in obj &&
		typeof obj["userId"] === "number" &&
		typeof obj["role"] === "string" &&
		typeof obj["iat"] === "number" &&
		typeof obj["exp"] === "number"
	);
}

/**
 * Type guard for session data
 */
export function isSessionData(value: unknown): value is SessionData {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const obj = value as Record<string, unknown>;

	return (
		"id" in obj &&
		"userId" in obj &&
		"role" in obj &&
		"createdAt" in obj &&
		"expiresAt" in obj &&
		"lastAccessedAt" in obj &&
		typeof obj["id"] === "string" &&
		typeof obj["userId"] === "string" &&
		typeof obj["role"] === "string" &&
		obj["createdAt"] instanceof Date &&
		obj["expiresAt"] instanceof Date &&
		obj["lastAccessedAt"] instanceof Date
	);
}

/**
 * Minimum JWT secret length (256 bits = 32 characters for HS256)
 */
const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Type guard for auth config
 */
export function isAuthConfig(value: unknown): value is AuthConfig<string> {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const opts = value as Record<string, unknown>;

	// roles and defaultRole are required
	if (!("roles" in opts) || !Array.isArray(opts["roles"])) {
		return false;
	}

	if (!("defaultRole" in opts) || typeof opts["defaultRole"] !== "string") {
		return false;
	}

	// At least one auth strategy must be configured
	if (!("jwt" in opts) && !("session" in opts)) {
		return false;
	}

	// Validate JWT config if present
	if ("jwt" in opts && opts["jwt"] !== undefined) {
		if (typeof opts["jwt"] !== "object" || opts["jwt"] === null) {
			return false;
		}
		const jwt = opts["jwt"] as Record<string, unknown>;
		if (
			!("secret" in jwt) ||
			typeof jwt["secret"] !== "string" ||
			jwt["secret"].length < MIN_JWT_SECRET_LENGTH
		) {
			return false;
		}
	}

	return true;
}

/**
 * @deprecated Use isAuthConfig instead
 */
export const isAuthPluginOptions = isAuthConfig;
