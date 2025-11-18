/**
 * API Serializer Module
 *
 * Exports response serializers for converting database results to API responses.
 */

// Export serializer types
export type {
  SerializerOptions,
  SerializerError,
  RelationSerializerResult,
} from './types';

// Export JSON serializer
export { serializeRecord, serializeCollection } from './json';

// Export relation serializer
export { serializeRelations } from './relations';
