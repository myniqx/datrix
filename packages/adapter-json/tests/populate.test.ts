import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JsonAdapter } from '../src/adapter';
import { QueryObject } from 'forja-types/core/query-builder';
import { expectSuccessData } from 'forja-types/test/helpers';

describe('JsonAdapter Populate - Happy Path', () => {
  const root = path.join(__dirname, 'tmp_populate_test');
  let adapter: JsonAdapter;

  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    adapter = new JsonAdapter({ root });
    await adapter.connect();

    // Setup tables
    await adapter.createTable({ name: 'users', fields: { name: { type: 'string', required: true } } });
    await adapter.createTable({
      name: 'posts', fields: {
        title: { type: 'string', required: true },
        authorId: { type: 'number', required: true }
      }
    });
  });

  afterEach(async () => {
    await adapter.disconnect();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('should populate belongsTo relation', async () => {
    // Insert User
    await adapter.executeQuery({
      type: 'insert',
      table: 'users',
      data: { name: 'Burak' }
    });

    // Insert Posts
    await adapter.executeQuery({
      type: 'insert',
      table: 'posts',
      data: { title: 'Post 1', authorId: 1 }
    });
    await adapter.executeQuery({
      type: 'insert',
      table: 'posts',
      data: { title: 'Post 2', authorId: 1 }
    });

    // Select with Populate
    const query: QueryObject = {
      type: 'select',
      table: 'posts',
      populate: { author: {} },
      // @ts-ignore - internal property
      meta: {
        relations: {
          author: {
            type: 'belongsTo',
            targetTable: 'users',
            foreignKey: 'authorId'
          }
        }
      }
    };

    const result = expectSuccessData(await adapter.executeQuery(query));

    expect(result.rows).toHaveLength(2);

    const row1 = result.rows[0] as any;
    expect(row1.title).toBe('Post 1');
    expect(row1.author).toBeDefined();
    expect(row1.author.id).toBe(1);
    expect(row1.author.name).toBe('Burak');
  });

  it('should handle missing relation', async () => {
    // Insert Post without User
    await adapter.executeQuery({
      type: 'insert',
      table: 'posts',
      data: { title: 'Orphan Post', authorId: 999 }
    });

    const query: QueryObject = {
      type: 'select',
      table: 'posts',
      populate: { author: {} },
      // @ts-ignore
      meta: {
        relations: {
          author: {
            type: 'belongsTo',
            targetTable: 'users',
            foreignKey: 'authorId'
          }
        }
      }
    };

    const result = expectSuccessData(await adapter.executeQuery(query));
    const row = result.rows[0] as any;

    expect(row.author).toBeNull();
  });
});
