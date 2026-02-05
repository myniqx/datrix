/**
 * Auth Error Helper Functions
 *
 * Centralized error throwing functions for authentication module.
 * Provides consistent error messages and suggestions.
 */

import { ForjaAuthError } from "forja-types/errors";

// ============================================================================
// JWT Errors
// ============================================================================

/**
 * Throw JWT sign error
 *
 * @param cause - Original error
 */
export function throwJwtSignError(cause?: Error): never {
	throw new ForjaAuthError("Failed to sign JWT token", {
		code: "JWT_SIGN_ERROR",
		strategy: "jwt",
		cause,
		suggestion: "Check your JWT configuration and secret key",
	});
}

/**
 * Throw JWT verify error
 *
 * @param cause - Original error
 */
export function throwJwtVerifyError(cause?: Error): never {
	throw new ForjaAuthError("Failed to verify JWT token", {
		code: "JWT_VERIFY_ERROR",
		strategy: "jwt",
		cause,
		suggestion: "Ensure the token is valid and not tampered with",
	});
}

/**
 * Throw JWT decode error
 *
 * @param cause - Original error
 */
export function throwJwtDecodeError(cause?: Error): never {
	throw new ForjaAuthError("Failed to decode JWT token", {
		code: "JWT_DECODE_ERROR",
		strategy: "jwt",
		cause,
		suggestion: "Ensure the token format is correct",
	});
}

/**
 * Throw JWT invalid format error
 */
export function throwJwtInvalidFormat(): never {
	throw new ForjaAuthError("Invalid JWT format", {
		code: "JWT_INVALID_FORMAT",
		strategy: "jwt",
		suggestion: "JWT must be in format: header.payload.signature",
		expected: "three dot-separated base64url strings",
	});
}

/**
 * Throw JWT invalid header error
 */
export function throwJwtInvalidHeader(): never {
	throw new ForjaAuthError("Invalid JWT header", {
		code: "JWT_INVALID_HEADER",
		strategy: "jwt",
		suggestion: "Ensure the JWT header has correct algorithm and type",
		expected: 'header with typ: "JWT" and matching algorithm',
	});
}

/**
 * Throw JWT invalid payload error
 */
export function throwJwtInvalidPayload(): never {
	throw new ForjaAuthError("Invalid JWT payload", {
		code: "JWT_INVALID_PAYLOAD",
		strategy: "jwt",
		suggestion: "JWT payload must contain userId, role, iat, and exp fields",
		expected: "valid JWT payload with required fields",
	});
}

/**
 * Throw JWT invalid signature error
 */
export function throwJwtInvalidSignature(): never {
	throw new ForjaAuthError("Invalid JWT signature", {
		code: "JWT_INVALID_SIGNATURE",
		strategy: "jwt",
		suggestion: "Token may have been tampered with or signed with wrong secret",
		expected: "valid HMAC signature",
	});
}

/**
 * Throw JWT expired error
 *
 * @param exp - Token expiration timestamp
 * @param now - Current timestamp
 */
export function throwJwtExpired(exp: number, now: number): never {
	throw new ForjaAuthError("JWT token expired", {
		code: "JWT_EXPIRED",
		strategy: "jwt",
		context: { exp, now },
		suggestion: "Refresh your token or login again",
		expected: "token with exp > current time",
	});
}

/**
 * Throw JWT invalid issued at time error
 */
export function throwJwtInvalidIat(): never {
	throw new ForjaAuthError("JWT token issued in the future", {
		code: "JWT_INVALID_IAT",
		strategy: "jwt",
		suggestion: "Check your server time synchronization",
		expected: "token with iat <= current time (allowing 60s skew)",
	});
}

/**
 * Throw JWT invalid issuer error
 *
 * @param expected - Expected issuer
 * @param received - Received issuer
 */
export function throwJwtInvalidIssuer(
	expected: string,
	received: string | undefined,
): never {
	throw new ForjaAuthError("JWT issuer mismatch", {
		code: "JWT_INVALID_ISSUER",
		strategy: "jwt",
		expected,
		received,
		suggestion: `Token must be issued by: ${expected}`,
	});
}

/**
 * Throw JWT invalid audience error
 *
 * @param expected - Expected audience
 * @param received - Received audience
 */
export function throwJwtInvalidAudience(
	expected: string,
	received: string | undefined,
): never {
	throw new ForjaAuthError("JWT audience mismatch", {
		code: "JWT_INVALID_AUDIENCE",
		strategy: "jwt",
		expected,
		received,
		suggestion: `Token must be for audience: ${expected}`,
	});
}

// ============================================================================
// Session Errors
// ============================================================================

/**
 * Throw session create error
 *
 * @param cause - Original error
 */
export function throwSessionCreateError(cause?: Error): never {
	throw new ForjaAuthError("Failed to create session", {
		code: "SESSION_CREATE_ERROR",
		strategy: "session",
		cause,
		suggestion: "Check your session store configuration",
	});
}

/**
 * Throw session not found error
 *
 * @param sessionId - Session ID
 */
export function throwSessionNotFound(sessionId?: string): never {
	throw new ForjaAuthError("Session not found", {
		code: "AUTH_SESSION_NOT_FOUND",
		strategy: "session",
		context: { sessionId },
		suggestion: "Login again to create a new session",
	});
}

/**
 * Throw session expired error
 *
 * @param sessionId - Session ID
 */
export function throwSessionExpired(sessionId?: string): never {
	throw new ForjaAuthError("Session expired", {
		code: "AUTH_SESSION_EXPIRED",
		strategy: "session",
		context: { sessionId },
		suggestion: "Login again to create a new session",
	});
}

/**
 * Throw session delete error
 *
 * @param cause - Original error
 */
export function throwSessionDeleteError(cause?: Error): never {
	throw new ForjaAuthError("Failed to delete session", {
		code: "SESSION_DELETE_ERROR",
		strategy: "session",
		cause,
		suggestion: "Check your session store configuration",
	});
}

/**
 * Throw session not configured error
 */
export function throwSessionNotConfigured(): never {
	throw new ForjaAuthError("Session strategy not configured", {
		code: "SESSION_NOT_CONFIGURED",
		strategy: "session",
		suggestion: "Add session configuration to your auth config",
		expected: "AuthConfig.session to be defined",
	});
}

// ============================================================================
// Password Errors
// ============================================================================

/**
 * Throw password too short error
 *
 * @param minLength - Minimum password length
 * @param actualLength - Actual password length
 */
export function throwPasswordTooShort(
	minLength: number,
	actualLength: number,
): never {
	throw new ForjaAuthError(
		`Password must be at least ${minLength} characters`,
		{
			code: "PASSWORD_TOO_SHORT",
			strategy: "password",
			context: { minLength, actualLength },
			suggestion: `Use a password with at least ${minLength} characters`,
			expected: `password length >= ${minLength}`,
			received: actualLength,
		},
	);
}

/**
 * Throw password hash error
 *
 * @param cause - Original error
 */
export function throwPasswordHashError(cause?: Error): never {
	throw new ForjaAuthError("Failed to hash password", {
		code: "PASSWORD_HASH_ERROR",
		strategy: "password",
		cause,
		suggestion: "Check your password hashing configuration",
	});
}

/**
 * Throw password verify error
 *
 * @param cause - Original error
 */
export function throwPasswordVerifyError(cause?: Error): never {
	throw new ForjaAuthError("Failed to verify password", {
		code: "PASSWORD_VERIFY_ERROR",
		strategy: "password",
		cause,
		suggestion: "Ensure the password hash and salt are valid",
	});
}

// ============================================================================
// General Auth Errors
// ============================================================================

/**
 * Throw invalid credentials error
 */
export function throwInvalidCredentials(): never {
	throw new ForjaAuthError("Invalid email or password", {
		code: "AUTH_INVALID_CREDENTIALS",
		suggestion: "Check your email and password and try again",
	});
}

/**
 * Throw user not found error
 *
 * @param email - User email
 */
export function throwUserNotFound(email?: string): never {
	throw new ForjaAuthError("User not found", {
		code: "AUTH_USER_NOT_FOUND",
		context: { email },
		suggestion: email
			? `No user found with email: ${email}`
			: "User does not exist",
	});
}

/**
 * Throw user already exists error
 *
 * @param email - User email
 */
export function throwUserExists(email: string): never {
	throw new ForjaAuthError(`User with email ${email} already exists`, {
		code: "AUTH_USER_EXISTS",
		context: { email },
		suggestion: "Use a different email or try logging in",
	});
}

/**
 * Throw unauthorized error
 *
 * @param message - Custom message
 */
export function throwUnauthorized(message = "Authentication required"): never {
	throw new ForjaAuthError(message, {
		code: "AUTH_UNAUTHORIZED",
		suggestion: "Provide valid authentication credentials",
	});
}

/**
 * Throw forbidden error
 *
 * @param action - Action attempted
 * @param resource - Resource name
 * @param role - User role
 */
export function throwForbidden(
	action?: string,
	resource?: string,
	role?: string,
): never {
	const message =
		action && resource
			? `You don't have permission to ${action} ${resource}`
			: "Access forbidden";

	throw new ForjaAuthError(message, {
		code: "AUTH_FORBIDDEN",
		strategy: "permission",
		context: { action, resource, role },
		suggestion: "Contact your administrator for access",
	});
}

/**
 * Throw permission denied error
 *
 * @param action - Action attempted
 * @param resource - Resource name
 * @param field - Field name (optional)
 */
export function throwPermissionDenied(
	action: string,
	resource: string,
	field?: string,
): never {
	const message = field
		? `Permission denied: Cannot ${action} field "${field}" on ${resource}`
		: `Permission denied: Cannot ${action} ${resource}`;

	throw new ForjaAuthError(message, {
		code: "PERMISSION_DENIED",
		strategy: "permission",
		context: { action, resource, field },
		suggestion: "Check your role permissions",
	});
}

/**
 * Throw auth config invalid error
 *
 * @param message - Error message
 * @param field - Config field name
 */
export function throwAuthConfigInvalid(message: string, field?: string): never {
	throw new ForjaAuthError(message, {
		code: "AUTH_CONFIG_INVALID",
		context: { field },
		suggestion: "Check your authentication configuration",
	});
}
