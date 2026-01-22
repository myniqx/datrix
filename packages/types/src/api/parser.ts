/**
 * Parser Type Definitions
 *
 * Types for parsing Strapi-style query strings into QueryObject format.
 * Supports: populate, fields, where, pagination, sorting
 */

import {
  OrderByItem,
  PopulateClause,
  QueryObject,
  SelectClause,
  WhereClause,
} from "../core/query-builder";
import { Result } from "../utils";

/**
 * Raw query parameters from HTTP request
 * (framework-agnostic - works with URLSearchParams, Express req.query, etc.)
 */
export type RawQueryParams = Record<
  string,
  string | readonly string[] | undefined
>;

/**
 * Parsed query result
 */

export interface ParsedQuery {
  readonly select?: QueryObject["select"];
  readonly where?: QueryObject["where"];
  readonly populate?: QueryObject["populate"];
  readonly orderBy?: QueryObject["orderBy"];
  readonly limit?: QueryObject["limit"];
  readonly offset?: QueryObject["offset"];
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
}

/**
 * Parser options
 */
export interface ParserOptions {
  readonly maxPageSize?: number; // Default: 100
  readonly defaultPageSize?: number; // Default: 25
  readonly maxPopulateDepth?: number; // Default: 5
  readonly allowedOperators?: readonly string[]; // Default: all
  readonly strictMode?: boolean; // Fail on unknown fields
}

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
  readonly queryParam?: string;
  readonly index?: number;
  readonly depth?: number;
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
}

/**
 * Fields parser specific context
 */
export interface FieldsErrorContext extends BaseErrorContext {
  readonly fieldName?: string;
  readonly invalidFields?: readonly string[];
  readonly validationReasons?: readonly string[];
  readonly suspiciousParams?: readonly string[];
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
}

/**
 * Union of all context types
 */
export type ErrorContext =
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
  readonly context?: ErrorContext;
  readonly suggestion?: string;
  readonly received?: unknown;
  readonly expected?: string;
}

/**
 * Serialized error for API responses
 */
export interface SerializedParserError {
  readonly name: string;
  readonly message: string;
  readonly code: ParserErrorCode;
  readonly parser: ParserType;
  readonly location: ErrorLocation;
  readonly context: ErrorContext;
  readonly suggestion?: string;
  readonly received?: unknown;
  readonly expected?: string;
}

/**
 * Standardized Parser Error with rich context
 */
export class ParserError extends Error {
  readonly code: ParserErrorCode;
  readonly parser: ParserType;
  readonly location: ErrorLocation;
  readonly context: ErrorContext;
  readonly suggestion?: string;
  readonly received?: unknown;
  readonly expected?: string;

  constructor(
    message: string,
    options: ParserErrorOptions
  ) {
    super(message);
    this.name = "ParserError";
    this.code = options.code;
    this.parser = options.parser;
    this.location = options.location;
    this.context = options.context ?? {};
    this.suggestion = options.suggestion;
    this.received = options.received;
    this.expected = options.expected;
  }

  toDetailedMessage(): string {
    const parts = [
      `[${this.parser}] ${this.message}`,
      `  Location: ${this.location.path}`,
    ];

    if (this.received !== undefined) {
      parts.push(`  Received: ${JSON.stringify(this.received)}`);
    }

    if (this.expected) {
      parts.push(`  Expected: ${this.expected}`);
    }

    if (this.suggestion) {
      parts.push(`  Suggestion: ${this.suggestion}`);
    }

    return parts.join("\n");
  }

  toJSON(): SerializedParserError {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      parser: this.parser,
      location: this.location,
      context: this.context,
      suggestion: this.suggestion,
      received: this.received,
      expected: this.expected,
    };
  }
}

/**
 * Helper to build error location
 */
export function buildErrorLocation(
  parts: string[],
  options?: {
    queryParam?: string;
    index?: number;
    depth?: number;
  }
): ErrorLocation {
  return {
    path: parts.join("."),
    parts,
    queryParam: options?.queryParam,
    index: options?.index,
    depth: options?.depth,
  };
}

/**
 * Field parser result
 */
export type FieldsParserResult = Result<SelectClause, ParserError>;

/**
 * Where parser result
 */
export type WhereParserResult = Result<WhereClause | undefined, ParserError>;

/**
 * Populate parser result
 */
export type PopulateParserResult = Result<
  PopulateClause | undefined,
  ParserError
>;

/**
 * Query parser result
 */
export type QueryParserResult = Result<ParsedQuery, ParserError>;

/**
 * Supported WHERE operators
 */
export const WHERE_OPERATORS = [
  "$eq",
  "$ne",
  "$lt",
  "$lte",
  "$gt",
  "$gte",
  "$in",
  "$nin",
  "$contains",
  "$notContains",
  "$startsWith",
  "$endsWith",
  "$null",
  "$notNull",
  "$like",
  "$ilike",
  "$and",
  "$or",
  "$not",
] as const;

/**
 * WHERE operator type
 */
export type WhereOperator = (typeof WHERE_OPERATORS)[number];

/**
 * Check if string is a valid operator
 */
export function isWhereOperator(value: string): value is WhereOperator {
  return WHERE_OPERATORS.includes(value as WhereOperator);
}

/**
 * Pagination parameters
 */
export interface PaginationParams {
  readonly page?: number;
  readonly pageSize?: number;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Parse pagination result
 */
export interface ParsedPagination {
  readonly limit: number;
  readonly offset: number;
}

/**
 * Sort parameters
 */
export type SortParam = string | readonly string[];

/**
 * Parse sort result
 */
export type ParsedSort = readonly OrderByItem[];
