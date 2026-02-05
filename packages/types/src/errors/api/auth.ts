/**
 * Authentication Error
 *
 * Specialized error for authentication and authorization failures.
 * Extends ForjaError with auth-specific fields.
 */

import { ForjaError, type SerializedForjaError } from "../forja-error";

/**
 * Auth strategy types
 */
export type AuthStrategy = "jwt" | "session" | "password" | "permission";

/**
 * Auth error codes
 */
export type AuthErrorCode =
	| "AUTH_INVALID_CREDENTIALS"
	| "AUTH_USER_NOT_FOUND"
	| "AUTH_USER_EXISTS"
	| "AUTH_WEAK_PASSWORD"
	| "AUTH_TOKEN_EXPIRED"
	| "AUTH_TOKEN_INVALID"
	| "AUTH_SESSION_NOT_FOUND"
	| "AUTH_SESSION_EXPIRED"
	| "AUTH_SESSION_INVALID"
	| "AUTH_UNAUTHORIZED"
	| "AUTH_FORBIDDEN"
	| "AUTH_CONFIG_INVALID"
	| "JWT_SIGN_ERROR"
	| "JWT_VERIFY_ERROR"
	| "JWT_DECODE_ERROR"
	| "JWT_EXPIRED"
	| "JWT_INVALID_FORMAT"
	| "JWT_INVALID_HEADER"
	| "JWT_INVALID_PAYLOAD"
	| "JWT_INVALID_SIGNATURE"
	| "JWT_INVALID_IAT"
	| "JWT_INVALID_ISSUER"
	| "JWT_INVALID_AUDIENCE"
	| "SESSION_CREATE_ERROR"
	| "SESSION_DELETE_ERROR"
	| "SESSION_NOT_CONFIGURED"
	| "PASSWORD_HASH_ERROR"
	| "PASSWORD_VERIFY_ERROR"
	| "PASSWORD_TOO_SHORT"
	| "PASSWORD_TOO_LONG"
	| "PERMISSION_DENIED";

/**
 * Auth error context
 */
export interface AuthErrorContext {
	readonly strategy?: AuthStrategy | undefined;
	readonly userId?: string | undefined;
	readonly role?: string | undefined;
	readonly sessionId?: string | undefined;
	readonly action?: string | undefined;
	readonly resource?: string | undefined;
	readonly field?: string | undefined;
	readonly exp?: number | undefined;
	readonly iat?: number | undefined;
	readonly now?: number | undefined;
	readonly minLength?: number | undefined;
	readonly maxLength?: number | undefined;
	readonly receivedType?: string | undefined;
	readonly expectedType?: string | undefined;
	readonly [key: string]: unknown;
}

/**
 * Options for creating ForjaAuthError
 */
export interface ForjaAuthErrorOptions {
	readonly code: AuthErrorCode;
	readonly strategy?: AuthStrategy;
	readonly context?: AuthErrorContext | undefined;
	readonly cause?: Error | undefined;
	readonly suggestion?: string | undefined;
	readonly expected?: string | undefined;
	readonly received?: unknown | undefined;
}

/**
 * Serialized auth error for API responses
 */
export interface SerializedForjaAuthError extends SerializedForjaError {
	readonly strategy?: AuthStrategy;
}

/**
 * Forja Auth Error Class
 *
 * Specialized ForjaError for authentication and authorization failures.
 * Includes strategy type for better debugging.
 *
 * @example
 * ```ts
 * throw new ForjaAuthError('JWT token expired', {
 *   code: 'JWT_EXPIRED',
 *   strategy: 'jwt',
 *   context: { exp: 1234567890, now: 1234567900 },
 *   suggestion: 'Refresh your token or login again'
 * });
 * ```
 */
export class ForjaAuthError extends ForjaError<AuthErrorContext> {
	readonly strategy?: AuthStrategy | undefined;

	constructor(message: string, options: ForjaAuthErrorOptions) {
		super(message, {
			code: options.code,
			operation: options.strategy ? `auth:${options.strategy}` : "auth",
			context: options.context,
			cause: options.cause,
			suggestion: options.suggestion,
			expected: options.expected,
			received: options.received,
		});

		this.strategy = options.strategy;
	}

	/**
	 * Override toJSON to include auth-specific fields
	 */
	override toJSON(): SerializedForjaAuthError {
		const json = super.toJSON();

		if (this.strategy) {
			return {
				...json,
				strategy: this.strategy,
			};
		}

		return json;
	}

	/**
	 * Override toDetailedMessage to include auth-specific fields
	 */
	override toDetailedMessage(): string {
		const baseMessage = super.toDetailedMessage();

		if (this.strategy) {
			const parts = baseMessage.split("\n");
			parts.splice(3, 0, `  Strategy: ${this.strategy}`);
			return parts.join("\n");
		}

		return baseMessage;
	}
}
