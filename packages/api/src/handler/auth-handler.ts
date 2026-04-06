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

import type { Forja } from "@forja/core";
import { DEFAULT_API_AUTH_CONFIG } from "@forja/core";
import { AuthManager } from "../auth/manager";
import type { AuthConfig } from "../auth/types";
import { jsonResponse, extractSessionId, forjaErrorResponse } from "./utils";
import { authError } from "../errors/auth-error";
import { handlerError } from "../errors/api-error";
import { ForjaError } from "@forja/core";
import { AuthenticatedUser } from "@forja/core";
import { ForjaEntry } from "@forja/core";
import { AuthUser } from "@forja/core";
import { FallbackValue } from "@forja/core";
import { FallbackInput } from "@forja/core";

/**
 * Auth Handler Configuration
 */
export interface AuthHandlerConfig {
	readonly forja: Forja;
	readonly authManager: AuthManager;
	readonly authConfig: AuthConfig;
}

/**
 * Auth Handlers Factory
 *
 * Creates authentication endpoint handlers
 */
export function createAuthHandlers(config: AuthHandlerConfig) {
	const { forja, authManager, authConfig } = config;

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

			const existingAuth = await forja.raw.findOne<AuthenticatedUser>(
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

			let user: ForjaEntry;
			try {
				const createdUser = await forja.raw.create(userSchemaName, userData);

				if (!createdUser) {
					throw handlerError.internalError("Failed to create user record");
				}
				user = createdUser;
			} catch (error) {
				if (error instanceof ForjaError) {
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

			const authRecord = await forja.raw.create<AuthenticatedUser>(
				authSchemaName,
				authData,
			);

			if (!authRecord) {
				await forja.raw.delete(userSchemaName, user.id);
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
			if (error instanceof ForjaError) {
				return forjaErrorResponse(error);
			}
			const message =
				error instanceof Error ? error.message : "Internal server error";
			return forjaErrorResponse(
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

			const authRecord = await forja.raw.findOne<AuthenticatedUser>(
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
			if (error instanceof ForjaError) {
				return forjaErrorResponse(error);
			}
			const message =
				error instanceof Error ? error.message : "Internal server error";
			return forjaErrorResponse(
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
			if (error instanceof ForjaError) {
				return forjaErrorResponse(error);
			}
			const message =
				error instanceof Error ? error.message : "Internal server error";
			return forjaErrorResponse(
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

			const authenticatedUser = await forja.raw.findById<AuthenticatedUser>(
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
			if (error instanceof ForjaError) {
				return forjaErrorResponse(error);
			}
			const message =
				error instanceof Error ? error.message : "Internal server error";
			return forjaErrorResponse(
				handlerError.internalError(
					message,
					error instanceof Error ? error : undefined,
				),
			);
		}
	}

	return { register, login, logout, me };
}

/**
 * Create unified auth handler (handles routing internally)
 */
export function createUnifiedAuthHandler(
	config: AuthHandlerConfig,
	apiPrefix: string = "/api",
) {
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

		return forjaErrorResponse(
			handlerError.recordNotFound("Auth Route", url.pathname),
		);
	};
}
