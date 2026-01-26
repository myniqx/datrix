/**
 * Parser Type Definitions
 *
 * Types for parsing Strapi-style query strings into QueryObject format.
 * Supports: populate, fields, where, pagination, sorting
 */

import { ForjaEntry, ForjaRecord } from "forja-types/core/schema";
import {
  OrderByItem,
  PopulateClause,
  QueryObject,
  SelectClause,
  WhereClause,
} from "../core/query-builder";
import { ParserError } from "../errors/api/parser";
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

export interface ParsedQuery<T extends ForjaEntry = ForjaRecord> {
  readonly select?: QueryObject<T>["select"];
  readonly where?: QueryObject<T>["where"];
  readonly populate?: QueryObject<T>["populate"];
  readonly orderBy?: QueryObject<T>["orderBy"];
  readonly limit?: QueryObject<T>["limit"];
  readonly offset?: QueryObject<T>["offset"];
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

// Re-export parser error types from errors module
export type {
  ParserType,
  ParserErrorCode,
  ParserErrorContext,
  WhereErrorContext,
  PopulateErrorContext,
  FieldsErrorContext,
  PaginationErrorContext,
  SortErrorContext,
  BaseErrorContext,
  ErrorLocation,
  ParserErrorOptions,
  SerializedParserError,
} from "../errors/api/parser";

export { ParserError, buildErrorLocation } from "../errors/api/parser";

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
