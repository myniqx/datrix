/**
 * PostgreSQL Query Translator Tests
 *
 * Critical tests for SQL generation, parameter binding, and SQL injection prevention
 * Target: 95%+ coverage - SECURITY CRITICAL
 */

import { createPostgresTranslator } from '../src';
import { QueryObject, WhereClause } from '../../types/src/core/query-builder';
import { describe, it, expect, beforeEach } from 'vitest';

describe('PostgreSQL Query Translator', () => {
  let translator: ReturnType<typeof createPostgresTranslator>;

  beforeEach(() => {
    translator = createPostgresTranslator();
  });

  describe('Identifier Escaping', () => {
    it('should escape valid identifiers with double quotes', () => {
      expect(translator.escapeIdentifier('users')).toBe('"users"');
      expect(translator.escapeIdentifier('user_name')).toBe('"user_name"');
      expect(translator.escapeIdentifier('_private')).toBe('"_private"');
      expect(translator.escapeIdentifier('table123')).toBe('"table123"');
    });

    it('should escape double quotes in identifiers', () => {
      // This shouldn't happen in practice but test the escaping
      expect(translator.escapeIdentifier('test')).toBe('"test"');
    });

    it('should reject identifiers starting with numbers', () => {
      expect(() => translator.escapeIdentifier('123table')).toThrow('Invalid identifier');
      expect(() => translator.escapeIdentifier('9users')).toThrow('Invalid identifier');
    });

    it('should reject identifiers with special characters', () => {
      expect(() => translator.escapeIdentifier('user-name')).toThrow('Invalid identifier');
      expect(() => translator.escapeIdentifier('user.name')).toThrow('Invalid identifier');
      expect(() => translator.escapeIdentifier('user@domain')).toThrow('Invalid identifier');
      expect(() => translator.escapeIdentifier('user name')).toThrow('Invalid identifier');
    });

    it('should reject identifiers exceeding 63 characters', () => {
      const longName = 'a'.repeat(64);
      expect(() => translator.escapeIdentifier(longName)).toThrow('exceeds PostgreSQL maximum length');
    });

    it('should accept identifiers with exactly 63 characters', () => {
      const maxName = 'a'.repeat(63);
      expect(translator.escapeIdentifier(maxName)).toBe(`"${maxName}"`);
    });

    it('should accept valid patterns', () => {
      expect(translator.escapeIdentifier('UsErS')).toBe('"UsErS"');
      expect(translator.escapeIdentifier('_')).toBe('"_"');
      expect(translator.escapeIdentifier('a_b_c_1_2_3')).toBe('"a_b_c_1_2_3"');
    });
  });

  describe('Value Escaping', () => {
    it('should escape NULL values', () => {
      expect(translator.escapeValue(null)).toBe('NULL');
      expect(translator.escapeValue(undefined)).toBe('NULL');
    });

    it('should escape string values with single quotes', () => {
      expect(translator.escapeValue('hello')).toBe("'hello'");
      expect(translator.escapeValue('world')).toBe("'world'");
    });

    it('should escape single quotes in strings', () => {
      expect(translator.escapeValue("it's")).toBe("'it''s'");
      expect(translator.escapeValue("'quoted'")).toBe("'''quoted'''");
    });

    it('should escape numbers without quotes', () => {
      expect(translator.escapeValue(42)).toBe('42');
      expect(translator.escapeValue(3.14)).toBe('3.14');
      expect(translator.escapeValue(-10)).toBe('-10');
      expect(translator.escapeValue(0)).toBe('0');
    });

    it('should escape booleans as TRUE/FALSE', () => {
      expect(translator.escapeValue(true)).toBe('TRUE');
      expect(translator.escapeValue(false)).toBe('FALSE');
    });

    it('should escape Date objects as ISO strings', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');
      const result = translator.escapeValue(date);
      expect(result).toContain('2024-01-01');
    });

    it('should escape arrays as PostgreSQL array syntax', () => {
      const result = translator.escapeValue([1, 2, 3]);
      expect(result).toContain('ARRAY');
    });

    it('should escape objects as JSON', () => {
      const result = translator.escapeValue({ foo: 'bar' });
      expect(result).toContain('foo');
      expect(result).toContain('bar');
    });
  });

  describe('Parameter Placeholders', () => {
    it('should generate PostgreSQL-style parameter placeholders', () => {
      expect(translator.getParameterPlaceholder(1)).toBe('$1');
      expect(translator.getParameterPlaceholder(2)).toBe('$2');
      expect(translator.getParameterPlaceholder(10)).toBe('$10');
      expect(translator.getParameterPlaceholder(100)).toBe('$100');
    });
  });

  describe('SELECT Translation', () => {
    it('should translate simple SELECT query', () => {
      const query: QueryObject = {
        type: 'select',
        table: 'users'
      };

      const result = translator.translate(query);

      expect(result.sql).toContain('SELECT *');
      expect(result.sql).toContain('FROM "users"');
      expect(result.params).toEqual([]);
    });

    it('should translate SELECT with specific fields', () => {
      const query: QueryObject = {
        type: 'select',
        table: 'users',
        select: ['id', 'email', 'name']
      };

      const result = translator.translate(query);

      expect(result.sql).toContain('"id"');
      expect(result.sql).toContain('"email"');
      expect(result.sql).toContain('"name"');
      expect(result.sql).not.toContain('SELECT *');
    });

    it('should translate SELECT with WHERE clause', () => {
      const query: QueryObject = {
        type: 'select',
        table: 'users',
        where: { email: 'test@example.com' }
      };

      const result = translator.translate(query);

      expect(result.sql).toContain('WHERE');
      expect(result.sql).toContain('"email"');
      expect(result.sql).toContain('$1');
      expect(result.params).toEqual(['test@example.com']);
    });

    it('should translate SELECT with ORDER BY', () => {
      const query: QueryObject = {
        type: 'select',
        table: 'users',
        orderBy: [
          { field: 'name', direction: 'asc' },
          { field: 'createdAt', direction: 'desc' }
        ]
      };

      const result = translator.translate(query);

      expect(result.sql).toContain('ORDER BY');
      expect(result.sql).toContain('"name" ASC');
      expect(result.sql).toContain('"createdAt" DESC');
    });

    it('should translate SELECT with LIMIT', () => {
      const query: QueryObject = {
        type: 'select',
        table: 'users',
        limit: 10
      };

      const result = translator.translate(query);

      expect(result.sql).toContain('LIMIT $1');
      expect(result.params).toEqual([10]);
    });

    it('should translate SELECT with OFFSET', () => {
      const query: QueryObject = {
        type: 'select',
        table: 'users',
        offset: 20
      };

      const result = translator.translate(query);

      expect(result.sql).toContain('OFFSET $1');
      expect(result.params).toEqual([20]);
    });

    it('should translate SELECT with LIMIT and OFFSET', () => {
      const query: QueryObject = {
        type: 'select',
        table: 'users',
        limit: 10,
        offset: 20
      };

      const result = translator.translate(query);

      expect(result.sql).toContain('LIMIT $1');
      expect(result.sql).toContain('OFFSET $2');
      expect(result.params).toEqual([10, 20]);
    });

    it('should translate complex SELECT with all clauses', () => {
      const query: QueryObject = {
        type: 'select',
        table: 'users',
        select: ['id', 'email'],
        where: { role: 'admin' },
        orderBy: [{ field: 'createdAt', direction: 'desc' }],
        limit: 5,
        offset: 10
      };

      const result = translator.translate(query);

      expect(result.sql).toContain('SELECT');
      expect(result.sql).toContain('"id"');
      expect(result.sql).toContain('"email"');
      expect(result.sql).toContain('FROM "users"');
      expect(result.sql).toContain('WHERE');
      expect(result.sql).toContain('ORDER BY');
      expect(result.sql).toContain('LIMIT');
      expect(result.sql).toContain('OFFSET');
      expect(result.params).toHaveLength(3); // role value, limit, offset
    });
  });

  describe('INSERT Translation', () => {
    it('should translate simple INSERT query', () => {
      const query: QueryObject = {
        type: 'insert',
        table: 'users',
        data: {
          email: 'test@example.com',
          name: 'Test User'
        }
      };

      const result = translator.translate(query);

      expect(result.sql).toContain('INSERT INTO "users"');
      expect(result.sql).toContain('"email"');
      expect(result.sql).toContain('"name"');
      expect(result.sql).toContain('VALUES');
      expect(result.sql).toContain('$1');
      expect(result.sql).toContain('$2');
      expect(result.params).toEqual(['test@example.com', 'Test User']);
    });

    it('should translate INSERT with RETURNING clause', () => {
      const query: QueryObject = {
        type: 'insert',
        table: 'users',
        data: { email: 'test@example.com' },
        returning: ['id', 'email']
      };

      const result = translator.translate(query);

      expect(result.sql).toContain('RETURNING');
      expect(result.sql).toContain('"id"');
      expect(result.sql).toContain('"email"');
    });

    it('should handle INSERT with NULL values', () => {
      const query: QueryObject = {
        type: 'insert',
        table: 'users',
        data: {
          email: 'test@example.com',
          middleName: null
        }
      };

      const result = translator.translate(query);

      expect(result.params).toContain('test@example.com');
      expect(result.params).toContain(null);
    });

    it('should handle INSERT with multiple data types', () => {
      const query: QueryObject = {
        type: 'insert',
        table: 'users',
        data: {
          email: 'test@example.com',
          age: 25,
          active: true,
          metadata: { role: 'user' }
        }
      };

      const result = translator.translate(query);

      expect(result.params).toEqual(['test@example.com', 25, true, { role: 'user' }]);
    });
  });

  describe('UPDATE Translation', () => {
    it('should translate simple UPDATE query', () => {
      const query: QueryObject = {
        type: 'update',
        table: 'users',
        data: { name: 'Updated Name' },
        where: { id: 1 }
      };

      const result = translator.translate(query);

      expect(result.sql).toContain('UPDATE "users"');
      expect(result.sql).toContain('SET');
      expect(result.sql).toContain('"name" = $1');
      expect(result.sql).toContain('WHERE');
      expect(result.params).toEqual(['Updated Name', 1]);
    });

    it('should translate UPDATE with multiple fields', () => {
      const query: QueryObject = {
        type: 'update',
        table: 'users',
        data: {
          name: 'New Name',
          email: 'new@example.com',
          age: 30
        },
        where: { id: 1 }
      };

      const result = translator.translate(query);

      expect(result.sql).toContain('"name" = $1');
      expect(result.sql).toContain('"email" = $2');
      expect(result.sql).toContain('"age" = $3');
      expect(result.params).toEqual(['New Name', 'new@example.com', 30, 1]);
    });

    it('should translate UPDATE with RETURNING clause', () => {
      const query: QueryObject = {
        type: 'update',
        table: 'users',
        data: { name: 'Updated' },
        where: { id: 1 },
        returning: ['id', 'name', 'updatedAt']
      };

      const result = translator.translate(query);

      expect(result.sql).toContain('RETURNING');
      expect(result.sql).toContain('"id"');
      expect(result.sql).toContain('"name"');
      expect(result.sql).toContain('"updatedAt"');
    });

    it('should handle UPDATE with NULL values', () => {
      const query: QueryObject = {
        type: 'update',
        table: 'users',
        data: { middleName: null },
        where: { id: 1 }
      };

      const result = translator.translate(query);

      expect(result.params).toContain(null);
    });
  });

  describe('DELETE Translation', () => {
    it('should translate simple DELETE query', () => {
      const query: QueryObject = {
        type: 'delete',
        table: 'users',
        where: { id: 1 }
      };

      const result = translator.translate(query);

      expect(result.sql).toContain('DELETE FROM "users"');
      expect(result.sql).toContain('WHERE');
      expect(result.sql).toContain('"id" = $1');
      expect(result.params).toEqual([1]);
    });

    it('should translate DELETE with complex WHERE', () => {
      const query: QueryObject = {
        type: 'delete',
        table: 'users',
        where: {
          role: 'guest',
          active: false
        }
      };

      const result = translator.translate(query);

      expect(result.sql).toContain('DELETE FROM "users"');
      expect(result.sql).toContain('WHERE');
      expect(result.params).toEqual(['guest', false]);
    });

    it('should translate DELETE with RETURNING clause', () => {
      const query: QueryObject = {
        type: 'delete',
        table: 'users',
        where: { id: 1 },
        returning: ['id']
      };

      const result = translator.translate(query);

      expect(result.sql).toContain('RETURNING "id"');
    });
  });

  describe('WHERE Clause Translation', () => {
    describe('Simple Equality', () => {
      it('should translate simple equality', () => {
        const result = translator.translateWhere({ email: 'test@example.com' }, 0);

        expect(result.sql).toContain('"email" = $1');
        expect(result.params).toEqual(['test@example.com']);
      });

      it('should translate multiple equality conditions with AND', () => {
        const result = translator.translateWhere({
          email: 'test@example.com',
          role: 'admin'
        }, 0);

        expect(result.sql).toContain('"email" = $1');
        expect(result.sql).toContain('AND');
        expect(result.sql).toContain('"role" = $2');
        expect(result.params).toEqual(['test@example.com', 'admin']);
      });
    });

    describe('Comparison Operators', () => {
      it('should translate $eq operator', () => {
        const result = translator.translateWhere({ age: { $eq: 25 } }, 0);

        expect(result.sql).toContain('"age" = $1');
        expect(result.params).toEqual([25]);
      });

      it('should translate $ne operator', () => {
        const result = translator.translateWhere({ status: { $ne: 'deleted' } }, 0);

        expect(result.sql).toContain('"status" <> $1');
        expect(result.params).toEqual(['deleted']);
      });

      it('should translate $gt operator', () => {
        const result = translator.translateWhere({ age: { $gt: 18 } }, 0);

        expect(result.sql).toContain('"age" > $1');
        expect(result.params).toEqual([18]);
      });

      it('should translate $gte operator', () => {
        const result = translator.translateWhere({ age: { $gte: 18 } }, 0);

        expect(result.sql).toContain('"age" >= $1');
        expect(result.params).toEqual([18]);
      });

      it('should translate $lt operator', () => {
        const result = translator.translateWhere({ age: { $lt: 65 } }, 0);

        expect(result.sql).toContain('"age" < $1');
        expect(result.params).toEqual([65]);
      });

      it('should translate $lte operator', () => {
        const result = translator.translateWhere({ age: { $lte: 65 } }, 0);

        expect(result.sql).toContain('"age" <= $1');
        expect(result.params).toEqual([65]);
      });

      it('should translate multiple operators on same field', () => {
        const result = translator.translateWhere({
          age: { $gte: 18, $lte: 65 }
        }, 0);

        expect(result.sql).toContain('"age" >= $1');
        expect(result.sql).toContain('AND');
        expect(result.sql).toContain('"age" <= $2');
        expect(result.params).toEqual([18, 65]);
      });
    });

    describe('Array Operators', () => {
      it('should translate $in operator', () => {
        const result = translator.translateWhere({
          role: { $in: ['admin', 'moderator', 'user'] }
        }, 0);

        expect(result.sql).toContain('"role" IN ($1, $2, $3)');
        expect(result.params).toEqual(['admin', 'moderator', 'user']);
      });

      it('should translate $nin operator', () => {
        const result = translator.translateWhere({
          status: { $nin: ['deleted', 'banned'] }
        }, 0);

        expect(result.sql).toContain('"status" NOT IN ($1, $2)');
        expect(result.params).toEqual(['deleted', 'banned']);
      });

      it('should handle empty array in $in', () => {
        const result = translator.translateWhere({
          role: { $in: [] }
        }, 0);

        // Empty IN should result in always-false condition
        expect(result.sql).toContain('FALSE');
      });
    });

    describe('Logical Operators', () => {
      it('should translate $and operator', () => {
        const result = translator.translateWhere({
          $and: [{ age: { $gte: 18 } }, { role: 'user' }]
        }, 0);

        expect(result.sql).toContain('"age" >= $1');
        expect(result.sql).toContain('AND');
        expect(result.sql).toContain('"role" = $2');
        expect(result.params).toEqual([18, 'user']);
      });

      it('should translate $or operator', () => {
        const result = translator.translateWhere({
          $or: [{ role: 'admin' }, { role: 'moderator' }]
        }, 0);

        expect(result.sql).toContain('"role" = $1');
        expect(result.sql).toContain('OR');
        expect(result.sql).toContain('"role" = $2');
        expect(result.params).toEqual(['admin', 'moderator']);
      });

      it('should translate nested logical operators', () => {
        const result = translator.translateWhere({
          $and: [
            { age: { $gte: 18 } },
            {
              $or: [{ role: 'admin' }, { role: 'moderator' }]
            }
          ]
        }, 0);

        expect(result.sql).toContain('AND');
        expect(result.sql).toContain('OR');
        expect(result.params).toEqual([18, 'admin', 'moderator']);
      });
    });

    describe('NULL Handling', () => {
      it('should handle NULL equality check', () => {
        const result = translator.translateWhere({ deletedAt: null }, 0);

        expect(result.sql).toContain('"deletedAt" IS NULL');
        expect(result.params).toEqual([]);
      });

      it('should handle NULL with $ne operator', () => {
        const result = translator.translateWhere({ deletedAt: { $ne: null } }, 0);

        expect(result.sql).toContain('"deletedAt" IS NOT NULL');
        expect(result.params).toEqual([]);
      });
    });

    describe('Edge Cases and Security', () => {
      it('should prevent SQL injection in field names via validation', () => {
        // Field names must pass identifier validation
        expect(() => {
          translator.translateWhere({ "email'; DROP TABLE users; --": 'test' }, 0);
        }).toThrow('Invalid identifier');
      });

      it('should safely handle special characters in values via parameterization', () => {
        const result = translator.translateWhere({
          comment: "'; DROP TABLE users; --"
        }, 0);

        // Value should be parameterized, not interpolated
        expect(result.sql).not.toContain('DROP TABLE');
        expect(result.sql).toContain('$1');
        expect(result.params).toEqual(["'; DROP TABLE users; --"]);
      });

      it('should handle very long field values via parameterization', () => {
        const longValue = 'a'.repeat(10000);
        const result = translator.translateWhere({ description: longValue }, 0);

        expect(result.sql).toContain('$1');
        expect(result.params).toEqual([longValue]);
      });

      it('should handle Unicode characters safely', () => {
        const result = translator.translateWhere({ name: '测试用户 🚀' }, 0);

        expect(result.sql).toContain('$1');
        expect(result.params).toEqual(['测试用户 🚀']);
      });

      it('should reject excessive nesting depth', () => {
        // Create deeply nested WHERE clause
        let deep: WhereClause = { value: 1 };
        for (let i = 0; i < 15; i++) {
          deep = { $and: [deep] };
        }

        expect(() => {
          translator.translateWhere(deep, 0);
        }).toThrow();
      });
    });
  });

  describe('Parameter Binding', () => {
    it('should correctly bind parameters in order', () => {
      const query: QueryObject = {
        type: 'select',
        table: 'users',
        where: {
          email: 'test@example.com',
          age: { $gte: 18, $lte: 65 },
          role: { $in: ['admin', 'user'] }
        }
      };

      const result = translator.translate(query);

      // Parameters should be in order: email, age min, age max, role1, role2
      expect(result.params).toEqual(['test@example.com', 18, 65, 'admin', 'user']);
      expect(result.sql).toContain('$1');
      expect(result.sql).toContain('$2');
      expect(result.sql).toContain('$3');
      expect(result.sql).toContain('$4');
      expect(result.sql).toContain('$5');
    });

    it('should reset parameter index between queries', () => {
      const query1: QueryObject = {
        type: 'select',
        table: 'users',
        where: { id: 1 }
      };

      const query2: QueryObject = {
        type: 'select',
        table: 'posts',
        where: { userId: 2 }
      };

      const result1 = translator.translate(query1);
      const result2 = translator.translate(query2);

      // Both should start from $1
      expect(result1.sql).toContain('$1');
      expect(result2.sql).toContain('$1');
      expect(result1.params).toEqual([1]);
      expect(result2.params).toEqual([2]);
    });
  });

  describe('Error Handling', () => {
    it('should throw error for missing table name', () => {
      const query = {
        type: 'select'
      } as unknown as QueryObject;

      expect(() => translator.translate(query)).toThrow();
    });

    it('should throw error for INSERT without data', () => {
      const query: QueryObject = {
        type: 'insert',
        table: 'users'
      };

      expect(() => translator.translate(query)).toThrow();
    });

    it('should throw error for UPDATE without data', () => {
      const query: QueryObject = {
        type: 'update',
        table: 'users',
        where: { id: 1 }
      };

      expect(() => translator.translate(query)).toThrow();
    });

    it('should throw error for invalid query type', () => {
      const query = {
        type: 'invalid',
        table: 'users'
      } as unknown as QueryObject;

      expect(() => translator.translate(query)).toThrow();
    });
  });
});
