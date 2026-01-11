/**
 * Authentication Plugin Types
 *
 * Type definitions for the authentication plugin including JWT, Session, and RBAC.
 */

import { AuthError } from "forja-types/plugin";
import { Result } from "forja-types/utils";

/**
 * JWT algorithm types
 */
export type JwtAlgorithm = 'HS256' | 'HS512';

/**
 * Time unit for expiration
 */
export type TimeUnit = 's' | 'm' | 'h' | 'd';

/**
 * Expiry string format (e.g., "1h", "7d", "30m")
 */
export type ExpiryString = `${number}${TimeUnit}`;

/**
 * JWT configuration
 */
export interface JwtConfig {
  readonly secret: string;
  readonly expiresIn?: ExpiryString | number; // String like "1h" or seconds as number
  readonly algorithm?: JwtAlgorithm;
  readonly issuer?: string;
  readonly audience?: string;
}

/**
 * JWT payload (base)
 */
export interface JwtPayload {
  readonly userId: string;
  readonly role: string;
  readonly iat: number;
  readonly exp: number;
  readonly iss?: string;
  readonly aud?: string;
  readonly [key: string]: unknown;
}

/**
 * JWT token parts
 */
export interface JwtToken {
  readonly header: JwtHeader;
  readonly payload: JwtPayload;
  readonly signature: string;
}

/**
 * JWT header
 */
export interface JwtHeader {
  readonly alg: JwtAlgorithm;
  readonly typ: 'JWT';
}

/**
 * Session storage type
 */
export type SessionStoreType = 'memory' | 'redis' | 'database';

/**
 * Session configuration
 */
export interface SessionConfig {
  readonly store?: SessionStoreType;
  readonly maxAge?: number; // seconds
  readonly checkPeriod?: number; // cleanup interval in seconds
  readonly prefix?: string; // session key prefix
}

/**
 * Session data
 */
export interface SessionData {
  readonly id: string;
  readonly userId: string;
  readonly role: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly lastAccessedAt: Date;
  readonly [key: string]: unknown;
}

/**
 * Session store interface
 */
export interface SessionStore {
  readonly name: SessionStoreType;

  get(sessionId: string): Promise<Result<SessionData | undefined, AuthError>>;
  set(
    sessionId: string,
    data: SessionData
  ): Promise<Result<void, AuthError>>;
  delete(sessionId: string): Promise<Result<void, AuthError>>;
  cleanup(): Promise<Result<number, AuthError>>; // Returns number of deleted sessions
  clear(): Promise<Result<void, AuthError>>;
}

/**
 * RBAC permission action types
 */
export type PermissionAction = 'create' | 'read' | 'update' | 'delete';

/**
 * Permission definition
 */
export interface Permission {
  readonly resource: string;
  readonly action: PermissionAction;
}

/**
 * Role definition
 */
export interface Role {
  readonly name: string;
  readonly permissions: readonly Permission[];
  readonly inherits?: readonly string[]; // Role names to inherit from
}

/**
 * RBAC configuration
 */
export interface RbacConfig {
  readonly roles?: readonly Role[];
  readonly defaultRole?: string;
}

/**
 * Auth plugin options
 */
export interface AuthPluginOptions {
  readonly jwt?: JwtConfig;
  readonly session?: SessionConfig;
  readonly rbac?: RbacConfig;
  readonly passwordHashIterations?: number; // PBKDF2 iterations (default: 100000)
  readonly passwordHashKeyLength?: number; // PBKDF2 key length (default: 64)
}

/**
 * Authenticated user
 */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly [key: string]: unknown;
}

/**
 * Login credentials
 */
export interface LoginCredentials {
  readonly email: string;
  readonly password: string;
}

/**
 * Login result
 */
export interface LoginResult {
  readonly user: AuthUser;
  readonly token?: string; // JWT token if JWT is enabled
  readonly sessionId?: string; // Session ID if session is enabled
}

/**
 * Password hash result
 */
export interface PasswordHash {
  readonly hash: string;
  readonly salt: string;
}

/**
 * Auth context (attached to request)
 */
export interface AuthContext {
  readonly user: AuthUser | undefined;
  readonly sessionId?: string;
  readonly token?: string;
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

/**
 * Type guard for JWT payload
 */
export function isJwtPayload(value: unknown): value is JwtPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    'userId' in obj &&
    'role' in obj &&
    'iat' in obj &&
    'exp' in obj &&
    typeof obj['userId'] === 'string' &&
    typeof obj['role'] === 'string' &&
    typeof obj['iat'] === 'number' &&
    typeof obj['exp'] === 'number'
  );
}

/**
 * Type guard for session data
 */
export function isSessionData(value: unknown): value is SessionData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    'id' in obj &&
    'userId' in obj &&
    'role' in obj &&
    'createdAt' in obj &&
    'expiresAt' in obj &&
    'lastAccessedAt' in obj &&
    typeof obj['id'] === 'string' &&
    typeof obj['userId'] === 'string' &&
    typeof obj['role'] === 'string' &&
    obj['createdAt'] instanceof Date &&
    obj['expiresAt'] instanceof Date &&
    obj['lastAccessedAt'] instanceof Date
  );
}

/**
 * Minimum JWT secret length (256 bits = 32 characters for HS256)
 */
const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Type guard for auth plugin options
 */
export function isAuthPluginOptions(
  value: unknown
): value is AuthPluginOptions {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const opts = value as Record<string, unknown>;

  // At least one strategy must be configured
  if (!('jwt' in opts) && !('session' in opts)) {
    return false;
  }

  // Validate JWT config if present
  if ('jwt' in opts && opts['jwt'] !== undefined) {
    if (typeof opts['jwt'] !== 'object' || opts['jwt'] === null) {
      return false;
    }
    const jwt = opts['jwt'] as Record<string, unknown>;
    if (
      !('secret' in jwt) ||
      typeof jwt['secret'] !== 'string' ||
      jwt['secret'].length < MIN_JWT_SECRET_LENGTH
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Type guard for permission
 */
export function isPermission(value: unknown): value is Permission {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    'resource' in obj &&
    'action' in obj &&
    typeof obj['resource'] === 'string' &&
    typeof obj['action'] === 'string' &&
    ['create', 'read', 'update', 'delete'].includes(obj['action'] as string)
  );
}

/**
 * Type guard for role
 */
export function isRole(value: unknown): value is Role {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    'name' in obj &&
    'permissions' in obj &&
    typeof obj['name'] === 'string' &&
    Array.isArray(obj['permissions']) &&
    (obj['permissions'] as unknown[]).every(isPermission)
  );
}
