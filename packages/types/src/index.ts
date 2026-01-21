/**
 * Forja Types
 *
 * Shared TypeScript types for the Forja framework.
 */

export * from './adapter';
export * from './plugin';
export * from './config';
export * from './utils';
export * from './cli';

// API types - explicit to avoid conflicts with plugin Middleware
export {
  type NextAppRequest,
  type NextPagesRequest,
  type ExpressLikeRequest,
  type GenericHttpRequest,
  type ContextBuilderOptions,
  type HttpMethod,
  type RequestContext,
  type ResponseData,
  type ResponseMeta,
  type HandlerResponse,
  type ErrorResponse,
  type HandlerFunction,
  type Middleware as ApiMiddleware, // Renamed to avoid conflict with plugin Middleware
  type PermissionCheck,
  type HandlerConfig,
  type CrudOperation,
  type CrudHandler,
  HandlerError,
  type ContextBuilder,
  type QueryExecutionResult,
  type BatchOptions,
  type BatchResult,
} from './api/handler';

export * from './api/parser';
export * from './api/serializer';

// Core schema types - exclude LifecycleHooks (defined in plugin.ts)
export {
  // Reserved fields
  RESERVED_FIELDS,
  type ReservedFieldName,
  type ForjaEntry,
  // Field types
  type FieldType,
  type StringField,
  type NumberField,
  type BooleanField,
  type DateField,
  type JsonField,
  type EnumField,
  type ArrayField,
  type RelationKind,
  type RelationField,
  type RelationInput,
  type FileField,
  type FieldDefinition,
  // Index
  type IndexDefinition,
  // Schema
  type SchemaDefinition,
  type InferFieldType,
  type InferSchemaType,
  type TypedSchema,
  defineSchema,
  // Registry
  type SchemaRegistry,
  // Metadata & Validation
  type FieldMetadata,
  getFieldMetadata,
  type SchemaDefinitionValidationResult,
  type SchemaValidationError,
  validateSchemaDefinition,
} from './core/schema';

// Permission types
export * from './core/permission';
