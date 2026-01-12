/**
 * Permission Middleware
 *
 * Handles RBAC permission checking
 */

import type { AuthManager } from '../auth/manager';
import type { AuthenticatedUser, PermissionAction } from './types';

/**
 * Check if user has permission for action on resource
 */
export async function checkPermission(
  user: AuthenticatedUser | null,
  model: string,
  action: PermissionAction,
  authManager?: AuthManager
): Promise<boolean> {
  // If no auth manager, allow all (auth disabled)
  if (!authManager) {
    return true;
  }

  // If no user, deny access
  if (!user) {
    return false;
  }

  // Check permission via RBAC
  return authManager.checkPermission(user.role, model, action);
}

/**
 * Map HTTP method to permission action
 */
export function methodToAction(method: string): PermissionAction {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'read';
    case 'POST':
      return 'create';
    case 'PATCH':
    case 'PUT':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      return 'read';
  }
}
