/**
 * API Lifecycle Manager Tests
 */

import { describe, it, expect } from 'vitest';
import {
  ApiLifecycleManager,
  createApiLifecycleManager,
  ApiLifecycleError,
} from '../../src/lifecycle/manager';
import type { SchemaDefinition } from 'forja-types/core/schema';
import type { ApiAuthConfig } from 'forja-types/config';

/**
 * Mock Schema Registry
 */
class MockSchemaRegistry {
  private schemas: Map<string, SchemaDefinition> = new Map();

  has(name: string): boolean {
    return this.schemas.has(name);
  }

  get(name: string): SchemaDefinition | undefined {
    return this.schemas.get(name);
  }

  register(schema: SchemaDefinition): void {
    this.schemas.set(schema.name, schema);
  }

  update(name: string, schema: SchemaDefinition): void {
    this.schemas.set(name, schema);
  }

  getAll(): SchemaDefinition[] {
    return Array.from(this.schemas.values());
  }
}

describe('ApiLifecycleManager', () => {
  describe('init', () => {
    it('should reject "auth" schema name', async () => {
      const registry = new MockSchemaRegistry();
      registry.register({
        name: 'auth',
        fields: { id: { type: 'string' } },
      });

      const manager = createApiLifecycleManager({ enabled: true });
      const result = await manager.init(registry);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(ApiLifecycleError);
        expect(result.error.code).toBe('RESERVED_SCHEMA_NAME');
        expect(result.error.message).toContain('reserved');
      }
    });

    it('should skip user schema setup when auth is disabled', async () => {
      const registry = new MockSchemaRegistry();
      const manager = createApiLifecycleManager({ enabled: false });

      const result = await manager.init(registry);

      expect(result.success).toBe(true);
      expect(registry.has('user')).toBe(false);
    });

    it('should create minimal user schema when not exists', async () => {
      const registry = new MockSchemaRegistry();
      const authConfig: ApiAuthConfig = {
        enabled: true,
        jwt: { secret: 'a'.repeat(32) },
      };

      const manager = createApiLifecycleManager(authConfig);
      const result = await manager.init(registry);

      expect(result.success).toBe(true);
      expect(registry.has('user')).toBe(true);

      const userSchema = registry.get('user');
      expect(userSchema).toBeDefined();
      expect(userSchema?.fields.email).toBeDefined();
      expect(userSchema?.fields.password).toBeDefined();
      expect(userSchema?.fields.passwordSalt).toBeDefined();
      expect(userSchema?.fields.role).toBeDefined();
      expect(userSchema?.fields.password?.internal).toBe(true);
      expect(userSchema?.fields.passwordSalt?.internal).toBe(true);
    });

    it('should create user schema with custom field names', async () => {
      const registry = new MockSchemaRegistry();
      const authConfig: ApiAuthConfig = {
        enabled: true,
        jwt: { secret: 'a'.repeat(32) },
        userSchema: {
          fields: {
            email: 'emailAddress',
            password: 'passwordHash',
            role: 'userRole',
          },
        },
      };

      const manager = createApiLifecycleManager(authConfig);
      const result = await manager.init(registry);

      expect(result.success).toBe(true);

      const userSchema = registry.get('user');
      expect(userSchema?.fields.emailAddress).toBeDefined();
      expect(userSchema?.fields.passwordHash).toBeDefined();
      expect(userSchema?.fields.userRole).toBeDefined();
    });

    it('should create user schema with extra fields', async () => {
      const registry = new MockSchemaRegistry();
      const authConfig: ApiAuthConfig = {
        enabled: true,
        jwt: { secret: 'a'.repeat(32) },
        userSchema: {
          extraFields: [
            { name: 'firstName', type: 'string', required: true },
            { name: 'lastName', type: 'string', required: true },
            { name: 'avatar', type: 'string' },
          ],
        },
      };

      const manager = createApiLifecycleManager(authConfig);
      const result = await manager.init(registry);

      expect(result.success).toBe(true);

      const userSchema = registry.get('user');
      expect(userSchema?.fields.firstName).toBeDefined();
      expect(userSchema?.fields.lastName).toBeDefined();
      expect(userSchema?.fields.avatar).toBeDefined();
    });

    it('should reject extra fields that conflict with auth fields', async () => {
      const registry = new MockSchemaRegistry();
      const authConfig: ApiAuthConfig = {
        enabled: true,
        jwt: { secret: 'a'.repeat(32) },
        userSchema: {
          extraFields: [
            { name: 'email', type: 'number' }, // Conflict
          ],
        },
      };

      const manager = createApiLifecycleManager(authConfig);
      const result = await manager.init(registry);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('FIELD_CONFLICT');
      }
    });

    it('should extend existing user schema with auth fields', async () => {
      const registry = new MockSchemaRegistry();
      registry.register({
        name: 'user',
        fields: {
          id: { type: 'string', primaryKey: true },
          email: { type: 'string', required: true, unique: true },
          firstName: { type: 'string', required: true },
          lastName: { type: 'string', required: true },
        },
      });

      const authConfig: ApiAuthConfig = {
        enabled: true,
        jwt: { secret: 'a'.repeat(32) },
      };

      const manager = createApiLifecycleManager(authConfig);
      const result = await manager.init(registry);

      expect(result.success).toBe(true);

      const userSchema = registry.get('user');
      expect(userSchema?.fields.email).toBeDefined();
      expect(userSchema?.fields.firstName).toBeDefined();
      expect(userSchema?.fields.lastName).toBeDefined();
      expect(userSchema?.fields.password).toBeDefined();
      expect(userSchema?.fields.passwordSalt).toBeDefined();
      expect(userSchema?.fields.role).toBeDefined();
    });

    it('should reject user schema without email field', async () => {
      const registry = new MockSchemaRegistry();
      registry.register({
        name: 'user',
        fields: {
          id: { type: 'string', primaryKey: true },
          username: { type: 'string', required: true },
        },
      });

      const authConfig: ApiAuthConfig = {
        enabled: true,
        jwt: { secret: 'a'.repeat(32) },
      };

      const manager = createApiLifecycleManager(authConfig);
      const result = await manager.init(registry);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('MISSING_EMAIL_FIELD');
      }
    });

    it('should reject user schema with non-string email field', async () => {
      const registry = new MockSchemaRegistry();
      registry.register({
        name: 'user',
        fields: {
          id: { type: 'string', primaryKey: true },
          email: { type: 'number', required: true }, // Wrong type
        },
      });

      const authConfig: ApiAuthConfig = {
        enabled: true,
        jwt: { secret: 'a'.repeat(32) },
      };

      const manager = createApiLifecycleManager(authConfig);
      const result = await manager.init(registry);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_EMAIL_FIELD_TYPE');
      }
    });

    it('should use custom user schema name', async () => {
      const registry = new MockSchemaRegistry();
      const authConfig: ApiAuthConfig = {
        enabled: true,
        jwt: { secret: 'a'.repeat(32) },
        userSchema: {
          name: 'account',
        },
      };

      const manager = createApiLifecycleManager(authConfig);
      const result = await manager.init(registry);

      expect(result.success).toBe(true);
      expect(registry.has('account')).toBe(true);
      expect(registry.has('user')).toBe(false);
    });
  });

  describe('validateJwtConfig', () => {
    it('should accept valid JWT secret', () => {
      const manager = createApiLifecycleManager({
        enabled: true,
        jwt: { secret: 'a'.repeat(32) },
      });

      const result = manager.validateJwtConfig();

      expect(result.success).toBe(true);
    });

    it('should reject weak JWT secret', () => {
      const manager = createApiLifecycleManager({
        enabled: true,
        jwt: { secret: 'short' },
      });

      const result = manager.validateJwtConfig();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('WEAK_JWT_SECRET');
      }
    });

    it('should pass when JWT is not configured', () => {
      const manager = createApiLifecycleManager({
        enabled: true,
        session: { store: 'memory' },
      });

      const result = manager.validateJwtConfig();

      expect(result.success).toBe(true);
    });
  });

  describe('shouldGenerateRoutes', () => {
    it('should exclude "auth" schema', () => {
      const manager = createApiLifecycleManager();

      expect(manager.shouldGenerateRoutes('auth')).toBe(false);
    });

    it('should exclude schemas in excludeSchemas list', () => {
      const manager = createApiLifecycleManager();

      expect(manager.shouldGenerateRoutes('internal', ['internal', 'system'])).toBe(false);
      expect(manager.shouldGenerateRoutes('system', ['internal', 'system'])).toBe(false);
    });

    it('should allow regular schemas', () => {
      const manager = createApiLifecycleManager();

      expect(manager.shouldGenerateRoutes('user')).toBe(true);
      expect(manager.shouldGenerateRoutes('post')).toBe(true);
      expect(manager.shouldGenerateRoutes('comment')).toBe(true);
    });
  });

  describe('getAuthFieldNames', () => {
    it('should return default field names', () => {
      const manager = createApiLifecycleManager({ enabled: true });

      const fieldNames = manager.getAuthFieldNames();

      expect(fieldNames).toEqual({
        email: 'email',
        password: 'password',
        role: 'role',
      });
    });

    it('should return custom field names', () => {
      const manager = createApiLifecycleManager({
        enabled: true,
        userSchema: {
          fields: {
            email: 'emailAddress',
            password: 'pwd',
            role: 'userRole',
          },
        },
      });

      const fieldNames = manager.getAuthFieldNames();

      expect(fieldNames).toEqual({
        email: 'emailAddress',
        password: 'pwd',
        role: 'userRole',
      });
    });
  });

  describe('getUserSchemaName', () => {
    it('should return default user schema name', () => {
      const manager = createApiLifecycleManager({ enabled: true });

      expect(manager.getUserSchemaName()).toBe('user');
    });

    it('should return custom user schema name', () => {
      const manager = createApiLifecycleManager({
        enabled: true,
        userSchema: { name: 'account' },
      });

      expect(manager.getUserSchemaName()).toBe('account');
    });
  });
});
