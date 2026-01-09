/**
 * Local Storage Provider Tests - Happy Path
 *
 * Tests successful local storage operations:
 * - File upload to disk
 * - File deletion from disk
 * - Existence checks
 * - Unique filename generation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalStorageProvider } from '../src/providers/local';
import type { UploadFile } from '../src/types';
import { expectSuccessData } from '../../../types/src/test/helpers';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Local Storage Provider - Happy Path', () => {
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

  describe('File Upload', () => {
    it('should upload a file and return correct metadata', async () => {
      const textFile: UploadFile = {
        filename: 'test.txt',
        originalName: 'My File.txt',
        mimetype: 'text/plain',
        size: 11,
        buffer: new TextEncoder().encode('Hello World'),
      };

      const uploadResult = await localProvider.upload(textFile);

      const uploadedFile = expectSuccessData(uploadResult);
      expect(uploadedFile.key).toMatch(/^\d+-[a-z0-9]+\.txt$/);
      expect(uploadedFile.url).toBe(`${baseUrl}/${uploadedFile.key}`);
      expect(uploadedFile.size).toBe(11);
      expect(uploadedFile.mimetype).toBe('text/plain');

      // Verify file exists on disk
      const filePath = path.join(testBaseDir, uploadedFile.key);
      const fileStats = await fs.stat(filePath);
      expect(fileStats.size).toBe(11);

      const fileContent = await fs.readFile(filePath, 'utf-8');
      expect(fileContent).toBe('Hello World');
    });
  });

  describe('File Deletion', () => {
    it('should delete an existing file', async () => {
      const fileToDelete: UploadFile = {
        filename: 'delete-me.txt',
        originalName: 'delete-me.txt',
        mimetype: 'text/plain',
        size: 4,
        buffer: new TextEncoder().encode('bye'),
      };

      const uploadResult = await localProvider.upload(fileToDelete);
      const uploadedKey = expectSuccessData(uploadResult).key;

      expect(await localProvider.exists(uploadedKey)).toBe(true);

      const deleteResult = await localProvider.delete(uploadedKey);
      expectSuccessData(deleteResult);
      expect(await localProvider.exists(uploadedKey)).toBe(false);

      // Verify file removed from disk
      await expect(fs.access(path.join(testBaseDir, uploadedKey))).rejects.toThrow();
    });
  });

  describe('Unique Filename Generation', () => {
    it('should generate unique filenames for duplicate original names', async () => {
      const duplicateFile: UploadFile = {
        filename: 'test.txt',
        originalName: 'test.txt',
        mimetype: 'text/plain',
        size: 1,
        buffer: new Uint8Array([0]),
      };

      const firstUpload = await localProvider.upload(duplicateFile);
      const secondUpload = await localProvider.upload(duplicateFile);

      const firstKey = expectSuccessData(firstUpload).key;
      const secondKey = expectSuccessData(secondUpload).key;

      expect(firstKey).not.toBe(secondKey);
      expect(await localProvider.exists(firstKey)).toBe(true);
      expect(await localProvider.exists(secondKey)).toBe(true);
    });
  });
});
