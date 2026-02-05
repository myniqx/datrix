/**
 * Auth Specific Errors
 */

import { ApiError } from "./api-error";
import type { Result } from "forja-types/utils";

/**
 * Auth Error Helper
 */
export const authError = {
	invalidCredentials(): Result<never, ApiError> {
		return {
			success: false,
			error: new ApiError("Invalid email or password", {
				code: "INVALID_CREDENTIALS",
				status: 401,
				suggestion: "Please check your email and password and try again.",
			}),
		};
	},

	invalidToken(reason?: string): Result<never, ApiError> {
		return {
			success: false,
			error: new ApiError("Invalid or expired authentication token", {
				code: "INVALID_TOKEN",
				status: 401,
				context: { reason },
				suggestion: "Please log in again to obtain a new session.",
			}),
		};
	},

	missingToken(): Result<never, ApiError> {
		return {
			success: false,
			error: new ApiError("Authentication token is missing", {
				code: "MISSING_TOKEN",
				status: 401,
				suggestion:
					"Include an Authorization header or a session cookie in your request.",
			}),
		};
	},

	sessionExpired(): Result<never, ApiError> {
		return {
			success: false,
			error: new ApiError("Your session has expired", {
				code: "SESSION_EXPIRED",
				status: 401,
				suggestion: "Log in again to continue using the application.",
			}),
		};
	},

	accountLocked(reason?: string): Result<never, ApiError> {
		return {
			success: false,
			error: new ApiError("This account has been locked", {
				code: "ACCOUNT_LOCKED",
				status: 403,
				context: { reason },
				suggestion: "Contact support to unlock your account.",
			}),
		};
	},
};
