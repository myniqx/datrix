/**
 * User Schema
 *
 * Defines the User model with authentication, validation, and lifecycle hooks.
 * Type inference is automatic - no manual type definitions needed.
 */

import { defineSchema } from 'forja';
import type { InferSchemaType } from 'forja';
import { hash, compare } from 'crypto'; // For password hashing

/**
 * User Schema Definition
 *
 * This schema demonstrates:
 * - Field validation (email pattern, password strength)
 * - Unique constraints
 * - Enum types with literal inference
 * - Relations (hasMany posts)
 * - Lifecycle hooks (password hashing, data sanitization)
 * - Automatic timestamps
 */
export const userSchema = defineSchema({
  /**
   * Schema name (used for table name and API routes)
   */
  name: 'User',

  /**
   * Custom table name (optional)
   * If not specified, defaults to pluralized lowercase: 'users'
   */
  tableName: 'users',

  /**
   * Field definitions
   */
  fields: {
    /**
     * Email - unique identifier
     */
    email: {
      type: 'string',
      required: true,
      unique: true,
      maxLength: 255,
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      errorMessage: 'Invalid email format',
    },

    /**
     * Password - hashed with PBKDF2
     * Never returned in API responses (removed in afterFind hook)
     */
    password: {
      type: 'string',
      required: true,
      minLength: 8,
      maxLength: 128,
      validator: (value: string): true | string => {
        // Password strength validation
        if (!/[A-Z]/.test(value)) {
          return 'Password must contain at least one uppercase letter';
        }
        if (!/[a-z]/.test(value)) {
          return 'Password must contain at least one lowercase letter';
        }
        if (!/[0-9]/.test(value)) {
          return 'Password must contain at least one number';
        }
        if (!/[!@#$%^&*(),.?":{}|<>]/.test(value)) {
          return 'Password must contain at least one special character';
        }
        return true;
      },
      errorMessage: 'Password does not meet security requirements',
    },

    /**
     * Name - user's display name
     */
    name: {
      type: 'string',
      required: true,
      minLength: 2,
      maxLength: 100,
    },

    /**
     * Role - user's role for RBAC
     * Enum type with automatic literal type inference
     */
    role: {
      type: 'enum',
      values: ['user', 'moderator', 'admin'] as const,
      required: true,
      default: 'user',
    },

    /**
     * Bio - optional user biography
     */
    bio: {
      type: 'string',
      required: false,
      maxLength: 500,
    },

    /**
     * Avatar - profile picture URL
     */
    avatar: {
      type: 'file',
      required: false,
      allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
      maxSize: 2 * 1024 * 1024, // 2MB
    },

    /**
     * Email Verified - whether email is verified
     */
    emailVerified: {
      type: 'boolean',
      required: true,
      default: false,
    },

    /**
     * Last Login - timestamp of last login
     */
    lastLogin: {
      type: 'date',
      required: false,
    },

    /**
     * Posts - relation to Post model
     * One user can have many posts
     */
    posts: {
      type: 'relation',
      model: 'Post',
      kind: 'hasMany',
      foreignKey: 'authorId',
      onDelete: 'cascade', // Delete all posts when user is deleted
    },
  },

  /**
   * Indexes for performance
   */
  indexes: [
    // Unique index on email (enforced by unique: true above)
    { fields: ['email'], unique: true },

    // Index for querying by role
    { fields: ['role'] },

    // Composite index for common queries
    { fields: ['role', 'emailVerified'] },

    // Index for sorting by creation date
    { fields: ['createdAt'] },
  ],

  /**
   * Lifecycle Hooks
   *
   * Execute custom logic at different stages of record lifecycle
   */
  hooks: {
    /**
     * Before Create Hook
     *
     * Hash password before storing in database
     */
    beforeCreate: async (data) => {
      // Hash password if provided
      if (data.password && typeof data.password === 'string') {
        const hashedPassword = await hashPassword(data.password);
        return {
          ...data,
          password: hashedPassword,
        };
      }

      return data;
    },

    /**
     * After Create Hook
     *
     * Remove password from response
     */
    afterCreate: async (user) => {
      return removePassword(user);
    },

    /**
     * Before Update Hook
     *
     * Hash password if it's being updated
     */
    beforeUpdate: async (data) => {
      // Only hash if password is being updated
      if (data.password && typeof data.password === 'string') {
        const hashedPassword = await hashPassword(data.password);
        return {
          ...data,
          password: hashedPassword,
        };
      }

      return data;
    },

    /**
     * After Update Hook
     *
     * Remove password from response
     */
    afterUpdate: async (user) => {
      return removePassword(user);
    },

    /**
     * After Find Hook
     *
     * Remove password from all query results
     */
    afterFind: async (results) => {
      if (Array.isArray(results)) {
        return results.map(removePassword);
      }
      return removePassword(results);
    },
  },

  /**
   * Enable automatic timestamps
   * Adds: createdAt, updatedAt fields
   */
  timestamps: true,

  /**
   * Disable soft delete for users
   * When deleted, users are permanently removed
   */
  softDelete: false,
} as const);

/**
 * Infer TypeScript type from schema
 * This type is automatically generated from the schema definition
 */
export type User = InferSchemaType<typeof userSchema>;

/**
 * User without password (for API responses)
 */
export type SafeUser = Omit<User, 'password'>;

/**
 * Helper Functions
 */

/**
 * Hash password using PBKDF2
 *
 * @param password - Plain text password
 * @returns Hashed password
 */
async function hashPassword(password: string): Promise<string> {
  const { pbkdf2 } = await import('crypto');
  const { promisify } = await import('util');
  const pbkdf2Async = promisify(pbkdf2);

  // Generate salt
  const { randomBytes } = await import('crypto');
  const salt = randomBytes(16).toString('hex');

  // Hash password
  const iterations = 100000;
  const keyLength = 64;
  const digest = 'sha512';

  const hash = await pbkdf2Async(password, salt, iterations, keyLength, digest);

  // Return salt:hash format
  return `${salt}:${hash.toString('hex')}`;
}

/**
 * Verify password against hash
 *
 * @param password - Plain text password
 * @param hashedPassword - Stored hash (salt:hash format)
 * @returns True if password matches
 */
export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  const { pbkdf2 } = await import('crypto');
  const { promisify } = await import('util');
  const pbkdf2Async = promisify(pbkdf2);

  // Extract salt and hash
  const [salt, storedHash] = hashedPassword.split(':');

  if (!salt || !storedHash) {
    return false;
  }

  // Hash provided password with same salt
  const iterations = 100000;
  const keyLength = 64;
  const digest = 'sha512';

  const hash = await pbkdf2Async(password, salt, iterations, keyLength, digest);

  // Compare hashes (constant-time comparison)
  return hash.toString('hex') === storedHash;
}

/**
 * Remove password from user object
 *
 * @param user - User object
 * @returns User object without password
 */
function removePassword<T extends Record<string, unknown>>(user: T): Omit<T, 'password'> {
  const { password, ...safeUser } = user;
  return safeUser;
}

/**
 * Type Guards
 */

/**
 * Check if value is a valid user role
 */
export function isValidRole(value: unknown): value is User['role'] {
  return (
    typeof value === 'string' &&
    ['user', 'moderator', 'admin'].includes(value)
  );
}

/**
 * Check if value is a valid User object
 */
export function isUser(value: unknown): value is User {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj['email'] === 'string' &&
    typeof obj['name'] === 'string' &&
    isValidRole(obj['role'])
  );
}

/**
 * Example Usage:
 *
 * ```typescript
 * import { userSchema, type User } from '@/schemas/user.schema';
 *
 * // Type is inferred automatically
 * const user: User = {
 *   email: 'user@example.com',
 *   password: 'SecurePass123!',
 *   name: 'John Doe',
 *   role: 'user', // TypeScript knows valid values: 'user' | 'moderator' | 'admin'
 * };
 *
 * // Validate with type guard
 * if (isUser(userData)) {
 *   // userData is now typed as User
 *   console.log(userData.email);
 * }
 * ```
 */
