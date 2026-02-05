/**
 * Serializer Type Definitions
 *
 * Types for serializing database results to JSON responses.
 * Handles relations, field selection, and response formatting.
 */

import { PopulateClause, SelectClause } from "../core/query-builder";
import { FieldDefinition, SchemaDefinition } from "../core/schema";
import { Result } from "../utils";

/**
 * Serialization options
 */
export interface SerializerOptions {
	readonly schema: SchemaDefinition;
	readonly select?: SelectClause;
	readonly populate?: PopulateClause;
	readonly includeTimestamps?: boolean; // Include createdAt, updatedAt
	readonly includeMeta?: boolean; // Include metadata
}

/**
 * Serialized data (single record)
 */
export type SerializedData<T = Record<string, unknown>> = T;

/**
 * Serialized collection (multiple records)
 */
export interface SerializedCollection<T = Record<string, unknown>> {
	readonly data: readonly T[];
	readonly meta?: SerializationMeta;
}

/**
 * Serialization metadata
 */
export interface SerializationMeta {
	readonly pagination?: {
		readonly page: number;
		readonly pageSize: number;
		readonly total: number;
		readonly pageCount: number;
	};
	readonly [key: string]: unknown;
}

/**
 * Serializer function type
 */
export type Serializer<T = Record<string, unknown>> = (
	data: unknown,
	options: SerializerOptions,
) => Result<SerializedData<T>, SerializerError>;

/**
 * Collection serializer function type
 */
export type CollectionSerializer<T = Record<string, unknown>> = (
	data: readonly unknown[],
	options: SerializerOptions,
	meta?: SerializationMeta,
) => Result<SerializedCollection<T>, SerializerError>;

/**
 * Serializer error
 */
export class SerializerError extends Error {
	readonly code: SerializerErrorCode;
	readonly field: string | undefined;
	readonly details: unknown | undefined;

	constructor(
		message: string,
		options?: {
			code?: SerializerErrorCode;
			field?: string;
			details?: unknown;
		},
	) {
		super(message);
		this.name = "SerializerError";
		this.code = options?.code ?? "UNKNOWN";
		this.field = options?.field;
		this.details = options?.details;
	}
}

/**
 * Serializer error codes
 */
export type SerializerErrorCode =
	| "INVALID_DATA"
	| "MISSING_SCHEMA"
	| "MISSING_FIELD"
	| "INVALID_RELATION"
	| "CIRCULAR_REFERENCE"
	| "UNKNOWN";

/**
 * Relation data (populated relation)
 */
export interface RelationData {
	readonly id: string;
	readonly [key: string]: unknown;
}

/**
 * Relation serialization context
 */
export interface RelationContext {
	readonly parentSchema: SchemaDefinition;
	readonly relationField: FieldDefinition;
	readonly relationName: string;
	readonly depth: number;
	readonly maxDepth: number;
	readonly visited: ReadonlySet<string>; // For circular reference detection
}

/**
 * Relation serializer options
 */
export interface RelationSerializerOptions {
	readonly schema: SchemaDefinition;
	readonly populate: PopulateClause;
	readonly maxDepth?: number;
}

/**
 * Relation serializer result
 */
export type RelationSerializerResult = Result<
	Record<string, unknown>,
	SerializerError
>;

/**
 * Field transformer function
 */
export type FieldTransformer = (
	value: unknown,
	field: FieldDefinition,
) => unknown;

/**
 * Custom serializers map
 */
export type CustomSerializers = Record<string, FieldTransformer>;

/**
 * Serialization strategy
 */
export type SerializationStrategy = "flat" | "nested";

/**
 * JSON serialization options
 */
export interface JsonSerializationOptions extends SerializerOptions {
	readonly strategy?: SerializationStrategy;
	readonly customSerializers?: CustomSerializers;
	readonly omitNull?: boolean; // Omit null values
	readonly omitUndefined?: boolean; // Omit undefined values
	readonly dateFormat?: "iso" | "timestamp"; // Date serialization format
}
