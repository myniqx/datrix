import { defineConfig } from "@forja/core";
import { ApiPlugin } from "../../src/api";
import { testSchemas } from "./schemas";
import { ForjaConfig } from "@forja/types";
import { getAdapter, getAdapterType } from "./adapter";

/**
 * Test Roles
 *
 * Defined roles for permission testing
 */
export const roles = ["admin", "editor", "user", "guest"] as const;
export type TestRoles = (typeof roles)[number];

/**
 * Test JWT Secret
 *
 * Minimum 32 characters for HS256
 */
export const testJwtSecret = "test-jwt-secret-key-for-unit-tests-32-chars-min";

/**
 * Test Configuration with Authentication
 *
 * Uses configurable adapter (json, postgres, or mysql)
 * API plugin enabled WITH authentication and permission system
 *
 * Switch adapter via environment variable:
 * - ADAPTER=json npm test (default, fast in-memory)
 * - ADAPTER=postgres npm test (PostgreSQL database)
 * - ADAPTER=mysql npm test (MySQL database)
 */
export async function createTestConfigWithAuth(tmpDir: string) {
	const adapterType = getAdapterType();
	const adapter = await getAdapter(adapterType, tmpDir);

	return defineConfig(() => {
		const config: ForjaConfig = {
			adapter,

			schemas: testSchemas,

			plugins: [
				new ApiPlugin({
					enabled: true,
					prefix: "/api",
					defaultPageSize: 25,
					maxPageSize: 100,
					maxPopulateDepth: 5,
					autoRoutes: true,
					excludeSchemas: [],

					// Authentication enabled
					auth: {
						jwt: {
							secret: testJwtSecret,
							expiresIn: "1h",
							algorithm: "HS256",
						},
						session: {
							store: "memory",
							maxAge: 3600,
							checkPeriod: 600,
						},

						// Role definitions
						roles: roles,

						defaultRole: "user",

						// Default permissions (fallback for schemas without explicit permissions)
						defaultPermission: {
							create: ["admin"],
							read: true,
							update: ["admin"],
							delete: ["admin"],
						},
					},
				}),
			],
		};

		return config as ForjaConfig;
	});
}

/**
 * Helper to create a test JWT token
 * Used in tests to simulate authenticated requests
 */
export interface TestUser {
	readonly id: number;
	readonly email: string;
	readonly role: TestRoles;
}

export const testUsers: Record<TestRoles, TestUser> = {
	admin: { id: 1, email: "admin@test.com", role: "admin" },
	editor: { id: 2, email: "editor@test.com", role: "editor" },
	user: { id: 3, email: "user@test.com", role: "user" },
	guest: { id: 4, email: "guest@test.com", role: "guest" },
};
