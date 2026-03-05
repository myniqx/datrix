/**
 * Auth Specific Errors
 */

import { ForjaApiError } from "./api-error";

/**
 * Auth Error Helper
 */
export const authError = {
	invalidCredentials(): ForjaApiError {
		return new ForjaApiError("Invalid email or password", {
			code: "INVALID_CREDENTIALS",
			status: 401,
			suggestion: "Please check your email and password and try again.",
		});
	},

	invalidToken(reason?: string): ForjaApiError {
		return new ForjaApiError("Invalid or expired authentication token", {
			code: "INVALID_TOKEN",
			status: 401,
			context: { reason },
			suggestion: "Please log in again to obtain a new session.",
		});
	},

	missingToken(): ForjaApiError {
		return new ForjaApiError("Authentication token is missing", {
			code: "MISSING_TOKEN",
			status: 401,
			suggestion:
				"Include an Authorization header or a session cookie in your request.",
		});
	},

	sessionExpired(): ForjaApiError {
		return new ForjaApiError("Your session has expired", {
			code: "SESSION_EXPIRED",
			status: 401,
			suggestion: "Log in again to continue using the application.",
		});
	},

	accountLocked(reason?: string): ForjaApiError {
		return new ForjaApiError("This account has been locked", {
			code: "ACCOUNT_LOCKED",
			status: 403,
			context: { reason },
			suggestion: "Contact support to unlock your account.",
		});
	},
};
