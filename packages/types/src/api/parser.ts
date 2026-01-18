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
 * Parser error
 */
export class ParserError extends Error {
  readonly code: ParserErrorCode;
  readonly field: string | undefined;
  readonly details: unknown | undefined;

  constructor(
    message: string,
    options?: {
      code?: ParserErrorCode;
      field?: string;
      details?: unknown;
    },
  ) {
    super(message);
    this.name = "ParserError";
    this.code = options?.code ?? "UNKNOWN";
    this.field = options?.field;
    this.details = options?.details;
  }
}

/**
 * Parser error codes
 */
export type ParserErrorCode =
  | "INVALID_SYNTAX"
  | "INVALID_OPERATOR"
  | "INVALID_VALUE"
  | "MAX_DEPTH_EXCEEDED"
  | "INVALID_PAGINATION"
  | "UNKNOWN_FIELD"
  | "INVALID_FIELD"
  | "UNKNOWN";

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
