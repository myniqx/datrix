/**
 * Middleware Module
 *
 * Exports all middleware functionality
 */

export { buildRequestContext } from "./context";
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
	RequestLimits,
	HttpMethod,
	ContextBuilderOptions,
} from "./types";

// Re-export permission types
export type { PermissionAction } from "@datrix/core";
