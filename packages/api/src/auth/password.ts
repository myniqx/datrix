/**
 * Password Utilities
 *
 * Handles password hashing and verification using PBKDF2
 */

import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Result } from 'forja-types/utils';

/**
 * Password hash error
 */
export class PasswordError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = 'PasswordError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Password hash result
 */
export interface PasswordHash {
  readonly hash: string;
  readonly salt: string;
}

/**
 * Password configuration
 */
export interface PasswordConfig {
  readonly iterations?: number; // PBKDF2 iterations (default: 100000)
  readonly keyLength?: number; // PBKDF2 key length (default: 64)
  readonly minLength?: number; // Minimum password length (default: 8)
}

/**
 * Default password configuration
 */
const DEFAULT_CONFIG: Required<PasswordConfig> = {
  iterations: 100000,
  keyLength: 64,
  minLength: 8,
};

/**
 * Password Manager
 *
 * Manages password hashing and verification
 */
export class PasswordManager {
  private readonly iterations: number;
  private readonly keyLength: number;
  private readonly minLength: number;

  constructor(config: PasswordConfig = {}) {
    this.iterations = config.iterations ?? DEFAULT_CONFIG.iterations;
    this.keyLength = config.keyLength ?? DEFAULT_CONFIG.keyLength;
    this.minLength = config.minLength ?? DEFAULT_CONFIG.minLength;
  }

  /**
   * Hash password using PBKDF2
   */
  async hash(password: string): Promise<Result<PasswordHash, PasswordError>> {
    // Validate password strength
    if (!password || password.length < this.minLength) {
      return {
        success: false,
        error: new PasswordError(
          `Password must be at least ${this.minLength} characters`,
          'WEAK_PASSWORD',
          { minLength: this.minLength, actualLength: password?.length ?? 0 }
        ),
      };
    }

    try {
      const salt = randomBytes(32).toString('hex');

      const hash = pbkdf2Sync(
        password,
        salt,
        this.iterations,
        this.keyLength,
        'sha512'
      ).toString('hex');

      return {
        success: true,
        data: { hash, salt },
      };
    } catch (error) {
      return {
        success: false,
        error: new PasswordError(
          'Failed to hash password',
          'HASH_ERROR',
          error
        ),
      };
    }
  }

  /**
   * Verify password against hash
   */
  async verify(
    password: string,
    hash: string,
    salt: string
  ): Promise<Result<boolean, PasswordError>> {
    try {
      const computedHash = pbkdf2Sync(
        password,
        salt,
        this.iterations,
        this.keyLength,
        'sha512'
      ).toString('hex');

      // Constant-time comparison to prevent timing attacks
      const isValid = this.constantTimeCompare(computedHash, hash);

      return { success: true, data: isValid };
    } catch (error) {
      return {
        success: false,
        error: new PasswordError(
          'Failed to verify password',
          'VERIFY_ERROR',
          error
        ),
      };
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
      const bufA = Buffer.from(a);
      const bufB = Buffer.from(b);
      return timingSafeEqual(bufA, bufB);
    } catch {
      // Fallback to manual constant-time comparison
      let result = 0;
      for (let i = 0; i < a.length; i++) {
        result |= (a.charCodeAt(i) as number) ^ (b.charCodeAt(i) as number);
      }
      return result === 0;
    }
  }
}

/**
 * Create password manager
 */
export function createPasswordManager(config?: PasswordConfig): PasswordManager {
  return new PasswordManager(config);
}
