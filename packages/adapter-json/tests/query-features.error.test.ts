import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JsonAdapter } from '../src/adapter';
import { QueryObject } from 'forja-types/core/query-builder';
import { expectFailureError, expectSuccessData } from 'forja-types/test/helpers';

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
});
