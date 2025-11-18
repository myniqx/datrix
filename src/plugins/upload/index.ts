/**
 * Upload Plugin
 *
 * Provides file upload functionality with multiple storage providers.
 * NO `any` types, NO type assertions, NEVER throw exceptions.
 */

import type { Result } from '@utils/types';
import type {
  ForjaPlugin,
  PluginContext,
  PluginError,
} from '@plugins/base/types';
import type {
  UploadPluginOptions,
  UploadFile,
  UploadResult,
  StorageProvider,
  FileValidationOptions,
} from './types';
import {
  UploadError,
  isStorageProvider,
  isUploadFile,
  validateUploadFile,
} from './types';

/**
 * Upload plugin implementation
 */
export class UploadPlugin implements ForjaPlugin<UploadPluginOptions> {
  readonly name = 'upload' as const;
  readonly version = '0.1.0';
  readonly options: UploadPluginOptions;

  private provider: StorageProvider;
  private validation: FileValidationOptions;
  private enableLogging: boolean;

  constructor(options: UploadPluginOptions) {
    this.options = options;
    this.provider = options.provider;
    this.validation = options.validation ?? {};
    this.enableLogging = options.enableLogging ?? false;
  }

  /**
   * Initialize the plugin
   */
  async init(_context: PluginContext): Promise<Result<void, PluginError>> {
    // Validate provider
    if (!isStorageProvider(this.provider)) {
      return {
        success: false,
        error: new UploadError('Invalid storage provider', {
          provider: this.provider,
        }),
      };
    }

    if (this.enableLogging) {
      console.log(
        `[Upload] Initialized with provider: ${this.provider.name}`
      );
    }

    return { success: true, data: undefined };
  }

  /**
   * Destroy the plugin
   */
  async destroy(): Promise<Result<void, PluginError>> {
    if (this.enableLogging) {
      console.log('[Upload] Plugin destroyed');
    }

    return { success: true, data: undefined };
  }

  /**
   * Upload a file
   */
  async upload(file: UploadFile): Promise<Result<UploadResult, UploadError>> {
    // Validate file object
    if (!isUploadFile(file)) {
      return {
        success: false,
        error: new UploadError('Invalid file object', { file }),
      };
    }

    // Validate file against rules
    const validationResult = validateUploadFile(file, this.validation);
    if (!validationResult.success) {
      return {
        success: false,
        error: validationResult.error,
      };
    }

    // Upload using provider
    if (this.enableLogging) {
      console.log(`[Upload] Uploading file: ${file.originalName}`);
    }

    const uploadResult = await this.provider.upload(file);

    if (!uploadResult.success) {
      if (this.enableLogging) {
        console.error(
          `[Upload] Upload failed: ${uploadResult.error.message}`
        );
      }
      return uploadResult;
    }

    if (this.enableLogging) {
      console.log(
        `[Upload] Upload successful: ${uploadResult.data.key}`
      );
    }

    return uploadResult;
  }

  /**
   * Delete a file
   */
  async delete(key: string): Promise<Result<void, UploadError>> {
    if (typeof key !== 'string' || key.trim().length === 0) {
      return {
        success: false,
        error: new UploadError('Invalid file key', { key }),
      };
    }

    if (this.enableLogging) {
      console.log(`[Upload] Deleting file: ${key}`);
    }

    const deleteResult = await this.provider.delete(key);

    if (!deleteResult.success) {
      if (this.enableLogging) {
        console.error(
          `[Upload] Delete failed: ${deleteResult.error.message}`
        );
      }
      return deleteResult;
    }

    if (this.enableLogging) {
      console.log(`[Upload] Delete successful: ${key}`);
    }

    return deleteResult;
  }

  /**
   * Get URL for a file
   */
  async getUrl(key: string): Promise<Result<string, UploadError>> {
    if (typeof key !== 'string' || key.trim().length === 0) {
      return {
        success: false,
        error: new UploadError('Invalid file key', { key }),
      };
    }

    try {
      const url = await this.provider.getUrl(key);
      return { success: true, data: url };
    } catch (error) {
      return {
        success: false,
        error: new UploadError('Failed to get file URL', {
          originalError: error,
          key,
        }),
      };
    }
  }

  /**
   * Check if a file exists
   */
  async exists(key: string): Promise<Result<boolean, UploadError>> {
    if (typeof key !== 'string' || key.trim().length === 0) {
      return {
        success: false,
        error: new UploadError('Invalid file key', { key }),
      };
    }

    try {
      const exists = await this.provider.exists(key);
      return { success: true, data: exists };
    } catch (error) {
      return {
        success: false,
        error: new UploadError('Failed to check file existence', {
          originalError: error,
          key,
        }),
      };
    }
  }

  /**
   * Get current provider
   */
  getProvider(): StorageProvider {
    return this.provider;
  }

  /**
   * Get validation options
   */
  getValidation(): FileValidationOptions {
    return this.validation;
  }

  /**
   * Update validation options
   */
  setValidation(validation: FileValidationOptions): void {
    this.validation = validation;
  }
}

/**
 * Create a new upload plugin instance
 */
export function createUploadPlugin(
  options: UploadPluginOptions
): UploadPlugin {
  return new UploadPlugin(options);
}

/**
 * Re-export types
 */
export type {
  UploadPluginOptions,
  UploadFile,
  UploadResult,
  StorageProvider,
  FileValidationOptions,
  LocalProviderOptions,
  S3ProviderOptions,
} from './types';

export {
  UploadError,
  FileValidationError,
  isStorageProvider,
  isUploadFile,
  validateUploadFile,
  generateUniqueFilename,
  sanitizeFilename,
  getFileExtension,
} from './types';

export { LocalStorageProvider, createLocalStorageProvider } from './providers/local';
export { S3StorageProvider, createS3StorageProvider } from './providers/s3';
