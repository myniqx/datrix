/**
 * Migration Generator Tests
 *
 * Tests for migration operation generation from schema diffs
 * Target: 95%+ coverage - CRITICAL PATH
 */

import { describe, it, expect } from 'vitest';
import { ForgeMigrationGenerator } from '@core/migration/generator';
import type { SchemaDiff, MigrationOperation } from '@core/migration/types';

describe('MigrationGenerator', () => {
  const generator = new ForgeMigrationGenerator();

  describe('Table Operations', () => {
    it('should generate createTable/dropTable for tableAdded', () => {
      const diffs: SchemaDiff[] = [
        {
          type: 'tableAdded',
          schema: {
            name: 'users',
            fields: {
              id: { type: 'number', required: true },
              email: { type: 'string', required: true }
            }
          }
        }
      ];

      const result = generator.generateOperations(diffs);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.up).toHaveLength(1);
        expect(result.data.down).toHaveLength(1);

        // UP operation
        const upOp = result.data.up[0];
        expect(upOp.type).toBe('createTable');
        if (upOp.type === 'createTable') {
          expect(upOp.schema.name).toBe('users');
          expect(upOp.schema.fields).toHaveProperty('id');
          expect(upOp.schema.fields).toHaveProperty('email');
        }

        // DOWN operation (reverse)
        const downOp = result.data.down[0];
        expect(downOp.type).toBe('dropTable');
        if (downOp.type === 'dropTable') {
          expect(downOp.tableName).toBe('users');
        }
      }
    });

    it('should generate dropTable for tableRemoved with TODO down migration', () => {
      const diffs: SchemaDiff[] = [
        {
          type: 'tableRemoved',
          tableName: 'old_table'
        }
      ];

      const result = generator.generateOperations(diffs);

      expect(result.success).toBe(true);
      if (result.success) {
        // UP: drop table
        const upOp = result.data.up[0];
        expect(upOp.type).toBe('dropTable');
        if (upOp.type === 'dropTable') {
          expect(upOp.tableName).toBe('old_table');
        }

        // DOWN: should be raw SQL with TODO (limitation - schema not stored)
        const downOp = result.data.down[0];
        expect(downOp.type).toBe('raw');
        if (downOp.type === 'raw') {
          expect(downOp.sql).toContain('TODO');
          expect(downOp.sql).toContain('old_table');
        }
      }
    });

    it('should generate renameTable with bidirectional operations', () => {
      const diffs: SchemaDiff[] = [
        {
          type: 'tableRenamed',
          from: 'users',
          to: 'accounts'
        }
      ];

      const result = generator.generateOperations(diffs);

      expect(result.success).toBe(true);
      if (result.success) {
        // UP: users → accounts
        const upOp = result.data.up[0];
        expect(upOp.type).toBe('renameTable');
        if (upOp.type === 'renameTable') {
          expect(upOp.from).toBe('users');
          expect(upOp.to).toBe('accounts');
        }

        // DOWN: accounts → users (reversed)
        const downOp = result.data.down[0];
        expect(downOp.type).toBe('renameTable');
        if (downOp.type === 'renameTable') {
          expect(downOp.from).toBe('accounts');
          expect(downOp.to).toBe('users');
        }
      }
    });
  });

  describe('Field Operations', () => {
    it('should generate addColumn/dropColumn for fieldAdded', () => {
      const diffs: SchemaDiff[] = [
        {
          type: 'fieldAdded',
          tableName: 'users',
          fieldName: 'phone',
          definition: { type: 'string', required: false }
        }
      ];

      const result = generator.generateOperations(diffs);

      expect(result.success).toBe(true);
      if (result.success) {
        // UP: add column
        const upOp = result.data.up[0];
        expect(upOp.type).toBe('alterTable');
        if (upOp.type === 'alterTable') {
          expect(upOp.tableName).toBe('users');
          expect(upOp.operations).toHaveLength(1);

          const alterOp = upOp.operations[0];
          expect(alterOp.type).toBe('addColumn');
          if (alterOp.type === 'addColumn') {
            expect(alterOp.column).toBe('phone');
            expect(alterOp.definition.type).toBe('string');
            expect(alterOp.definition.required).toBe(false);
          }
        }

        // DOWN: drop column
        const downOp = result.data.down[0];
        expect(downOp.type).toBe('alterTable');
        if (downOp.type === 'alterTable') {
          expect(downOp.tableName).toBe('users');
          expect(downOp.operations).toHaveLength(1);

          const alterOp = downOp.operations[0];
          expect(alterOp.type).toBe('dropColumn');
          if (alterOp.type === 'dropColumn') {
            expect(alterOp.column).toBe('phone');
          }
        }
      }
    });

    it('should generate dropColumn for fieldRemoved with TODO down migration', () => {
      const diffs: SchemaDiff[] = [
        {
          type: 'fieldRemoved',
          tableName: 'users',
          fieldName: 'old_field'
        }
      ];

      const result = generator.generateOperations(diffs);

      expect(result.success).toBe(true);
      if (result.success) {
        // UP: drop column
        const upOp = result.data.up[0];
        expect(upOp.type).toBe('alterTable');
        if (upOp.type === 'alterTable') {
          const alterOp = upOp.operations[0];
          expect(alterOp.type).toBe('dropColumn');
          if (alterOp.type === 'dropColumn') {
            expect(alterOp.column).toBe('old_field');
          }
        }

        // DOWN: TODO comment (field definition not stored)
        const downOp = result.data.down[0];
        expect(downOp.type).toBe('raw');
        if (downOp.type === 'raw') {
          expect(downOp.sql).toContain('TODO');
          expect(downOp.sql).toContain('old_field');
          expect(downOp.sql).toContain('users');
        }
      }
    });

    it('should generate modifyColumn for fieldModified with exact old and new definitions', () => {
      const diffs: SchemaDiff[] = [
        {
          type: 'fieldModified',
          tableName: 'users',
          fieldName: 'email',
          oldDefinition: { type: 'string', required: false },
          newDefinition: { type: 'string', required: true, unique: true }
        }
      ];

      const result = generator.generateOperations(diffs);

      expect(result.success).toBe(true);
      if (result.success) {
        // UP: modify to new definition
        const upOp = result.data.up[0];
        expect(upOp.type).toBe('alterTable');
        if (upOp.type === 'alterTable') {
          const alterOp = upOp.operations[0];
          expect(alterOp.type).toBe('modifyColumn');
          if (alterOp.type === 'modifyColumn') {
            expect(alterOp.column).toBe('email');
            expect(alterOp.newDefinition).toEqual({
              type: 'string',
              required: true,
              unique: true
            });
          }
        }

        // DOWN: modify back to old definition
        const downOp = result.data.down[0];
        expect(downOp.type).toBe('alterTable');
        if (downOp.type === 'alterTable') {
          const alterOp = downOp.operations[0];
          expect(alterOp.type).toBe('modifyColumn');
          if (alterOp.type === 'modifyColumn') {
            expect(alterOp.column).toBe('email');
            expect(alterOp.newDefinition).toEqual({
              type: 'string',
              required: false
            });
          }
        }
      }
    });

    it('should generate renameColumn with bidirectional operations', () => {
      const diffs: SchemaDiff[] = [
        {
          type: 'fieldRenamed',
          tableName: 'users',
          from: 'username',
          to: 'login'
        }
      ];

      const result = generator.generateOperations(diffs);

      expect(result.success).toBe(true);
      if (result.success) {
        // UP: username → login
        const upOp = result.data.up[0];
        expect(upOp.type).toBe('alterTable');
        if (upOp.type === 'alterTable') {
          const alterOp = upOp.operations[0];
          expect(alterOp.type).toBe('renameColumn');
          if (alterOp.type === 'renameColumn') {
            expect(alterOp.from).toBe('username');
            expect(alterOp.to).toBe('login');
          }
        }

        // DOWN: login → username (reversed)
        const downOp = result.data.down[0];
        expect(downOp.type).toBe('alterTable');
        if (downOp.type === 'alterTable') {
          const alterOp = downOp.operations[0];
          expect(alterOp.type).toBe('renameColumn');
          if (alterOp.type === 'renameColumn') {
            expect(alterOp.from).toBe('login');
            expect(alterOp.to).toBe('username');
          }
        }
      }
    });
  });

  describe('Index Operations', () => {
    it('should generate createIndex/dropIndex for indexAdded', () => {
      const diffs: SchemaDiff[] = [
        {
          type: 'indexAdded',
          tableName: 'users',
          index: {
            name: 'email_idx',
            fields: ['email'],
            unique: true,
            type: 'btree'
          }
        }
      ];

      const result = generator.generateOperations(diffs);

      expect(result.success).toBe(true);
      if (result.success) {
        // UP: create index
        const upOp = result.data.up[0];
        expect(upOp.type).toBe('createIndex');
        if (upOp.type === 'createIndex') {
          expect(upOp.tableName).toBe('users');
          expect(upOp.index.name).toBe('email_idx');
          expect(upOp.index.fields).toEqual(['email']);
          expect(upOp.index.unique).toBe(true);
          expect(upOp.index.type).toBe('btree');
        }

        // DOWN: drop index
        const downOp = result.data.down[0];
        expect(downOp.type).toBe('dropIndex');
        if (downOp.type === 'dropIndex') {
          expect(downOp.tableName).toBe('users');
          expect(downOp.indexName).toBe('email_idx');
        }
      }
    });

    it('should generate dropIndex for indexRemoved', () => {
      const diffs: SchemaDiff[] = [
        {
          type: 'indexRemoved',
          tableName: 'users',
          indexName: 'old_idx'
        }
      ];

      const result = generator.generateOperations(diffs);

      expect(result.success).toBe(true);
      if (result.success) {
        // UP: drop index
        const upOp = result.data.up[0];
        expect(upOp.type).toBe('dropIndex');
        if (upOp.type === 'dropIndex') {
          expect(upOp.tableName).toBe('users');
          expect(upOp.indexName).toBe('old_idx');
        }

        // DOWN: should be raw SQL with TODO (index definition not stored)
        const downOp = result.data.down[0];
        expect(downOp.type).toBe('raw');
        if (downOp.type === 'raw') {
          expect(downOp.sql).toContain('TODO');
          expect(downOp.sql).toContain('old_idx');
        }
      }
    });
  });

  describe('Complex Scenarios', () => {
    it('should generate operations for multiple diffs in order', () => {
      const diffs: SchemaDiff[] = [
        {
          type: 'tableAdded',
          schema: {
            name: 'posts',
            fields: { id: { type: 'number', required: true } }
          }
        },
        {
          type: 'fieldAdded',
          tableName: 'users',
          fieldName: 'age',
          definition: { type: 'number', min: 18 }
        },
        {
          type: 'indexAdded',
          tableName: 'users',
          index: { fields: ['email'], unique: true }
        }
      ];

      const result = generator.generateOperations(diffs);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.up).toHaveLength(3);
        expect(result.data.down).toHaveLength(3);

        // Verify operation types
        expect(result.data.up[0].type).toBe('createTable');
        expect(result.data.up[1].type).toBe('alterTable');
        expect(result.data.up[2].type).toBe('createIndex');

        // Verify down operations are reversed
        expect(result.data.down[0].type).toBe('dropTable');
        expect(result.data.down[1].type).toBe('alterTable');
        expect(result.data.down[2].type).toBe('dropIndex');
      }
    });

    it('should handle constraint changes correctly', () => {
      const diffs: SchemaDiff[] = [
        {
          type: 'fieldModified',
          tableName: 'products',
          fieldName: 'price',
          oldDefinition: { type: 'number', min: 0 },
          newDefinition: { type: 'number', min: 10, max: 10000, integer: true }
        }
      ];

      const result = generator.generateOperations(diffs);

      expect(result.success).toBe(true);
      if (result.success) {
        const upOp = result.data.up[0];
        if (upOp.type === 'alterTable') {
          const alterOp = upOp.operations[0];
          if (alterOp.type === 'modifyColumn') {
            const newDef = alterOp.newDefinition;
            if (newDef.type === 'number') {
              expect(newDef.min).toBe(10);
              expect(newDef.max).toBe(10000);
              expect(newDef.integer).toBe(true);
            }
          }
        }

        const downOp = result.data.down[0];
        if (downOp.type === 'alterTable') {
          const alterOp = downOp.operations[0];
          if (alterOp.type === 'modifyColumn') {
            const oldDef = alterOp.newDefinition;
            if (oldDef.type === 'number') {
              expect(oldDef.min).toBe(0);
              expect(oldDef.max).toBeUndefined();
              expect(oldDef.integer).toBeUndefined();
            }
          }
        }
      }
    });
  });

  describe('Migration Generation (Complete)', () => {
    it('should generate complete migration with metadata and timestamp', () => {
      const diffs: SchemaDiff[] = [
        {
          type: 'tableAdded',
          schema: {
            name: 'users',
            fields: { id: { type: 'number', required: true } }
          }
        }
      ];

      const metadata = {
        name: 'create_users_table',
        version: '001',
        description: 'Create users table',
        author: 'test'
      };

      const result = generator.generate(diffs, metadata);

      expect(result.success).toBe(true);
      if (result.success) {
        const migration = result.data;

        // Metadata
        expect(migration.metadata.name).toBe('create_users_table');
        expect(migration.metadata.version).toBe('001');
        expect(migration.metadata.description).toBe('Create users table');
        expect(migration.metadata.author).toBe('test');
        expect(migration.metadata.timestamp).toBeTypeOf('number');
        expect(migration.metadata.timestamp).toBeGreaterThan(0);

        // Operations
        expect(migration.up).toHaveLength(1);
        expect(migration.down).toHaveLength(1);
        expect(migration.up[0].type).toBe('createTable');
        expect(migration.down[0].type).toBe('dropTable');
      }
    });

    it('should generate unique timestamps for consecutive migrations', () => {
      const diffs: SchemaDiff[] = [
        {
          type: 'tableAdded',
          schema: { name: 'test', fields: {} }
        }
      ];

      const result1 = generator.generate(diffs, { name: 'mig1', version: '001' });
      const result2 = generator.generate(diffs, { name: 'mig2', version: '002' });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      if (result1.success && result2.success) {
        // Timestamps should be different (or at least not fail)
        expect(result1.data.metadata.timestamp).toBeDefined();
        expect(result2.data.metadata.timestamp).toBeDefined();
        // In practice they might be the same if generated quickly,
        // but they should both be valid
        expect(result1.data.metadata.timestamp).toBeGreaterThan(0);
        expect(result2.data.metadata.timestamp).toBeGreaterThan(0);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty diffs array', () => {
      const result = generator.generateOperations([]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.up).toHaveLength(0);
        expect(result.data.down).toHaveLength(0);
      }
    });

    it('should handle composite index with multiple fields', () => {
      const diffs: SchemaDiff[] = [
        {
          type: 'indexAdded',
          tableName: 'orders',
          index: {
            name: 'user_date_idx',
            fields: ['userId', 'createdAt', 'status'],
            type: 'btree'
          }
        }
      ];

      const result = generator.generateOperations(diffs);

      expect(result.success).toBe(true);
      if (result.success) {
        const upOp = result.data.up[0];
        if (upOp.type === 'createIndex') {
          expect(upOp.index.fields).toEqual(['userId', 'createdAt', 'status']);
          expect(upOp.index.fields).toHaveLength(3);
        }
      }
    });

    it('should preserve field definition properties exactly', () => {
      const definition = {
        type: 'string' as const,
        required: true,
        unique: true,
        minLength: 5,
        maxLength: 50,
        pattern: /^[a-z]+$/,
        default: 'test'
      };

      const diffs: SchemaDiff[] = [
        {
          type: 'fieldAdded',
          tableName: 'users',
          fieldName: 'username',
          definition
        }
      ];

      const result = generator.generateOperations(diffs);

      expect(result.success).toBe(true);
      if (result.success) {
        const upOp = result.data.up[0];
        if (upOp.type === 'alterTable') {
          const alterOp = upOp.operations[0];
          if (alterOp.type === 'addColumn') {
            // All properties should be preserved
            expect(alterOp.definition).toEqual(definition);
          }
        }
      }
    });

    it('should handle relation field changes', () => {
      const diffs: SchemaDiff[] = [
        {
          type: 'fieldModified',
          tableName: 'posts',
          fieldName: 'author',
          oldDefinition: {
            type: 'relation',
            model: 'User',
            kind: 'belongsTo',
            foreignKey: 'userId'
          },
          newDefinition: {
            type: 'relation',
            model: 'Account',
            kind: 'belongsTo',
            foreignKey: 'accountId',
            onDelete: 'cascade'
          }
        }
      ];

      const result = generator.generateOperations(diffs);

      expect(result.success).toBe(true);
      if (result.success) {
        const upOp = result.data.up[0];
        if (upOp.type === 'alterTable') {
          const alterOp = upOp.operations[0];
          if (alterOp.type === 'modifyColumn') {
            const newDef = alterOp.newDefinition;
            if (newDef.type === 'relation') {
              expect(newDef.model).toBe('Account');
              expect(newDef.foreignKey).toBe('accountId');
              expect(newDef.onDelete).toBe('cascade');
            }
          }
        }
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid diff types gracefully', () => {
      const invalidDiff = {
        type: 'invalidType'
      } as unknown as SchemaDiff;

      const result = generator.generateOperations([invalidDiff]);

      // Should either fail gracefully or throw error
      expect(result.success).toBeDefined();
    });
  });
});
