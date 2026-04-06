/**
 * API Configuration Defaults
 */

export const DEFAULT_API_CONFIG = {
	enabled: true,
	prefix: "/api",
	defaultPageSize: 25,
	maxPageSize: 100,
	maxPopulateDepth: 5,
	autoRoutes: true,
	excludeSchemas: [],
} as const;

/**
 * Default API Auth configuration values
 */
export const DEFAULT_API_AUTH_CONFIG = {
	enabled: true,
	userSchema: {
		name: "user",
		email: "email",
	},
	jwt: {
		expiresIn: "7d",
		algorithm: "HS256" as const,
	},
	session: {
		store: "memory" as const,
		maxAge: 86400,
		checkPeriod: 3600,
		prefix: "datrix:session:",
	},
	password: {
		iterations: 100000,
		keyLength: 64,
		minLength: 8,
	},
	endpoints: {
		login: "/auth/login",
		register: "/auth/register",
		logout: "/auth/logout",
		me: "/auth/me",
		disableRegister: false,
	},
} as const;
