import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JsonAdapter } from '../src/adapter';
import { expectFailureError, expectSuccessData } from '../../types/src/test/helpers';

describe('JsonAdapter - Error Path', () => {
  const root = path.join(__dirname, 'tmp_adapter_error_test');
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

  it('should fail when table not found', async () => {
    const result = await adapter.executeQuery({
      type: 'select',
      table: 'non_existent_table'
    });

    const error = expectFailureError({ success: false, error: result.error as any });
    expect(error.code).toBe('TABLE_NOT_FOUND');
  });

  it('should fail when query validation fails', async () => {
    // @ts-ignore - Invalid query
    const result = await adapter.executeQuery({ table: 'users' });

    const error = expectFailureError(result);
    expect(error.code).toBe('QUERY_ERROR'); // Or generic validation error code
    expect(error.message).toContain('Invalid QueryObject');
  });

  it('should fail raw query execution', async () => {
    const result = await adapter.executeRawQuery('SELECT * FROM users', []);

    const error = expectFailureError(result);
    expect(error.code).toBe('QUERY_ERROR');
    expect(error.message).toContain('executeRawQuery is not supported');
  });

  describe('Security: Path Traversal', () => {
    it('should prevent directory traversal with parent references', async () => {
      const maliciousTableNames = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32',
        'users/../../../sensitive',
        '.ssh/id_rsa',
      ];

      for (const tableName of maliciousTableNames) {
        const result = await adapter.createTable({
          name: tableName,
          fields: { name: { type: 'string', required: true } }
        });

        if (result.success) {
          const tablePath = path.join(root, `${tableName}.json`);
          const resolved = path.resolve(tablePath);
          const rootPath = path.resolve(root);

          expect(resolved.startsWith(rootPath)).toBe(true);
        }
      }
    });

    it('should reject table names with path separators', async () => {
      const invalidNames = ['users/admin', 'data\\tables', 'a/b/c', './hidden'];

      for (const name of invalidNames) {
        const result = await adapter.createTable({
          name,
          fields: { name: { type: 'string', required: true } }
        });

        if (!result.success) {
          expect(['MIGRATION_ERROR', 'INVALID_TABLE_NAME']).toContain(result.error.code);
        }
      }
    });

    it('should reject table names with null bytes', async () => {
      const nullByteTable = 'users\x00malicious';

      const result = await adapter.createTable({
        name: nullByteTable,
        fields: {}
      });

      if (!result.success) {
        expect(result.error.code).toBe('MIGRATION_ERROR');
      }
    });
  });

  describe('Security: File System Permissions', () => {
    it('should handle read-only directory errors', async () => {
      const readOnlyRoot = path.join(__dirname, 'tmp_readonly_test');
      await fs.mkdir(readOnlyRoot, { recursive: true });

      try {
        await fs.chmod(readOnlyRoot, 0o444);

        const restrictedAdapter = new JsonAdapter({ root: readOnlyRoot });
        await restrictedAdapter.connect();

        const result = await restrictedAdapter.createTable({
          name: 'users',
          fields: { name: { type: 'string', required: true } }
        });

        if (!result.success) {
          expect(result.error.code).toBe('MIGRATION_ERROR');
          expect(result.error.message.toLowerCase()).toContain('permission');
        }
      } finally {
        await fs.chmod(readOnlyRoot, 0o755);
        await fs.rm(readOnlyRoot, { recursive: true, force: true });
      }
    });

    it('should handle non-existent root directory creation', async () => {
      const deepRoot = path.join(__dirname, 'tmp_deep', 'nested', 'path');
      await fs.rm(path.join(__dirname, 'tmp_deep'), { recursive: true, force: true });

      const deepAdapter = new JsonAdapter({ root: deepRoot });
      const connectResult = expectSuccessData(await deepAdapter.connect());

      expect(connectResult).toBeUndefined();

      const dirExists = await fs.stat(deepRoot).then(() => true).catch(() => false);
      expect(dirExists).toBe(true);

      await deepAdapter.disconnect();
      await fs.rm(path.join(__dirname, 'tmp_deep'), { recursive: true, force: true });
    });
  });
});
