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
				const createdUser = await datrix.raw.create(userSchemaName, userData);

				if (!createdUser) {
					throw handlerError.internalError("Failed to create user record");
				}
				user = createdUser;
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

			const authRecord = await datrix.raw.create<AuthenticatedUser>(
				authSchemaName,
				authData,
			);

			if (!authRecord) {
				await datrix.raw.delete(userSchemaName, user.id);
				throw handlerError.internalError(
					"Failed to create authentication record",
				);
			}

			const authUser: AuthUser = {
				id: authRecord.id,
				email: authRecord.email,
				role: authRecord.role,
			};

			const loginResult = await authManager.login(authUser);

			const responseBody = {
				data: {
					user: authUser,
					token: loginResult.token,
					sessionId: loginResult.sessionId,
				},
			};

			if (loginResult.sessionId) {
				return new Response(JSON.stringify(responseBody), {
					status: 201,
					headers: {
						"Content-Type": "application/json",
						"Set-Cookie": `sessionId=${loginResult.sessionId}; HttpOnly; Path=/; Max-Age=86400; SameSite=Strict`,
					},
				});
			}

			return jsonResponse(responseBody, 201);
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

			const responseBody = {
				data: {
					user: authUser,
					token: loginResult.token,
					sessionId: loginResult.sessionId,
				},
			};

			if (loginResult.sessionId) {
				return new Response(JSON.stringify(responseBody), {
					status: 200,
					headers: {
						"Content-Type": "application/json",
						"Set-Cookie": `sessionId=${loginResult.sessionId}; HttpOnly; Path=/; Max-Age=86400; SameSite=Strict`,
					},
				});
			}

			return jsonResponse(responseBody);
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
	 */
	async function logout(request: Request): Promise<Response> {
		try {
			const sessionId = extractSessionId(request);

			if (!sessionId) {
				throw handlerError.invalidBody("No session found");
			}

			await authManager.logout(sessionId);

			return new Response(JSON.stringify({ data: { success: true } }), {
				status: 200,
				headers: {
					"Content-Type": "application/json",
					"Set-Cookie":
						"sessionId=; HttpOnly; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict",
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

			const authenticatedUser = await datrix.raw.findById<AuthenticatedUser>(
				authSchemaName,
				authContext.user.id,
				{ populate: { user: "*" } },
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
					select: ["email", "role", "resetToken", "resetTokenExpiry"],
				},
			);

			if (!authRecord) {
				return jsonResponse({ data: { success: true } });
			}

			const tokenBytes = new Uint8Array(32);
			crypto.getRandomValues(tokenBytes);
			const token = Array.from(tokenBytes)
				.map((b) => b.toString(16).padStart(2, "0"))
				.join("");

			const expirySeconds =
				authConfig.passwordReset?.tokenExpirySeconds ??
				DEFAULT_API_AUTH_CONFIG.passwordReset.tokenExpirySeconds;

			const expiry = new Date(Date.now() + expirySeconds * 1000);

			await datrix.raw.update(authSchemaName, authRecord.id, {
				resetToken: token,
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
				{ resetToken: token },
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
