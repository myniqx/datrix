/**
 * Authentication Plugin
 *
 * Provides authentication and authorization functionality including:
 * - JWT token-based authentication
 * - Session-based authentication
 * - RBAC (Role-Based Access Control)
 * - Password hashing and verification
 */

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import type { Result } from '@utils/types';
import type { PluginContext, PluginError } from '@plugins/base/types';
import { AuthError } from '@plugins/base/types';
import { BasePlugin } from '@plugins/base/plugin';
import { JwtStrategy } from './jwt';
import { SessionStrategy } from './session';
import { RbacManager } from './rbac';
import type {
  AuthPluginOptions,
  AuthUser,
  LoginResult,
  PasswordHash,
  AuthContext,
  PermissionAction,
} from './types';
import { isAuthPluginOptions } from './types';

/**
 * Authentication Plugin
 *
 * Main plugin class that integrates JWT, Session, and RBAC strategies
 */
export class AuthPlugin extends BasePlugin<AuthPluginOptions> {
  readonly name = 'auth' as const;
  readonly version = '0.1.0';

  private jwtStrategy: JwtStrategy | undefined;
  private sessionStrategy: SessionStrategy | undefined;
  private rbacManager: RbacManager | undefined;

  private readonly passwordHashIterations: number;
  private readonly passwordHashKeyLength: number;

  constructor(options: AuthPluginOptions) {
    super(options);
    this.passwordHashIterations = options.passwordHashIterations ?? 100000;
    this.passwordHashKeyLength = options.passwordHashKeyLength ?? 64;
  }

  /**
   * Initialize the auth plugin
   */
  async init(context: PluginContext): Promise<Result<void, PluginError>> {
    // Validate options
    if (!isAuthPluginOptions(this.options)) {
      return {
        success: false,
        error: this.createError(
          'Invalid auth plugin options. At least JWT or Session must be configured.',
          'AUTH_INVALID_OPTIONS',
          this.options
        ),
      };
    }

    this.context = context;

    // Initialize JWT strategy if configured
    if (this.options.jwt) {
      try {
        this.jwtStrategy = new JwtStrategy(this.options.jwt);
      } catch (error) {
        return {
          success: false,
          error: this.createError(
            'Failed to initialize JWT strategy',
            'AUTH_JWT_INIT_ERROR',
            error
          ),
        };
      }
    }

    // Initialize Session strategy if configured
    if (this.options.session) {
      try {
        this.sessionStrategy = new SessionStrategy(this.options.session);
        this.sessionStrategy.startCleanup();
      } catch (error) {
        return {
          success: false,
          error: this.createError(
            'Failed to initialize Session strategy',
            'AUTH_SESSION_INIT_ERROR',
            error
          ),
        };
      }
    }

    // Initialize RBAC manager if configured
    if (this.options.rbac) {
      try {
        this.rbacManager = new RbacManager(this.options.rbac);
      } catch (error) {
        return {
          success: false,
          error: this.createError(
            'Failed to initialize RBAC manager',
            'AUTH_RBAC_INIT_ERROR',
            error
          ),
        };
      }
    }

    return { success: true, data: undefined };
  }

  /**
   * Cleanup and destroy plugin
   */
  async destroy(): Promise<Result<void, PluginError>> {
    // Stop session cleanup timer
    if (this.sessionStrategy) {
      this.sessionStrategy.stopCleanup();
    }

    // Clear sessions
    if (this.sessionStrategy) {
      await this.sessionStrategy.clear();
    }

    this.jwtStrategy = undefined;
    this.sessionStrategy = undefined;
    this.rbacManager = undefined;

    return { success: true, data: undefined };
  }

  /**
   * Hash password using PBKDF2
   */
  async hashPassword(password: string): Promise<Result<PasswordHash, AuthError>> {
    // Validate password strength
    if (!password || password.length < 8) {
      return {
        success: false,
        error: new AuthError('Password must be at least 8 characters', {
          code: 'WEAK_PASSWORD',
        }),
      };
    }

    try {
      const salt = randomBytes(32).toString('hex');

      const hash = pbkdf2Sync(
        password,
        salt,
        this.passwordHashIterations,
        this.passwordHashKeyLength,
        'sha512'
      ).toString('hex');

      return {
        success: true,
        data: { hash, salt },
      };
    } catch (error) {
      return {
        success: false,
        error: new AuthError('Failed to hash password', {
          code: 'AUTH_HASH_ERROR',
          details: error,
        }),
      };
    }
  }

  /**
   * Verify password against hash
   */
  async verifyPassword(
    password: string,
    hash: string,
    salt: string
  ): Promise<Result<boolean, AuthError>> {
    try {
      const computedHash = pbkdf2Sync(
        password,
        salt,
        this.passwordHashIterations,
        this.passwordHashKeyLength,
        'sha512'
      ).toString('hex');

      // Constant-time comparison to prevent timing attacks
      const isValid = this.constantTimeCompare(computedHash, hash);

      return { success: true, data: isValid };
    } catch (error) {
      return {
        success: false,
        error: new AuthError('Failed to verify password', {
          code: 'AUTH_VERIFY_ERROR',
          details: error,
        }),
      };
    }
  }

  /**
   * Login user and create session/token
   */
  async login(
    user: AuthUser,
    createToken = true,
    createSession = true
  ): Promise<Result<LoginResult, AuthError>> {
    let token: string | undefined = undefined;
    let sessionId: string | undefined = undefined;

    // Create JWT token if enabled and requested
    if (this.jwtStrategy && createToken) {
      const tokenResult = await this.jwtStrategy.sign({
        userId: user.id,
        role: user.role,
      });

      if (!tokenResult.success) {
        return {
          success: false,
          error: tokenResult.error,
        };
      }

      token = tokenResult.data;
    }

    // Create session if enabled and requested
    if (this.sessionStrategy && createSession) {
      const sessionResult = await this.sessionStrategy.create(
        user.id,
        user.role
      );

      if (!sessionResult.success) {
        return {
          success: false,
          error: sessionResult.error,
        };
      }

      sessionId = sessionResult.data.id;
    }

    const result: LoginResult = {
      user,
      ...(token !== undefined && { token }),
      ...(sessionId !== undefined && { sessionId }),
    };

    return { success: true, data: result };
  }

  /**
   * Logout user (destroy session)
   */
  async logout(sessionId: string): Promise<Result<void, AuthError>> {
    if (!this.sessionStrategy) {
      return {
        success: false,
        error: new AuthError('Session strategy not configured', {
          code: 'AUTH_SESSION_NOT_CONFIGURED',
        }),
      };
    }

    return this.sessionStrategy.delete(sessionId);
  }

  /**
   * Verify JWT token
   */
  async verifyToken(token: string): Promise<Result<AuthContext, AuthError>> {
    if (!this.jwtStrategy) {
      return {
        success: false,
        error: new AuthError('JWT strategy not configured', {
          code: 'AUTH_JWT_NOT_CONFIGURED',
        }),
      };
    }

    const verifyResult = await this.jwtStrategy.verify(token);

    if (!verifyResult.success) {
      return {
        success: false,
        error: verifyResult.error,
      };
    }

    const payload = verifyResult.data;

    return {
      success: true,
      data: {
        user: {
          id: payload.userId,
          email: '', // Email not stored in JWT
          role: payload.role,
        },
        token,
      },
    };
  }

  /**
   * Verify session
   */
  async verifySession(sessionId: string): Promise<Result<AuthContext, AuthError>> {
    if (!this.sessionStrategy) {
      return {
        success: false,
        error: new AuthError('Session strategy not configured', {
          code: 'AUTH_SESSION_NOT_CONFIGURED',
        }),
      };
    }

    const sessionResult = await this.sessionStrategy.get(sessionId);

    if (!sessionResult.success) {
      return {
        success: false,
        error: sessionResult.error,
      };
    }

    const session = sessionResult.data;

    return {
      success: true,
      data: {
        user: {
          id: session.userId,
          email: '', // Email not stored in session
          role: session.role,
        },
        sessionId,
      },
    };
  }

  /**
   * Check if user has permission
   */
  checkPermission(
    userRole: string | readonly string[],
    resource: string,
    action: PermissionAction
  ): Result<boolean, AuthError> {
    if (!this.rbacManager) {
      return {
        success: false,
        error: new AuthError('RBAC not configured', {
          code: 'AUTH_RBAC_NOT_CONFIGURED',
        }),
      };
    }

    const roles = Array.isArray(userRole) ? userRole : [userRole];
    const result = this.rbacManager.checkPermission(roles, resource, action);

    return { success: true, data: result.allowed };
  }

  /**
   * Get JWT strategy (for advanced usage)
   */
  getJwtStrategy(): JwtStrategy | undefined {
    return this.jwtStrategy;
  }

  /**
   * Get session strategy (for advanced usage)
   */
  getSessionStrategy(): SessionStrategy | undefined {
    return this.sessionStrategy;
  }

  /**
   * Get RBAC manager (for advanced usage)
   */
  getRbacManager(): RbacManager | undefined {
    return this.rbacManager;
  }

  /**
   * Constant-time string comparison (prevent timing attacks)
   */
  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= (a.charCodeAt(i) as number) ^ (b.charCodeAt(i) as number);
    }

    return result === 0;
  }
}

/**
 * Create an auth plugin instance
 */
export function createAuthPlugin(options: AuthPluginOptions): AuthPlugin {
  return new AuthPlugin(options);
}

/**
 * Export types and utilities
 */
export type {
  AuthPluginOptions,
  AuthUser,
  LoginCredentials,
  LoginResult,
  PasswordHash,
  AuthContext,
  JwtPayload,
  SessionData,
  SessionStore,
  Permission,
  Role,
  PermissionAction,
} from './types';

export { JwtStrategy, createJwtStrategy } from './jwt';
export {
  SessionStrategy,
  MemorySessionStore,
  createSessionStrategy,
} from './session';
export { RbacManager, PredefinedRoles, createRbacManager } from './rbac';
export type {
  JwtConfig,
  SessionConfig,
  RbacConfig,
  PermissionCheckResult,
} from './types';
