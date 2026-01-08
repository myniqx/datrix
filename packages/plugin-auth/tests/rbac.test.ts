/**
 * RBAC Manager Tests - Happy Path
 *
 * Tests successful RBAC operations:
 * - Role definition and permission checking
 * - Wildcard permissions
 * - Role inheritance
 * - Multi-role permission checking
 * - Dynamic permission management
 */

import { describe, it, expect } from 'vitest';
import { createRbacManager, PredefinedRoles } from '../src/rbac';

describe('RBAC Manager - Happy Path', () => {
  describe('Basic Permissions', () => {
    it('should define and check permissions correctly', () => {
      const rbacManager = createRbacManager();

      rbacManager.defineRole({
        name: 'editor',
        permissions: [
          { resource: 'posts', action: 'update' },
          { resource: 'posts', action: 'read' }
        ]
      });

      expect(rbacManager.hasPermission('editor', 'posts', 'update')).toBe(true);
      expect(rbacManager.hasPermission('editor', 'posts', 'read')).toBe(true);
    });

    it('should deny permissions not explicitly granted', () => {
      const rbacManager = createRbacManager();

      rbacManager.defineRole({
        name: 'editor',
        permissions: [{ resource: 'posts', action: 'read' }]
      });

      expect(rbacManager.hasPermission('editor', 'posts', 'delete')).toBe(false);
      expect(rbacManager.hasPermission('editor', 'comments', 'read')).toBe(false);
    });
  });

  describe('Wildcard Permissions', () => {
    it('should handle wildcard resource permissions', () => {
      const rbacManager = createRbacManager();

      rbacManager.defineRole({
        name: 'viewer',
        permissions: [{ resource: '*', action: 'read' }]
      });

      expect(rbacManager.hasPermission('viewer', 'posts', 'read')).toBe(true);
      expect(rbacManager.hasPermission('viewer', 'users', 'read')).toBe(true);
      expect(rbacManager.hasPermission('viewer', 'anything', 'read')).toBe(true);
    });
  });

  describe('Role Inheritance', () => {
    it('should support single-level inheritance', () => {
      const rbacManager = createRbacManager();

      rbacManager.defineRole({
        name: 'base',
        permissions: [{ resource: 'profile', action: 'read' }]
      });

      rbacManager.defineRole({
        name: 'user',
        inherits: ['base'],
        permissions: [{ resource: 'posts', action: 'create' }]
      });

      expect(rbacManager.hasPermission('user', 'profile', 'read')).toBe(true);
      expect(rbacManager.hasPermission('user', 'posts', 'create')).toBe(true);
    });

    it('should support multi-level inheritance', () => {
      const rbacManager = createRbacManager();

      rbacManager.defineRole({
        name: 'base',
        permissions: [{ resource: 'profile', action: 'read' }]
      });

      rbacManager.defineRole({
        name: 'user',
        inherits: ['base'],
        permissions: [{ resource: 'posts', action: 'create' }]
      });

      rbacManager.defineRole({
        name: 'admin',
        inherits: ['user'],
        permissions: [{ resource: '*', action: 'delete' }]
      });

      expect(rbacManager.hasPermission('admin', 'profile', 'read')).toBe(true);
      expect(rbacManager.hasPermission('admin', 'posts', 'create')).toBe(true);
      expect(rbacManager.hasPermission('admin', 'any-resource', 'delete')).toBe(true);
    });
  });

  describe('Multi-Role Users', () => {
    it('should check permissions for users with multiple roles', () => {
      const rbacManager = createRbacManager();

      rbacManager.defineRole({
        name: 'role1',
        permissions: [{ resource: 'resource1', action: 'read' }]
      });

      rbacManager.defineRole({
        name: 'role2',
        permissions: [{ resource: 'resource2', action: 'update' }]
      });

      const userRoles = ['role1', 'role2'];

      expect(rbacManager.checkPermission(userRoles, 'resource1', 'read').allowed).toBe(true);
      expect(rbacManager.checkPermission(userRoles, 'resource2', 'update').allowed).toBe(true);
    });
  });

  describe('Dynamic Permission Management', () => {
    it('should add permissions dynamically', () => {
      const rbacManager = createRbacManager();
      rbacManager.defineRole({ name: 'temp', permissions: [] });

      expect(rbacManager.hasPermission('temp', 'news', 'read')).toBe(false);

      rbacManager.addPermission('temp', { resource: 'news', action: 'read' });
      expect(rbacManager.hasPermission('temp', 'news', 'read')).toBe(true);
    });

    it('should remove permissions dynamically', () => {
      const rbacManager = createRbacManager();
      rbacManager.defineRole({
        name: 'temp',
        permissions: [{ resource: 'news', action: 'read' }]
      });

      expect(rbacManager.hasPermission('temp', 'news', 'read')).toBe(true);

      rbacManager.removePermission('temp', 'news', 'read');
      expect(rbacManager.hasPermission('temp', 'news', 'read')).toBe(false);
    });
  });

  describe('Predefined Roles', () => {
    it('should verify admin role permissions', () => {
      const rbacManager = createRbacManager({
        roles: [PredefinedRoles.admin()]
      });

      expect(rbacManager.hasPermission('admin', 'anything', 'delete')).toBe(true);
      expect(rbacManager.hasPermission('admin', 'anything', 'create')).toBe(true);
    });

    it('should verify user role permissions', () => {
      const rbacManager = createRbacManager({
        roles: [PredefinedRoles.user()]
      });

      expect(rbacManager.hasPermission('user', 'posts', 'create')).toBe(true);
      expect(rbacManager.hasPermission('user', 'users', 'delete')).toBe(false);
    });

    it('should verify guest role permissions', () => {
      const rbacManager = createRbacManager({
        roles: [PredefinedRoles.guest()]
      });

      expect(rbacManager.hasPermission('guest', 'anything', 'read')).toBe(true);
      expect(rbacManager.hasPermission('guest', 'anything', 'create')).toBe(false);
    });
  });

  describe('Circular Inheritance Protection', () => {
    it('should handle circular inheritance without crashing', () => {
      const rbacManager = createRbacManager();

      rbacManager.defineRole({ name: 'A', permissions: [] });
      rbacManager.defineRole({ name: 'B', inherits: ['A'], permissions: [] });

      const roleA = rbacManager.getRole('A')!;
      (roleA as any).inherits = ['B'];

      const permissions = rbacManager.getRolePermissions(roleA);
      expect(Array.isArray(permissions)).toBe(true);
    });
  });
});
