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
import { AuthManager, type AuthUser } from "../auth/manager";
import type { AuthConfig } from "../auth/types";
import { jsonResponse, errorResponse, extractSessionId } from "./utils";

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
        return errorResponse(
          "Registration is disabled",
          "REGISTRATION_DISABLED",
          403,
        );
      }

      // Parse request body
      const body = await request.json();
      const { email, password, ...extraData } = body as Record<string, unknown>;

      // Validate required fields
      if (!email || typeof email !== "string") {
        return errorResponse("Email is required", "VALIDATION_ERROR", 400);
      }

      if (!password || typeof password !== "string") {
        return errorResponse("Password is required", "VALIDATION_ERROR", 400);
      }

      // Check if auth record already exists (email must be unique)
      const existingAuth = await forja.raw.findOne(authSchemaName, {
        email: email,
      });

      if (existingAuth) {
        return errorResponse(
          "User with this email already exists",
          "USER_EXISTS",
          409,
        );
      }

      // Hash password
      const hashResult = await authManager.hashPassword(password);
      if (!hashResult.success) {
        return errorResponse(hashResult.error.message, hashResult.error.code, 400);
      }

      const { hash, salt } = hashResult.data;

      // Create user record first (without password)
      // Extra data (name, phone, etc.) will be validated by user schema
      const userData: Record<string, unknown> = {
        [userEmailField]: email,
        ...extraData,
      };

      let user: Record<string, unknown>;
      try {
        user = (await forja.raw.create(userSchemaName, userData)) as Record<
          string,
          unknown
        >;
      } catch (error) {
        // Validation errors from user schema will be caught here
        const message =
          error instanceof Error ? error.message : "Failed to create user";
        return errorResponse(message, "VALIDATION_ERROR", 400);
      }

      if (!user) {
        return errorResponse("Failed to create user", "USER_CREATE_ERROR", 500);
      }

      // Create authentication record
      const authData = {
        user: String(user["id"]),
        email: email,
        password: hash,
        passwordSalt: salt,
        role: defaultRole,
      };

      const authRecord = await forja.raw.create(authSchemaName, authData);

      if (!authRecord) {
        // Rollback: delete user if auth creation fails
        await forja.raw.delete(userSchemaName, user["id"] as string | number);
        return errorResponse(
          "Failed to create authentication record",
          "AUTH_CREATE_ERROR",
          500,
        );
      }

      // Login user (create token/session)
      const authUser: AuthUser = {
        id: String(user["id"]),
        email: email,
        role: defaultRole,
      };

      const loginResult = await authManager.login(authUser);

      if (!loginResult.success) {
        return errorResponse(
          loginResult.error.message,
          loginResult.error.code,
          500,
        );
      }

      // Build response (no sensitive data)
      const safeUser = { ...user };

      const response = {
        data: {
          user: safeUser,
          token: loginResult.data.token,
          sessionId: loginResult.data.sessionId,
        },
      };

      // Set session cookie if session was created
      if (loginResult.data.sessionId) {
        return new Response(JSON.stringify(response), {
          status: 201,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": `sessionId=${loginResult.data.sessionId}; HttpOnly; Path=/; Max-Age=86400; SameSite=Strict`,
          },
        });
      }

      return jsonResponse(response, 201);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Internal server error";
      return errorResponse(message, "INTERNAL_ERROR", 500);
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
        return errorResponse("Email is required", "VALIDATION_ERROR", 400);
      }

      if (!password || typeof password !== "string") {
        return errorResponse("Password is required", "VALIDATION_ERROR", 400);
      }

      // Find auth record by email
      const authRecord = (await forja.raw.findOne(authSchemaName, {
        email: email,
      })) as Record<string, unknown> | null;

      if (!authRecord) {
        return errorResponse("Invalid credentials", "INVALID_CREDENTIALS", 401);
      }

      // Verify password
      const verifyResult = await authManager.verifyPassword(
        password,
        authRecord["password"] as string,
        authRecord["passwordSalt"] as string,
      );

      if (!verifyResult.success || !verifyResult.data) {
        return errorResponse("Invalid credentials", "INVALID_CREDENTIALS", 401);
      }

      // Fetch user data
      const user = (await forja.raw.findById(
        userSchemaName,
        authRecord["user"] as string,
      )) as Record<string, unknown> | null;

      if (!user) {
        return errorResponse("User not found", "USER_NOT_FOUND", 404);
      }

      // Login user (create token/session)
      const authUser: AuthUser = {
        id: String(user["id"]),
        email: authRecord["email"] as string,
        role: authRecord["role"] as string,
      };

      const loginResult = await authManager.login(authUser);

      if (!loginResult.success) {
        return errorResponse(
          loginResult.error.message,
          loginResult.error.code,
          500,
        );
      }

      // Build response (no sensitive data)
      const safeUser = { ...user };

      const response = {
        data: {
          user: safeUser,
          token: loginResult.data.token,
          sessionId: loginResult.data.sessionId,
        },
      };

      // Set session cookie if session was created
      if (loginResult.data.sessionId) {
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": `sessionId=${loginResult.data.sessionId}; HttpOnly; Path=/; Max-Age=86400; SameSite=Strict`,
          },
        });
      }

      return jsonResponse(response);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Internal server error";
      return errorResponse(message, "INTERNAL_ERROR", 500);
    }
  }

  /**
   * POST /auth/logout - Logout user
   */
  async function logout(request: Request): Promise<Response> {
    try {
      const sessionId = extractSessionId(request);

      if (!sessionId) {
        return errorResponse("No session found", "NO_SESSION", 400);
      }

      const logoutResult = await authManager.logout(sessionId);

      if (!logoutResult.success) {
        return errorResponse(
          logoutResult.error.message,
          logoutResult.error.code,
          500,
        );
      }

      // Clear session cookie
      return new Response(JSON.stringify({ data: { success: true } }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": "sessionId=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict",
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Internal server error";
      return errorResponse(message, "INTERNAL_ERROR", 500);
    }
  }

  /**
   * GET /auth/me - Get current user
   */
  async function me(request: Request): Promise<Response> {
    try {
      // Authenticate request
      const authContext = await authManager.authenticate(request);

      if (!authContext) {
        return errorResponse("Unauthorized", "UNAUTHORIZED", 401);
      }

      // Fetch full user data from database
      const user = (await forja.raw.findById(
        userSchemaName,
        authContext.user.id,
      )) as Record<string, unknown> | null;

      if (!user) {
        return errorResponse("User not found", "USER_NOT_FOUND", 404);
      }

      // Build response
      const safeUser = { ...user };

      return jsonResponse({ data: safeUser });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Internal server error";
      return errorResponse(message, "INTERNAL_ERROR", 500);
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
      authConfig.endpoints?.register ?? DEFAULT_API_AUTH_CONFIG.endpoints.register,
    login: authConfig.endpoints?.login ?? DEFAULT_API_AUTH_CONFIG.endpoints.login,
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
    return errorResponse("Not found", "NOT_FOUND", 404);
  };
}
