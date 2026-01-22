/**
 * Auth Middleware
 *
 * Handles authentication from JWT token or session cookie
 */

import type { AuthManager } from "../auth/manager";
import { AuthUser } from "forja-api/auth/types";

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

  if (!authContext) {
    return null;
  }

  return authContext.user;
}
