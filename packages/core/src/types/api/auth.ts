import { DatrixEntry } from "../core/schema";

export interface AuthenticatedUser<
	TRoles extends string = string,
	TUser extends DatrixEntry = DatrixEntry,
> extends DatrixEntry {
	user: TUser;
	email: string;
	password: string;
	passwordSalt: string;
	role: TRoles;
	resetToken?: string;
	resetTokenExpiry?: Date;
}

/**
 * Minimal user shape expected by IAuthManager.
 */
export interface AuthUser {
	readonly id: number;
	readonly email: string;
	readonly role: string;
}

/**
 * Minimal auth context attached to a verified request.
 */
export interface AuthContext {
	readonly user: AuthUser | undefined;
	readonly sessionId?: string;
	readonly token?: string;
}

/**
 * Result returned after a successful login.
 */
export interface LoginResult {
	readonly user: AuthUser;
	readonly token?: string;
	readonly sessionId?: string;
}

/**
 * Public interface for AuthManager.
 * Allows consumers (plugins, CLI, tests) to depend on the contract
 * without importing the concrete class from @datrix/api.
 */
export interface IAuthManager {
	hashPassword(password: string): Promise<{ hash: string; salt: string }>;
	verifyPassword(
		password: string,
		hash: string,
		salt: string,
	): Promise<boolean>;
	login(
		user: AuthUser,
		options?: { createToken?: boolean; createSession?: boolean },
	): Promise<LoginResult>;
	logout(sessionId: string): Promise<void>;
	authenticate(request: Request): Promise<AuthContext | null>;
	destroy(): Promise<void>;
}
