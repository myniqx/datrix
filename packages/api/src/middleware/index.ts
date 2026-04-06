/**
 * Middleware Module
 *
 * Exports all middleware functionality
 */

export { buildRequestContext, ContextBuildError } from "./context";
export { authenticate } from "./auth";
export {
	methodToAction,
	evaluatePermissionValue,
	checkSchemaPermission,
	checkFieldsForWrite,
	filterFieldsForRead,
	filterRecordsForRead,
} from "./permission";

export type {
	RequestContext,
	HttpMethod,
	ContextBuilderOptions,
} from "./types";

// Re-export permission types
export type { PermissionAction } from "@forja/core/types/core/permission";
