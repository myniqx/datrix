/**
 * Forja Error System
 *
 * Unified error handling across the framework.
 */

// Base error
export {
  ForjaError,
  type ForjaErrorOptions,
  type SerializedForjaError,
} from "./base";

// Parser error
export {
  ParserError,
  buildErrorLocation,
  type ParserType,
  type ParserErrorCode,
  type ParserErrorOptions,
  type ParserErrorContext,
  type WhereErrorContext,
  type PopulateErrorContext,
  type FieldsErrorContext,
  type PaginationErrorContext,
  type SortErrorContext,
  type BaseErrorContext,
  type ErrorLocation,
  type SerializedParserError,
} from "./parser";
