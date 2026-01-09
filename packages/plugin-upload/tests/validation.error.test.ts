/**
 * Upload Validation Tests - Error Path
 *
 * Tests validation failures and security:
 * - File size violations
 * - MIME type restrictions
 * - Extension restrictions
 * - Path traversal prevention
 * - Dangerous character removal
 */

import { describe, it, expect } from 'vitest';
import {
  validateUploadFile,
  sanitizeFilename,
  validateFileSize,
  validateMimeType,
  validateExtension
} from '../src/types';
import type { UploadFile, FileValidationOptions } from '../src/types';
import { expectFailureError } from '../../../types/src/test/helpers';

describe('Upload Validation - Error Path', () => {
  const mockFile: UploadFile = {
    filename: 'test.jpg',
    originalName: 'test.jpg',
    mimetype: 'image/jpeg',
    size: 500,
    buffer: new Uint8Array(500),
  };

  describe('File Size Violations', () => {
    it('should fail for size below minimum', () => {
      const validationError = validateFileSize(50, { minSize: 100 });

      expect(validationError?.field).toBe('size');
      expect(validationError?.message).toContain('below minimum');
    });

    it('should fail for size above maximum', () => {
      const validationError = validateFileSize(1500, { maxSize: 1000 });

      expect(validationError?.field).toBe('size');
      expect(validationError?.message).toContain('exceeds maximum');
    });
  });

  describe('MIME Type Restrictions', () => {
    it('should fail for disallowed mime type', () => {
      const validationError = validateMimeType('application/pdf', { allowedMimeTypes: ['image/png'] });

      expect(validationError?.field).toBe('mimetype');
      expect(validationError?.message).toContain('not allowed');
    });
  });

  describe('Extension Restrictions', () => {
    it('should fail for disallowed extension', () => {
      const validationError = validateExtension('document.pdf', { allowedExtensions: ['png'] });

      expect(validationError?.field).toBe('extension');
    });
  });

  describe('Security - Path Traversal Prevention', () => {
    it('should remove path traversal attempts', () => {
      expect(sanitizeFilename('../../../etc/passwd')).toBe('etcpasswd');
      expect(sanitizeFilename('..\\..\\windows\\system32')).toBe('windowssystem32');
    });
  });

  describe('Security - Dangerous Characters', () => {
    it('should remove dangerous characters', () => {
      const sanitizedFilename = sanitizeFilename('file<>:"|?*.txt');
      expect(sanitizedFilename).toBe('file.txt');
    });
  });

  describe('Multiple Validation Failures', () => {
    it('should return multiple errors if multiple validations fail', () => {
      const strictOptions: FileValidationOptions = {
        maxSize: 100,
        allowedMimeTypes: ['image/png']
      };

      const validationResult = validateUploadFile(mockFile, strictOptions);

      const error = expectFailureError(validationResult);
      expect(error.validationErrors).toHaveLength(2);
      expect(error.validationErrors.some(e => e.field === 'size')).toBe(true);
      expect(error.validationErrors.some(e => e.field === 'mimetype')).toBe(true);
    });
  });
});
