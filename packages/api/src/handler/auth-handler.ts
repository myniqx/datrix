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

import type { Forja } from "forja-core";
import { DEFAULT_API_AUTH_CONFIG } from "forja-types/config";
import { AuthManager } from "../auth/manager";
import type { AuthConfig } from "../auth/types";
import { jsonResponse, extractSessionId, forjaErrorResponse } from "./utils";
import { authError } from "../errors/auth-error";
import { handlerError } from "../errors/api-error";
import { ForjaError } from "forja-types/errors";
import { AuthenticatedUser } from "forja-types/api/auth";
import { ForjaEntry } from "forja-types";
import { AuthUser } from "forja-types/api";

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

	// Schema names
	const userSchemaName = authConfig.userSchema?.name ?? "user";
	const authSchemaName = authConfig.authSchemaName ?? "authentication";

	// User schema email field name
	const userEmailField = authConfig.userSchema?.email ?? "email";

	// Default role for new users
	const defaultRole = authConfig.defaultRole;

	/**
	 * POST /auth/register - Register new user
	 *
	 * Creates both user record and authentication record
	 */
	async function register(request: Request): Promise<Response> {
		try {
			// Check if registration is disabled
			if (authConfig.endpoints?.disableRegister) {
				const result = handlerError.permissionDenied(
					"Registration is disabled",
				);
				return forjaErrorResponse(result);
			}

			// Parse request body
			const body = await request.json();
			const { email, password, ...extraData } = body as Record<string, unknown>;

			// Validate required fields
			if (!email || typeof email !== "string") {
				const result = handlerError.invalidBody("Email is required");
				return forjaErrorResponse(result);
			}

			if (!password || typeof password !== "string") {
				const result = handlerError.invalidBody("Password is required");
				return forjaErrorResponse(result);
			}

			// Check if auth record already exists (email must be unique)
			const existingAuth = await forja.raw.findOne<AuthenticatedUser>(
				authSchemaName,
				{
					email: email,
				},
			);

			if (existingAuth) {
				const result = handlerError.conflict(
					"User with this email already exists",
				);
				return forjaErrorResponse(result);
			}

			// Hash password
			const { hash, salt } = await authManager.hashPassword(password);

			// Create user record first (without password)
			const userData: Record<string, unknown> = {
				[userEmailField]: email,
				...extraData,
			};

			let user: ForjaEntry;
			try {
				const createdUser = await forja.raw.create(userSchemaName, userData);

				if (!createdUser) {
					const result = handlerError.internalError(
						"Failed to create user record",
					);
					return forjaErrorResponse(result);
				}
				user = createdUser;
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Failed to create user";
				const result = handlerError.invalidBody(message);
				return forjaErrorResponse(result);
			}

			// Create authentication record
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
				// Rollback: delete user if auth creation fails
				await forja.raw.delete(userSchemaName, user.id);
				const result = handlerError.internalError(
					"Failed to create authentication record",
				);
				return forjaErrorResponse(result);
			}

			// Login user (create token/session)
			const authUser: AuthUser = {
				id: authRecord.id,
				email: authRecord.email,
				role: authRecord.role,
			};

			const loginResult = await authManager.login(authUser);

			// Build response (no sensitive data)
			const responseBody = {
				data: {
					user: authUser,
					token: loginResult.token,
					sessionId: loginResult.sessionId,
				},
			};

			// Set session cookie if session was created
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
				return forjaErrorResponse({ success: false, error });
			}
			const message =
				error instanceof Error ? error.message : "Internal server error";
			const result = handlerError.internalError(
				message,
				error instanceof Error ? error : undefined,
			);
			return forjaErrorResponse(result);
		}
	}

	/**
	 * POST /auth/login - Login user
	 *
	 * Verifies credentials against authentication table
	 */
	async function login(request: Request): Promise<Response> {
		try {
			// Parse request body
			const body = await request.json();
			const { email, password } = body as Record<string, string>;

			// Validate required fields
			if (!email || typeof email !== "string") {
				const result = handlerError.invalidBody("Email is required");
				return forjaErrorResponse(result);
			}

			if (!password || typeof password !== "string") {
				const result = handlerError.invalidBody("Password is required");
				return forjaErrorResponse(result);
			}

			// Find auth record by email
			const authRecord = await forja.raw.findOne<AuthenticatedUser>(
				authSchemaName,
				{
					email: email,
				},
			);

			if (!authRecord) {
				const result = authError.invalidCredentials();
				return forjaErrorResponse(result);
			}

			// Verify password
			const isValid = await authManager.verifyPassword(
				password,
				authRecord.password,
				authRecord.passwordSalt,
			);

			if (!isValid) {
				const result = authError.invalidCredentials();
				return forjaErrorResponse(result);
			}

			// Login user (create token/session)
			const authUser: AuthUser = {
				id: authRecord.id,
				email: authRecord.email,
				role: authRecord.role,
			};

			const loginResult = await authManager.login(authUser);

			// Build response (no sensitive data)
			const responseBody = {
				data: {
					user: authUser,
					token: loginResult.token,
					sessionId: loginResult.sessionId,
				},
			};

			// Set session cookie if session was created
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
				return forjaErrorResponse({ success: false, error });
			}
			const message =
				error instanceof Error ? error.message : "Internal server error";
			const result = handlerError.internalError(
				message,
				error instanceof Error ? error : undefined,
			);
			return forjaErrorResponse(result);
		}
	}

	/**
	 * POST /auth/logout - Logout user
	 */
	async function logout(request: Request): Promise<Response> {
		try {
			const sessionId = extractSessionId(request);

			if (!sessionId) {
				const result = handlerError.invalidBody("No session found");
				return forjaErrorResponse(result);
			}

			await authManager.logout(sessionId);

			// Clear session cookie
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
				return forjaErrorResponse({ success: false, error });
			}
			const message =
				error instanceof Error ? error.message : "Internal server error";
			const result = handlerError.internalError(
				message,
				error instanceof Error ? error : undefined,
			);
			return forjaErrorResponse(result);
		}
	}

	/**
	 * GET /auth/me - Get current user
	 */
	async function me(request: Request): Promise<Response> {
		try {
			// Authenticate request
			const authContext = await authManager.authenticate(request);

			if (!authContext || !authContext.user) {
				const result = authError.invalidToken();
				return forjaErrorResponse(result);
			}

			// Fetch full user data from database
			const authenticatedUser = await forja.raw.findById<AuthenticatedUser>(
				authSchemaName,
				authContext.user.id,
				{
					populate: { user: "*" },
				},
			);

			if (!authenticatedUser) {
				const result = handlerError.recordNotFound(
					userSchemaName,
					String(authContext.user.id),
				);
				return forjaErrorResponse(result);
			}

			return jsonResponse({ data: authenticatedUser });
		} catch (error) {
			if (error instanceof ForjaError) {
				return forjaErrorResponse({ success: false, error });
			}
			const message =
				error instanceof Error ? error.message : "Internal server error";
			const result = handlerError.internalError(
				message,
				error instanceof Error ? error : undefined,
			);
			return forjaErrorResponse(result);
		}
	}

	return {
		register,
		login,
		logout,
		me,
	};
}

/**
 * Create unified auth handler (handles routing internally)
 */
export function createUnifiedAuthHandler(config: AuthHandlerConfig) {
	const handlers = createAuthHandlers(config);
	const { authConfig } = config;

	// Get endpoint paths
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
		const path = url.pathname;
		const method = request.method;

		// Route to appropriate handler
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

		// No matching route
		const res = handlerError.recordNotFound("Auth Route", url.pathname);
		return forjaErrorResponse(res);
	};
}
