/**
 * Forja API Module
 *
 * Simple HTTP handlers for REST API.
 * Connects HTTP requests to Forja core.
 */

// Export handlers
export {
  handleGet,
  handlePost,
  handlePatch,
  handlePut,
  handleDelete,
} from './handler';

// Re-export parser module
export * from './parser';

// Re-export serializer module
export * from './serializer';
