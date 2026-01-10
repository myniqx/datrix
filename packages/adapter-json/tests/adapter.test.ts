import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JsonAdapter } from '../src/adapter';
import { SchemaDefinition } from 'forja-types/core/schema';
import { expectSuccessData } from 'forja-types/test/helpers';

describe('JsonAdapter - Happy Path', () => {
  const root = path.join(__dirname, 'tmp_adapter_happy_test');
  let adapter: JsonAdapter;

  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    adapter = new JsonAdapter({ root });
    await adapter.connect();
  });

  afterEach(async () => {
    await adapter.disconnect();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('should create table (json file)', async () => {
    const schema: SchemaDefinition = {
      name: 'users',
      fields: {
        id: { type: 'number', required: true },
        name: { type: 'string', required: true }
      }
    };

    const result = expectSuccessData(await adapter.createTable(schema));
    expect(result).toBeUndefined();

    const fileExists = await fs.stat(path.join(root, 'users.json')).then(() => true).catch(() => false);
    expect(fileExists).toBe(true);
  });

  it('should insert and select data', async () => {
    await adapter.createTable({ name: 'users', fields: { name: { type: 'string', required: true } } });

    // Insert
    const insertResult = expectSuccessData(await adapter.executeQuery({
      type: 'insert',
      table: 'users',
      data: { name: 'Burak' }
    }));

    expect(insertResult.metadata.insertId).toBe(1);

    // Select
    const selectResult = expectSuccessData(await adapter.executeQuery({
      type: 'select',
      table: 'users'
    }));

    expect(selectResult.rows).toHaveLength(1);
    expect(selectResult.rows[0]).toEqual({ id: 1, name: 'Burak' });
  });

  it('should update data', async () => {
    await adapter.createTable({ name: 'users', fields: { name: { type: 'string', required: true } } });
    await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'Old' } });

    const updateResult = expectSuccessData(await adapter.executeQuery({
      type: 'update',
      table: 'users',
      data: { name: 'New' },
      where: { id: 1 }
    }));

    expect(updateResult.metadata.affectedRows).toBe(1);

    const selectResult = expectSuccessData(await adapter.executeQuery({
      type: 'select',
      table: 'users',
      where: { id: 1 }
    }));

    expect(selectResult.rows[0]).toEqual({ id: 1, name: 'New' });
  });

  it('should delete data', async () => {
    await adapter.createTable({ name: 'users', fields: { name: { type: 'string', required: true } } });
    await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'DeleteMe' } });

    const deleteResult = expectSuccessData(await adapter.executeQuery({
      type: 'delete',
      table: 'users',
      where: { id: 1 }
    }));

    expect(deleteResult.metadata.affectedRows).toBe(1);

    const selectResult = expectSuccessData(await adapter.executeQuery({
      type: 'select',
      table: 'users'
    }));

    expect(selectResult.rows).toHaveLength(0);
  });
});
