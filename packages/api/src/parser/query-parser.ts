/**
 * Main Query Parser
 *
 * Parses complete query strings into ParsedQuery.
 * Combines fields, where, populate, pagination, and sorting.
 */

import type {
  OrderByItem,
  OrderDirection,
} from "forja-types/core/query-builder";
import type {
  RawQueryParams,
  QueryParserResult,
  ParserOptions,
  ParsedPagination,
  ParsedSort,
  ParsedQuery,
  ParserError,
} from "forja-types/api/parser";
import { validateFieldName } from "forja-types/core/constants";
import { parseFields } from "./fields-parser";
import { parseWhere } from "./where-parser";
import { parsePopulate } from "./populate-parser";
import { paginationError, sortError } from "./errors";

/**
 * Default parser options
 */
const DEFAULT_OPTIONS: Required<ParserOptions> = {
  maxPageSize: 100,
  defaultPageSize: 25,
  maxPopulateDepth: 5,
  allowedOperators: [],
  strictMode: false,
};

/**
 * Parse query parameters into ParsedQuery
 *
 * @param params - Raw query parameters
 * @param options - Parser options
 * @returns Result with ParsedQuery or ParserError
 */
export function parseQuery(
  params: RawQueryParams,
  options?: Partial<ParserOptions>,
): QueryParserResult {
  try {
    const opts: Required<ParserOptions> = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    // Build result as mutable object
    const result: {
      select?: ParsedQuery["select"];
      where?: ParsedQuery["where"];
      populate?: ParsedQuery["populate"];
      orderBy?: ParsedQuery["orderBy"];
      page?: number;
      pageSize?: number;
    } = {};

    // Parse fields - throws on error
    const fields = parseFields(params);
    if (fields !== undefined && fields !== "*") {
      result.select = fields;
    }

    // Parse where - throws on error
    const where = parseWhere(params);
    if (where !== undefined) {
      result.where = where;
    }

    // Parse populate - throws on error
    const populate = parsePopulate(params, opts.maxPopulateDepth);
    if (populate !== undefined) {
      result.populate = populate;
    }

    // Parse pagination - throws on error
    const pagination = parsePagination(params, opts);
    if (pagination !== undefined) {
      result.page = pagination.page ?? 1;
      result.pageSize = pagination.pageSize ?? opts.defaultPageSize;
    }

    // Parse sorting - throws on error
    const sort = parseSort(params);
    if (sort !== undefined && Array.isArray(sort) && sort.length > 0) {
      result.orderBy = sort;
    }

    // Return result as ParsedQuery - all fields are optional and properly typed
    return { success: true, data: result as ParsedQuery };
  } catch (error) {
    // Catch ParserError thrown by helper functions
    if (error && typeof error === "object" && "code" in error) {
      return { success: false, error: error as ParserError };
    }
    // Re-throw unexpected errors
    throw error;
  }
}

/**
 * Parse pagination parameters
 * Throws ParserError on validation failure
 */
function parsePagination(
  params: RawQueryParams,
  options: Required<ParserOptions>,
): ParsedPagination | undefined {
  const { page, pageSize } = params;

  // Parse page/pageSize with defaults
  const parsedPage = page !== undefined ? parseInt(String(page), 10) : 1;
  const parsedPageSize =
    pageSize !== undefined ?
      parseInt(String(pageSize), 10)
      : options.defaultPageSize;

  // Maximum safe page number to prevent overflow
  const MAX_PAGE_NUMBER = 1000000;

  // Validate page
  if (isNaN(parsedPage) || parsedPage < 1) {
    paginationError.invalidPage(page ?? "", ["page"]);
  }

  if (parsedPage > MAX_PAGE_NUMBER) {
    paginationError.maxPageNumberExceeded(parsedPage, MAX_PAGE_NUMBER, ["page"]);
  }

  // Validate pageSize
  if (isNaN(parsedPageSize) || parsedPageSize < 1) {
    paginationError.invalidPageSize(pageSize ?? "", ["pageSize"]);
  }

  if (parsedPageSize > options.maxPageSize) {
    paginationError.maxPageSizeExceeded(parsedPageSize, options.maxPageSize, [
      "pageSize",
    ]);
  }

  return {
    page: parsedPage,
    pageSize: parsedPageSize,
  };
}

/**
 * Parse sort parameters
 * Throws ParserError on validation failure
 *
 * Examples:
 *   ?sort=name              -> orderBy: [{ field: 'name', direction: 'asc' }]
 *   ?sort=-createdAt        -> orderBy: [{ field: 'createdAt', direction: 'desc' }]
 *   ?sort=name,-createdAt   -> multiple sorts
 */
function parseSort(params: RawQueryParams): ParsedSort | undefined {
  const sortParam = params["sort"];

  if (sortParam === undefined) {
    return undefined;
  }

  // Handle empty or whitespace-only sort
  if (typeof sortParam === "string" && sortParam.trim() === "") {
    sortError.emptyValue([]);
  }

  const sorts: OrderByItem[] = [];

  // Handle comma-separated sorts
  const sortStrings =
    typeof sortParam === "string" ? sortParam.split(",").map((s) => s.trim())
      : Array.isArray(sortParam) ? sortParam.map((s) => String(s).trim())
        : [String(sortParam).trim()];

  for (const sortStr of sortStrings) {
    if (!sortStr) {
      continue;
    }

    // Check for descending order (leading -)
    const isDescending = sortStr.startsWith("-");
    const field = isDescending ? sortStr.slice(1) : sortStr;

    if (!field) {
      sortError.invalidFieldName(sortStr, [sortStr]);
    }

    const validation = validateFieldName(field);
    if (!validation.valid) {
      sortError.invalidFieldName(sortStr, [sortStr], {
        fieldValidationReason: validation.reason,
      });
    }

    const direction: OrderDirection = isDescending ? "desc" : "asc";
    sorts.push({ field, direction });
  }

  return sorts.length > 0 ? sorts : undefined;
}
