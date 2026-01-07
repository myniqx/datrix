/**
 * Upload Plugin - Local Storage Provider Tests
 *
 * Tests the LocalStorageProvider:
 * - File upload (writing to disk)
 * - File deletion (removing from disk)
 * - Existence check
 * - Directory creation (ensureDirectory)
 * - Filename sanitization and uniqueness
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalStorageProvider } from '@plugins/upload/providers/local';
import type { UploadFile } from '@plugins/upload/types';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Upload Plugin - Local Storage Provider', () => {
  const testBaseDir = path.join(os.tmpdir(), `forja-test-uploads-${Date.now()}`);
  const baseUrl = 'http://localhost:3000/uploads';

  let provider: LocalStorageProvider;

  beforeEach(async () => {
    // Ensure clean state for each test
    await fs.mkdir(testBaseDir, { recursive: true });
    provider = new LocalStorageProvider({
      basePath: testBaseDir,
      baseUrl,
      ensureDirectory: true
    });
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      await fs.rm(testBaseDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  it('should upload a file and return correct metadata', async () => {
    const file: UploadFile = {
      filename: 'test.txt',
      originalName: 'My File.txt',
      mimetype: 'text/plain',
      size: 11,
      buffer: new TextEncoder().encode('Hello World'),
    };

    const result = await provider.upload(file);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.key).toMatch(/^\d+-[a-z0-9]+\.txt$/);
      expect(result.data.url).toBe(`${baseUrl}/${result.data.key}`);
      expect(result.data.size).toBe(11);
      expect(result.data.mimetype).toBe('text/plain');

      // Verify file exists on disk
      const filePath = path.join(testBaseDir, result.data.key);
      const stats = await fs.stat(filePath);
      expect(stats.size).toBe(11);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Hello World');
    }
  });

  it('should delete an existing file', async () => {
    const file: UploadFile = {
      filename: 'delete-me.txt',
      originalName: 'delete-me.txt',
      mimetype: 'text/plain',
      size: 4,
      buffer: new TextEncoder().encode('bye'),
    };

    const upload = await provider.upload(file);
    const key = (upload as any).data.key;

    expect(await provider.exists(key)).toBe(true);

    const deleteResult = await provider.delete(key);
    expect(deleteResult.success).toBe(true);
    expect(await provider.exists(key)).toBe(false);

    // Check disk
    await expect(fs.access(path.join(testBaseDir, key))).rejects.toThrow();
  });

  it('should fail when deleting non-existent file', async () => {
    const result = await provider.delete('non-existent.txt');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect((result.error.details as any).key).toBe('non-existent.txt');
    }
  });

  it('should sanitize dangerous filenames', async () => {
    const file: UploadFile = {
      filename: 'danger.txt',
      originalName: '../../../etc/passwd.txt',
      mimetype: 'text/plain',
      size: 1,
      buffer: new Uint8Array([0]),
    };

    const result = await provider.upload(file);
    if (result.success) {
      expect(result.data.key).not.toContain('..');
      expect(result.data.key).not.toContain('/');
      expect(result.data.key).toMatch(/\.txt$/);

      // Should be inside testBaseDir, not escaping it
      const filePath = path.join(testBaseDir, result.data.key);
      expect(path.resolve(filePath)).toContain(path.resolve(testBaseDir));
    }
  });

  it('should generate unique filenames for duplicate original names', async () => {
    const file: UploadFile = {
      filename: 'test.txt',
      originalName: 'test.txt',
      mimetype: 'text/plain',
      size: 1,
      buffer: new Uint8Array([0]),
    };

    const r1 = await provider.upload(file);
    const r2 = await provider.upload(file);

    if (r1.success && r2.success) {
      expect(r1.data.key).not.toBe(r2.data.key);
      expect(await provider.exists(r1.data.key)).toBe(true);
      expect(await provider.exists(r2.data.key)).toBe(true);
    }
  });
});
