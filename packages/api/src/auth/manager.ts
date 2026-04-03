/**
 * Auth Manager
 *
 * Central authentication manager for API package.
 * Integrates password hashing, JWT, and sessions.
 * Note: Permission checking is now handled by schema-based permissions in middleware/permission.ts
 */

import { PasswordManager, type PasswordHash } from "./password";
import { JwtStrategy } from "./jwt";
import { SessionStrategy } from "./session";
import { AuthConfig } from "./types";
import { throwSessionNotConfigured } from "./error-helper";
import {
	AuthContext,
	AuthUser,
	IAuthManager,
	LoginResult,
} from "@forja/types/api/auth";

/**
 * Auth Manager
 *
 * Main authentication manager that coordinates all auth components.
 * Note: Permission checking is now schema-based (see middleware/permission.ts)
 */
export class AuthManager<
	TRole extends string = string,
> implements IAuthManager {
	private readonly passwordManager: PasswordManager;
	private readonly jwtStrategy: JwtStrategy | undefined;
	private readonly sessionStrategy: SessionStrategy | undefined;
	private readonly config: AuthConfig<TRole>;

	public get authConfig(): AuthConfig<TRole> {
		return this.config;
	}

	constructor(config: AuthConfig<TRole>) {
		this.config = config;

		// Initialize password manager
		this.passwordManager = new PasswordManager(config.password);

		// Initialize JWT strategy if configured
		if (config.jwt) {
			this.jwtStrategy = new JwtStrategy(config.jwt);
		}

		// Initialize session strategy if configured
		if (config.session) {
			this.sessionStrategy = new SessionStrategy(config.session);
			this.sessionStrategy.startCleanup();
		}
	}

	/**
	 * Hash password
	 */
	async hashPassword(password: string): Promise<PasswordHash> {
		return this.passwordManager.hash(password);
	}

	/**
	 * Verify password
	 */
	async verifyPassword(
		password: string,
		hash: string,
		salt: string,
	): Promise<boolean> {
		return this.passwordManager.verify(password, hash, salt);
	}

	/**
	 * Login user and create token/session
	 */
	async login(
		user: AuthUser,
		options: { createToken?: boolean; createSession?: boolean } = {},
	): Promise<LoginResult> {
		const { createToken = true, createSession = true } = options;

		let token: string | undefined = undefined;
		let sessionId: string | undefined = undefined;

		// Create JWT token if enabled and requested
		if (this.jwtStrategy && createToken) {
			token = this.jwtStrategy.sign({
				userId: user.id,
				role: user.role,
			});
		}

		// Create session if enabled and requested
		if (this.sessionStrategy && createSession) {
			const sessionData = await this.sessionStrategy.create(user.id, user.role);
			sessionId = sessionData.id;
		}

		const result: LoginResult = {
			user,
			...(token !== undefined && { token }),
			...(sessionId !== undefined && { sessionId }),
		};

		return result;
	}

	/**
	 * Logout user (destroy session)
	 */
	async logout(sessionId: string): Promise<void> {
		if (!this.sessionStrategy) {
			throwSessionNotConfigured();
		}

		await this.sessionStrategy.delete(sessionId);
	}

	/**
	 * Authenticate request (extract and verify token/session)
	 */
	async authenticate(request: Request): Promise<AuthContext | null> {
		// Try JWT first
		const token = this.extractToken(request);
		if (token && this.jwtStrategy) {
			try {
				const payload = this.jwtStrategy.verify(token);
				return {
					user: {
						id: payload.userId,
						email: "", // Will be fetched from DB if needed
						role: payload.role,
					},
					token,
				};
			} catch {
				// JWT verification failed, continue to session
			}
		}

		// Try session
		const sessionId = this.extractSessionId(request);
		if (sessionId && this.sessionStrategy) {
			try {
				const session = await this.sessionStrategy.get(sessionId);
				return {
					user: {
						id: session.userId,
						email: "",
						role: session.role,
					},
					sessionId,
				};
			} catch {
				// Session not found or expired
			}
		}

		return null;
	}

	/**
	 * Extract JWT token from request headers
	 */
	private extractToken(request: Request): string | null {
		const authHeader = request.headers.get("authorization");
		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return null;
		}

		return authHeader.slice(7); // Remove 'Bearer ' prefix
	}

	/**
	 * Extract session ID from request cookies
	 */
	private extractSessionId(request: Request): string | null {
		const cookieHeader = request.headers.get("cookie");
		if (!cookieHeader) {
			return null;
		}

		// Parse cookies
		const cookies = cookieHeader.split(";").reduce(
			(acc, cookie) => {
				const [key, value] = cookie.trim().split("=");
				if (key && value) {
					acc[key] = value;
				}
				return acc;
			},
			{} as Record<string, string>,
		);

		return cookies["sessionId"] ?? null;
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
	 * Cleanup resources
	 */
	async destroy(): Promise<void> {
		// Stop session cleanup timer
		if (this.sessionStrategy) {
			this.sessionStrategy.stopCleanup();
		}

		// Clear sessions
		if (this.sessionStrategy) {
			await this.sessionStrategy.clear();
		}
	}
}
