/**
 * Forja Types
 *
 * Shared TypeScript types for the Forja framework.
 */

export * from "./adapter";
export * from "./plugin";
export * from "./config";
export * from "./utils";
export * from "./cli";

// API types - explicit to avoid conflicts with plugin Middleware
export {
	type NextAppRequest,
	type NextPagesRequest,
	type ExpressLikeRequest,
	type GenericHttpRequest,
	type ContextBuilderOptions,
	type HttpMethod,
	type RequestContext,
	type ResponseMultiData as ResponseData,
	type HandlerResponse,
} from "./api/handler";

export * from "./api/parser";
export * from "./api/serializer";

// Core schema types - exclude LifecycleHooks (defined in plugin.ts)
export {
	// Reserved fields
	RESERVED_FIELDS,
	type ReservedFieldName,
	type ForjaEntry,
	type ForjaRecord,
	// Relation types
	type Relation,
	type IsRelation,
	type UnwrapRelation,
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
	type AnyRelationInput,
	type RelationBelongsTo,
	type RelationHasOne,
	type RelationHasMany,
	type RelationManyToMany,
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
} from "./core/schema";

// Permission types
export * from "./core/permission";

// Core constants
export { FORJA_META_MODEL, FORJA_META_KEY_PREFIX } from "./core/constants";

// Query builder types
export {
	type QueryPrimitive,
	type ScalarValue,
	type QueryType,
	type ComparisonOperators,
	type LogicalOperators,
	type WhereClause,
	type SelectClause,
	type PopulateOptions,
	type PopulateClause,
	type OrderDirection,
	type OrderByItem,
	type QueryOrderBy as OrderBy,
	type QuerySelectObject,
	type QueryCountObject,
	type QueryInsertObject,
	type QueryUpdateObject,
	type QueryDeleteObject,
	type QueryObject,
	type QueryObjectForType,
} from "./core/query-builder";
