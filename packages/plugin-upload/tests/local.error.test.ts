/**
 * Local Storage Provider Tests - Error Path
 *
 * Tests error handling and security:
 * - Non-existent file deletion
 * - Path traversal prevention
 * - Filename sanitization
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalStorageProvider } from '../src/providers/local';
import type { UploadFile } from '../src/types';
import { expectFailureError, expectSuccessData } from '../../../types/src/test/helpers';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Local Storage Provider - Error Path', () => {
  const testBaseDir = path.join(os.tmpdir(), `forja-test-uploads-${Date.now()}`);
  const baseUrl = 'http://localhost:3000/uploads';

  let localProvider: LocalStorageProvider;

  beforeEach(async () => {
    await fs.mkdir(testBaseDir, { recursive: true });
    localProvider = new LocalStorageProvider({
      basePath: testBaseDir,
      baseUrl,
      ensureDirectory: true
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(testBaseDir, { recursive: true, force: true });
    } catch (e) {
      // ignore cleanup errors
    }
  });

  describe('File Deletion Errors', () => {
    it('should fail when deleting non-existent file', async () => {
      const deleteResult = await localProvider.delete('non-existent.txt');

      const error = expectFailureError(deleteResult);
      expect((error.details as any).key).toBe('non-existent.txt');
    });
  });

  describe('Security - Path Traversal Prevention', () => {
    it('should sanitize dangerous filenames', async () => {
      const pathTraversalFile: UploadFile = {
        filename: 'danger.txt',
        originalName: '../../../etc/passwd.txt',
        mimetype: 'text/plain',
        size: 1,
        buffer: new Uint8Array([0]),
      };

      const uploadResult = await localProvider.upload(pathTraversalFile);
      const sanitizedKey = expectSuccessData(uploadResult).key;

      expect(sanitizedKey).not.toContain('..');
      expect(sanitizedKey).not.toContain('/');
      expect(sanitizedKey).toMatch(/\.txt$/);

      // Should be inside testBaseDir, not escaping it
      const filePath = path.join(testBaseDir, sanitizedKey);
      expect(path.resolve(filePath)).toContain(path.resolve(testBaseDir));
    });
  });
});
