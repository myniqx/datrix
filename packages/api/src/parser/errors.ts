/**
 * Parser Error Helpers
 *
 * Centralized error creation for all parsers.
 * Provides clean, type-safe error handling with rich context.
 */

import type { Result } from "forja-types/utils";
import {
  ParserError,
  buildErrorLocation,
  type WhereErrorContext,
  type PopulateErrorContext,
  type FieldsErrorContext,
  type PaginationErrorContext,
} from "forja-types/api/parser";
import {
  MAX_WHERE_VALUE_LENGTH,
  MAX_LOGICAL_NESTING_DEPTH,
} from "forja-types/core/constants";

type ErrorResult<T = never> = Result<T, ParserError>;

/**
 * Where Parser Errors
 */
export const whereError = {
  invalidOperator(
    operator: string,
    path: string[],
    context?: Partial<WhereErrorContext>,
  ): ErrorResult {
    return {
      success: false,
      error: new ParserError(`Invalid WHERE operator: ${operator}`, {
        code: "INVALID_OPERATOR",
        parser: "where",
        location: buildErrorLocation(["where", ...path], {
          queryParam: context?.operatorPath,
        }),
        received: operator,
        expected:
          "One of: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $contains, $startsWith, $endsWith, $like, $ilike, $null, $notNull, $and, $or, $not",
        suggestion: "Use a valid WHERE operator. See documentation for full list.",
        context: {
          operator,
          ...context,
        },
      }),
    };
  },

  invalidFieldName(
    fieldName: string,
    path: string[],
    context?: Partial<WhereErrorContext>,
  ): ErrorResult {
    return {
      success: false,
      error: new ParserError(`Invalid field name in WHERE clause: ${fieldName}`, {
        code: "INVALID_FIELD_NAME",
        parser: "where",
        location: buildErrorLocation(["where", ...path]),
        received: fieldName,
        expected:
          "Field name must start with letter/underscore and contain only alphanumeric characters, underscores, and dots",
        suggestion:
          "Use valid field names (e.g., 'name', 'user_id', 'profile.age')",
        context: {
          operator: fieldName,
          ...context,
        },
      }),
    };
  },

  invalidArrayIndex(
    index: string,
    operator: string,
    path: string[],
    context?: Partial<WhereErrorContext>,
  ): ErrorResult {
    return {
      success: false,
      error: new ParserError(
        `Array index [${index}] can only follow array operators ($or, $and, $not, $in, $nin), found after: ${context?.previousOperator || "unknown"}`,
        {
          code: "ARRAY_INDEX_ERROR",
          parser: "where",
          location: buildErrorLocation(["where", ...path], {
            index: parseInt(index, 10),
            queryParam: context?.operatorPath,
          }),
          received: index,
          expected: "Array index after $or, $and, $not, $in, or $nin",
          suggestion: "Array indices can only be used with array operators",
          context: {
            operator,
            arrayIndex: parseInt(index, 10),
            ...context,
          },
        },
      ),
    };
  },

  arrayIndexAtStart(index: string, _path: string[]): ErrorResult {
    return {
      success: false,
      error: new ParserError(
        "Array index cannot appear at the beginning of WHERE clause",
        {
          code: "ARRAY_INDEX_ERROR",
          parser: "where",
          location: buildErrorLocation(["where"], {
            index: parseInt(index, 10),
          }),
          received: index,
          expected: "Field name or operator before array index",
          suggestion:
            "WHERE clause must start with a field name, not an array index",
          context: {
            arrayIndex: parseInt(index, 10),
          },
        },
      ),
    };
  },

  invalidArrayIndexFormat(
    index: string,
    operator: string,
    path: string[],
  ): ErrorResult {
    return {
      success: false,
      error: new ParserError(
        `Invalid array index in ${operator}: ${index} (must be non-negative integer)`,
        {
          code: "ARRAY_INDEX_ERROR",
          parser: "where",
          location: buildErrorLocation(["where", ...path]),
          received: index,
          expected: "Non-negative integer (0, 1, 2, ...)",
          suggestion: "Use valid array indices starting from 0",
          context: {
            operator,
            arrayIndex: NaN,
          },
        },
      ),
    };
  },

  arrayIndexNotStartingFromZero(
    firstIndex: number,
    operator: string,
    path: string[],
  ): ErrorResult {
    return {
      success: false,
      error: new ParserError(
        `Array indices for ${operator} must start from 0, found: ${firstIndex}`,
        {
          code: "CONSECUTIVE_INDEX_ERROR",
          parser: "where",
          location: buildErrorLocation(["where", ...path], {
            index: firstIndex,
          }),
          received: firstIndex,
          expected: "Array indices starting from 0",
          suggestion: "Start array indices at 0: use [0], [1], [2], etc.",
          context: {
            operator,
            arrayIndex: firstIndex,
          },
        },
      ),
    };
  },

  arrayIndexNotConsecutive(
    missingIndex: number,
    operator: string,
    path: string[],
  ): ErrorResult {
    return {
      success: false,
      error: new ParserError(
        `Array indices for ${operator} must be consecutive (0,1,2...), missing index: ${missingIndex}`,
        {
          code: "CONSECUTIVE_INDEX_ERROR",
          parser: "where",
          location: buildErrorLocation(["where", ...path], {
            index: missingIndex,
          }),
          received: `Gap at index ${missingIndex}`,
          expected: "Consecutive indices: [0], [1], [2], ...",
          suggestion: `Ensure array indices have no gaps. Missing index: ${missingIndex}`,
          context: {
            operator,
            arrayIndex: missingIndex,
          },
        },
      ),
    };
  },

  maxValueLength(actualLength: number, path: string[]): ErrorResult {
    return {
      success: false,
      error: new ParserError(
        `WHERE value exceeds maximum length of ${MAX_WHERE_VALUE_LENGTH} characters`,
        {
          code: "MAX_LENGTH_EXCEEDED",
          parser: "where",
          location: buildErrorLocation(["where", ...path]),
          received: `${actualLength} characters`,
          expected: `Maximum ${MAX_WHERE_VALUE_LENGTH} characters`,
          suggestion:
            "Reduce the length of your query value or use a different approach",
          context: {
            operator: "value_length",
          },
        },
      ),
    };
  },

  maxDepthExceeded(depth: number, path: string[]): ErrorResult {
    return {
      success: false,
      error: new ParserError(
        `WHERE clause nesting depth exceeds maximum of ${MAX_LOGICAL_NESTING_DEPTH}`,
        {
          code: "MAX_DEPTH_EXCEEDED",
          parser: "where",
          location: buildErrorLocation(["where", ...path], {
            depth,
          }),
          received: depth,
          expected: `Maximum depth: ${MAX_LOGICAL_NESTING_DEPTH}`,
          suggestion: "Reduce nesting level or restructure your query",
          context: {
            operator: "nesting_depth",
          },
        },
      ),
    };
  },

  emptyLogicalOperator(operator: string, path: string[]): ErrorResult {
    return {
      success: false,
      error: new ParserError(
        `Logical operator ${operator} requires at least one condition`,
        {
          code: "EMPTY_VALUE",
          parser: "where",
          location: buildErrorLocation(["where", ...path]),
          received: "empty array",
          expected: "At least one condition",
          suggestion: `Add at least one condition to ${operator} operator`,
          context: {
            operator,
          },
        },
      ),
    };
  },

  emptyArrayOperator(operator: string, path: string[]): ErrorResult {
    return {
      success: false,
      error: new ParserError(`Operator ${operator} requires a non-empty array`, {
        code: "EMPTY_VALUE",
        parser: "where",
        location: buildErrorLocation(["where", ...path]),
        received: "empty array",
        expected: "Non-empty array",
        suggestion: `Provide at least one value for ${operator} operator`,
        context: {
          operator,
        },
      }),
    };
  },

  invalidOperatorValue(
    operator: string,
    valueType: string,
    path: string[],
  ): ErrorResult {
    return {
      success: false,
      error: new ParserError(`Operator ${operator} requires an array value`, {
        code: "INVALID_VALUE_TYPE",
        parser: "where",
        location: buildErrorLocation(["where", ...path]),
        received: valueType,
        expected: "array",
        suggestion: `Use array format for ${operator} operator`,
        context: {
          operator,
        },
      }),
    };
  },
};

/**
 * Populate Parser Errors
 */
export const populateError = {
  invalidRelation(
    relation: string,
    path: string[],
    context?: Partial<PopulateErrorContext>,
  ): ErrorResult {
    return {
      success: false,
      error: new ParserError(`Invalid relation name: ${relation}`, {
        code: "INVALID_FIELD_NAME",
        parser: "populate",
        location: buildErrorLocation(["populate", ...path], {
          depth: context?.currentDepth,
        }),
        received: relation,
        expected:
          "Relation name must start with letter/underscore and contain only alphanumeric characters and underscores",
        suggestion: "Use valid relation names (e.g., 'author', 'user_profile')",
        context: {
          relation,
          ...context,
        },
      }),
    };
  },

  maxDepthExceeded(
    depth: number,
    maxDepth: number,
    path: string[],
    context?: Partial<PopulateErrorContext>,
  ): ErrorResult {
    return {
      success: false,
      error: new ParserError("Maximum populate depth exceeded", {
        code: "MAX_DEPTH_EXCEEDED",
        parser: "populate",
        location: buildErrorLocation(["populate", ...path], {
          depth,
        }),
        received: depth,
        expected: `Maximum depth: ${maxDepth}`,
        suggestion:
          "Reduce nesting level or increase maxPopulateDepth in parser options",
        context: {
          currentDepth: depth,
          maxDepth,
          relationPath: path.join("."),
          ...context,
        },
      }),
    };
  },

  emptyValue(path: string[]): ErrorResult {
    return {
      success: false,
      error: new ParserError("Populate value cannot be empty", {
        code: "EMPTY_VALUE",
        parser: "populate",
        location: buildErrorLocation(["populate", ...path]),
        received: "empty string",
        expected: "Relation name or wildcard (*)",
        suggestion: "Provide a relation name or use * to populate all relations",
        context: {},
      }),
    };
  },

  invalidType(type: string, path: string[]): ErrorResult {
    return {
      success: false,
      error: new ParserError("Populate value must be a string or array", {
        code: "INVALID_VALUE_TYPE",
        parser: "populate",
        location: buildErrorLocation(["populate", ...path]),
        received: type,
        expected: "string or array",
        suggestion: "Use a string (e.g., 'author') or array format",
        context: {},
      }),
    };
  },
};

/**
 * Fields Parser Errors
 */
export const fieldsError = {
  invalidFieldNames(
    invalidFields: readonly string[],
    path: string[],
    context?: Partial<FieldsErrorContext>,
  ): ErrorResult {
    return {
      success: false,
      error: new ParserError(`Invalid field names: ${invalidFields.join(", ")}`, {
        code: "INVALID_FIELD_NAME",
        parser: "fields",
        location: buildErrorLocation(["fields", ...path]),
        received: invalidFields,
        expected:
          "Field names must start with letter/underscore and contain only alphanumeric characters, underscores, and dots",
        suggestion:
          "Use valid field names (e.g., 'name', 'user_id', 'profile.age')",
        context: {
          invalidFields: invalidFields as string[],
          ...context,
        },
      }),
    };
  },

  emptyValue(path: string[]): ErrorResult {
    return {
      success: false,
      error: new ParserError(
        "Fields parameter is empty or contains only whitespace",
        {
          code: "EMPTY_VALUE",
          parser: "fields",
          location: buildErrorLocation(["fields", ...path]),
          received: "empty string",
          expected: "Field name(s) or wildcard (*)",
          suggestion:
            "Provide field names (e.g., 'name,email') or use * for all fields",
          context: {},
        },
      ),
    };
  },

  suspiciousParams(params: readonly string[], path: string[]): ErrorResult {
    return {
      success: false,
      error: new ParserError(`Unknown fields parameters: ${params.join(", ")}`, {
        code: "UNKNOWN_PARAMETER",
        parser: "fields",
        location: buildErrorLocation(["fields", ...path]),
        received: params,
        expected: "fields or fields[N] format",
        suggestion:
          "Use 'fields=name,email' or 'fields[0]=name&fields[1]=email' format",
        context: {
          suspiciousParams: params as string[],
        },
      }),
    };
  },

  invalidFormat(path: string[]): ErrorResult {
    return {
      success: false,
      error: new ParserError("Invalid fields format", {
        code: "INVALID_SYNTAX",
        parser: "fields",
        location: buildErrorLocation(["fields", ...path]),
        received: "unknown format",
        expected: "string or array",
        suggestion: "Use 'fields=name,email' or 'fields[0]=name' format",
        context: {},
      }),
    };
  },
};

/**
 * Pagination Parser Errors
 */
export const paginationError = {
  invalidLimit(
    value: string | number | readonly string[] | undefined,
    path: string[],
    context?: Partial<PaginationErrorContext>,
  ): ErrorResult {
    return {
      success: false,
      error: new ParserError(`Invalid limit value: "${value}"`, {
        code: "INVALID_PAGINATION",
        parser: "pagination",
        location: buildErrorLocation(["pagination", ...path]),
        received: value,
        expected: "Positive integer",
        suggestion: "Provide a positive integer for limit (e.g., limit=10)",
        context: {
          parameter: "limit",
          ...context,
        },
      }),
    };
  },

  invalidOffset(
    value: string | number | readonly string[] | undefined,
    path: string[],
    context?: Partial<PaginationErrorContext>,
  ): ErrorResult {
    return {
      success: false,
      error: new ParserError(`Invalid offset value: "${value}"`, {
        code: "INVALID_PAGINATION",
        parser: "pagination",
        location: buildErrorLocation(["pagination", ...path]),
        received: value,
        expected: "Non-negative integer",
        suggestion: "Provide a non-negative integer for offset (e.g., offset=0)",
        context: {
          parameter: "offset",
          ...context,
        },
      }),
    };
  },

  invalidPage(
    value: string | number | readonly string[],
    path: string[],
    context?: Partial<PaginationErrorContext>,
  ): ErrorResult {
    return {
      success: false,
      error: new ParserError(`Invalid page value: "${value}" (must be >= 1)`, {
        code: "INVALID_PAGINATION",
        parser: "pagination",
        location: buildErrorLocation(["pagination", ...path]),
        received: value,
        expected: "Integer >= 1",
        suggestion: "Provide a positive integer for page (e.g., page=1)",
        context: {
          parameter: "page",
          minValue: 1,
          ...context,
        },
      }),
    };
  },

  invalidPageSize(
    value: string | number | readonly string[] | undefined,
    path: string[],
    context?: Partial<PaginationErrorContext>,
  ): ErrorResult {
    return {
      success: false,
      error: new ParserError(`Invalid pageSize value: "${value}" (must be >= 1)`, {
        code: "INVALID_PAGINATION",
        parser: "pagination",
        location: buildErrorLocation(["pagination", ...path]),
        received: value,
        expected: "Integer >= 1",
        suggestion: "Provide a positive integer for pageSize (e.g., pageSize=25)",
        context: {
          parameter: "pageSize",
          minValue: 1,
          ...context,
        },
      }),
    };
  },

  maxPageSizeExceeded(value: number, max: number, path: string[]): ErrorResult {
    return {
      success: false,
      error: new ParserError(`Page size exceeds maximum (${max})`, {
        code: "MAX_VALUE_VIOLATION",
        parser: "pagination",
        location: buildErrorLocation(["pagination", ...path]),
        received: value,
        expected: `Maximum: ${max}`,
        suggestion: `Reduce pageSize to ${max} or less`,
        context: {
          parameter: "pageSize",
          maxValue: max,
        },
      }),
    };
  },

  maxLimitExceeded(value: number, max: number, path: string[]): ErrorResult {
    return {
      success: false,
      error: new ParserError(`Limit exceeds maximum page size (${max})`, {
        code: "MAX_VALUE_VIOLATION",
        parser: "pagination",
        location: buildErrorLocation(["pagination", ...path]),
        received: value,
        expected: `Maximum: ${max}`,
        suggestion: `Reduce limit to ${max} or less`,
        context: {
          parameter: "limit",
          maxValue: max,
        },
      }),
    };
  },

  maxPageNumberExceeded(
    value: number,
    max: number,
    path: string[],
  ): ErrorResult {
    return {
      success: false,
      error: new ParserError(`Page number exceeds maximum (${max})`, {
        code: "PAGE_OUT_OF_RANGE",
        parser: "pagination",
        location: buildErrorLocation(["pagination", ...path]),
        received: value,
        expected: `Maximum: ${max}`,
        suggestion: `Use page number ${max} or less`,
        context: {
          parameter: "page",
          maxValue: max,
        },
      }),
    };
  },
};

/**
 * Sort Parser Errors
 */
export const sortError = {
  emptyValue(path: string[]): ErrorResult {
    return {
      success: false,
      error: new ParserError("Sort value cannot be empty", {
        code: "EMPTY_VALUE",
        parser: "sort",
        location: buildErrorLocation(["sort", ...path]),
        received: "empty string",
        expected: "Field name(s) with optional direction",
        suggestion:
          "Provide field names (e.g., 'name' or '-createdAt' for descending)",
        context: {},
      }),
    };
  },

  invalidFieldName(field: string, path: string[]): ErrorResult {
    return {
      success: false,
      error: new ParserError(`Invalid sort field: ${field}`, {
        code: "INVALID_FIELD_NAME",
        parser: "sort",
        location: buildErrorLocation(["sort", ...path]),
        received: field,
        expected:
          "Field name must start with letter/underscore and contain only alphanumeric characters, underscores, and dots. Use '-' prefix for descending order.",
        suggestion:
          "Use valid field names (e.g., 'name', '-createdAt', 'user.age')",
        context: {
          sortField: field,
          parameter: "sort",
        },
      }),
    };
  },
};
