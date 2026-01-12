/**
 * JWT Strategy
 *
 * Implements JWT token signing and verification using Node.js crypto module.
 * No external dependencies (no jsonwebtoken library).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  JwtConfig,
  JwtPayload,
  JwtHeader,
  JwtAlgorithm,
  TimeUnit,
  ExpiryString,
} from './types';
import { isJwtPayload } from './types';
import { AuthError } from 'forja-types/plugin';
import { Result } from 'forja-types/utils';

/**
 * JWT Strategy
 *
 * Handles JWT token creation and verification
 */
export class JwtStrategy {
  private readonly secret: string;
  private readonly expiresIn: number; // in seconds
  private readonly algorithm: JwtAlgorithm;
  private readonly issuer: string | undefined;
  private readonly audience: string | undefined;

  constructor(config: JwtConfig) {
    this.secret = config.secret;
    this.expiresIn = this.parseExpiry(config.expiresIn ?? '1h');
    this.algorithm = config.algorithm ?? 'HS256';
    this.issuer = config.issuer;
    this.audience = config.audience;
  }

  /**
   * Sign a JWT token
   */
  async sign(
    payload: Omit<JwtPayload, 'iat' | 'exp' | 'iss' | 'aud'>
  ): Promise<Result<string, AuthError>> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const exp = now + this.expiresIn;

      const basePayload = payload as Record<string, unknown>;
      const fullPayload: JwtPayload = {
        userId: basePayload['userId'] as string,
        role: basePayload['role'] as string,
        iat: now,
        exp,
        ...(this.issuer && { iss: this.issuer }),
        ...(this.audience && { aud: this.audience }),
        ...basePayload,
      };

      const token = this.createToken(fullPayload);

      return { success: true, data: token };
    } catch (error) {
      return {
        success: false,
        error: new AuthError('Failed to sign JWT token', {
          code: 'JWT_SIGN_ERROR',
          details: error,
        }),
      };
    }
  }

  /**
   * Verify a JWT token
   */
  async verify(token: string): Promise<Result<JwtPayload, AuthError>> {
    try {
      // Split token into parts
      const parts = token.split('.');
      if (parts.length !== 3) {
        return {
          success: false,
          error: new AuthError('Invalid JWT format', {
            code: 'JWT_INVALID_FORMAT',
          }),
        };
      }

      const encodedHeader = parts[0];
      const encodedPayload = parts[1];
      const signature = parts[2];

      if (!encodedHeader || !encodedPayload || !signature) {
        return {
          success: false,
          error: new AuthError('Invalid JWT format', {
            code: 'JWT_INVALID_FORMAT',
          }),
        };
      }

      // Verify signature
      const expectedSignature = this.signData(
        `${encodedHeader}.${encodedPayload}`
      );

      if (!this.constantTimeCompare(signature, expectedSignature)) {
        return {
          success: false,
          error: new AuthError('Invalid JWT signature', {
            code: 'JWT_INVALID_SIGNATURE',
          }),
        };
      }

      // Decode and validate header
      const header = this.decodeBase64Url<JwtHeader>(encodedHeader);
      if (!header || header.typ !== 'JWT' || header.alg !== this.algorithm) {
        return {
          success: false,
          error: new AuthError('Invalid JWT header', {
            code: 'JWT_INVALID_HEADER',
          }),
        };
      }

      // Decode and validate payload
      const payload = this.decodeBase64Url<JwtPayload>(encodedPayload);
      if (!payload || !isJwtPayload(payload)) {
        return {
          success: false,
          error: new AuthError('Invalid JWT payload', {
            code: 'JWT_INVALID_PAYLOAD',
          }),
        };
      }

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now) {
        return {
          success: false,
          error: new AuthError('JWT token expired', {
            code: 'JWT_EXPIRED',
            details: { exp: payload.exp, now },
          }),
        };
      }

      // Check issued at (not in future)
      if (payload.iat > now + 60) {
        // Allow 60s clock skew
        return {
          success: false,
          error: new AuthError('JWT token issued in the future', {
            code: 'JWT_INVALID_IAT',
          }),
        };
      }

      // Check issuer if configured
      if (this.issuer !== undefined && payload.iss !== this.issuer) {
        return {
          success: false,
          error: new AuthError('JWT issuer mismatch', {
            code: 'JWT_INVALID_ISSUER',
          }),
        };
      }

      // Check audience if configured
      if (this.audience !== undefined && payload.aud !== this.audience) {
        return {
          success: false,
          error: new AuthError('JWT audience mismatch', {
            code: 'JWT_INVALID_AUDIENCE',
          }),
        };
      }

      return { success: true, data: payload };
    } catch (error) {
      return {
        success: false,
        error: new AuthError('Failed to verify JWT token', {
          code: 'JWT_VERIFY_ERROR',
          details: error,
        }),
      };
    }
  }

  /**
   * Refresh a JWT token
   *
   * Creates a new token with updated expiration
   */
  async refresh(token: string): Promise<Result<string, AuthError>> {
    const verifyResult = await this.verify(token);

    if (!verifyResult.success) {
      return verifyResult;
    }

    const { userId, role, ...rest } = verifyResult.data;

    // Remove standard claims
    const { iat: _iat, exp: _exp, iss: _iss, aud: _aud, ...custom } = rest;

    return this.sign({ userId, role, ...custom });
  }

  /**
   * Decode token without verification (for debugging)
   */
  decode(token: string): Result<JwtPayload, AuthError> {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return {
          success: false,
          error: new AuthError('Invalid JWT format', {
            code: 'JWT_INVALID_FORMAT',
          }),
        };
      }

      const encodedPayload = parts[1];
      if (!encodedPayload) {
        return {
          success: false,
          error: new AuthError('Invalid JWT format', {
            code: 'JWT_INVALID_FORMAT',
          }),
        };
      }

      const payload = this.decodeBase64Url<JwtPayload>(encodedPayload);
      if (!payload || !isJwtPayload(payload)) {
        return {
          success: false,
          error: new AuthError('Invalid JWT payload', {
            code: 'JWT_INVALID_PAYLOAD',
          }),
        };
      }

      return { success: true, data: payload };
    } catch (error) {
      return {
        success: false,
        error: new AuthError('Failed to decode JWT token', {
          code: 'JWT_DECODE_ERROR',
          details: error,
        }),
      };
    }
  }

  /**
   * Create a JWT token from payload
   */
  private createToken(payload: JwtPayload): string {
    const header: JwtHeader = {
      alg: this.algorithm,
      typ: 'JWT',
    };

    const encodedHeader = this.encodeBase64Url(JSON.stringify(header));
    const encodedPayload = this.encodeBase64Url(JSON.stringify(payload));

    const signature = this.signData(`${encodedHeader}.${encodedPayload}`);

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  /**
   * Sign data using HMAC
   */
  private signData(data: string): string {
    const algorithm = this.algorithm === 'HS256' ? 'sha256' : 'sha512';
    const hmac = createHmac(algorithm, this.secret);
    hmac.update(data);
    return this.encodeBase64Url(hmac.digest('base64'));
  }

  /**
   * Base64 URL encode
   */
  private encodeBase64Url(str: string): string {
    return Buffer.from(str)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Base64 URL decode
   */
  private decodeBase64Url<T>(str: string): T | undefined {
    try {
      // Add padding if needed
      let padded = str;
      while (padded.length % 4 !== 0) {
        padded += '=';
      }

      // Replace URL-safe characters
      const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');

      const decoded = Buffer.from(base64, 'base64').toString('utf8');
      return JSON.parse(decoded) as T;
    } catch {
      return undefined;
    }
  }

  /**
   * Constant-time string comparison (prevent timing attacks)
   */
  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    try {
      const bufferA = Buffer.from(a);
      const bufferB = Buffer.from(b);
      return timingSafeEqual(bufferA, bufferB);
    } catch {
      return false;
    }
  }

  /**
   * Parse expiry string or number to seconds
   */
  private parseExpiry(expiry: ExpiryString | number): number {
    if (typeof expiry === 'number') {
      return expiry;
    }

    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 3600; // default 1 hour
    }

    const [, num, unit] = match as [string, string, TimeUnit];
    const value = parseInt(num, 10);

    const multipliers: Record<TimeUnit, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };

    return value * multipliers[unit];
  }
}

/**
 * Create a JWT strategy instance
 */
export function createJwtStrategy(config: JwtConfig): JwtStrategy {
  return new JwtStrategy(config);
}
