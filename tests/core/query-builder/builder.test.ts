/**
 * Query Builder Tests
 *
 * Tests for the main query builder class
 * Target: 90%+ coverage
 */

import { describe, it, expect } from 'vitest';
import {
  createQueryBuilder,
  selectFrom,
  insertInto,
  updateTable,
  deleteFrom,
} from '@core/query-builder';
import { sampleSchemas } from '../../utils/fixtures';

describe('QueryBuilder', () => {
  describe('Instantiation', () => {
    it('should create query builder without schema', () => {
      const builder = createQueryBuilder();
      expect(builder).toBeDefined();
    });

    it('should create query builder with schema', () => {
      const builder = createQueryBuilder(sampleSchemas.userSchema);
      expect(builder).toBeDefined();
    });

    it('should fail to build without type and table', () => {
      const builder = createQueryBuilder();
      const query = builder.build();

      expect(query.success).toBe(false);
      if (!query.success) {
        expect(query.error).toBeDefined();
        expect(query.error.message).toContain('type');
      }
    });
  });

  describe('Helper Functions', () => {
    it('should create SELECT query with selectFrom', () => {
      const builder = selectFrom('users');
      const query = builder.build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.type).toBe('select');
        expect(query.data.table).toBe('users');
      }
    });

    it('should create INSERT query with insertInto', () => {
      const builder = insertInto('users', { name: 'John', email: 'john@example.com' });
      const query = builder.build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.type).toBe('insert');
        expect(query.data.table).toBe('users');
        expect(query.data.data).toEqual({ name: 'John', email: 'john@example.com' });
      }
    });

    it('should create UPDATE query with updateTable', () => {
      const builder = updateTable('users', { name: 'Jane' });
      const query = builder.build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.type).toBe('update');
        expect(query.data.table).toBe('users');
        expect(query.data.data).toEqual({ name: 'Jane' });
      }
    });

    it('should create DELETE query with deleteFrom', () => {
      const builder = deleteFrom('users');
      const query = builder.build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.type).toBe('delete');
        expect(query.data.table).toBe('users');
      }
    });
  });

  describe('Method Chaining', () => {
    it('should support method chaining', () => {
      const builder = selectFrom('users');

      const result = builder
        .select(['id', 'name'])
        .where({ status: 'active' })
        .limit(10);

      expect(result).toBe(builder); // Same instance
    });

    it('should build complex query with chaining', () => {
      const query = selectFrom('users')
        .select(['id', 'email', 'name'])
        .where({ role: 'admin' })
        .orderBy('createdAt', 'desc')
        .limit(25)
        .offset(0)
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.table).toBe('users');
        expect(query.data.select).toEqual(['id', 'email', 'name']); // Preserves user's order
        expect(query.data.where).toEqual({ role: 'admin' });
        expect(query.data.limit).toBe(25);
        expect(query.data.offset).toBe(0);
      }
    });
  });

  describe('SELECT Query', () => {
    it('should build select query with specific fields', () => {
      const query = selectFrom('users')
        .select(['id', 'name'])
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data).toMatchObject({
          type: 'select',
          table: 'users',
          select: ['id', 'name'],
        });
      }
    });

    it('should build select query with wildcard', () => {
      const query = selectFrom('users')
        .select('*')
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.select).toBe('*');
      }
    });

    it('should build select query without explicit select (select all)', () => {
      const query = selectFrom('users').build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.type).toBe('select');
        // select might be undefined (implying *)
      }
    });

    it('should override previous selection, not merge', () => {
      const query = selectFrom('users')
        .select(['id', 'name'])
        .select(['email'])
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        // Second select() call overrides the first one
        expect(query.data.select).toEqual(['email']);
        // NOT ['email', 'id', 'name'] - select doesn't merge
      }
    });

    it('should remove duplicate fields while preserving order', () => {
      const query = selectFrom('users')
        .select(['name', 'id', 'name', 'email', 'id'])
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        // Duplicates removed, first occurrence position preserved
        expect(query.data.select).toEqual(['name', 'id', 'email']);
      }
    });
  });

  describe('INSERT Query', () => {
    it('should build insert query', () => {
      const query = insertInto('users', {
        name: 'John',
        email: 'john@example.com',
        role: 'user',
      }).build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.type).toBe('insert');
        expect(query.data.data).toEqual({
          name: 'John',
          email: 'john@example.com',
          role: 'user',
        });
      }
    });

    it('should support returning clause', () => {
      const query = insertInto('users', { name: 'John' })
        .returning(['id', 'createdAt'])
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.returning).toEqual(['id', 'createdAt']); // Preserves user's order
      }
    });
  });

  describe('UPDATE Query', () => {
    it('should build update query', () => {
      const query = updateTable('users', { name: 'Jane' })
        .where({ id: 1 })
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.type).toBe('update');
        expect(query.data.data).toEqual({ name: 'Jane' });
        expect(query.data.where).toEqual({ id: 1 });
      }
    });

    it('should support returning clause', () => {
      const query = updateTable('users', { name: 'Jane' })
        .where({ id: 1 })
        .returning('*')
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.returning).toBe('*');
      }
    });
  });

  describe('DELETE Query', () => {
    it('should build delete query', () => {
      const query = deleteFrom('users')
        .where({ id: 1 })
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.type).toBe('delete');
        expect(query.data.where).toEqual({ id: 1 });
      }
    });

    it('should support returning clause', () => {
      const query = deleteFrom('users')
        .where({ id: 1 })
        .returning(['id'])
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.returning).toEqual(['id']);
      }
    });
  });

  describe('COUNT Query', () => {
    it('should build count query', () => {
      const query = createQueryBuilder()
        .type('count')
        .table('users')
        .where({ status: 'active' })
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.type).toBe('count');
        expect(query.data.where).toEqual({ status: 'active' });
      }
    });
  });

  describe('WHERE Conditions', () => {
    it('should set where conditions', () => {
      const query = selectFrom('users')
        .where({ status: 'active', role: 'admin' })
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.where).toEqual({ status: 'active', role: 'admin' });
      }
    });

    it('should merge conditions with andWhere using $and operator', () => {
      const query = selectFrom('users')
        .where({ status: 'active' })
        .andWhere({ role: 'admin' })
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.where).toEqual({
          $and: [
            { status: 'active' },
            { role: 'admin' }
          ]
        });
      }
    });

    it('should support multiple andWhere calls (creates nested structure)', () => {
      const query = selectFrom('users')
        .where({ status: 'active' })
        .andWhere({ role: 'admin' })
        .andWhere({ verified: true })
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        // Multiple andWhere creates nested $and structure
        expect(query.data.where).toEqual({
          $and: [
            { $and: [{ status: 'active' }, { role: 'admin' }] },
            { verified: true }
          ]
        });
      }
    });

    it('should create OR condition with orWhere', () => {
      const query = selectFrom('users')
        .where({ status: 'active' })
        .orWhere({ role: 'admin' })
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.where).toHaveProperty('$or');
        expect(query.data.where).toEqual({
          $or: [
            { status: 'active' },
            { role: 'admin' }
          ]
        });
      }
    });

    it('should support complex where with comparison operators', () => {
      const query = selectFrom('users')
        .where({
          age: { $gte: 18, $lte: 65 },
          status: 'active'
        })
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.where).toEqual({
          age: { $gte: 18, $lte: 65 },
          status: 'active'
        });
      }
    });
  });

  describe('ORDER BY', () => {
    it('should set order by ascending', () => {
      const query = selectFrom('users')
        .orderBy('createdAt', 'asc')
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.orderBy).toEqual([
          { field: 'createdAt', direction: 'asc' },
        ]);
      }
    });

    it('should set order by descending', () => {
      const query = selectFrom('users')
        .orderBy('createdAt', 'desc')
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.orderBy).toEqual([
          { field: 'createdAt', direction: 'desc' },
        ]);
      }
    });

    it('should support multiple order by', () => {
      const query = selectFrom('users')
        .orderBy('role', 'asc')
        .orderBy('createdAt', 'desc')
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.orderBy).toHaveLength(2);
        expect(query.data.orderBy?.[0]).toEqual({ field: 'role', direction: 'asc' });
        expect(query.data.orderBy?.[1]).toEqual({ field: 'createdAt', direction: 'desc' });
      }
    });
  });

  describe('Pagination', () => {
    it('should set limit', () => {
      const query = selectFrom('users')
        .limit(10)
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.limit).toBe(10);
      }
    });

    it('should set offset', () => {
      const query = selectFrom('users')
        .offset(20)
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.offset).toBe(20);
      }
    });

    it('should support limit and offset together', () => {
      const query = selectFrom('users')
        .limit(25)
        .offset(50)
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.limit).toBe(25);
        expect(query.data.offset).toBe(50);
      }
    });
  });

  describe('DISTINCT', () => {
    it('should set distinct flag', () => {
      const query = selectFrom('users')
        .select(['email'])
        .distinct()
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.distinct).toBe(true);
      }
    });

    it('should work with multiple fields', () => {
      const query = selectFrom('users')
        .select(['status', 'role'])
        .distinct()
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.distinct).toBe(true);
        expect(query.data.select).toEqual(['status', 'role']); // Preserves user's order
      }
    });

    it('should allow disabling distinct', () => {
      const query = selectFrom('users')
        .select(['email'])
        .distinct(false)
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.distinct).toBe(false);
      }
    });
  });

  describe('GROUP BY', () => {
    it('should set group by fields', () => {
      const query = selectFrom('users')
        .select(['status'])
        .groupBy(['status'])
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.groupBy).toEqual(['status']);
      }
    });

    it('should support multiple group by fields', () => {
      const query = selectFrom('users')
        .select(['status', 'role'])
        .groupBy(['status', 'role'])
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.groupBy).toEqual(['status', 'role']);
      }
    });
  });

  describe('HAVING', () => {
    it('should set having clause', () => {
      const query = selectFrom('users')
        .select(['status'])
        .groupBy(['status'])
        .having({ count: { $gt: 5 } })
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.having).toEqual({ count: { $gt: 5 } });
      }
    });
  });

  describe('Clone', () => {
    it('should create independent copy without shared references', () => {
      const original = selectFrom('users')
        .select(['id', 'name'])
        .where({ status: 'active' })
        .orderBy('createdAt', 'desc')
        .limit(10);

      const cloned = original.clone();

      // Modify clone - should not affect original
      cloned
        .select(['email']) // select() overrides, doesn't merge
        .andWhere({ role: 'admin' })
        .orderBy('name', 'asc')
        .limit(20);

      const originalQuery = original.build();
      const clonedQuery = cloned.build();

      expect(originalQuery.success).toBe(true);
      expect(clonedQuery.success).toBe(true);

      if (originalQuery.success && clonedQuery.success) {
        // Original should remain unchanged
        expect(originalQuery.data.select).toEqual(['id', 'name']);
        expect(originalQuery.data.where).toEqual({ status: 'active' });
        expect(originalQuery.data.limit).toBe(10);
        expect(originalQuery.data.orderBy).toHaveLength(1);

        // Clone should have modifications (select is overridden, not merged)
        expect(clonedQuery.data.select).toEqual(['email']);
        expect(clonedQuery.data.where).toHaveProperty('$and');
        expect(clonedQuery.data.limit).toBe(20);
        expect(clonedQuery.data.orderBy).toHaveLength(2);
      }
    });

    it('should deep clone nested objects (where, populate, data)', () => {
      const original = updateTable('users', {
        metadata: { updated: true, count: 1 }
      }).where({
        settings: { notifications: true }
      });

      const cloned = original.clone();

      // Modify nested data in clone
      cloned.data({ metadata: { updated: false, count: 2 } });
      cloned.where({ settings: { notifications: false } });

      const originalQuery = original.build();
      const clonedQuery = cloned.build();

      if (originalQuery.success && clonedQuery.success) {
        // Original nested data should be unchanged
        expect(originalQuery.data.data).toEqual({
          metadata: { updated: true, count: 1 }
        });
        expect(originalQuery.data.where).toEqual({
          settings: { notifications: true }
        });

        // Clone should have new data
        expect(clonedQuery.data.data).toEqual({
          metadata: { updated: false, count: 2 }
        });
        expect(clonedQuery.data.where).toEqual({
          settings: { notifications: false }
        });
      }
    });
  });

  describe('Reset', () => {
    it('should reset query builder', () => {
      const builder = selectFrom('users')
        .select(['id'])
        .where({ status: 'active' })
        .limit(10);

      builder.reset();

      const query = builder.build();
      expect(query.success).toBe(false); // No type/table after reset
    });
  });

  describe('Complex Query Combinations', () => {
    it('should support UPDATE with WHERE + RETURNING + multiple clauses', () => {
      const query = updateTable('users', {
        status: 'inactive',
        lastModified: new Date('2024-01-01')
      })
        .where({ lastLogin: { $lt: '2023-01-01' } })
        .andWhere({ role: 'user' })
        .returning(['id', 'email', 'status'])
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.type).toBe('update');
        expect(query.data.table).toBe('users');
        expect(query.data.data).toEqual({
          status: 'inactive',
          lastModified: new Date('2024-01-01')
        });
        expect(query.data.where).toHaveProperty('$and');
        expect(query.data.returning).toEqual(['id', 'email', 'status']); // Preserves order
      }
    });

    it('should support SELECT with DISTINCT + GROUP BY + HAVING + ORDER BY', () => {
      const query = selectFrom('orders')
        .select(['customerId', 'status'])
        .distinct()
        .where({ total: { $gte: 100 } })
        .groupBy(['customerId', 'status'])
        .having({ orderCount: { $gt: 5 } })
        .orderBy('customerId', 'asc')
        .orderBy('status', 'desc')
        .limit(10)
        .offset(0)
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.type).toBe('select');
        expect(query.data.distinct).toBe(true);
        expect(query.data.where).toBeDefined();
        expect(query.data.groupBy).toEqual(['customerId', 'status']);
        expect(query.data.having).toEqual({ orderCount: { $gt: 5 } });
        expect(query.data.orderBy).toHaveLength(2);
        expect(query.data.limit).toBe(10);
        expect(query.data.offset).toBe(0);
      }
    });

    it('should support DELETE with complex WHERE conditions', () => {
      const query = deleteFrom('sessions')
        .where({ expired: true })
        .andWhere({
          lastActivity: { $lt: new Date('2024-01-01') }
        })
        .returning(['id', 'userId'])
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.type).toBe('delete');
        expect(query.data.where).toHaveProperty('$and');
        expect(query.data.returning).toBeDefined();
      }
    });

    it('should support INSERT with RETURNING', () => {
      const query = insertInto('posts', {
        title: 'New Post',
        content: 'Content here',
        authorId: 1,
        tags: ['typescript', 'testing']
      })
        .returning(['id', 'createdAt', 'slug'])
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.type).toBe('insert');
        expect(query.data.data).toBeDefined();
        expect(query.data.data?.tags).toEqual(['typescript', 'testing']);
        expect(query.data.returning).toEqual(['id', 'createdAt', 'slug']); // Preserves order
      }
    });

    it('should support SELECT with nested WHERE (OR + AND)', () => {
      const query = selectFrom('users')
        .where({ status: 'active' })
        .orWhere({ role: 'admin' })
        .build();

      expect(query.success).toBe(true);
      if (query.success) {
        expect(query.data.where).toEqual({
          $or: [
            { status: 'active' },
            { role: 'admin' }
          ]
        });
      }
    });
  });

  describe('Error Handling', () => {
    it('should fail without table name', () => {
      const query = createQueryBuilder()
        .type('select')
        .build();

      expect(query.success).toBe(false);
      if (!query.success) {
        expect(query.error.message).toContain('Table');
      }
    });

    it('should fail without query type', () => {
      const query = createQueryBuilder()
        .table('users')
        .build();

      expect(query.success).toBe(false);
      if (!query.success) {
        expect(query.error.message).toContain('type');
      }
    });
  });
});
