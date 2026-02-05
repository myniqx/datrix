/**
 * API Handler Module
 *
 * Exports unified handler with middleware pattern
 */

// Unified handler (recommended)
export { handleRequest } from "./unified";

// Auth handlers
export {
	createAuthHandlers,
	createUnifiedAuthHandler,
	type AuthHandlerConfig,
} from "./auth-handler";
