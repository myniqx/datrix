/**
 * Session Strategy
 *
 * Implements session management with pluggable storage backends.
 * Includes in-memory store by default.
 */

import { randomBytes } from "node:crypto";
import type { SessionConfig, SessionData } from "./types";
import {
	throwSessionCreateError,
	throwSessionNotFound,
	throwSessionExpired,
} from "./error-helper";
import { ForjaAuthError } from "forja-types/errors";

/**
 * Session Strategy
 *
 * Manages user sessions with configurable storage
 */
export class SessionStrategy {
	private readonly store: MemorySessionStore;
	private readonly maxAge: number; // in seconds
	private readonly checkPeriod: number; // cleanup interval in seconds
	private cleanupTimer: NodeJS.Timeout | undefined;

	constructor(config: SessionConfig, store?: MemorySessionStore) {
		this.maxAge = config.maxAge ?? 86400; // default 24 hours
		this.checkPeriod = config.checkPeriod ?? 3600; // default 1 hour
		this.store = store ?? new MemorySessionStore(config.prefix);
	}

	/**
	 * Create a new session
	 */
	async create(
		userId: number,
		role: string,
		data?: Record<string, unknown>,
	): Promise<SessionData> {
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

			await this.store.set(sessionId, sessionData);

			return sessionData;
		} catch (error) {
			if (error instanceof Error && error.name === "ForjaAuthError") {
				throw error;
			}
			throwSessionCreateError(error instanceof Error ? error : undefined);
		}
	}

	/**
	 * Get session by ID
	 */
	async get(sessionId: string): Promise<SessionData> {
		const session = await this.store.get(sessionId);

		if (session === undefined) {
			throwSessionNotFound(sessionId);
		}

		// Check if session expired
		const now = new Date();
		if (session.expiresAt < now) {
			// Delete expired session
			await this.store.delete(sessionId);
			throwSessionExpired(sessionId);
		}

		// Update last accessed time
		const updatedSession: SessionData = {
			...session,
			lastAccessedAt: now,
		};

		await this.store.set(sessionId, updatedSession);

		return updatedSession;
	}

	/**
	 * Update session data
	 */
	async update(
		sessionId: string,
		data: Partial<Omit<SessionData, "id" | "createdAt">>,
	): Promise<SessionData> {
		const session = await this.get(sessionId);

		const updatedSession: SessionData = {
			...session,
			...data,
			id: session.id, // Preserve ID
			createdAt: session.createdAt, // Preserve creation time
		};

		await this.store.set(sessionId, updatedSession);

		return updatedSession;
	}

	/**
	 * Delete session
	 */
	async delete(sessionId: string): Promise<void> {
		await this.store.delete(sessionId);
	}

	/**
	 * Refresh session (extend expiration)
	 */
	async refresh(sessionId: string): Promise<SessionData> {
		const now = new Date();
		const expiresAt = new Date(now.getTime() + this.maxAge * 1000);

		return this.update(sessionId, { expiresAt, lastAccessedAt: now });
	}

	/**
	 * Validate session (check if exists and not expired)
	 */
	async validate(sessionId: string): Promise<boolean> {
		try {
			await this.get(sessionId);
			return true;
		} catch {
			return false;
		}
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
	async clear(): Promise<void> {
		await this.store.clear();
	}

	/**
	 * Generate secure session ID
	 */
	private generateSessionId(): string {
		return randomBytes(32).toString("hex");
	}
}

/**
 * In-Memory Session Store
 *
 * Default session store implementation using Map
 */
export class MemorySessionStore {
	readonly name = "memory" as const;
	private readonly sessions: Map<string, SessionData> = new Map();
	private readonly prefix: string;

	constructor(prefix = "sess:") {
		this.prefix = prefix;
	}

	async get(
		sessionId: string,
	): Promise<SessionData | undefined> {
		try {
			const key = this.getKey(sessionId);
			const session = this.sessions.get(key);

			return session;
		} catch (error) {
			throw new ForjaAuthError("Failed to get session from store", {
				code: "SESSION_CREATE_ERROR",
				strategy: "session",
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	async set(
		sessionId: string,
		data: SessionData,
	): Promise<void> {
		const key = this.getKey(sessionId);
		this.sessions.set(key, data);
	}

	async delete(sessionId: string): Promise<void> {
		const key = this.getKey(sessionId);
		this.sessions.delete(key);
	}

	async cleanup(): Promise<number> {
		const now = new Date();
		let deletedCount = 0;

		for (const [key, session] of this.sessions.entries()) {
			if (session.expiresAt < now) {
				this.sessions.delete(key);
				deletedCount++;
			}
		}

		return deletedCount;
	}

	async clear(): Promise<void> {
		this.sessions.clear();
	}

	private getKey(sessionId: string): string {
		return `${this.prefix}${sessionId}`;
	}
}
