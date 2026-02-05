/**
 * Schema System
 *
 * Exports schema type definitions, registry, and type inference utilities.
 */

// Export schema registry
export { SchemaRegistry } from "./registry";

// Export type inference utilities
export {
	inferFieldType,
	getRequiredFields,
	getOptionalFields,
} from "./inference";
