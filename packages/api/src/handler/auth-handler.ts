/**
 * Auth Handlers
 *
 * HTTP handlers for authentication endpoints:
 * - POST /auth/register - Register new user
 * - POST /auth/login - Login user
 * - POST /auth/logout - Logout user
 * - GET /auth/me - Get current user
 *
 * Authentication data is stored in the 'authentication' table,
 * separate from user business data in the 'user' table.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Datrix } from "@datrix/core";
import { DEFAULT_API_AUTH_CONFIG } from "@datrix/core";
import { AuthManager } from "../auth/manager";
import type { AuthConfig } from "../auth/types";
import { jsonResponse, extractSessionId, datrixErrorResponse } from "./utils";
import { authError } from "../errors/auth-error";
import { handlerError } from "../errors/api-error";
import { DatrixError } from "@datrix/core";
import { AuthenticatedUser } from "@datrix/core";
import { DatrixEntry } from "@datrix/core";
import { AuthUser } from "@datrix/core";
import { FallbackValue } from "@datrix/core";
import { FallbackInput } from "@datrix/core";
import { LoginResult } from "@datrix/core";

/**
 * Fixed-format credentials used to equalize the timing of the "account not
 * found" and "wrong password" paths (PBKDF2 runs in both cases).
 */
const DUMMY_HASH = "0".repeat(128);
const DUMMY_SALT = "0".repeat(64);

/**
 * Reset tokens are bearer credentials — only their SHA-256 digest is stored.
 */
function hashResetToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/**
 * Auth Handler Configuration
 */
export interface AuthHandlerConfig<
	TRole extends string = string,
	TUser extends DatrixEntry = DatrixEntry,
> {
	readonly datrix: Datrix;
	readonly authManager: AuthManager<TRole, TUser>;
	readonly authConfig: AuthConfig<TRole, TUser>;
}

/**
 * Auth Handlers Factory
 *
 * Creates authentication endpoint handlers
 */
export function createAuthHandlers<
	TRole extends string = string,
	TUser extends DatrixEntry = DatrixEntry,
>(config: AuthHandlerConfig<TRole, TUser>) {
	const { datrix, authManager, authConfig } = config;

	const userSchemaName = authConfig.userSchema?.name ?? "user";
	const authSchemaName = authConfig.authSchemaName ?? "authentication";
	const userEmailField = authConfig.userSchema?.email ?? "email";
	const defaultRole = authConfig.defaultRole;

	function isSecureRequest(request: Request): boolean {
		return new URL(request.url).protocol === "https:";
	}

	function sessionCookie(sessionId: string, request: Request): string {
		const maxAge =
			authConfig.session?.maxAge ?? DEFAULT_API_AUTH_CONFIG.session.maxAge;
		const secure = isSecureRequest(request) ? "; Secure" : "";
		return `sessionId=${sessionId}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Strict${secure}`;
	}

	function clearSessionCookie(request: Request): string {
		const secure = isSecureRequest(request) ? "; Secure" : "";
		return `sessionId=; HttpOnly; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict${secure}`;
	}

	function loginResponse(
		authUser: AuthUser,
		loginResult: LoginResult,
		request: Request,
		status: number,
	): Response {
		const responseBody = {
			data: {
				user: authUser,
				token: loginResult.token,
				sessionId: loginResult.sessionId,
			},
		};

		if (loginResult.sessionId) {
			return new Response(JSON.stringify(responseBody), {
				status,
				headers: {
					"Content-Type": "application/json",
					"Set-Cookie": sessionCookie(loginResult.sessionId, request),
				},
			});
		}

		return jsonResponse(responseBody, status);
	}

	/**
	 * POST /auth/register - Register new user
	 */
	async function register(request: Request): Promise<Response> {
		try {
			if (authConfig.endpoints?.disableRegister) {
				throw handlerError.permissionDenied("Registration is disabled");
			}

			const body = (await request.json()) as FallbackValue;
			const { email, password, ...extraData } = body;

			if (!email || typeof email !== "string") {
				throw handlerError.invalidBody("Email is required");
			}

			if (!password || typeof password !== "string") {
				throw handlerError.invalidBody("Password is required");
			}

			// Raw mode skips the reserved-field check — strip auto-managed fields
			// and the email field so the checked email cannot be overridden.
			delete extraData["id"];
			delete extraData["createdAt"];
			delete extraData["updatedAt"];
			delete extraData[userEmailField];

			const existingAuth = await datrix.raw.findOne<AuthenticatedUser>(
				authSchemaName,
				{ email: email },
			);

			if (existingAuth) {
				throw handlerError.conflict("User with this email already exists");
			}

			const { hash, salt } = await authManager.hashPassword(password);

			const userData = {
				[userEmailField]: email,
				...extraData,
			} as FallbackInput;

			let user: DatrixEntry;
			try {
				user = await datrix.raw.create(userSchemaName, userData);
			} catch (error) {
				if (error instanceof DatrixError) {
					throw error;
				}
				const message =
					error instanceof Error ? error.message : "Failed to create user";
				throw handlerError.invalidBody(message);
			}

			const authData = {
				user: { set: [{ id: user.id }] },
				email: email,
				password: hash,
				passwordSalt: salt,
				role: defaultRole,
			};

			let authRecord: AuthenticatedUser;
			try {
				authRecord = await datrix.raw.create<AuthenticatedUser>(
					authSchemaName,
					authData,
				);
			} catch (error) {
				// Not transactional — roll back the user row so it isn't orphaned
				// (e.g. unique-email race on the authentication table).
				await datrix.raw.delete(userSchemaName, user.id);
				throw error;
			}

			const authUser: AuthUser = {
				id: authRecord.id,
				email: authRecord.email,
				role: authRecord.role,
			};

			const loginResult = await authManager.login(authUser);

			return loginResponse(authUser, loginResult, request, 201);
		} catch (error) {
			if (error instanceof DatrixError) {
				return datrixErrorResponse(error);
			}
			const message =
				error instanceof Error ? error.message : "Internal server error";
			return datrixErrorResponse(
				handlerError.internalError(
					message,
					error instanceof Error ? error : undefined,
				),
			);
		}
	}

	/**
	 * POST /auth/login - Login user
	 */
	async function login(request: Request): Promise<Response> {
		try {
			const body = await request.json();
			const { email, password } = body as Record<string, string>;

			if (!email || typeof email !== "string") {
				throw handlerError.invalidBody("Email is required");
			}

			if (!password || typeof password !== "string") {
				throw handlerError.invalidBody("Password is required");
			}

			const authRecord = await datrix.raw.findOne<AuthenticatedUser>(
				authSchemaName,
				{ email: email },
			);

			if (!authRecord) {
				// Burn the same PBKDF2 cost as the real verification path so the
				// response time does not reveal whether the email exists.
				await authManager.verifyPassword(password, DUMMY_HASH, DUMMY_SALT);
				throw authError.invalidCredentials();
			}

			// Passwordless accounts (auto-synced, see D3) must activate via the
			// reset-password flow — reject login explicitly.
			if (!authRecord.password || !authRecord.passwordSalt) {
				await authManager.verifyPassword(password, DUMMY_HASH, DUMMY_SALT);
				throw authError.invalidCredentials();
			}

			const isValid = await authManager.verifyPassword(
				password,
				authRecord.password,
				authRecord.passwordSalt,
			);

			if (!isValid) {
				throw authError.invalidCredentials();
			}

			const authUser: AuthUser = {
				id: authRecord.id,
				email: authRecord.email,
				role: authRecord.role,
			};

			const loginResult = await authManager.login(authUser);

			return loginResponse(authUser, loginResult, request, 200);
		} catch (error) {
			if (error instanceof DatrixError) {
				return datrixErrorResponse(error);
			}
			const message =
				error instanceof Error ? error.message : "Internal server error";
			return datrixErrorResponse(
				handlerError.internalError(
					message,
					error instanceof Error ? error : undefined,
				),
			);
		}
	}

	/**
	 * POST /auth/logout - Logout user
	 *
	 * Always succeeds: session (if any) is deleted, the cookie is cleared.
	 * JWT invalidation is client-side by design.
	 */
	async function logout(request: Request): Promise<Response> {
		try {
			const sessionId = extractSessionId(request);

			if (sessionId && authManager.getSessionStrategy()) {
				await authManager.logout(sessionId);
			}

			return new Response(JSON.stringify({ data: { success: true } }), {
				status: 200,
				headers: {
					"Content-Type": "application/json",
					"Set-Cookie": clearSessionCookie(request),
				},
			});
		} catch (error) {
			if (error instanceof DatrixError) {
				return datrixErrorResponse(error);
			}
			const message =
				error instanceof Error ? error.message : "Internal server error";
			return datrixErrorResponse(
				handlerError.internalError(
					message,
					error instanceof Error ? error : undefined,
				),
			);
		}
	}

	/**
	 * GET /auth/me - Get current user
	 */
	async function me(request: Request): Promise<Response> {
		try {
			const authContext = await authManager.authenticate(request);

			if (!authContext || !authContext.user) {
				throw authError.invalidToken();
			}

			// Never return password, passwordSalt, resetToken, resetTokenExpiry.
			const authenticatedUser = await datrix.raw.findById<AuthenticatedUser>(
				authSchemaName,
				authContext.user.id,
				{ select: ["email", "role"], populate: { user: "*" } },
			);

			if (!authenticatedUser) {
				throw handlerError.recordNotFound(
					userSchemaName,
					String(authContext.user.id),
				);
			}

			return jsonResponse({ data: authenticatedUser });
		} catch (error) {
			if (error instanceof DatrixError) {
				return datrixErrorResponse(error);
			}
			const message =
				error instanceof Error ? error.message : "Internal server error";
			return datrixErrorResponse(
				handlerError.internalError(
					message,
					error instanceof Error ? error : undefined,
				),
			);
		}
	}

	/**
	 * POST /auth/forgot-password - Request password reset token
	 */
	async function forgotPassword(request: Request): Promise<Response> {
		try {
			const onForgotPassword = authConfig.passwordReset?.onForgotPassword;

			if (!onForgotPassword) {
				throw handlerError.permissionDenied("Password reset is not configured");
			}

			const body = (await request.json()) as Record<string, unknown>;
			const { email } = body;

			if (!email || typeof email !== "string") {
				throw handlerError.invalidBody("Email is required");
			}

			const authRecord = await datrix.raw.findOne<
				AuthenticatedUser<TRole, TUser>
			>(
				authSchemaName,
				{ email },
				{
					populate: true,
					select: ["email", "role"],
				},
			);

			if (!authRecord) {
				return jsonResponse({ data: { success: true } });
			}

			const token = randomBytes(32).toString("hex");

			const expirySeconds =
				authConfig.passwordReset?.tokenExpirySeconds ??
				DEFAULT_API_AUTH_CONFIG.passwordReset.tokenExpirySeconds;

			const expiry = new Date(Date.now() + expirySeconds * 1000);

			// Only the digest is persisted; the raw token goes to the callback.
			await datrix.raw.update(authSchemaName, authRecord.id, {
				resetToken: hashResetToken(token),
				resetTokenExpiry: expiry,
			});

			await onForgotPassword(authRecord, token);

			return jsonResponse({ data: { success: true } });
		} catch (error) {
			if (error instanceof DatrixError) {
				return datrixErrorResponse(error);
			}
			const message =
				error instanceof Error ? error.message : "Internal server error";
			return datrixErrorResponse(
				handlerError.internalError(
					message,
					error instanceof Error ? error : undefined,
				),
			);
		}
	}

	/**
	 * POST /auth/reset-password - Reset password using token
	 */
	async function resetPassword(request: Request): Promise<Response> {
		try {
			const body = (await request.json()) as Record<string, unknown>;
			const { token, password } = body;

			if (!token || typeof token !== "string") {
				throw handlerError.invalidBody("Token is required");
			}

			if (!password || typeof password !== "string") {
				throw handlerError.invalidBody("Password is required");
			}

			const authRecord = await datrix.raw.findOne<AuthenticatedUser>(
				authSchemaName,
				{ resetToken: hashResetToken(token) },
			);

			if (
				!authRecord ||
				!authRecord.resetTokenExpiry ||
				new Date(authRecord.resetTokenExpiry) < new Date()
			) {
				throw handlerError.invalidBody("Invalid or expired reset token");
			}

			const { hash, salt } = await authManager.hashPassword(password);

			await datrix.raw.update(authSchemaName, authRecord.id, {
				password: hash,
				passwordSalt: salt,
				resetToken: null,
				resetTokenExpiry: null,
			});

			return jsonResponse({ data: { success: true } });
		} catch (error) {
			if (error instanceof DatrixError) {
				return datrixErrorResponse(error);
			}
			const message =
				error instanceof Error ? error.message : "Internal server error";
			return datrixErrorResponse(
				handlerError.internalError(
					message,
					error instanceof Error ? error : undefined,
				),
			);
		}
	}

	return { register, login, logout, me, forgotPassword, resetPassword };
}

/**
 * Create unified auth handler (handles routing internally)
 */
export function createUnifiedAuthHandler<
	TRole extends string = string,
	TUser extends DatrixEntry = DatrixEntry,
>(config: AuthHandlerConfig<TRole, TUser>, apiPrefix: string = "/api") {
	const handlers = createAuthHandlers(config);
	const { authConfig } = config;

	const endpoints = {
		register:
			authConfig.endpoints?.register ??
			DEFAULT_API_AUTH_CONFIG.endpoints.register,
		login:
			authConfig.endpoints?.login ?? DEFAULT_API_AUTH_CONFIG.endpoints.login,
		logout:
			authConfig.endpoints?.logout ?? DEFAULT_API_AUTH_CONFIG.endpoints.logout,
		me: authConfig.endpoints?.me ?? DEFAULT_API_AUTH_CONFIG.endpoints.me,
		forgotPassword:
			authConfig.endpoints?.forgotPassword ??
			DEFAULT_API_AUTH_CONFIG.endpoints.forgotPassword,
		resetPassword:
			authConfig.endpoints?.resetPassword ??
			DEFAULT_API_AUTH_CONFIG.endpoints.resetPassword,
	};

	return async function authHandler(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname.slice(apiPrefix.length);
		const method = request.method;

		if (path === endpoints.register && method === "POST") {
			return handlers.register(request);
		}

		if (path === endpoints.login && method === "POST") {
			return handlers.login(request);
		}

		if (path === endpoints.logout && method === "POST") {
			return handlers.logout(request);
		}

		if (path === endpoints.me && method === "GET") {
			return handlers.me(request);
		}

		if (path === endpoints.forgotPassword && method === "POST") {
			return handlers.forgotPassword(request);
		}

		if (path === endpoints.resetPassword && method === "POST") {
			return handlers.resetPassword(request);
		}

		return datrixErrorResponse(
			handlerError.recordNotFound("Auth Route", url.pathname),
		);
	};
}
