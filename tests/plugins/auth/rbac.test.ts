/**
 * Auth Plugin - RBAC Tests
 *
 * Tests the RBAC (Role-Based Access Control) implementation:
 * - Role definition and retrieval
 * - Permission checking (exact and wildcard)
 * - Role inheritance and hierarchy
 * - Multi-role user permissions
 * - Dynamic role/permission management
 */

import { describe, it, expect } from 'vitest';
import { createRbacManager, PredefinedRoles } from '@plugins/auth/rbac';

describe('Auth Plugin - RBAC Manager', () => {
  it('should define and check basic permissions', () => {
    const rbac = createRbacManager();

    rbac.defineRole({
      name: 'editor',
      permissions: [
        { resource: 'posts', action: 'update' },
        { resource: 'posts', action: 'read' }
      ]
    });

    expect(rbac.hasPermission('editor', 'posts', 'update')).toBe(true);
    expect(rbac.hasPermission('editor', 'posts', 'read')).toBe(true);
    expect(rbac.hasPermission('editor', 'posts', 'delete')).toBe(false);
    expect(rbac.hasPermission('editor', 'comments', 'read')).toBe(false);
    expect(rbac.hasPermission('non-existent', 'posts', 'read')).toBe(false);
  });

  it('should handle wildcard resource permissions', () => {
    const rbac = createRbacManager();

    rbac.defineRole({
      name: 'viewer',
      permissions: [{ resource: '*', action: 'read' }]
    });

    expect(rbac.hasPermission('viewer', 'posts', 'read')).toBe(true);
    expect(rbac.hasPermission('viewer', 'users', 'read')).toBe(true);
    expect(rbac.hasPermission('viewer', 'posts', 'update')).toBe(false);
  });

  it('should support role inheritance', () => {
    const rbac = createRbacManager();

    rbac.defineRole({
      name: 'base',
      permissions: [{ resource: 'profile', action: 'read' }]
    });

    rbac.defineRole({
      name: 'user',
      inherits: ['base'],
      permissions: [{ resource: 'posts', action: 'create' }]
    });

    rbac.defineRole({
      name: 'admin',
      inherits: ['user'],
      permissions: [{ resource: '*', action: 'delete' }] // valid action
    });

    // User inherits from base
    expect(rbac.hasPermission('user', 'profile', 'read')).toBe(true);
    expect(rbac.hasPermission('user', 'posts', 'create')).toBe(true);

    // Admin inherits from user (and thus also base)
    expect(rbac.hasPermission('admin', 'profile', 'read')).toBe(true);
    expect(rbac.hasPermission('admin', 'posts', 'create')).toBe(true);
    expect(rbac.hasPermission('admin', 'any-resource', 'delete')).toBe(true);
  });

  it('should prevent circular inheritance', () => {
    const rbac = createRbacManager();

    // Initial roles
    rbac.defineRole({ name: 'A', permissions: [] });
    rbac.defineRole({ name: 'B', inherits: ['A'], permissions: [] });

    // Manually inject circularity for testing the safeguard
    const roleA = rbac.getRole('A')!;
    (roleA as any).inherits = ['B'];

    // Safeguard check: getRolePermissions handles it
    const permissions = rbac.getRolePermissions(roleA);
    expect(Array.isArray(permissions)).toBe(true);
    // Should not crash with "Maximum call stack size exceeded"
  });

  it('should check permissions for users with multiple roles', () => {
    const rbac = createRbacManager();

    rbac.defineRole({
      name: 'role1',
      permissions: [{ resource: 'resource1', action: 'read' }]
    });

    rbac.defineRole({
      name: 'role2',
      permissions: [{ resource: 'resource2', action: 'update' }]
    });

    const roles = ['role1', 'role2'];

    expect(rbac.checkPermission(roles, 'resource1', 'read').allowed).toBe(true);
    expect(rbac.checkPermission(roles, 'resource2', 'update').allowed).toBe(true);
    expect(rbac.checkPermission(roles, 'resource1', 'update').allowed).toBe(false);
    expect(rbac.checkPermission([], 'resource1', 'read').allowed).toBe(false);
  });

  it('should dynamically add and remove permissions', () => {
    const rbac = createRbacManager();
    rbac.defineRole({ name: 'temp', permissions: [] });

    expect(rbac.hasPermission('temp', 'news', 'read')).toBe(false);

    rbac.addPermission('temp', { resource: 'news', action: 'read' });
    expect(rbac.hasPermission('temp', 'news', 'read')).toBe(true);

    rbac.removePermission('temp', 'news', 'read');
    expect(rbac.hasPermission('temp', 'news', 'read')).toBe(false);
  });

  it('should verify predefined roles', () => {
    const rbac = createRbacManager({
      roles: [
        PredefinedRoles.admin(),
        PredefinedRoles.user(),
        PredefinedRoles.guest()
      ]
    });

    expect(rbac.hasPermission('admin', 'anything', 'delete')).toBe(true);
    expect(rbac.hasPermission('user', 'posts', 'create')).toBe(true);
    expect(rbac.hasPermission('user', 'users', 'delete')).toBe(false);
    expect(rbac.hasPermission('guest', 'anything', 'read')).toBe(true);
    expect(rbac.hasPermission('guest', 'anything', 'create')).toBe(false);
  });
});
