/**
 * Upload Plugin - Validation Tests
 *
 * Tests the file validation logic:
 * - File size limits (min/max)
 * - MIME type restrictions
 * - Extension restrictions
 * - Sanitization and security (path traversal)
 */

import { describe, it, expect } from 'vitest';
import {
  validateUploadFile,
  sanitizeFilename,
  validateFileSize,
  validateMimeType,
  validateExtension
} from '@plugins/upload/types';
import type { UploadFile, FileValidationOptions } from '@plugins/upload/types';

describe('Upload Plugin - Validation Utility', () => {
  const mockFile: UploadFile = {
    filename: 'test.jpg',
    originalName: 'test.jpg',
    mimetype: 'image/jpeg',
    size: 500,
    buffer: new Uint8Array(500),
  };

  describe('validateFileSize', () => {
    it('should pass for valid size', () => {
      const result = validateFileSize(500, { minSize: 100, maxSize: 1000 });
      expect(result).toBeNull();
    });

    it('should fail for size below minimum', () => {
      const result = validateFileSize(50, { minSize: 100 });
      expect(result?.field).toBe('size');
      expect(result?.message).toContain('below minimum');
    });

    it('should fail for size above maximum', () => {
      const result = validateFileSize(1500, { maxSize: 1000 });
      expect(result?.field).toBe('size');
      expect(result?.message).toContain('exceeds maximum');
    });
  });

  describe('validateMimeType', () => {
    it('should pass for allowed mime type', () => {
      const result = validateMimeType('image/png', { allowedMimeTypes: ['image/png', 'image/jpeg'] });
      expect(result).toBeNull();
    });

    it('should fail for disallowed mime type', () => {
      const result = validateMimeType('application/pdf', { allowedMimeTypes: ['image/png'] });
      expect(result?.field).toBe('mimetype');
      expect(result?.message).toContain('not allowed');
    });
  });

  describe('validateExtension', () => {
    it('should pass for allowed extension', () => {
      const result = validateExtension('image.png', { allowedExtensions: ['png', 'jpg'] });
      expect(result).toBeNull();
    });

    it('should fail for disallowed extension', () => {
      const result = validateExtension('document.pdf', { allowedExtensions: ['png'] });
      expect(result?.field).toBe('extension');
    });
  });

  describe('sanitizeFilename', () => {
    it('should remove path traversal attempts', () => {
      expect(sanitizeFilename('../../../etc/passwd')).toBe('etcpasswd');
      expect(sanitizeFilename('..\\..\\windows\\system32')).toBe('windowssystem32');
    });

    it('should remove dangerous characters', () => {
      expect(sanitizeFilename('file<>:"|?*.txt')).toBe('file.txt');
    });

    it('should replace spaces with dashes', () => {
      expect(sanitizeFilename('My Resume 2023.pdf')).toBe('my-resume-2023.pdf');
    });
  });

  describe('validateUploadFile (Integration)', () => {
    it('should return multiple errors if multiple validations fail', () => {
      const options: FileValidationOptions = {
        maxSize: 100,
        allowedMimeTypes: ['image/png']
      };

      const result = validateUploadFile(mockFile, options); // mockFile is 500 bytes and image/jpeg
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.validationErrors).toHaveLength(2);
        expect(result.error.validationErrors.some(e => e.field === 'size')).toBe(true);
        expect(result.error.validationErrors.some(e => e.field === 'mimetype')).toBe(true);
      }
    });

    it('should pass when all rules match', () => {
      const result = validateUploadFile(mockFile, { maxSize: 1000, allowedMimeTypes: ['image/jpeg'] });
      expect(result.success).toBe(true);
    });
  });
});
