/**
 * Auth Handler Tests
 *
 * Tests for authentication endpoints:
 * - POST /api/auth/register - Register new user
 * - POST /api/auth/login - Login user
 * - POST /api/auth/logout - Logout user
 * - GET /api/auth/me - Get current user
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import { createTestConfigWithAuth } from "./data/config-auth";
import fs from "node:fs/promises";
import path from "node:path";

/** API Response type for type-safe json parsing */
interface ApiResponse<T = Record<string, unknown>> {
  data?: T;
  error?: { message: string; code: string };
}

/** User response from auth endpoints */
interface AuthUserResponse {
  user: {
    id: number;
    email: string;
    role: string;
  };
  token?: string;
  sessionId?: string;
}

describe("Auth Handler Tests", () => {
  let forja: Forja;
  const tmpDir = path.join(
    process.cwd(),
    "packages",
    "api",
    "tests",
    ".tmp-auth-handler",
  );

  /**
   * Helper to create request
   */
  function createRequest(
    url: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      token?: string;
      cookie?: string;
    } = {},
  ): Request {
    const { method = "GET", body, token, cookie } = options;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    if (cookie) {
      headers["Cookie"] = cookie;
    }

    return new Request(`http://localhost:3000${url}`, {
      method,
      headers,
      ...(body && { body: JSON.stringify(body) }),
    });
  }

  /**
   * Helper to handle request through API plugin
   */
  async function handleRequest(request: Request): Promise<Response> {
    const apiPlugin = forja.getPlugin("api");
    if (!apiPlugin || !("handleRequest" in apiPlugin)) {
      throw new Error("API plugin not found");
    }
    const response = await (
      apiPlugin as {
        handleRequest: (req: Request, forja: Forja) => Promise<Response>;
      }
    ).handleRequest(request, forja);
    console.log(`Response: ${JSON.stringify(response, null, 2)}`);
    return response;
  }

  beforeAll(async () => {
    // Clean up and create temp directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
    await fs.mkdir(tmpDir, { recursive: true });

    // Initialize Forja with auth config
    const getForja = createTestConfigWithAuth(tmpDir);
    forja = await getForja();

    // Create tables
    const adapter = forja.getAdapter();
    for (const schema of forja.getSchemas().getAll()) {
      const result = await adapter.createTable(schema);
      if (!result.success) {
        throw new Error(
          `Failed to create table ${schema.name}: ${result.error.message}`,
        );
      }
    }
  });

  afterAll(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  // ============================================================
  // REGISTER TESTS
  // POST /api/auth/register
  // ============================================================

  describe("POST /api/auth/register", () => {
    it("should register a new user successfully", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/register", {
          method: "POST",
          body: {
            email: "newuser@test.com",
            password: "securePassword123",
          },
        }),
      );

      expect(response.status).toBe(201);

      const data = (await response.json()) as ApiResponse<AuthUserResponse>;
      expect(data.data).toBeDefined();
      expect(data.data?.user.email).toBe("newuser@test.com");
      //      expect(data.data?.user.role).toBe("user"); // default role
      expect(data.data?.token).toBeDefined();
      // Password should not be in response
      expect(
        (data.data?.user as Record<string, unknown>)["password"],
      ).toBeUndefined();
    });

    it("should return 400 when email is missing", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/register", {
          method: "POST",
          body: {
            password: "securePassword123",
          },
        }),
      );

      expect(response.status).toBe(400);

      const data = (await response.json()) as ApiResponse;
      expect(data.error?.code).toBe("VALIDATION_ERROR");
      expect(data.error?.message).toContain("Email");
    });

    it("should return 400 when password is missing", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/register", {
          method: "POST",
          body: {
            email: "test@test.com",
          },
        }),
      );

      expect(response.status).toBe(400);

      const data = (await response.json()) as ApiResponse;
      expect(data.error?.code).toBe("VALIDATION_ERROR");
      expect(data.error?.message).toContain("Password");
    });

    it("should return 400 when email is not a string", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/register", {
          method: "POST",
          body: {
            email: 12345,
            password: "securePassword123",
          },
        }),
      );

      expect(response.status).toBe(400);

      const data = (await response.json()) as ApiResponse;
      expect(data.error?.code).toBe("VALIDATION_ERROR");
    });

    it("should return 400 when password is not a string", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/register", {
          method: "POST",
          body: {
            email: "test2@test.com",
            password: 12345,
          },
        }),
      );

      expect(response.status).toBe(400);

      const data = (await response.json()) as ApiResponse;
      expect(data.error?.code).toBe("VALIDATION_ERROR");
    });

    it("should return 409 when user already exists", async () => {
      // First registration
      const response1 = await handleRequest(
        createRequest("/api/auth/register", {
          method: "POST",
          body: {
            email: "duplicate@test.com",
            password: "securePassword123",
          },
        }),
      );

      console.log(response1);
      expect(response1.status).toBe(201);

      // Second registration with same email
      const response = await handleRequest(
        createRequest("/api/auth/register", {
          method: "POST",
          body: {
            email: "duplicate@test.com",
            password: "anotherPassword456",
          },
        }),
      );

      expect(response.status).toBe(409);

      const data = (await response.json()) as ApiResponse;
      expect(data.error?.code).toBe("USER_EXISTS");
    });

    it("should set session cookie when session is enabled", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/register", {
          method: "POST",
          body: {
            email: "sessionuser@test.com",
            password: "securePassword123",
          },
        }),
      );

      expect(response.status).toBe(201);

      const setCookie = response.headers.get("Set-Cookie");
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain("sessionId=");
      expect(setCookie).toContain("HttpOnly");
    });
  });

  // ============================================================
  // LOGIN TESTS
  // POST /api/auth/login
  // ============================================================

  describe("POST /api/auth/login", () => {
    const loginEmail = "logintest@test.com";
    const loginPassword = "loginPassword123";

    beforeAll(async () => {
      // Create a user for login tests
      await handleRequest(
        createRequest("/api/auth/register", {
          method: "POST",
          body: {
            email: loginEmail,
            password: loginPassword,
          },
        }),
      );
    });

    it("should login successfully with correct credentials", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/login", {
          method: "POST",
          body: {
            email: loginEmail,
            password: loginPassword,
          },
        }),
      );

      expect(response.status).toBe(200);

      const data = (await response.json()) as ApiResponse<AuthUserResponse>;
      expect(data.data).toBeDefined();
      expect(data.data?.user.email).toBe(loginEmail);
      expect(data.data?.token).toBeDefined();
      // Password should not be in response
      expect(
        (data.data?.user as Record<string, unknown>)["password"],
      ).toBeUndefined();
    });

    it("should return 400 when email is missing", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/login", {
          method: "POST",
          body: {
            password: loginPassword,
          },
        }),
      );

      expect(response.status).toBe(400);

      const data = (await response.json()) as ApiResponse;
      expect(data.error?.code).toBe("VALIDATION_ERROR");
      expect(data.error?.message).toContain("Email");
    });

    it("should return 400 when password is missing", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/login", {
          method: "POST",
          body: {
            email: loginEmail,
          },
        }),
      );

      expect(response.status).toBe(400);

      const data = (await response.json()) as ApiResponse;
      expect(data.error?.code).toBe("VALIDATION_ERROR");
      expect(data.error?.message).toContain("Password");
    });

    it("should return 401 when user does not exist", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/login", {
          method: "POST",
          body: {
            email: "nonexistent@test.com",
            password: "anyPassword123",
          },
        }),
      );

      expect(response.status).toBe(401);

      const data = (await response.json()) as ApiResponse;
      expect(data.error?.code).toBe("INVALID_CREDENTIALS");
    });

    it("should return 401 when password is incorrect", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/login", {
          method: "POST",
          body: {
            email: loginEmail,
            password: "wrongPassword123",
          },
        }),
      );

      expect(response.status).toBe(401);

      const data = (await response.json()) as ApiResponse;
      expect(data.error?.code).toBe("INVALID_CREDENTIALS");
    });

    it("should set session cookie when session is enabled", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/login", {
          method: "POST",
          body: {
            email: loginEmail,
            password: loginPassword,
          },
        }),
      );

      expect(response.status).toBe(200);

      const setCookie = response.headers.get("Set-Cookie");
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain("sessionId=");
    });
  });

  // ============================================================
  // LOGOUT TESTS
  // POST /api/auth/logout
  // ============================================================

  describe("POST /api/auth/logout", () => {
    it("should logout successfully with valid session", async () => {
      // First register to create the user
      await handleRequest(
        createRequest("/api/auth/register", {
          method: "POST",
          body: {
            email: "logouttest@test.com",
            password: "logoutPassword123",
          },
        }),
      );

      // Then login to get a session
      const loginResponse = await handleRequest(
        createRequest("/api/auth/login", {
          method: "POST",
          body: {
            email: "logouttest@test.com",
            password: "logoutPassword123",
          },
        }),
      );

      const setCookie = loginResponse.headers.get("Set-Cookie");
      const sessionIdMatch = setCookie?.match(/sessionId=([^;]+)/);
      const sessionId = sessionIdMatch?.[1];

      expect(sessionId).toBeDefined();

      // Now logout
      const logoutResponse = await handleRequest(
        createRequest("/api/auth/logout", {
          method: "POST",
          cookie: `sessionId=${sessionId}`,
        }),
      );

      expect(logoutResponse.status).toBe(200);

      const data = (await logoutResponse.json()) as ApiResponse<{
        success: boolean;
      }>;
      expect(data.data?.success).toBe(true);

      // Check that session cookie is cleared
      const logoutSetCookie = logoutResponse.headers.get("Set-Cookie");
      expect(logoutSetCookie).toContain("sessionId=;");
      expect(logoutSetCookie).toContain("Max-Age=0");
    });

    it("should return 400 when no session provided", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/logout", {
          method: "POST",
        }),
      );

      expect(response.status).toBe(400);

      const data = (await response.json()) as ApiResponse;
      expect(data.error?.code).toBe("NO_SESSION");
    });
  });

  // ============================================================
  // ME ENDPOINT TESTS
  // GET /api/auth/me
  // ============================================================

  describe("GET /api/auth/me", () => {
    let userToken: string;

    beforeAll(async () => {
      // Register and login to get a token
      await handleRequest(
        createRequest("/api/auth/register", {
          method: "POST",
          body: {
            email: "metest@test.com",
            password: "mePassword123",
          },
        }),
      );

      const loginResponse = await handleRequest(
        createRequest("/api/auth/login", {
          method: "POST",
          body: {
            email: "metest@test.com",
            password: "mePassword123",
          },
        }),
      );

      const data = (await loginResponse.json()) as ApiResponse<AuthUserResponse>;
      userToken = data.data?.token ?? "";
    });

    it("should return current user when authenticated with token", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/me", {
          method: "GET",
          token: userToken,
        }),
      );

      expect(response.status).toBe(200);

      const data = (await response.json()) as ApiResponse<{
        email: string;
        role: string;
      }>;
      expect(data.data).toBeDefined();
      expect(data.data?.email).toBe("metest@test.com");
      //    expect(data.data?.role).toBe("user");
    });

    it("should return current user when authenticated with session", async () => {
      // Login to get session
      const loginResponse = await handleRequest(
        createRequest("/api/auth/login", {
          method: "POST",
          body: {
            email: "metest@test.com",
            password: "mePassword123",
          },
        }),
      );

      const setCookie = loginResponse.headers.get("Set-Cookie");
      const sessionIdMatch = setCookie?.match(/sessionId=([^;]+)/);
      const sessionId = sessionIdMatch?.[1];

      const response = await handleRequest(
        createRequest("/api/auth/me", {
          method: "GET",
          cookie: `sessionId=${sessionId}`,
        }),
      );

      expect(response.status).toBe(200);

      const data = (await response.json()) as ApiResponse<{ email: string }>;
      expect(data.data?.email).toBe("metest@test.com");
    });

    it("should return 401 when not authenticated", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/me", {
          method: "GET",
        }),
      );

      expect(response.status).toBe(401);

      const data = (await response.json()) as ApiResponse;
      expect(data.error?.code).toBe("UNAUTHORIZED");
    });

    it("should return 401 with invalid token", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/me", {
          method: "GET",
          token: "invalid-token-here",
        }),
      );

      expect(response.status).toBe(401);

      const data = (await response.json()) as ApiResponse;
      expect(data.error?.code).toBe("UNAUTHORIZED");
    });

    it("should return 401 with expired/invalid session", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/me", {
          method: "GET",
          cookie: "sessionId=nonexistent-session-id",
        }),
      );

      expect(response.status).toBe(401);

      const data = (await response.json()) as ApiResponse;
      expect(data.error?.code).toBe("UNAUTHORIZED");
    });
  });

  // ============================================================
  // AUTH ROUTE NOT FOUND
  // ============================================================

  describe("Auth Route Not Found", () => {
    it("should return 404 for unknown auth routes", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/unknown", {
          method: "POST",
        }),
      );

      expect(response.status).toBe(404);

      const data = (await response.json()) as ApiResponse;
      expect(data.error?.code).toBe("NOT_FOUND");
    });

    it("should return 404 for wrong method on register", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/register", {
          method: "GET",
        }),
      );

      expect(response.status).toBe(404);
    });

    it("should return 404 for wrong method on login", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/login", {
          method: "GET",
        }),
      );

      expect(response.status).toBe(404);
    });

    it("should return 404 for wrong method on logout", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/logout", {
          method: "GET",
        }),
      );

      expect(response.status).toBe(404);
    });

    it("should return 404 for wrong method on me", async () => {
      const response = await handleRequest(
        createRequest("/api/auth/me", {
          method: "POST",
        }),
      );

      expect(response.status).toBe(404);
    });
  });
});
