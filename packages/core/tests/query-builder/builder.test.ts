/**
 * Query Builder Tests - Happy Path
 *
 * Tests for the main query builder class
 * Target: 90%+ coverage
 */

import { describe, it, expect } from 'vitest';

import { createQueryBuilder, deleteFrom, insertInto, selectFrom, updateTable } from '../../src';
import { expectSuccessData } from '../../../types/src/test/helpers';
import { sampleSchemas } from '../../../types/src/test/fixtures';

describe('QueryBuilder - Happy Path', () => {
  describe('Instantiation', () => {
    it('should create query builder without schema', () => {
      const emptyBuilder = createQueryBuilder();
      expect(emptyBuilder).toBeDefined();
    });

    it('should create query builder with schema', () => {
      const builderWithSchema = createQueryBuilder(sampleSchemas.userSchema);
      expect(builderWithSchema).toBeDefined();
    });
  });

  describe('Helper Functions', () => {
    it('should create SELECT query with selectFrom', () => {
      const selectBuilder = selectFrom('users');
      const builtQuery = selectBuilder.build();

      const queryData = expectSuccessData(builtQuery);
      expect(queryData.type).toBe('select');
      expect(queryData.table).toBe('users');
    });

    it('should create INSERT query with insertInto', () => {
      const newUserData = { name: 'John', email: 'john@example.com' };
      const insertBuilder = insertInto('users', newUserData);
      const builtQuery = insertBuilder.build();

      const queryData = expectSuccessData(builtQuery);
      expect(queryData.type).toBe('insert');
      expect(queryData.table).toBe('users');
      expect(queryData.data).toEqual(newUserData);
    });

    it('should create UPDATE query with updateTable', () => {
      const updatedName = { name: 'Jane' };
      const updateBuilder = updateTable('users', updatedName);
      const builtQuery = updateBuilder.build();

      const queryData = expectSuccessData(builtQuery);
      expect(queryData.type).toBe('update');
      expect(queryData.table).toBe('users');
      expect(queryData.data).toEqual(updatedName);
    });

    it('should create DELETE query with deleteFrom', () => {
      const deleteBuilder = deleteFrom('users');
      const builtQuery = deleteBuilder.build();

      const queryData = expectSuccessData(builtQuery);
      expect(queryData.type).toBe('delete');
      expect(queryData.table).toBe('users');
    });
  });

  describe('Method Chaining', () => {
    it('should support method chaining', () => {
      const chainedBuilder = selectFrom('users');

      const sameInstance = chainedBuilder
        .select(['id', 'name'])
        .where({ status: 'active' })
        .limit(10);

      expect(sameInstance).toBe(chainedBuilder);
    });

    it('should build complex query with chaining', () => {
      const adminUsersQuery = selectFrom('users')
        .select(['id', 'email', 'name'])
        .where({ role: 'admin' })
        .orderBy('createdAt', 'desc')
        .limit(25)
        .offset(0)
        .build();

      const queryData = expectSuccessData(adminUsersQuery);
      expect(queryData.table).toBe('users');
      expect(queryData.select).toEqual(['id', 'email', 'name']);
      expect(queryData.where).toEqual({ role: 'admin' });
      expect(queryData.limit).toBe(25);
      expect(queryData.offset).toBe(0);
    });
  });

  describe('SELECT Query', () => {
    it('should build select query with specific fields', () => {
      const specificFieldsQuery = selectFrom('users')
        .select(['id', 'name'])
        .build();

      const queryData = expectSuccessData(specificFieldsQuery);
      expect(queryData).toMatchObject({
        type: 'select',
        table: 'users',
        select: ['id', 'name'],
      });
    });

    it('should build select query with wildcard', () => {
      const wildcardQuery = selectFrom('users')
        .select('*')
        .build();

      const queryData = expectSuccessData(wildcardQuery);
      expect(queryData.select).toBe('*');
    });

    it('should build select query without explicit select (select all)', () => {
      const implicitSelectAllQuery = selectFrom('users').build();

      const queryData = expectSuccessData(implicitSelectAllQuery);
      expect(queryData.type).toBe('select');
    });

    it('should override previous selection, not merge', () => {
      const overriddenSelectQuery = selectFrom('users')
        .select(['id', 'name'])
        .select(['email'])
        .build();

      const queryData = expectSuccessData(overriddenSelectQuery);
      expect(queryData.select).toEqual(['email']);
    });

    it('should remove duplicate fields while preserving order', () => {
      const duplicateFieldsQuery = selectFrom('users')
        .select(['name', 'id', 'name', 'email', 'id'])
        .build();

      const queryData = expectSuccessData(duplicateFieldsQuery);
      expect(queryData.select).toEqual(['name', 'id', 'email']);
    });
  });

  describe('INSERT Query', () => {
    it('should build insert query', () => {
      const newUserData = {
        name: 'John',
        email: 'john@example.com',
        role: 'user',
      };
      const insertQuery = insertInto('users', newUserData).build();

      const queryData = expectSuccessData(insertQuery);
      expect(queryData.type).toBe('insert');
      expect(queryData.data).toEqual(newUserData);
    });

    it('should support returning clause', () => {
      const insertWithReturningQuery = insertInto('users', { name: 'John' })
        .returning(['id', 'createdAt'])
        .build();

      const queryData = expectSuccessData(insertWithReturningQuery);
      expect(queryData.returning).toEqual(['id', 'createdAt']);
    });
  });

  describe('UPDATE Query', () => {
    it('should build update query', () => {
      const updateQuery = updateTable('users', { name: 'Jane' })
        .where({ id: 1 })
        .build();

      const queryData = expectSuccessData(updateQuery);
      expect(queryData.type).toBe('update');
      expect(queryData.data).toEqual({ name: 'Jane' });
      expect(queryData.where).toEqual({ id: 1 });
    });

    it('should support returning clause', () => {
      const updateWithReturningQuery = updateTable('users', { name: 'Jane' })
        .where({ id: 1 })
        .returning('*')
        .build();

      const queryData = expectSuccessData(updateWithReturningQuery);
      expect(queryData.returning).toBe('*');
    });
  });

  describe('DELETE Query', () => {
    it('should build delete query', () => {
      const deleteQuery = deleteFrom('users')
        .where({ id: 1 })
        .build();

      const queryData = expectSuccessData(deleteQuery);
      expect(queryData.type).toBe('delete');
      expect(queryData.where).toEqual({ id: 1 });
    });

    it('should support returning clause', () => {
      const deleteWithReturningQuery = deleteFrom('users')
        .where({ id: 1 })
        .returning(['id'])
        .build();

      const queryData = expectSuccessData(deleteWithReturningQuery);
      expect(queryData.returning).toEqual(['id']);
    });
  });

  describe('COUNT Query', () => {
    it('should build count query', () => {
      const countQuery = createQueryBuilder()
        .type('count')
        .table('users')
        .where({ status: 'active' })
        .build();

      const queryData = expectSuccessData(countQuery);
      expect(queryData.type).toBe('count');
      expect(queryData.where).toEqual({ status: 'active' });
    });
  });

  describe('WHERE Conditions', () => {
    it('should set where conditions', () => {
      const simpleWhereQuery = selectFrom('users')
        .where({ status: 'active', role: 'admin' })
        .build();

      const queryData = expectSuccessData(simpleWhereQuery);
      expect(queryData.where).toEqual({ status: 'active', role: 'admin' });
    });

    it('should merge conditions with andWhere using $and operator', () => {
      const andWhereQuery = selectFrom('users')
        .where({ status: 'active' })
        .andWhere({ role: 'admin' })
        .build();

      const queryData = expectSuccessData(andWhereQuery);
      expect(queryData.where).toEqual({
        $and: [
          { status: 'active' },
          { role: 'admin' }
        ]
      });
    });

    it('should support multiple andWhere calls (creates nested structure)', () => {
      const multipleAndWhereQuery = selectFrom('users')
        .where({ status: 'active' })
        .andWhere({ role: 'admin' })
        .andWhere({ verified: true })
        .build();

      const queryData = expectSuccessData(multipleAndWhereQuery);
      expect(queryData.where).toEqual({
        $and: [
          { $and: [{ status: 'active' }, { role: 'admin' }] },
          { verified: true }
        ]
      });
    });

    it('should create OR condition with orWhere', () => {
      const orWhereQuery = selectFrom('users')
        .where({ status: 'active' })
        .orWhere({ role: 'admin' })
        .build();

      const queryData = expectSuccessData(orWhereQuery);
      expect(queryData.where).toHaveProperty('$or');
      expect(queryData.where).toEqual({
        $or: [
          { status: 'active' },
          { role: 'admin' }
        ]
      });
    });

    it('should support complex where with comparison operators', () => {
      const ageRangeCondition = {
        age: { $gte: 18, $lte: 65 },
        status: 'active'
      };
      const complexWhereQuery = selectFrom('users')
        .where(ageRangeCondition)
        .build();

      const queryData = expectSuccessData(complexWhereQuery);
      expect(queryData.where).toEqual(ageRangeCondition);
    });
  });

  describe('ORDER BY', () => {
    it('should set order by ascending', () => {
      const ascendingOrderQuery = selectFrom('users')
        .orderBy('createdAt', 'asc')
        .build();

      const queryData = expectSuccessData(ascendingOrderQuery);
      expect(queryData.orderBy).toEqual([
        { field: 'createdAt', direction: 'asc' },
      ]);
    });

    it('should set order by descending', () => {
      const descendingOrderQuery = selectFrom('users')
        .orderBy('createdAt', 'desc')
        .build();

      const queryData = expectSuccessData(descendingOrderQuery);
      expect(queryData.orderBy).toEqual([
        { field: 'createdAt', direction: 'desc' },
      ]);
    });

    it('should support multiple order by', () => {
      const multipleOrderByQuery = selectFrom('users')
        .orderBy('role', 'asc')
        .orderBy('createdAt', 'desc')
        .build();

      const queryData = expectSuccessData(multipleOrderByQuery);
      expect(queryData.orderBy).toHaveLength(2);
      expect(queryData.orderBy?.[0]).toEqual({ field: 'role', direction: 'asc' });
      expect(queryData.orderBy?.[1]).toEqual({ field: 'createdAt', direction: 'desc' });
    });
  });

  describe('Pagination', () => {
    it('should set limit', () => {
      const limitedQuery = selectFrom('users')
        .limit(10)
        .build();

      const queryData = expectSuccessData(limitedQuery);
      expect(queryData.limit).toBe(10);
    });

    it('should set offset', () => {
      const offsetQuery = selectFrom('users')
        .offset(20)
        .build();

      const queryData = expectSuccessData(offsetQuery);
      expect(queryData.offset).toBe(20);
    });

    it('should support limit and offset together', () => {
      const paginatedQuery = selectFrom('users')
        .limit(25)
        .offset(50)
        .build();

      const queryData = expectSuccessData(paginatedQuery);
      expect(queryData.limit).toBe(25);
      expect(queryData.offset).toBe(50);
    });
  });

  describe('DISTINCT', () => {
    it('should set distinct flag', () => {
      const distinctQuery = selectFrom('users')
        .select(['email'])
        .distinct()
        .build();

      const queryData = expectSuccessData(distinctQuery);
      expect(queryData.distinct).toBe(true);
    });

    it('should work with multiple fields', () => {
      const multiFieldDistinctQuery = selectFrom('users')
        .select(['status', 'role'])
        .distinct()
        .build();

      const queryData = expectSuccessData(multiFieldDistinctQuery);
      expect(queryData.distinct).toBe(true);
      expect(queryData.select).toEqual(['status', 'role']);
    });

    it('should allow disabling distinct', () => {
      const disabledDistinctQuery = selectFrom('users')
        .select(['email'])
        .distinct(false)
        .build();

      const queryData = expectSuccessData(disabledDistinctQuery);
      expect(queryData.distinct).toBe(false);
    });
  });

  describe('GROUP BY', () => {
    it('should set group by fields', () => {
      const groupByQuery = selectFrom('users')
        .select(['status'])
        .groupBy(['status'])
        .build();

      const queryData = expectSuccessData(groupByQuery);
      expect(queryData.groupBy).toEqual(['status']);
    });

    it('should support multiple group by fields', () => {
      const multiGroupByQuery = selectFrom('users')
        .select(['status', 'role'])
        .groupBy(['status', 'role'])
        .build();

      const queryData = expectSuccessData(multiGroupByQuery);
      expect(queryData.groupBy).toEqual(['status', 'role']);
    });
  });

  describe('HAVING', () => {
    it('should set having clause', () => {
      const havingQuery = selectFrom('users')
        .select(['status'])
        .groupBy(['status'])
        .having({ count: { $gt: 5 } })
        .build();

      const queryData = expectSuccessData(havingQuery);
      expect(queryData.having).toEqual({ count: { $gt: 5 } });
    });
  });

  describe('Clone', () => {
    it('should create independent copy without shared references', () => {
      const originalBuilder = selectFrom('users')
        .select(['id', 'name'])
        .where({ status: 'active' })
        .orderBy('createdAt', 'desc')
        .limit(10);

      const clonedBuilder = originalBuilder.clone();

      clonedBuilder
        .select(['email'])
        .andWhere({ role: 'admin' })
        .orderBy('name', 'asc')
        .limit(20);

      const originalQueryData = expectSuccessData(originalBuilder.build());
      const clonedQueryData = expectSuccessData(clonedBuilder.build());

      expect(originalQueryData.select).toEqual(['id', 'name']);
      expect(originalQueryData.where).toEqual({ status: 'active' });
      expect(originalQueryData.limit).toBe(10);
      expect(originalQueryData.orderBy).toHaveLength(1);

      expect(clonedQueryData.select).toEqual(['email']);
      expect(clonedQueryData.where).toHaveProperty('$and');
      expect(clonedQueryData.limit).toBe(20);
      expect(clonedQueryData.orderBy).toHaveLength(2);
    });

    it('should deep clone nested objects (where, populate, data)', () => {
      const originalNestedBuilder = updateTable('users', {
        metadata: { updated: true, count: 1 }
      }).where({
        settings: { notifications: true }
      });

      const clonedNestedBuilder = originalNestedBuilder.clone();

      clonedNestedBuilder.data({ metadata: { updated: false, count: 2 } });
      clonedNestedBuilder.where({ settings: { notifications: false } });

      const originalQueryData = expectSuccessData(originalNestedBuilder.build());
      const clonedQueryData = expectSuccessData(clonedNestedBuilder.build());

      expect(originalQueryData.data).toEqual({
        metadata: { updated: true, count: 1 }
      });
      expect(originalQueryData.where).toEqual({
        settings: { notifications: true }
      });

      expect(clonedQueryData.data).toEqual({
        metadata: { updated: false, count: 2 }
      });
      expect(clonedQueryData.where).toEqual({
        settings: { notifications: false }
      });
    });
  });

  describe('Complex Query Combinations', () => {
    it('should support UPDATE with WHERE + RETURNING + multiple clauses', () => {
      const inactiveDate = new Date('2024-01-01');
      const complexUpdateQuery = updateTable('users', {
        status: 'inactive',
        lastModified: inactiveDate
      })
        .where({ lastLogin: { $lt: '2023-01-01' } })
        .andWhere({ role: 'user' })
        .returning(['id', 'email', 'status'])
        .build();

      const queryData = expectSuccessData(complexUpdateQuery);
      expect(queryData.type).toBe('update');
      expect(queryData.table).toBe('users');
      expect(queryData.data).toEqual({
        status: 'inactive',
        lastModified: inactiveDate
      });
      expect(queryData.where).toHaveProperty('$and');
      expect(queryData.returning).toEqual(['id', 'email', 'status']);
    });

    it('should support SELECT with DISTINCT + GROUP BY + HAVING + ORDER BY', () => {
      const complexSelectQuery = selectFrom('orders')
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

      const queryData = expectSuccessData(complexSelectQuery);
      expect(queryData.type).toBe('select');
      expect(queryData.distinct).toBe(true);
      expect(queryData.where).toBeDefined();
      expect(queryData.groupBy).toEqual(['customerId', 'status']);
      expect(queryData.having).toEqual({ orderCount: { $gt: 5 } });
      expect(queryData.orderBy).toHaveLength(2);
      expect(queryData.limit).toBe(10);
      expect(queryData.offset).toBe(0);
    });

    it('should support DELETE with complex WHERE conditions', () => {
      const expiredSessionsQuery = deleteFrom('sessions')
        .where({ expired: true })
        .andWhere({
          lastActivity: { $lt: new Date('2024-01-01') }
        })
        .returning(['id', 'userId'])
        .build();

      const queryData = expectSuccessData(expiredSessionsQuery);
      expect(queryData.type).toBe('delete');
      expect(queryData.where).toHaveProperty('$and');
      expect(queryData.returning).toBeDefined();
    });

    it('should support INSERT with RETURNING', () => {
      const newPostData = {
        title: 'New Post',
        content: 'Content here',
        authorId: 1,
        tags: ['typescript', 'testing']
      };
      const insertWithReturningQuery = insertInto('posts', newPostData)
        .returning(['id', 'createdAt', 'slug'])
        .build();

      const queryData = expectSuccessData(insertWithReturningQuery);
      expect(queryData.type).toBe('insert');
      expect(queryData.data).toBeDefined();
      expect(queryData.data?.['tags']).toEqual(['typescript', 'testing']);
      expect(queryData.returning).toEqual(['id', 'createdAt', 'slug']);
    });

    it('should support SELECT with nested WHERE (OR + AND)', () => {
      const nestedWhereQuery = selectFrom('users')
        .where({ status: 'active' })
        .orWhere({ role: 'admin' })
        .build();

      const queryData = expectSuccessData(nestedWhereQuery);
      expect(queryData.where).toEqual({
        $or: [
          { status: 'active' },
          { role: 'admin' }
        ]
      });
    });
  });
});
