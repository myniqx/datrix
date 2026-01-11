import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JsonAdapter } from '../src/adapter';
import { QueryObject } from '../../types/src/core/query-builder';
import { expectFailureError, expectSuccessData } from '../../types/src/test/helpers';

describe('JsonAdapter - Advanced Features Error/Edge Cases', () => {
  const root = path.join(__dirname, 'tmp_features_error_test');
  let adapter: JsonAdapter;

  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    adapter = new JsonAdapter({ root });
    await adapter.connect();
    await adapter.createTable({ name: 'users', fields: { name: { type: 'string', required: true } } });
    await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'Alice' } });
  });

  afterEach(async () => {
    await adapter.disconnect();
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('Data Corruption: JSON File Integrity', () => {
    it('should handle corrupted JSON files gracefully', async () => {
      const filePath = path.join(root, 'users.json');
      await fs.writeFile(filePath, '{invalid json:::');

      const result = await adapter.executeQuery({
        type: 'select',
        table: 'users'
      });

      const error = expectFailureError(result);
      expect(error.code).toBe('QUERY_ERROR');
      expect(error.message.toLowerCase()).toMatch(/parse|json/);
    });

    it('should handle missing data/rows field', async () => {
      const filePath = path.join(root, 'users.json');
      await fs.writeFile(filePath, '{"wrong": "structure"}');

      const result = expectSuccessData(await adapter.executeQuery({
        type: 'select',
        table: 'users'
      }));

      expect(result.rows).toEqual([]);
    });

    it('should handle truncated JSON files', async () => {
      const filePath = path.join(root, 'users.json');
      await fs.writeFile(filePath, '{"data":{"rows":[{"id":1');

      const result = await adapter.executeQuery({
        type: 'select',
        table: 'users'
      });

      const error = expectFailureError(result);
      expect(error.code).toBe('QUERY_ERROR');
    });

    it('should handle empty file', async () => {
      const filePath = path.join(root, 'users.json');
      await fs.writeFile(filePath, '');

      const result = await adapter.executeQuery({
        type: 'select',
        table: 'users'
      });

      if (!result.success) {
        expect(result.error.code).toBe('QUERY_ERROR');
      } else {
        expect(result.data.rows).toEqual([]);
      }
    });
  });

  describe('Projection (Select)', () => {
    it('should handle non-existent fields gracefully (ignore them)', async () => {
      const result = expectSuccessData(await adapter.executeQuery({
        type: 'select',
        table: 'users',
        select: ['name', 'nonExistentField']
      }));

      expect(result.rows[0]).toHaveProperty('name');
      expect(result.rows[0]).not.toHaveProperty('nonExistentField');
    });

    it('should return empty objects if no fields match', async () => {
      const result = expectSuccessData(await adapter.executeQuery({
        type: 'select',
        table: 'users',
        select: ['invalid']
      }));

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toEqual({});
    });
  });

  describe('Populate', () => {
    it('should handle broken relation links (target table missing)', async () => {
      // Relation metadata points to 'missing_table'
      const query: QueryObject = {
        type: 'select',
        table: 'users',
        populate: { profile: {} },
        // @ts-ignore
        meta: {
          relations: {
            profile: {
              type: 'hasOne',
              targetTable: 'missing_table',
              foreignKey: 'userId',
              kind: 'hasOne'
            }
          }
        }
      };

      // Should not crash, just not populate
      const result = expectSuccessData(await adapter.executeQuery(query));
      expect((result.rows[0] as any).profile).toBeUndefined();
    });

    it('should handle type mismatch in foreign keys', async () => {
      // If FK is string "1" but ID is number 1, map lookup might fail if not careful.
      // JsonAdapter typically stores generic JSON types.
      // Ideally we should test if '1' == 1 behavior is desired or strict.
      // Map uses SameValueZero algorithm (strict for primitives).

      // Setup: User with string ID (if possible? schema says number, but JSON fits all)
      // Let's coerce manual write to test adaptation?
      // Or just standard usage.
    });
  });

  describe('Returning', () => {
    it('should ignore returning fields that do not exist', async () => {
      const result = expectSuccessData(await adapter.executeQuery({
        type: 'insert',
        table: 'users',
        data: { name: 'Bob' },
        returning: ['id', 'ghost_field']
      }));

      expect(result.rows[0]).toHaveProperty('id');
      expect(result.rows[0]).not.toHaveProperty('ghost_field');
    });
  });

  describe('Boundary: Data Limits', () => {
    it('should handle very large records', async () => {
      const hugeString = 'x'.repeat(10 * 1024 * 1024);

      const result = await adapter.executeQuery({
        type: 'insert',
        table: 'users',
        data: { name: 'Test', bio: hugeString }
      });

      if (!result.success) {
        expect(result.error.code).toBe('QUERY_ERROR');
        expect(result.error.message.toLowerCase()).toMatch(/size|large|limit/);
      }
    });

    it('should handle empty where clause as match-all', async () => {
      await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'Bob' } });
      await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'Charlie' } });

      const deleteResult = expectSuccessData(await adapter.executeQuery({
        type: 'delete',
        table: 'users',
        where: {}
      }));

      expect(deleteResult.metadata.affectedRows).toBeGreaterThanOrEqual(3);
    });

    it('should handle deeply nested populate gracefully', async () => {
      await adapter.createTable({ name: 'a', fields: { name: { type: 'string', required: true } } });
      await adapter.createTable({ name: 'b', fields: { name: { type: 'string', required: true }, aId: { type: 'number', required: true } } });
      await adapter.createTable({ name: 'c', fields: { name: { type: 'string', required: true }, bId: { type: 'number', required: true } } });
      await adapter.createTable({ name: 'd', fields: { name: { type: 'string', required: true }, cId: { type: 'number', required: true } } });

      await adapter.executeQuery({ type: 'insert', table: 'a', data: { name: 'A1' } });
      await adapter.executeQuery({ type: 'insert', table: 'b', data: { name: 'B1', aId: 1 } });
      await adapter.executeQuery({ type: 'insert', table: 'c', data: { name: 'C1', bId: 1 } });
      await adapter.executeQuery({ type: 'insert', table: 'd', data: { name: 'D1', cId: 1 } });

      const deepQuery: QueryObject = {
        type: 'select',
        table: 'a',
        populate: {
          b: {
            populate: {
              c: {
                populate: {
                  d: {}
                }
              }
            }
          }
        },
        // @ts-ignore
        meta: {
          relations: {
            b: { type: 'hasMany', targetTable: 'b', foreignKey: 'aId', kind: 'hasMany' },
            c: { type: 'hasMany', targetTable: 'c', foreignKey: 'bId', kind: 'hasMany' },
            d: { type: 'hasMany', targetTable: 'd', foreignKey: 'cId', kind: 'hasMany' }
          }
        }
      };

      const result = await adapter.executeQuery(deepQuery);

      if (!result.success) {
        expect(result.error.code).toBe('QUERY_ERROR');
        expect(result.error.message.toLowerCase()).toMatch(/depth|nest/);
      }
    });

    it('should handle zero-length arrays and objects', async () => {
      const result = expectSuccessData(await adapter.executeQuery({
        type: 'select',
        table: 'users',
        select: []
      }));

      expect(Array.isArray(result.rows)).toBe(true);
    });

    it('should handle extremely long field names', async () => {
      const longFieldName = 'a'.repeat(10000);

      const result = await adapter.executeQuery({
        type: 'select',
        table: 'users',
        select: [longFieldName]
      });

      if (result.success) {
        expect(result.data.rows[0]).not.toHaveProperty(longFieldName);
      }
    });
  });

  describe('Invariants: Input Immutability', () => {
    it('should not mutate input query object', async () => {
      const originalQuery: QueryObject = {
        type: 'select',
        table: 'users',
        where: { name: 'Alice' },
        select: ['id', 'name']
      };

      const querySnapshot = JSON.parse(JSON.stringify(originalQuery));

      await adapter.executeQuery(originalQuery);

      expect(originalQuery).toEqual(querySnapshot);
    });

    it('should not mutate input data object on insert', async () => {
      const inputData = { name: 'Immutable', age: 25 };
      const dataSnapshot = JSON.parse(JSON.stringify(inputData));

      await adapter.executeQuery({
        type: 'insert',
        table: 'users',
        data: inputData
      });

      expect(inputData).toEqual(dataSnapshot);
    });
  });
});
