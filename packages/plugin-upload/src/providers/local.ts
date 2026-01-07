/**
 * Local Filesystem Storage Provider
 *
 * Stores files on the local filesystem.
 * NO `any` types, NO type assertions, NEVER throw exceptions.
 */

import { Result } from 'forja-types/utils';
import type {
  StorageProvider,
  UploadFile,
  UploadResult,
  LocalProviderOptions,
} from '../types';
import { UploadError, generateUniqueFilename, sanitizeFilename } from '../types';

/**
 * Local filesystem storage provider
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local' as const;

  private readonly basePath: string;
  private readonly baseUrl: string;
  private readonly ensureDirectory: boolean;

  constructor(options: LocalProviderOptions) {
    this.basePath = options.basePath;
    this.baseUrl = options.baseUrl;
    this.ensureDirectory = options.ensureDirectory ?? true;
  }

  /**
   * Upload a file to local filesystem
   */
  async upload(file: UploadFile): Promise<Result<UploadResult, UploadError>> {
    try {
      // Dynamic imports for Node.js modules
      const fs = await import('fs/promises');
      const path = await import('path');

      // Generate unique filename
      const sanitized = sanitizeFilename(file.originalName);
      const uniqueFilename = generateUniqueFilename(sanitized);

      // Construct full path
      const fullPath = path.join(this.basePath, uniqueFilename);

      // Ensure directory exists
      if (this.ensureDirectory) {
        const dirPath = path.dirname(fullPath);
        await fs.mkdir(dirPath, { recursive: true });
      }

      // Write file
      await fs.writeFile(fullPath, file.buffer);

      // Return result
      const result: UploadResult = {
        key: uniqueFilename,
        url: this.getUrlSync(uniqueFilename),
        size: file.size,
        mimetype: file.mimetype,
        uploadedAt: new Date(),
      };

      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: new UploadError('Failed to upload file to local filesystem', {
          originalError: error,
          filename: file.originalName,
        }),
      };
    }
  }

  /**
   * Delete a file from local filesystem
   */
  async delete(key: string): Promise<Result<void, UploadError>> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      const fullPath = path.join(this.basePath, key);

      // Check if file exists
      try {
        await fs.access(fullPath);
      } catch {
        return {
          success: false,
          error: new UploadError('File not found', { key }),
        };
      }

      // Delete file
      await fs.unlink(fullPath);

      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: new UploadError('Failed to delete file from local filesystem', {
          originalError: error,
          key,
        }),
      };
    }
  }

  /**
   * Get URL for a file
   */
  async getUrl(key: string): Promise<string> {
    return this.getUrlSync(key);
  }

  /**
   * Get URL synchronously
   */
  private getUrlSync(key: string): string {
    // Ensure baseUrl doesn't end with / and key doesn't start with /
    const cleanBaseUrl = this.baseUrl.replace(/\/$/, '');
    const cleanKey = key.replace(/^\//, '');

    return `${cleanBaseUrl}/${cleanKey}`;
  }

  /**
   * Check if a file exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      const fullPath = path.join(this.basePath, key);

      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get base path
   */
  getBasePath(): string {
    return this.basePath;
  }

  /**
   * Get base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}

/**
 * Create a new local storage provider
 */
export function createLocalStorageProvider(
  options: LocalProviderOptions
): LocalStorageProvider {
  return new LocalStorageProvider(options);
}
