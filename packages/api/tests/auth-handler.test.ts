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
import { createRequest } from "./data/helper";
import { expectApiSingle, expectApiError } from "forja-types/test/helpers";
import fs from "node:fs/promises";
import path from "node:path";
import { ForjaEntry } from "forja-types";

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
		const getForja = await createTestConfigWithAuth(tmpDir);
		forja = await getForja();
		const migrate = await forja.beginMigrate();
		await migrate.apply();
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

			const data = await expectApiSingle<AuthUserResponse & ForjaEntry>(
				response,
				201,
			);
			expect(data.user!.email).toBe("newuser@test.com");
			//      expect(data.user.role).toBe("user"); // default role
			expect(data.token).toBeDefined();
			// Password should not be in response
			expect(
				(data.user as Record<string, unknown>)["password"],
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

			const error = await expectApiError(response, 400);
			expect(error.code).toBe("INVALID_BODY");
			expect(error.message).toContain("Invalid request body");
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

			const error = await expectApiError(response, 400);
			expect(error.code).toBe("INVALID_BODY");
			expect(error.message).toContain("Invalid request body");
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

			const error = await expectApiError(response, 400);
			expect(error.code).toBe("INVALID_BODY");
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

			const error = await expectApiError(response, 400);
			expect(error.code).toBe("INVALID_BODY");
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

			await expectApiSingle(response1, 201);

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

			const error = await expectApiError(response, 409);
			expect(error.code).toBe("CONFLICT");
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

			const data = await expectApiSingle<AuthUserResponse & ForjaEntry>(
				response,
				200,
			);
			expect(data.user!.email).toBe(loginEmail);
			expect(data.token).toBeDefined();
			// Password should not be in response
			expect(
				(data.user as Record<string, unknown>)["password"],
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

			const error = await expectApiError(response, 400);
			expect(error.code).toBe("INVALID_BODY");
			expect(error.message).toContain("Invalid request body");
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

			const error = await expectApiError(response, 400);
			expect(error.code).toBe("INVALID_BODY");
			expect(error.message).toContain("Invalid request body");
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

			const error = await expectApiError(response, 401);
			expect(error.code).toBe("INVALID_CREDENTIALS");
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

			const error = await expectApiError(response, 401);
			expect(error.code).toBe("INVALID_CREDENTIALS");
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

			const data = await expectApiSingle<{ success: boolean } & ForjaEntry>(
				logoutResponse,
				200,
			);
			expect(data.success).toBe(true);

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

			const error = await expectApiError(response, 400);
			expect(error.code).toBe("INVALID_BODY");
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

			const data = await expectApiSingle<AuthUserResponse & ForjaEntry>(
				loginResponse,
				200,
			);
			userToken = data.token ?? "";
		});

		it("should return current user when authenticated with token", async () => {
			const response = await handleRequest(
				createRequest("/api/auth/me", {
					method: "GET",
					token: userToken,
				}),
			);

			const data = await expectApiSingle<
				{ email: string; role: string } & ForjaEntry
			>(response, 200);
			expect(data.email).toBe("metest@test.com");
			//    expect(data.role).toBe("user");
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

			const data = await expectApiSingle<{ email: string } & ForjaEntry>(
				response,
				200,
			);
			expect(data.email).toBe("metest@test.com");
		});

		it("should return 401 when not authenticated", async () => {
			const response = await handleRequest(
				createRequest("/api/auth/me", {
					method: "GET",
				}),
			);

			const error = await expectApiError(response, 401);
			expect(error.code).toBe("INVALID_TOKEN");
		});

		it("should return 401 with invalid token", async () => {
			const response = await handleRequest(
				createRequest("/api/auth/me", {
					method: "GET",
					token: "invalid-token-here",
				}),
			);

			const error = await expectApiError(response, 401);
			expect(error.code).toBe("INVALID_TOKEN");
		});

		it("should return 401 with expired/invalid session", async () => {
			const response = await handleRequest(
				createRequest("/api/auth/me", {
					method: "GET",
					cookie: "sessionId=nonexistent-session-id",
				}),
			);

			const error = await expectApiError(response, 401);
			expect(error.code).toBe("INVALID_TOKEN");
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

			const error = await expectApiError(response, 404);
			expect(error.code).toBe("NOT_FOUND");
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
