/**
 * Parser Error
 *
 * Specialized error for query/URL parsing failures.
 * Extends DatrixError with parser-specific fields.
 */

import { DatrixError, type SerializedDatrixError } from "../datrix-error";

/**
 * Which parser generated the error
 */
export type ParserType =
	| "where"
	| "populate"
	| "fields"
	| "sort"
	| "pagination"
	| "query";

/**
 * Error location with full path tracking
 */
export interface ErrorLocation {
	readonly path: string;
	readonly parts: readonly string[];
	readonly queryParam?: string | undefined;
	readonly index?: number | undefined;
	readonly depth?: number | undefined;
}

/**
 * Base error context
 */
export interface BaseErrorContext {
	readonly [key: string]: unknown;
}

/**
 * Where parser specific context
 */
export interface WhereErrorContext extends BaseErrorContext {
	readonly operator?: string;
	readonly operatorPath?: string;
	readonly validOperators?: readonly string[];
	readonly arrayIndex?: number;
	readonly previousOperator?: string;
	readonly fieldValidationReason?: string;
}

/**
 * Populate parser specific context
 */
export interface PopulateErrorContext extends BaseErrorContext {
	readonly relation?: string;
	readonly relationPath?: string;
	readonly currentDepth?: number;
	readonly maxDepth?: number;
	readonly nestedRelations?: readonly string[];
	readonly fieldValidationReason?: string;
}

/**
 * Fields parser specific context
 */
export interface FieldsErrorContext extends BaseErrorContext {
	readonly fieldName?: string;
	readonly invalidFields?: readonly string[];
	readonly validationReasons?: readonly string[];
	readonly suspiciousParams?: readonly string[];
	readonly fieldValidationReason?: string;
}

/**
 * Pagination parser specific context
 */
export interface PaginationErrorContext extends BaseErrorContext {
	readonly parameter?: "page" | "pageSize" | "limit" | "offset";
	readonly minValue?: number;
	readonly maxValue?: number;
}

/**
 * Sort parser specific context
 */
export interface SortErrorContext extends BaseErrorContext {
	readonly sortField?: string;
	readonly sortDirection?: string;
	readonly invalidFields?: readonly string[];
	readonly fieldValidationReason?: string;
}

/**
 * Union of all parser context types
 */
export type ParserErrorContext =
	| WhereErrorContext
	| PopulateErrorContext
	| FieldsErrorContext
	| PaginationErrorContext
	| SortErrorContext
	| BaseErrorContext;

/**
 * Comprehensive parser error codes
 */
export type ParserErrorCode =
	| "INVALID_SYNTAX"
	| "INVALID_OPERATOR"
	| "INVALID_VALUE_TYPE"
	| "INVALID_VALUE_FORMAT"
	| "INVALID_FIELD_NAME"
	| "INVALID_PATH"
	| "MAX_DEPTH_EXCEEDED"
	| "MAX_LENGTH_EXCEEDED"
	| "MAX_SIZE_EXCEEDED"
	| "MIN_VALUE_VIOLATION"
	| "MAX_VALUE_VIOLATION"
	| "MISSING_REQUIRED"
	| "EMPTY_VALUE"
	| "ARRAY_INDEX_ERROR"
	| "CONSECUTIVE_INDEX_ERROR"
	| "UNKNOWN_PARAMETER"
	| "DUPLICATE_FIELD"
	| "INVALID_PAGINATION"
	| "PAGE_OUT_OF_RANGE"
	| "PARSER_INTERNAL_ERROR";

/**
 * Options for creating ParserError
 */
export interface ParserErrorOptions {
	readonly code: ParserErrorCode;
	readonly parser: ParserType;
	readonly location: ErrorLocation;
	readonly context?: ParserErrorContext;
	readonly suggestion?: string;
	readonly received?: unknown;
	readonly expected?: string;
}

/**
 * Serialized parser error for API responses
 */
export interface SerializedParserError extends SerializedDatrixError {
	readonly parser: ParserType;
	readonly location: ErrorLocation;
}

/**
 * Parser Error Class
 *
 * Specialized DatrixError for query/URL parsing errors.
 * Includes parser-specific fields: parser type and location tracking.
 */
export class ParserError extends DatrixError<ParserErrorContext> {
	readonly parser: ParserType;
	readonly location: ErrorLocation;

	constructor(message: string, options: ParserErrorOptions) {
		super(message, {
			code: options.code,
			operation: `parse:${options.parser}`,
			context: options.context,
			suggestion: options.suggestion,
			expected: options.expected,
			received: options.received,
		});

		this.parser = options.parser;
		this.location = options.location;
	}

	/**
	 * Override toJSON to include parser-specific fields
	 */
	override toJSON(): SerializedParserError {
		return {
			...super.toJSON(),
			parser: this.parser,
			location: this.location,
		};
	}

	/**
	 * Override toDetailedMessage to include parser-specific info
	 */
	override toDetailedMessage(): string {
		const baseMessage = super.toDetailedMessage();
		const parserInfo = [
			`  Parser: ${this.parser}`,
			`  Location: ${this.location.path}`,
		];

		if (this.location.queryParam) {
			parserInfo.push(`  Query Param: ${this.location.queryParam}`);
		}

		if (this.location.index !== undefined) {
			parserInfo.push(`  Index: ${this.location.index}`);
		}

		if (this.location.depth !== undefined) {
			parserInfo.push(`  Depth: ${this.location.depth}`);
		}

		// Insert parser info after the first line
		const lines = baseMessage.split("\n");
		lines.splice(1, 0, ...parserInfo);

		return lines.join("\n");
	}
}

/**
 * Helper to build error location
 */
export function buildErrorLocation(
	parts: string[],
	options?: {
		queryParam?: string | undefined;
		index?: number | undefined;
		depth?: number | undefined;
	},
): ErrorLocation {
	return {
		path: parts.join("."),
		parts,
		queryParam: options?.queryParam,
		index: options?.index,
		depth: options?.depth,
	};
}
