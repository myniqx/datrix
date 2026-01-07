/**
 * Upload Plugin - Integration Tests
 *
 * Tests the UploadPlugin class and its integration with providers:
 * - Plugin initialization and validation
 * - File validation before upload
 * - Error propagation from providers
 * - Logging (if enabled)
 * - Public API (upload, delete, exists, getUrl)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUploadPlugin } from '@plugins/upload';
import type { StorageProvider, UploadFile, UploadResult } from '@plugins/upload/types';
import { UploadError } from '@plugins/upload/types';
import type { PluginContext } from '@plugins/base/types';

describe('Upload Plugin - Integration', () => {
  // Mock Storage Provider
  const mockProvider: StorageProvider = {
    name: 'mock',
    upload: vi.fn(),
    delete: vi.fn(),
    getUrl: vi.fn(),
    exists: vi.fn(),
  };

  const mockContext: PluginContext = {
    adapter: {} as any,
    schemas: {} as any,
    config: {} as any,
  };

  let plugin: ReturnType<typeof createUploadPlugin>;

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = createUploadPlugin({
      provider: mockProvider,
      validation: {
        maxSize: 1000,
        allowedMimeTypes: ['image/jpeg']
      },
      enableLogging: true
    });
  });

  describe('upload', () => {
    it('should validate file before calling provider', async () => {
      const invalidFile: UploadFile = {
        filename: 'test.pdf',
        originalName: 'test.pdf',
        mimetype: 'application/pdf',
        size: 500,
        buffer: new Uint8Array(500),
      };

      const result = await plugin.upload(invalidFile);

      expect(result.success).toBe(false);
      expect(result.error.name).toBe('FileValidationError');
      expect(mockProvider.upload).not.toHaveBeenCalled();
    });

    it('should call provider if validation passes', async () => {
      const validFile: UploadFile = {
        filename: 'test.jpg',
        originalName: 'test.jpg',
        mimetype: 'image/jpeg',
        size: 500,
        buffer: new Uint8Array(500),
      };

      const mockResult: UploadResult = {
        key: 'gen-key.jpg',
        url: 'http://test.com/gen-key.jpg',
        size: 500,
        mimetype: 'image/jpeg',
        uploadedAt: new Date(),
      };

      vi.mocked(mockProvider.upload).mockResolvedValue({ success: true, data: mockResult });

      const result = await plugin.upload(validFile);

      expect(result.success).toBe(true);
      expect(mockProvider.upload).toHaveBeenCalledWith(validFile);
      if (result.success) {
        expect(result.data.key).toBe('gen-key.jpg');
      }
    });

    it('should propagate provider errors', async () => {
      const validFile: UploadFile = {
        filename: 'test.jpg',
        originalName: 'test.jpg',
        mimetype: 'image/jpeg',
        size: 500,
        buffer: new Uint8Array(500),
      };

      vi.mocked(mockProvider.upload).mockResolvedValue({
        success: false,
        error: new UploadError('Provider failed')
      });

      const result = await plugin.upload(validFile);
      expect(result.success).toBe(false);
      expect(result.error.message).toBe('Provider failed');
    });
  });

  describe('delete', () => {
    it('should call provider.delete with correct key', async () => {
      vi.mocked(mockProvider.delete).mockResolvedValue({ success: true, data: undefined });

      const result = await plugin.delete('some-key');
      expect(result.success).toBe(true);
      expect(mockProvider.delete).toHaveBeenCalledWith('some-key');
    });

    it('should fail for invalid keys', async () => {
      const result = await plugin.delete(' ');
      expect(result.success).toBe(false);
      expect(result.error.message).toContain('Invalid file key');
    });
  });

  describe('Logging', () => {
    it('should log to console if enabled', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => { });

      const validFile: UploadFile = {
        filename: 'test.jpg',
        originalName: 'test.jpg',
        mimetype: 'image/jpeg',
        size: 500,
        buffer: new Uint8Array(500),
      };

      vi.mocked(mockProvider.upload).mockResolvedValue({
        success: true,
        data: { key: 'k', url: 'u', size: 10, mimetype: 'm', uploadedAt: new Date() }
      });

      await plugin.upload(validFile);
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });
  });
});
