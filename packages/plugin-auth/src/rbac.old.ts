/**
 * RBAC (Role-Based Access Control)
 *
 * Implements role and permission management with hierarchical roles support.
 */

import { AuthError } from 'forja-types/plugin';
import type {
  Role,
  Permission,
  PermissionAction,
  RbacConfig,
  PermissionCheckResult,
} from './types';
import { isRole, isPermission } from './types';
import { Result } from 'forja-types/utils';

/**
 * RBAC Manager
 *
 * Manages roles, permissions, and access control
 */
export class RbacManager {
  private readonly roles: Map<string, Role> = new Map();
  private readonly defaultRole: string | undefined;

  constructor(config?: RbacConfig) {
    this.defaultRole = config?.defaultRole;

    // Register default roles if provided
    if (config?.roles) {
      for (const role of config.roles) {
        this.defineRole(role);
      }
    }
  }

  /**
   * Define a new role
   */
  defineRole(role: Role): Result<void, AuthError> {
    if (!isRole(role)) {
      return {
        success: false,
        error: new AuthError('Invalid role definition', {
          code: 'RBAC_INVALID_ROLE',
          details: role,
        }),
      };
    }

    if (this.roles.has(role.name)) {
      return {
        success: false,
        error: new AuthError(`Role already defined: ${role.name}`, {
          code: 'RBAC_ROLE_EXISTS',
        }),
      };
    }

    // Validate inherited roles exist
    if (role.inherits) {
      for (const inheritedRoleName of role.inherits) {
        if (!this.roles.has(inheritedRoleName)) {
          return {
            success: false,
            error: new AuthError(`Inherited role not found: ${inheritedRoleName}`, {
              code: 'RBAC_ROLE_NOT_FOUND',
            }),
          };
        }
      }
    }

    this.roles.set(role.name, role);

    return { success: true, data: undefined };
  }

  /**
   * Get role by name
   */
  getRole(roleName: string): Role | undefined {
    return this.roles.get(roleName);
  }

  /**
   * Get all roles
   */
  getAllRoles(): readonly Role[] {
    return Array.from(this.roles.values());
  }

  /**
   * Remove a role
   */
  removeRole(roleName: string): Result<void, AuthError> {
    if (!this.roles.has(roleName)) {
      return {
        success: false,
        error: new AuthError(`Role not found: ${roleName}`, {
          code: 'RBAC_ROLE_NOT_FOUND',
        }),
      };
    }

    // Check if any other role inherits from this role
    for (const role of this.roles.values()) {
      if (role.inherits?.includes(roleName)) {
        return {
          success: false,
          error: new AuthError(`Cannot remove role ${roleName}: inherited by ${role.name}`, {
            code: 'RBAC_ROLE_IN_USE',
          }),
        };
      }
    }

    this.roles.delete(roleName);

    return { success: true, data: undefined };
  }

  /**
   * Check if role has a specific permission
   */
  hasPermission(
    roleName: string,
    resource: string,
    action: PermissionAction
  ): boolean {
    const role = this.roles.get(roleName);

    if (!role) {
      return false;
    }

    // Get all permissions for this role (including inherited)
    const permissions = this.getRolePermissions(role);

    // Check for exact match
    const hasExact = permissions.some(
      (p) => p.resource === resource && p.action === action
    );

    if (hasExact) {
      return true;
    }

    // Check for wildcard resource (*)
    const hasWildcard = permissions.some(
      (p) => p.resource === '*' && p.action === action
    );

    return hasWildcard;
  }

  /**
   * Check if user (with multiple roles) has permission
   */
  checkPermission(
    userRoles: readonly string[],
    resource: string,
    action: PermissionAction
  ): PermissionCheckResult {
    if (userRoles.length === 0) {
      return {
        allowed: false,
        reason: 'No roles assigned',
      };
    }

    for (const roleName of userRoles) {
      if (this.hasPermission(roleName, resource, action)) {
        return {
          allowed: true,
        };
      }
    }

    return {
      allowed: false,
      reason: `None of the roles [${userRoles.join(', ')}] have ${action} permission on ${resource}`,
    };
  }

  /**
   * Add permission to role
   */
  addPermission(
    roleName: string,
    permission: Permission
  ): Result<void, AuthError> {
    if (!isPermission(permission)) {
      return {
        success: false,
        error: new AuthError('Invalid permission definition', {
          code: 'RBAC_INVALID_PERMISSION',
          details: permission,
        }),
      };
    }

    const role = this.roles.get(roleName);

    if (!role) {
      return {
        success: false,
        error: new AuthError(`Role not found: ${roleName}`, {
          code: 'RBAC_ROLE_NOT_FOUND',
        }),
      };
    }

    // Check if permission already exists
    const hasPermission = role.permissions.some(
      (p) => p.resource === permission.resource && p.action === permission.action
    );

    if (hasPermission) {
      return {
        success: false,
        error: new AuthError('Permission already exists', {
          code: 'RBAC_PERMISSION_EXISTS',
        }),
      };
    }

    const updatedRole: Role = {
      ...role,
      permissions: [...role.permissions, permission],
    };

    this.roles.set(roleName, updatedRole);

    return { success: true, data: undefined };
  }

  /**
   * Remove permission from role
   */
  removePermission(
    roleName: string,
    resource: string,
    action: PermissionAction
  ): Result<void, AuthError> {
    const role = this.roles.get(roleName);

    if (!role) {
      return {
        success: false,
        error: new AuthError(`Role not found: ${roleName}`, {
          code: 'RBAC_ROLE_NOT_FOUND',
        }),
      };
    }

    const updatedPermissions = role.permissions.filter(
      (p) => !(p.resource === resource && p.action === action)
    );

    if (updatedPermissions.length === role.permissions.length) {
      return {
        success: false,
        error: new AuthError('Permission not found', {
          code: 'RBAC_PERMISSION_NOT_FOUND',
        }),
      };
    }

    const updatedRole: Role = {
      ...role,
      permissions: updatedPermissions,
    };

    this.roles.set(roleName, updatedRole);

    return { success: true, data: undefined };
  }

  /**
   * Get all permissions for a role (including inherited)
   */
  getRolePermissions(
    role: Role,
    visited: Set<string> = new Set()
  ): readonly Permission[] {
    // Check for circular inheritance
    if (visited.has(role.name)) {
      return []; // Cycle detected, return empty to prevent infinite recursion
    }

    visited.add(role.name);
    const permissions: Permission[] = [...role.permissions];

    // Add inherited permissions
    if (role.inherits) {
      for (const inheritedRoleName of role.inherits) {
        const inheritedRole = this.roles.get(inheritedRoleName);

        if (inheritedRole) {
          const inheritedPermissions = this.getRolePermissions(
            inheritedRole,
            visited
          );
          permissions.push(...inheritedPermissions);
        }
      }
    }

    // Deduplicate permissions
    return this.deduplicatePermissions(permissions);
  }

  /**
   * Get default role
   */
  getDefaultRole(): string | undefined {
    return this.defaultRole;
  }

  /**
   * Check if role exists
   */
  hasRole(roleName: string): boolean {
    return this.roles.has(roleName);
  }

  /**
   * Create permission object
   */
  static createPermission(
    resource: string,
    action: PermissionAction
  ): Permission {
    return { resource, action };
  }

  /**
   * Create role object
   */
  static createRole(
    name: string,
    permissions: readonly Permission[],
    inherits?: readonly string[]
  ): Role {
    return {
      name,
      permissions,
      ...(inherits && { inherits }),
    };
  }

  /**
   * Deduplicate permissions array
   */
  private deduplicatePermissions(
    permissions: readonly Permission[]
  ): readonly Permission[] {
    const seen = new Set<string>();
    const unique: Permission[] = [];

    for (const permission of permissions) {
      const key = `${permission.resource}:${permission.action}`;

      if (!seen.has(key)) {
        seen.add(key);
        unique.push(permission);
      }
    }

    return unique;
  }
}

/**
 * Create predefined roles for common use cases
 */
export const PredefinedRoles = {
  /**
   * Admin role with full permissions
   */
  admin: (): Role => ({
    name: 'admin',
    permissions: [
      { resource: '*', action: 'create' },
      { resource: '*', action: 'read' },
      { resource: '*', action: 'update' },
      { resource: '*', action: 'delete' },
    ],
  }),

  /**
   * User role with basic permissions
   */
  user: (): Role => ({
    name: 'user',
    permissions: [
      { resource: '*', action: 'read' },
      { resource: 'posts', action: 'create' },
      { resource: 'comments', action: 'create' },
    ],
  }),

  /**
   * Moderator role
   */
  moderator: (): Role => ({
    name: 'moderator',
    permissions: [
      { resource: '*', action: 'read' },
      { resource: 'posts', action: 'update' },
      { resource: 'posts', action: 'delete' },
      { resource: 'comments', action: 'update' },
      { resource: 'comments', action: 'delete' },
    ],
  }),

  /**
   * Guest role (read-only)
   */
  guest: (): Role => ({
    name: 'guest',
    permissions: [{ resource: '*', action: 'read' }],
  }),
};

/**
 * Create an RBAC manager instance
 */
export function createRbacManager(config?: RbacConfig): RbacManager {
  return new RbacManager(config);
}
