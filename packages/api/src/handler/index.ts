/**
 * API Handler Module
 *
 * Exports unified handler with middleware pattern
 */

// Unified handler (recommended)
export { handleCrudRequest } from "./unified";

// Auth handlers
export {
	createAuthHandlers,
	createUnifiedAuthHandler,
	type AuthHandlerConfig,
} from "./auth-handler";

// Handler utilities (for extensions like api-upload)
export { jsonResponse, forjaErrorResponse } from "./utils";
export { ForjaApiError, handlerError } from "../errors/api-error";
