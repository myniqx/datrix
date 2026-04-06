/**
 * Auth Middleware
 *
 * Handles authentication from JWT token or session cookie
 */

import { AuthUser } from "@forja/core/types/api";
import type { AuthManager } from "../auth/manager";

/**
 * Authenticate request
 *
 * Extracts and verifies JWT token or session from request
 * Returns authenticated user or null
 */
export async function authenticate(
	request: Request,
	authManager?: AuthManager,
): Promise<AuthUser | null> {
	if (!authManager) {
		return null;
	}

	// Use auth manager's authenticate method
	const authContext = await authManager.authenticate(request);

	if (!authContext || !authContext.user) {
		return null;
	}

	return authContext.user;
}
