/**
 * Schema System
 *
 * Exports schema type definitions, registry, and type inference utilities.
 */

// Export schema registry
export { SchemaRegistry } from "./registry";

// Export shared pluralization helper (single source of truth for table names)
export { pluralize } from "./pluralize";

// Export type inference utilities
export {
	inferFieldType,
	getRequiredFields,
	getOptionalFields,
} from "./inference";

// Export id utilities (int/uuid primary key strategies)
export {
	type IdKind,
	isCanonicalUuid,
	normalizeUuid,
	normalizeIntId,
	normalizeIdValue,
	getFieldIdKind,
	getSchemaIdKind,
	generateUuidV7,
} from "./id";
