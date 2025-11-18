/**
 * AWS S3 Storage Provider
 *
 * Stores files in AWS S3 using native https module (no AWS SDK dependency).
 * Implements AWS Signature V4 signing.
 * NO `any` types, NO type assertions, NEVER throw exceptions.
 */

import type { Result } from '@utils/types';
import type {
  StorageProvider,
  UploadFile,
  UploadResult,
  S3ProviderOptions,
} from '../types';
import { UploadError, generateUniqueFilename, sanitizeFilename } from '../types';

/**
 * S3 storage provider
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3' as const;

  private readonly bucket: string;
  private readonly region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly endpoint: string;
  private readonly pathPrefix: string;

  constructor(options: S3ProviderOptions) {
    this.bucket = options.bucket;
    this.region = options.region;
    this.accessKeyId = options.accessKeyId;
    this.secretAccessKey = options.secretAccessKey;
    this.endpoint =
      options.endpoint ?? `s3.${options.region}.amazonaws.com`;
    this.pathPrefix = options.pathPrefix ?? 'uploads';
  }

  /**
   * Upload a file to S3
   */
  async upload(file: UploadFile): Promise<Result<UploadResult, UploadError>> {
    try {
      // Generate unique key
      const sanitized = sanitizeFilename(file.originalName);
      const filename = generateUniqueFilename(sanitized);
      const key = this.pathPrefix
        ? `${this.pathPrefix}/${filename}`
        : filename;

      // Upload to S3
      const uploadResult = await this.putObject(key, file.buffer, file.mimetype);

      if (!uploadResult.success) {
        return uploadResult;
      }

      // Return result
      const result: UploadResult = {
        key,
        url: await this.getUrl(key),
        size: file.size,
        mimetype: file.mimetype,
        uploadedAt: new Date(),
      };

      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: new UploadError('Failed to upload file to S3', {
          originalError: error,
          filename: file.originalName,
        }),
      };
    }
  }

  /**
   * Delete a file from S3
   */
  async delete(key: string): Promise<Result<void, UploadError>> {
    try {
      const result = await this.deleteObject(key);
      return result;
    } catch (error) {
      return {
        success: false,
        error: new UploadError('Failed to delete file from S3', {
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
    return `https://${this.bucket}.${this.endpoint}/${key}`;
  }

  /**
   * Check if a file exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.headObject(key);
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * PUT object to S3
   */
  private async putObject(
    key: string,
    buffer: Uint8Array,
    contentType: string
  ): Promise<Result<void, UploadError>> {
    try {
      const https = await import('https');
      const crypto = await import('crypto');

      const host = `${this.bucket}.${this.endpoint}`;
      const path = `/${key}`;
      const method = 'PUT';

      // Prepare headers
      const date = new Date().toUTCString();
      const contentLength = buffer.length;

      // Calculate content hash
      const contentHash = crypto
        .createHash('sha256')
        .update(buffer)
        .digest('hex');

      // Create signature
      const signature = await this.signRequest(
        method,
        path,
        host,
        date,
        contentType,
        contentHash
      );

      // Make request
      const result = await new Promise<Result<void, UploadError>>(
        (resolve) => {
          const req = https.request(
            {
              hostname: host,
              port: 443,
              path,
              method,
              headers: {
                'Host': host,
                'Date': date,
                'Content-Type': contentType,
                'Content-Length': contentLength,
                'x-amz-content-sha256': contentHash,
                'Authorization': signature,
              },
            },
            (res) => {
              if (
                res.statusCode !== undefined &&
                res.statusCode >= 200 &&
                res.statusCode < 300
              ) {
                resolve({ success: true, data: undefined });
              } else {
                let body = '';
                res.on('data', (chunk) => {
                  body += chunk.toString();
                });
                res.on('end', () => {
                  resolve({
                    success: false,
                    error: new UploadError('S3 upload failed', {
                      statusCode: res.statusCode,
                      body,
                    }),
                  });
                });
              }
            }
          );

          req.on('error', (error) => {
            resolve({
              success: false,
              error: new UploadError('S3 request failed', {
                originalError: error,
              }),
            });
          });

          req.write(buffer);
          req.end();
        }
      );

      return result;
    } catch (error) {
      return {
        success: false,
        error: new UploadError('Failed to PUT object to S3', {
          originalError: error,
          key,
        }),
      };
    }
  }

  /**
   * DELETE object from S3
   */
  private async deleteObject(key: string): Promise<Result<void, UploadError>> {
    try {
      const https = await import('https');
      const crypto = await import('crypto');

      const host = `${this.bucket}.${this.endpoint}`;
      const path = `/${key}`;
      const method = 'DELETE';

      const date = new Date().toUTCString();
      const contentHash = crypto
        .createHash('sha256')
        .update('')
        .digest('hex');

      const signature = await this.signRequest(
        method,
        path,
        host,
        date,
        '',
        contentHash
      );

      const result = await new Promise<Result<void, UploadError>>(
        (resolve) => {
          const req = https.request(
            {
              hostname: host,
              port: 443,
              path,
              method,
              headers: {
                'Host': host,
                'Date': date,
                'x-amz-content-sha256': contentHash,
                'Authorization': signature,
              },
            },
            (res) => {
              if (
                res.statusCode !== undefined &&
                res.statusCode >= 200 &&
                res.statusCode < 300
              ) {
                resolve({ success: true, data: undefined });
              } else {
                let body = '';
                res.on('data', (chunk) => {
                  body += chunk.toString();
                });
                res.on('end', () => {
                  resolve({
                    success: false,
                    error: new UploadError('S3 delete failed', {
                      statusCode: res.statusCode,
                      body,
                    }),
                  });
                });
              }
            }
          );

          req.on('error', (error) => {
            resolve({
              success: false,
              error: new UploadError('S3 request failed', {
                originalError: error,
              }),
            });
          });

          req.end();
        }
      );

      return result;
    } catch (error) {
      return {
        success: false,
        error: new UploadError('Failed to DELETE object from S3', {
          originalError: error,
          key,
        }),
      };
    }
  }

  /**
   * HEAD object to check existence
   */
  private async headObject(key: string): Promise<Result<void, UploadError>> {
    try {
      const https = await import('https');
      const crypto = await import('crypto');

      const host = `${this.bucket}.${this.endpoint}`;
      const path = `/${key}`;
      const method = 'HEAD';

      const date = new Date().toUTCString();
      const contentHash = crypto
        .createHash('sha256')
        .update('')
        .digest('hex');

      const signature = await this.signRequest(
        method,
        path,
        host,
        date,
        '',
        contentHash
      );

      const result = await new Promise<Result<void, UploadError>>(
        (resolve) => {
          const req = https.request(
            {
              hostname: host,
              port: 443,
              path,
              method,
              headers: {
                'Host': host,
                'Date': date,
                'x-amz-content-sha256': contentHash,
                'Authorization': signature,
              },
            },
            (res) => {
              if (
                res.statusCode !== undefined &&
                res.statusCode >= 200 &&
                res.statusCode < 300
              ) {
                resolve({ success: true, data: undefined });
              } else {
                resolve({
                  success: false,
                  error: new UploadError('Object not found', {
                    statusCode: res.statusCode,
                  }),
                });
              }
            }
          );

          req.on('error', (error) => {
            resolve({
              success: false,
              error: new UploadError('S3 request failed', {
                originalError: error,
              }),
            });
          });

          req.end();
        }
      );

      return result;
    } catch (error) {
      return {
        success: false,
        error: new UploadError('Failed to HEAD object from S3', {
          originalError: error,
          key,
        }),
      };
    }
  }

  /**
   * Sign request using AWS Signature V4
   */
  private async signRequest(
    method: string,
    path: string,
    host: string,
    date: string,
    _contentType: string,
    contentHash: string
  ): Promise<string> {
    const crypto = await import('crypto');

    // Create canonical request
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${contentHash}\nx-amz-date:${date}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = [
      method,
      path,
      '', // query string
      canonicalHeaders,
      signedHeaders,
      contentHash,
    ].join('\n');

    // Create string to sign
    const algorithm = 'AWS4-HMAC-SHA256';
    const amzDate = this.getAmzDate();
    const credentialScope = `${this.getDateStamp()}/${this.region}/s3/aws4_request`;

    const canonicalRequestHash = crypto
      .createHash('sha256')
      .update(canonicalRequest)
      .digest('hex');

    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      canonicalRequestHash,
    ].join('\n');

    // Calculate signature
    const signature = this.calculateSignature(stringToSign);

    // Create authorization header
    const authorization = `${algorithm} Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return authorization;
  }

  /**
   * Calculate AWS Signature V4
   */
  private calculateSignature(stringToSign: string): string {
    const crypto = require('crypto');

    const kDate = crypto
      .createHmac('sha256', `AWS4${this.secretAccessKey}`)
      .update(this.getDateStamp())
      .digest();

    const kRegion = crypto
      .createHmac('sha256', kDate)
      .update(this.region)
      .digest();

    const kService = crypto
      .createHmac('sha256', kRegion)
      .update('s3')
      .digest();

    const kSigning = crypto
      .createHmac('sha256', kService)
      .update('aws4_request')
      .digest();

    const signature = crypto
      .createHmac('sha256', kSigning)
      .update(stringToSign)
      .digest('hex');

    return signature;
  }

  /**
   * Get AMZ date format (YYYYMMDDTHHMMSSZ)
   */
  private getAmzDate(): string {
    const now = new Date();
    return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  }

  /**
   * Get date stamp (YYYYMMDD)
   */
  private getDateStamp(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }
}

/**
 * Create a new S3 storage provider
 */
export function createS3StorageProvider(
  options: S3ProviderOptions
): S3StorageProvider {
  return new S3StorageProvider(options);
}
