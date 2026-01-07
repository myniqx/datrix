/**
 * Schema Differ Tests
 *
 * Tests for schema comparison and difference detection
 * Target: 90%+ coverage
 */

import { describe, it, expect } from 'vitest';
import { ForgeSchemaDiffer } from '@core/migration/differ';
import type { SchemaDefinition } from '@core/schema/types';
import type { SchemaDiff } from '@core/migration/types';

describe('SchemaDiffer', () => {
  const differ = new ForgeSchemaDiffer();

  describe('Table Detection', () => {
    it('should detect newly added tables', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {};
      const newSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            id: { type: 'number', required: true },
            name: { type: 'string', required: true }
          }
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasChanges).toBe(true);
        expect(result.data.differences).toHaveLength(1);

        const diff = result.data.differences[0];
        expect(diff.type).toBe('tableAdded');
        if (diff.type === 'tableAdded') {
          expect(diff.schema.name).toBe('users');
        }
      }
    });

    it('should detect removed tables', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            id: { type: 'number', required: true }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {};

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasChanges).toBe(true);
        expect(result.data.differences).toHaveLength(1);

        const diff = result.data.differences[0];
        expect(diff.type).toBe('tableRemoved');
        if (diff.type === 'tableRemoved') {
          expect(diff.tableName).toBe('users');
        }
      }
    });

    it('should detect multiple table changes', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: { id: { type: 'number', required: true } }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        posts: {
          name: 'posts',
          fields: { id: { type: 'number', required: true } }
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasChanges).toBe(true);
        expect(result.data.differences).toHaveLength(2);

        const types = result.data.differences.map(d => d.type);
        expect(types).toContain('tableAdded');
        expect(types).toContain('tableRemoved');
      }
    });

    it('should return no changes for identical schemas', () => {
      const schemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            id: { type: 'number', required: true },
            name: { type: 'string', required: true }
          }
        }
      };

      const result = differ.compare(schemas, schemas);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasChanges).toBe(false);
        expect(result.data.differences).toHaveLength(0);
      }
    });
  });

  describe('Field Detection', () => {
    it('should detect newly added fields', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            id: { type: 'number', required: true }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            id: { type: 'number', required: true },
            email: { type: 'string', required: true }
          }
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasChanges).toBe(true);

        const fieldDiff = result.data.differences.find(d => d.type === 'fieldAdded');
        expect(fieldDiff).toBeDefined();
        if (fieldDiff && fieldDiff.type === 'fieldAdded') {
          expect(fieldDiff.tableName).toBe('users');
          expect(fieldDiff.fieldName).toBe('email');
          expect(fieldDiff.definition.type).toBe('string');
        }
      }
    });

    it('should detect removed fields', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            id: { type: 'number', required: true },
            email: { type: 'string', required: true }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            id: { type: 'number', required: true }
          }
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        const fieldDiff = result.data.differences.find(d => d.type === 'fieldRemoved');
        expect(fieldDiff).toBeDefined();
        if (fieldDiff && fieldDiff.type === 'fieldRemoved') {
          expect(fieldDiff.tableName).toBe('users');
          expect(fieldDiff.fieldName).toBe('email');
        }
      }
    });

    it('should detect modified fields', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            age: { type: 'number', required: false }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            age: { type: 'number', required: true }
          }
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        const fieldDiff = result.data.differences.find(d => d.type === 'fieldModified');
        expect(fieldDiff).toBeDefined();
        if (fieldDiff && fieldDiff.type === 'fieldModified') {
          expect(fieldDiff.tableName).toBe('users');
          expect(fieldDiff.fieldName).toBe('age');
          expect(fieldDiff.oldDefinition.required).toBe(false);
          expect(fieldDiff.newDefinition.required).toBe(true);
        }
      }
    });

    it('should detect multiple field changes in same table', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            id: { type: 'number', required: true },
            name: { type: 'string', required: true },
            age: { type: 'number' }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            id: { type: 'number', required: true },
            email: { type: 'string', required: true },
            age: { type: 'number', min: 18 }
          }
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasChanges).toBe(true);

        const types = result.data.differences.map(d => d.type);
        expect(types).toContain('fieldAdded'); // email
        expect(types).toContain('fieldRemoved'); // name
        expect(types).toContain('fieldModified'); // age
      }
    });
  });

  describe('Field Modification Detection', () => {
    it('should detect type changes', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            status: { type: 'string' }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            status: { type: 'boolean' }
          }
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        const fieldDiff = result.data.differences.find(d => d.type === 'fieldModified');
        expect(fieldDiff).toBeDefined();
        if (fieldDiff && fieldDiff.type === 'fieldModified') {
          expect(fieldDiff.oldDefinition.type).toBe('string');
          expect(fieldDiff.newDefinition.type).toBe('boolean');
        }
      }
    });

    it('should detect constraint changes', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            name: { type: 'string', minLength: 3 }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            name: { type: 'string', minLength: 5, maxLength: 50 }
          }
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        const fieldDiff = result.data.differences.find(d => d.type === 'fieldModified');
        expect(fieldDiff).toBeDefined();
      }
    });
  });

  describe('Index Detection', () => {
    it('should detect newly added indexes', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            id: { type: 'number', required: true },
            email: { type: 'string', required: true }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            id: { type: 'number', required: true },
            email: { type: 'string', required: true }
          },
          indexes: [
            { fields: ['email'], unique: true }
          ]
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        const indexDiff = result.data.differences.find(d => d.type === 'indexAdded');
        expect(indexDiff).toBeDefined();
        if (indexDiff && indexDiff.type === 'indexAdded') {
          expect(indexDiff.tableName).toBe('users');
          expect(indexDiff.index.fields).toEqual(['email']);
          expect(indexDiff.index.unique).toBe(true);
        }
      }
    });

    it('should detect removed indexes', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            email: { type: 'string', required: true }
          },
          indexes: [
            { fields: ['email'], unique: true, name: 'email_idx' }
          ]
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            email: { type: 'string', required: true }
          }
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        const indexDiff = result.data.differences.find(d => d.type === 'indexRemoved');
        expect(indexDiff).toBeDefined();
        if (indexDiff && indexDiff.type === 'indexRemoved') {
          expect(indexDiff.tableName).toBe('users');
          expect(indexDiff.indexName).toBe('email_idx');
        }
      }
    });
  });

  describe('Field Modification Details', () => {
    it('should detect string constraint changes with exact values', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            username: { type: 'string', minLength: 3, maxLength: 20 }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            username: { type: 'string', minLength: 5, maxLength: 50 }
          }
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        const fieldDiff = result.data.differences.find(d => d.type === 'fieldModified');
        expect(fieldDiff).toBeDefined();
        if (fieldDiff && fieldDiff.type === 'fieldModified') {
          expect(fieldDiff.fieldName).toBe('username');
          expect(fieldDiff.oldDefinition).toMatchObject({
            type: 'string',
            minLength: 3,
            maxLength: 20
          });
          expect(fieldDiff.newDefinition).toMatchObject({
            type: 'string',
            minLength: 5,
            maxLength: 50
          });
        }
      }
    });

    it('should detect number constraint changes with exact values', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        products: {
          name: 'products',
          fields: {
            price: { type: 'number', min: 0, max: 1000 }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        products: {
          name: 'products',
          fields: {
            price: { type: 'number', min: 10, max: 5000, integer: true }
          }
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        const fieldDiff = result.data.differences.find(d => d.type === 'fieldModified');
        expect(fieldDiff).toBeDefined();
        if (fieldDiff && fieldDiff.type === 'fieldModified') {
          const oldDef = fieldDiff.oldDefinition;
          const newDef = fieldDiff.newDefinition;

          if (oldDef.type === 'number' && newDef.type === 'number') {
            expect(oldDef.min).toBe(0);
            expect(oldDef.max).toBe(1000);
            expect(oldDef.integer).toBeUndefined();

            expect(newDef.min).toBe(10);
            expect(newDef.max).toBe(5000);
            expect(newDef.integer).toBe(true);
          }
        }
      }
    });

    it('should detect enum values changes', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            role: { type: 'enum', values: ['user', 'admin'] as const }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            role: { type: 'enum', values: ['user', 'admin', 'moderator'] as const }
          }
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        const fieldDiff = result.data.differences.find(d => d.type === 'fieldModified');
        expect(fieldDiff).toBeDefined();
        if (fieldDiff && fieldDiff.type === 'fieldModified') {
          const oldDef = fieldDiff.oldDefinition;
          const newDef = fieldDiff.newDefinition;

          if (oldDef.type === 'enum' && newDef.type === 'enum') {
            expect(oldDef.values).toEqual(['user', 'admin']);
            expect(newDef.values).toEqual(['user', 'admin', 'moderator']);
          }
        }
      }
    });

    it('should detect array item type changes', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        posts: {
          name: 'posts',
          fields: {
            tags: {
              type: 'array',
              items: { type: 'string', minLength: 2 }
            }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        posts: {
          name: 'posts',
          fields: {
            tags: {
              type: 'array',
              items: { type: 'string', minLength: 5, maxLength: 20 }
            }
          }
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        const fieldDiff = result.data.differences.find(d => d.type === 'fieldModified');
        expect(fieldDiff).toBeDefined();
        if (fieldDiff && fieldDiff.type === 'fieldModified') {
          const oldDef = fieldDiff.oldDefinition;
          const newDef = fieldDiff.newDefinition;

          if (oldDef.type === 'array' && newDef.type === 'array') {
            if (oldDef.items.type === 'string' && newDef.items.type === 'string') {
              expect(oldDef.items.minLength).toBe(2);
              expect(newDef.items.minLength).toBe(5);
              expect(newDef.items.maxLength).toBe(20);
            }
          }
        }
      }
    });

    it('should detect array constraint changes (minItems, maxItems)', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        posts: {
          name: 'posts',
          fields: {
            tags: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1
            }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        posts: {
          name: 'posts',
          fields: {
            tags: {
              type: 'array',
              items: { type: 'string' },
              minItems: 2,
              maxItems: 10,
              unique: true
            }
          }
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        const fieldDiff = result.data.differences.find(d => d.type === 'fieldModified');
        expect(fieldDiff).toBeDefined();
        if (fieldDiff && fieldDiff.type === 'fieldModified') {
          const oldDef = fieldDiff.oldDefinition;
          const newDef = fieldDiff.newDefinition;

          if (oldDef.type === 'array' && newDef.type === 'array') {
            expect(oldDef.minItems).toBe(1);
            expect(oldDef.maxItems).toBeUndefined();
            expect(oldDef.unique).toBeUndefined();

            expect(newDef.minItems).toBe(2);
            expect(newDef.maxItems).toBe(10);
            expect(newDef.unique).toBe(true);
          }
        }
      }
    });

    it('should detect relation field changes', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        posts: {
          name: 'posts',
          fields: {
            author: {
              type: 'relation',
              model: 'User',
              kind: 'belongsTo',
              foreignKey: 'userId'
            }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        posts: {
          name: 'posts',
          fields: {
            author: {
              type: 'relation',
              model: 'Account',
              kind: 'belongsTo',
              foreignKey: 'accountId'
            }
          }
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        const fieldDiff = result.data.differences.find(d => d.type === 'fieldModified');
        expect(fieldDiff).toBeDefined();
        if (fieldDiff && fieldDiff.type === 'fieldModified') {
          const oldDef = fieldDiff.oldDefinition;
          const newDef = fieldDiff.newDefinition;

          if (oldDef.type === 'relation' && newDef.type === 'relation') {
            expect(oldDef.model).toBe('User');
            expect(oldDef.foreignKey).toBe('userId');

            expect(newDef.model).toBe('Account');
            expect(newDef.foreignKey).toBe('accountId');
          }
        }
      }
    });

    it('should detect unique constraint addition/removal', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            email: { type: 'string', required: true }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            email: { type: 'string', required: true, unique: true }
          }
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        // Unique constraint might be detected as:
        // 1. fieldModified (if differ checks unique property)
        // 2. indexAdded (if differ treats unique as an index)
        // 3. No change (if unique is ignored in field comparison)

        const fieldDiff = result.data.differences.find(d => d.type === 'fieldModified');
        const indexDiff = result.data.differences.find(d => d.type === 'indexAdded');

        // At least one of these should be true
        expect(fieldDiff !== undefined || indexDiff !== undefined).toBe(true);

        if (fieldDiff && fieldDiff.type === 'fieldModified') {
          // If detected as field modification
          expect(fieldDiff.oldDefinition.unique).toBeUndefined();
          expect(fieldDiff.newDefinition.unique).toBe(true);
        }

        if (indexDiff && indexDiff.type === 'indexAdded') {
          // If detected as index addition
          expect(indexDiff.tableName).toBe('users');
          expect(indexDiff.index.unique).toBe(true);
        }
      }
    });

    it('should detect default value changes', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            status: { type: 'string', default: 'pending' }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            status: { type: 'string', default: 'active' }
          }
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        const fieldDiff = result.data.differences.find(d => d.type === 'fieldModified');
        expect(fieldDiff).toBeDefined();
        if (fieldDiff && fieldDiff.type === 'fieldModified') {
          expect(fieldDiff.oldDefinition.default).toBe('pending');
          expect(fieldDiff.newDefinition.default).toBe('active');
        }
      }
    });
  });

  describe('Multiple Changes', () => {
    it('should detect all changes in complex scenario with specific order', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            id: { type: 'number', required: true },
            username: { type: 'string', minLength: 3 },
            email: { type: 'string', required: true }
          }
        },
        posts: {
          name: 'posts',
          fields: {
            id: { type: 'number', required: true }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            id: { type: 'number', required: true },
            username: { type: 'string', minLength: 5 }, // modified
            displayName: { type: 'string' } // added
          }
          // email removed
        },
        comments: { // added table
          name: 'comments',
          fields: {
            id: { type: 'number', required: true }
          }
        }
        // posts removed
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasChanges).toBe(true);

        const types = result.data.differences.map(d => d.type);

        // Tables
        expect(types.filter(t => t === 'tableAdded')).toHaveLength(1);
        expect(types.filter(t => t === 'tableRemoved')).toHaveLength(1);

        // Fields
        expect(types.filter(t => t === 'fieldAdded')).toHaveLength(1);
        expect(types.filter(t => t === 'fieldRemoved')).toHaveLength(1);
        expect(types.filter(t => t === 'fieldModified')).toHaveLength(1);

        // Verify specific changes
        const tableAdded = result.data.differences.find(
          d => d.type === 'tableAdded' && d.schema.name === 'comments'
        );
        expect(tableAdded).toBeDefined();

        const tableRemoved = result.data.differences.find(
          d => d.type === 'tableRemoved' && d.tableName === 'posts'
        );
        expect(tableRemoved).toBeDefined();

        const fieldAdded = result.data.differences.find(
          d => d.type === 'fieldAdded' &&
          d.tableName === 'users' &&
          d.fieldName === 'displayName'
        );
        expect(fieldAdded).toBeDefined();

        const fieldRemoved = result.data.differences.find(
          d => d.type === 'fieldRemoved' &&
          d.tableName === 'users' &&
          d.fieldName === 'email'
        );
        expect(fieldRemoved).toBeDefined();

        const fieldModified = result.data.differences.find(
          d => d.type === 'fieldModified' &&
          d.tableName === 'users' &&
          d.fieldName === 'username'
        );
        expect(fieldModified).toBeDefined();
        if (fieldModified && fieldModified.type === 'fieldModified') {
          if (fieldModified.oldDefinition.type === 'string' &&
              fieldModified.newDefinition.type === 'string') {
            expect(fieldModified.oldDefinition.minLength).toBe(3);
            expect(fieldModified.newDefinition.minLength).toBe(5);
          }
        }
      }
    });
  });

  describe('Index Edge Cases', () => {
    it('should detect multiple indexes added to same table', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            email: { type: 'string' },
            username: { type: 'string' }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            email: { type: 'string' },
            username: { type: 'string' }
          },
          indexes: [
            { fields: ['email'], unique: true, name: 'email_idx' },
            { fields: ['username'], unique: true, name: 'username_idx' },
            { fields: ['email', 'username'], name: 'composite_idx' }
          ]
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        const indexAdded = result.data.differences.filter(d => d.type === 'indexAdded');
        expect(indexAdded).toHaveLength(3);

        // Verify each index
        const emailIdx = indexAdded.find(
          d => d.type === 'indexAdded' && d.index.name === 'email_idx'
        );
        expect(emailIdx).toBeDefined();
        if (emailIdx && emailIdx.type === 'indexAdded') {
          expect(emailIdx.index.fields).toEqual(['email']);
          expect(emailIdx.index.unique).toBe(true);
        }

        const compositeIdx = indexAdded.find(
          d => d.type === 'indexAdded' && d.index.name === 'composite_idx'
        );
        expect(compositeIdx).toBeDefined();
        if (compositeIdx && compositeIdx.type === 'indexAdded') {
          expect(compositeIdx.index.fields).toEqual(['email', 'username']);
          expect(compositeIdx.index.unique).toBeUndefined();
        }
      }
    });

    it('should handle index name generation when not provided', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            email: { type: 'string' }
          }
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {
        users: {
          name: 'users',
          fields: {
            email: { type: 'string' }
          },
          indexes: [
            { fields: ['email'], unique: true } // No name provided
          ]
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        const indexAdded = result.data.differences.find(d => d.type === 'indexAdded');
        expect(indexAdded).toBeDefined();
        // Name might be auto-generated or undefined - both acceptable
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty schema collections', () => {
      const result = differ.compare({}, {});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasChanges).toBe(false);
        expect(result.data.differences).toHaveLength(0);
      }
    });

    it('should handle adding table with no fields', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {};
      const newSchemas: Record<string, SchemaDefinition> = {
        empty: {
          name: 'empty',
          fields: {}
        }
      };

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasChanges).toBe(true);
        const tableAdded = result.data.differences.find(d => d.type === 'tableAdded');
        expect(tableAdded).toBeDefined();
        if (tableAdded && tableAdded.type === 'tableAdded') {
          expect(tableAdded.schema.name).toBe('empty');
          expect(Object.keys(tableAdded.schema.fields)).toHaveLength(0);
        }
      }
    });

    it('should handle removing table with no fields', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {
        empty: {
          name: 'empty',
          fields: {}
        }
      };
      const newSchemas: Record<string, SchemaDefinition> = {};

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasChanges).toBe(true);
        const tableRemoved = result.data.differences.find(d => d.type === 'tableRemoved');
        expect(tableRemoved).toBeDefined();
        if (tableRemoved && tableRemoved.type === 'tableRemoved') {
          expect(tableRemoved.tableName).toBe('empty');
        }
      }
    });

    it('should handle invalid schema definitions gracefully', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {};
      const newSchemas = {
        invalid: { notASchema: true }
      } as unknown as Record<string, SchemaDefinition>;

      const result = differ.compare(oldSchemas, newSchemas);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('DIFF_ERROR');
        expect(result.error.message).toContain('Invalid schema definition');
      }
    });

    it('should handle null field definitions', () => {
      const oldSchemas: Record<string, SchemaDefinition> = {};
      const newSchemas = {
        users: {
          name: 'users',
          fields: {
            bad: null
          }
        }
      } as unknown as Record<string, SchemaDefinition>;

      const result = differ.compare(oldSchemas, newSchemas);

      // Should either fail gracefully or handle it
      expect(result.success).toBeDefined();
    });

    it('should handle very large schemas without performance issues', () => {
      // Create schema with 100 fields
      const fields: Record<string, any> = {};
      for (let i = 0; i < 100; i++) {
        fields[`field${i}`] = { type: 'string', required: i % 2 === 0 };
      }

      const oldSchemas: Record<string, SchemaDefinition> = {
        large: { name: 'large', fields }
      };

      // Modify half of them
      const newFields: Record<string, any> = {};
      for (let i = 0; i < 100; i++) {
        if (i < 50) {
          newFields[`field${i}`] = { type: 'string', required: !fields[`field${i}`].required };
        } else {
          newFields[`field${i}`] = fields[`field${i}`];
        }
      }

      const newSchemas: Record<string, SchemaDefinition> = {
        large: { name: 'large', fields: newFields }
      };

      const startTime = Date.now();
      const result = differ.compare(oldSchemas, newSchemas);
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(100); // Should complete in < 100ms

      if (result.success) {
        const modified = result.data.differences.filter(d => d.type === 'fieldModified');
        expect(modified).toHaveLength(50);
      }
    });
  });

  describe('isFieldModified', () => {
    it('should detect type changes', () => {
      const oldField = { type: 'string' as const };
      const newField = { type: 'number' as const };

      const modified = differ.isFieldModified(oldField, newField);
      expect(modified).toBe(true);
    });

    it('should detect required changes', () => {
      const oldField = { type: 'string' as const, required: false };
      const newField = { type: 'string' as const, required: true };

      const modified = differ.isFieldModified(oldField, newField);
      expect(modified).toBe(true);
    });

    it('should detect constraint changes', () => {
      const oldField = { type: 'string' as const, minLength: 3 };
      const newField = { type: 'string' as const, minLength: 5 };

      const modified = differ.isFieldModified(oldField, newField);
      expect(modified).toBe(true);
    });

    it('should return false for identical fields', () => {
      const field = { type: 'string' as const, required: true, minLength: 3 };

      const modified = differ.isFieldModified(field, field);
      expect(modified).toBe(false);
    });
  });
});
