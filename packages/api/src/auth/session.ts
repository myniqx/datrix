/**
 * Session Strategy
 *
 * Implements session management with pluggable storage backends.
 * Includes in-memory store by default.
 */

import { randomBytes } from 'node:crypto';
import type { SessionConfig, SessionData, SessionStore } from './types';
import { AuthError } from 'forja-types/plugin';
import { Result } from 'forja-types/utils';

/**
 * Session Strategy
 *
 * Manages user sessions with configurable storage
 */
export class SessionStrategy {
  private readonly store: SessionStore;
  private readonly maxAge: number; // in seconds
  private readonly checkPeriod: number; // cleanup interval in seconds
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(config: SessionConfig, store?: SessionStore) {
    this.maxAge = config.maxAge ?? 86400; // default 24 hours
    this.checkPeriod = config.checkPeriod ?? 3600; // default 1 hour
    this.store = store ?? new MemorySessionStore(config.prefix);
  }

  /**
   * Create a new session
   */
  async create(
    userId: string,
    role: string,
    data?: Record<string, unknown>
  ): Promise<Result<SessionData, AuthError>> {
    try {
      const sessionId = this.generateSessionId();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.maxAge * 1000);

      const sessionData: SessionData = {
        id: sessionId,
        userId,
        role,
        createdAt: now,
        expiresAt,
        lastAccessedAt: now,
        ...data,
      };

      const setResult = await this.store.set(sessionId, sessionData);

      if (!setResult.success) {
        return {
          success: false,
          error: setResult.error,
        };
      }

      return { success: true, data: sessionData };
    } catch (error) {
      return {
        success: false,
        error: new AuthError('Failed to create session', {
          code: 'SESSION_CREATE_ERROR',
          details: error,
        }),
      };
    }
  }

  /**
   * Get session by ID
   */
  async get(sessionId: string): Promise<Result<SessionData, AuthError>> {
    try {
      const getResult = await this.store.get(sessionId);

      if (!getResult.success) {
        return {
          success: false,
          error: getResult.error,
        };
      }

      const session = getResult.data;

      if (session === undefined) {
        return {
          success: false,
          error: new AuthError('Session not found', {
            code: 'SESSION_NOT_FOUND',
          }),
        };
      }

      // Check if session expired
      const now = new Date();
      if (session.expiresAt < now) {
        // Delete expired session
        await this.store.delete(sessionId);

        return {
          success: false,
          error: new AuthError('Session expired', {
            code: 'SESSION_EXPIRED',
          }),
        };
      }

      // Update last accessed time
      const updatedSession: SessionData = {
        ...session,
        lastAccessedAt: now,
      };

      await this.store.set(sessionId, updatedSession);

      return { success: true, data: updatedSession };
    } catch (error) {
      return {
        success: false,
        error: new AuthError('Failed to get session', {
          code: 'SESSION_GET_ERROR',
          details: error,
        }),
      };
    }
  }

  /**
   * Update session data
   */
  async update(
    sessionId: string,
    data: Partial<Omit<SessionData, 'id' | 'createdAt'>>
  ): Promise<Result<SessionData, AuthError>> {
    try {
      const getResult = await this.get(sessionId);

      if (!getResult.success) {
        return getResult;
      }

      const session = getResult.data;

      const updatedSession: SessionData = {
        ...session,
        ...data,
        id: session.id, // Preserve ID
        createdAt: session.createdAt, // Preserve creation time
      };

      const setResult = await this.store.set(sessionId, updatedSession);

      if (!setResult.success) {
        return {
          success: false,
          error: setResult.error,
        };
      }

      return { success: true, data: updatedSession };
    } catch (error) {
      return {
        success: false,
        error: new AuthError('Failed to update session', {
          code: 'SESSION_UPDATE_ERROR',
          details: error,
        }),
      };
    }
  }

  /**
   * Delete session
   */
  async delete(sessionId: string): Promise<Result<void, AuthError>> {
    return this.store.delete(sessionId);
  }

  /**
   * Refresh session (extend expiration)
   */
  async refresh(sessionId: string): Promise<Result<SessionData, AuthError>> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.maxAge * 1000);

    return this.update(sessionId, { expiresAt, lastAccessedAt: now });
  }

  /**
   * Validate session (check if exists and not expired)
   */
  async validate(sessionId: string): Promise<Result<boolean, AuthError>> {
    const getResult = await this.get(sessionId);
    return {
      success: true,
      data: getResult.success,
    };
  }

  /**
   * Start cleanup timer
   */
  startCleanup(): void {
    if (this.cleanupTimer !== undefined) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      void this.store.cleanup();
    }, this.checkPeriod * 1000);

    // Don't prevent Node.js from exiting
    this.cleanupTimer.unref();
  }

  /**
   * Stop cleanup timer
   */
  stopCleanup(): void {
    if (this.cleanupTimer !== undefined) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Clear all sessions
   */
  async clear(): Promise<Result<void, AuthError>> {
    return this.store.clear();
  }

  /**
   * Generate secure session ID
   */
  private generateSessionId(): string {
    return randomBytes(32).toString('hex');
  }
}

/**
 * In-Memory Session Store
 *
 * Default session store implementation using Map
 */
export class MemorySessionStore implements SessionStore {
  readonly name = 'memory' as const;
  private readonly sessions: Map<string, SessionData> = new Map();
  private readonly prefix: string;

  constructor(prefix = 'sess:') {
    this.prefix = prefix;
  }

  async get(
    sessionId: string
  ): Promise<Result<SessionData | undefined, AuthError>> {
    try {
      const key = this.getKey(sessionId);
      const session = this.sessions.get(key);

      return { success: true, data: session };
    } catch (error) {
      return {
        success: false,
        error: new AuthError('Failed to get session from store', {
          code: 'SESSION_STORE_ERROR',
          details: error,
        }),
      };
    }
  }

  async set(
    sessionId: string,
    data: SessionData
  ): Promise<Result<void, AuthError>> {
    try {
      const key = this.getKey(sessionId);
      this.sessions.set(key, data);

      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: new AuthError('Failed to set session in store', {
          code: 'SESSION_STORE_ERROR',
          details: error,
        }),
      };
    }
  }

  async delete(sessionId: string): Promise<Result<void, AuthError>> {
    try {
      const key = this.getKey(sessionId);
      this.sessions.delete(key);

      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: new AuthError('Failed to delete session from store', {
          code: 'SESSION_STORE_ERROR',
          details: error,
        }),
      };
    }
  }

  async cleanup(): Promise<Result<number, AuthError>> {
    try {
      const now = new Date();
      let deletedCount = 0;

      for (const [key, session] of this.sessions.entries()) {
        if (session.expiresAt < now) {
          this.sessions.delete(key);
          deletedCount++;
        }
      }

      return { success: true, data: deletedCount };
    } catch (error) {
      return {
        success: false,
        error: new AuthError('Failed to cleanup sessions', {
          code: 'SESSION_CLEANUP_ERROR',
          details: error,
        }),
      };
    }
  }

  async clear(): Promise<Result<void, AuthError>> {
    try {
      this.sessions.clear();
      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: new AuthError('Failed to clear sessions', {
          code: 'SESSION_STORE_ERROR',
          details: error,
        }),
      };
    }
  }

  private getKey(sessionId: string): string {
    return `${this.prefix}${sessionId}`;
  }
}

/**
 * Create a session strategy instance
 */
export function createSessionStrategy(
  config: SessionConfig,
  store?: SessionStore
): SessionStrategy {
  return new SessionStrategy(config, store);
}
