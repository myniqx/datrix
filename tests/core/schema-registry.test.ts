/**
 * Core - Schema Registry Tests
 *
 * Tests the SchemaRegistry implementation:
 * - Registration and retrieval
 * - Validation and strict mode
 * - Metadata generation (pluralization)
 * - Locking mechanism
 * - Cache invalidation
 * - Relation validation
 * - JSON Import/Export
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaRegistry, SchemaRegistryError } from '@core/schema/registry';
import type { SchemaDefinition } from '@core/schema/types';

describe('Core - Schema Registry', () => {
  let registry: SchemaRegistry;

  beforeEach(() => {
    registry = new SchemaRegistry({
      strict: true,
      allowOverwrite: false,
      validateRelations: true
    });
  });

  describe('Registration', () => {
    it('should register a valid schema', () => {
      const schema: SchemaDefinition = {
        name: 'User',
        fields: {
          id: { type: 'string', required: true, primary: true },
          email: { type: 'string', required: true, unique: true }
        }
      };

      const result = registry.register(schema);
      expect(result.success).toBe(true);
      expect(registry.has('User')).toBe(true);
      expect(registry.get('User')).toEqual(schema);
    });

    it('should prevent duplicate registration by default', () => {
      const schema: SchemaDefinition = {
        name: 'User',
        fields: { id: { type: 'string' } }
      };

      registry.register(schema);
      const result = registry.register(schema);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DUPLICATE_SCHEMA');
    });

    it('should allow overwrite if configured', () => {
      const r = new SchemaRegistry({ allowOverwrite: true, strict: false, validateRelations: false });
      const s1: any = { name: 'User', fields: { a: { type: 'string' } } };
      const s2: any = { name: 'User', fields: { b: { type: 'string' } } };

      r.register(s1);
      const result = r.register(s2);

      expect(result.success).toBe(true);
      expect(r.get('User')).toEqual(s2);
    });

    it('should reject invalid schema in strict mode', () => {
      const invalidSchema: any = {
        name: '', // Required
        fields: {}
      };

      const result = registry.register(invalidSchema);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_SCHEMA_NAME');
    });
  });

  describe('Metadata & Pluralization', () => {
    it('should generate correct metadata with pluralized table names', () => {
      const tests = [
        { name: 'User', expected: 'users' },
        { name: 'Category', expected: 'categories' },
        { name: 'Bus', expected: 'buses' },
        { name: 'Person', expected: 'people' },
        { name: 'Leaf', expected: 'leaves' },
        { name: 'Hero', expected: 'heroes' },
        { name: 'Status', expected: 'statuses' }
      ];

      for (const { name, expected } of tests) {
        registry.register({ name, fields: { id: { type: 'string' } } });
        const meta = registry.getMetadata(name);
        expect(meta?.tableName).toBe(expected);
      }
    });

    it('should respect custom table names', () => {
      registry.register({
        name: 'Custom',
        tableName: 'my_table',
        fields: { id: { type: 'string' } }
      });
      expect(registry.getMetadata('Custom')?.tableName).toBe('my_table');
    });
  });

  describe('Locking', () => {
    it('should prevent modifications when locked', () => {
      registry.lock();
      expect(registry.isLocked()).toBe(true);

      const result = registry.register({ name: 'Test', fields: { id: { type: 'string' } } });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('REGISTRY_LOCKED');

      expect(() => registry.remove('NonExistent')).toThrow();
      expect(() => registry.clear()).toThrow();
    });

    it('should allow modifications after unlocking', () => {
      registry.lock();
      registry.unlock();
      expect(registry.isLocked()).toBe(false);

      const result = registry.register({ name: 'Test', fields: { id: { type: 'string' } } });
      expect(result.success).toBe(true);
    });
  });

  describe('Relations', () => {
    it('should validate relation targets', () => {
      const posts: SchemaDefinition = {
        name: 'Post',
        fields: {
          author: { type: 'relation', model: 'User', relation: 'belongsTo' }
        }
      };

      // Registering Post without User should fail in registerMany or explicit validation
      const result = registry.registerMany([posts]);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_RELATIONS');
    });

    it('should track related and referencing schemas', () => {
      const user: SchemaDefinition = { name: 'User', fields: { id: { type: 'string' } } };
      const post: SchemaDefinition = {
        name: 'Post',
        fields: {
          author: { type: 'relation', model: 'User', relation: 'belongsTo' }
        }
      };

      registry.registerMany([user, post]);

      expect(registry.getRelatedSchemas('Post')).toContain('User');
      expect(registry.getReferencingSchemas('User')).toContain('Post');
      expect(registry.getSchemasWithRelations()).toHaveLength(1);
    });
  });

  describe('JSON Import/Export', () => {
    it('should export and import schemas correctly', () => {
      const user: SchemaDefinition = { name: 'User', fields: { id: { type: 'string' } } };
      registry.register(user);

      const json = registry.toJSON();
      expect(json['User']).toEqual(user);

      const newRegistry = new SchemaRegistry();
      const result = newRegistry.fromJSON(json);
      expect(result.success).toBe(true);
      expect(newRegistry.has('User')).toBe(true);
    });
  });
});
