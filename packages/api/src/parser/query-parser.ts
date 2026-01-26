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
      limit?: number;
      offset?: number;
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
      const { limit, offset } = pagination;
      if (limit !== undefined) {
        result.limit = limit;
      }
      if (offset !== undefined) {
        result.offset = offset;
      }

      // Calculate page/pageSize if possible
      if (params["page"] !== undefined || params["pageSize"] !== undefined) {
        const page = parseInt(String(params["page"] ?? "1"), 10);
        const pageSize = parseInt(
          String(params["pageSize"] ?? opts.defaultPageSize),
          10,
        );
        result.page = page;
        result.pageSize = pageSize;
      }
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
  const { page, pageSize, limit, offset } = params;

  // If no pagination params, use defaults
  if (
    page === undefined &&
    pageSize === undefined &&
    limit === undefined &&
    offset === undefined
  ) {
    return {
      limit: options.defaultPageSize,
      offset: 0,
    };
  }

  // Parse limit/offset directly
  if (limit !== undefined || offset !== undefined) {
    const parsedLimit =
      limit !== undefined ? parseInt(String(limit), 10) : options.defaultPageSize;
    const parsedOffset = offset !== undefined ? parseInt(String(offset), 10) : 0;

    // Validate
    if (isNaN(parsedLimit) || parsedLimit < 0) {
      paginationError.invalidLimit(limit ?? "", ["limit"]);
    }

    if (isNaN(parsedOffset) || parsedOffset < 0) {
      paginationError.invalidOffset(offset ?? "", ["offset"]);
    }

    // Check max page size
    if (parsedLimit > options.maxPageSize) {
      paginationError.maxLimitExceeded(parsedLimit, options.maxPageSize, [
        "limit",
      ]);
    }

    return {
      limit: parsedLimit,
      offset: parsedOffset,
    };
  }

  // Parse page/pageSize
  const parsedPage = page !== undefined ? parseInt(String(page), 10) : 1;
  const parsedPageSize =
    pageSize !== undefined ?
      parseInt(String(pageSize), 10)
      : options.defaultPageSize;

  // Maximum safe page number to prevent overflow
  const MAX_PAGE_NUMBER = 1000000;

  // Validate
  if (isNaN(parsedPage) || parsedPage < 1) {
    paginationError.invalidPage(page ?? "", ["page"]);
  }

  if (parsedPage > MAX_PAGE_NUMBER) {
    paginationError.maxPageNumberExceeded(parsedPage, MAX_PAGE_NUMBER, ["page"]);
  }

  if (isNaN(parsedPageSize) || parsedPageSize < 1) {
    paginationError.invalidPageSize(pageSize ?? "", ["pageSize"]);
  }

  // Check max page size
  if (parsedPageSize > options.maxPageSize) {
    paginationError.maxPageSizeExceeded(parsedPageSize, options.maxPageSize, [
      "pageSize",
    ]);
  }

  // Convert page/pageSize to limit/offset
  const resultLimit = parsedPageSize;
  const resultOffset = (parsedPage - 1) * parsedPageSize;

  return {
    limit: resultLimit,
    offset: resultOffset,
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
