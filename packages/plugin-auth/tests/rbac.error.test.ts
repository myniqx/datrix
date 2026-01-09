/**
 * RBAC Manager Tests - Error Path
 *
 * Tests error handling:
 * - Non-existent role checks
 * - Empty role arrays
 */

import { describe, it, expect } from 'vitest';
import { createRbacManager } from '../src/rbac';

describe('RBAC Manager - Error Path', () => {
  describe('Non-Existent Roles', () => {
    it('should deny permissions for non-existent roles', () => {
      const rbacManager = createRbacManager();

      rbacManager.defineRole({
        name: 'editor',
        permissions: [{ resource: 'posts', action: 'read' }]
      });

      expect(rbacManager.hasPermission('non-existent', 'posts', 'read')).toBe(false);
    });
  });

  describe('Empty Role Arrays', () => {
    it('should deny permissions for users with no roles', () => {
      const rbacManager = createRbacManager();

      rbacManager.defineRole({
        name: 'editor',
        permissions: [{ resource: 'posts', action: 'read' }]
      });

      const emptyRoles: string[] = [];
      expect(rbacManager.checkPermission(emptyRoles, 'posts', 'read').allowed).toBe(false);
    });
  });

  describe('Permission Denial', () => {
    it('should deny wildcard action permissions', () => {
      const rbacManager = createRbacManager();

      rbacManager.defineRole({
        name: 'viewer',
        permissions: [{ resource: '*', action: 'read' }]
      });

      expect(rbacManager.hasPermission('viewer', 'posts', 'update')).toBe(false);
      expect(rbacManager.hasPermission('viewer', 'posts', 'delete')).toBe(false);
    });
  });
});
