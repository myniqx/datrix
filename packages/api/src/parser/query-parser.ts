/**
 * Main Query Parser
 *
 * Parses complete query strings into ParsedQuery.
 * Combines fields, where, populate, pagination, and sorting.
 */

import type { OrderByItem, OrderDirection } from 'forja-types/core/query-builder';
import type {
  RawQueryParams,
  QueryParserResult,
  ParserOptions,
  ParsedPagination,
  ParsedSort,
  ParsedQuery
} from 'forja-types/api/parser';
import { ParserError } from 'forja-types/api/parser';
import { parseFields } from './fields-parser';
import { parseWhere } from './where-parser';
import { parsePopulate } from './populate-parser';

/**
 * Default parser options
 */
const DEFAULT_OPTIONS: Required<ParserOptions> = {
  maxPageSize: 100,
  defaultPageSize: 25,
  maxPopulateDepth: 5,
  allowedOperators: [],
  strictMode: false
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
  options?: Partial<ParserOptions>
): QueryParserResult {
  const opts: Required<ParserOptions> = {
    ...DEFAULT_OPTIONS,
    ...options
  };

  // Build result as mutable object
  const result: {
    select?: ParsedQuery['select'];
    where?: ParsedQuery['where'];
    populate?: ParsedQuery['populate'];
    orderBy?: ParsedQuery['orderBy'];
    limit?: number;
    offset?: number;
    page?: number;
    pageSize?: number;
  } = {};

  // Parse fields
  const fieldsResult = parseFields(params);
  if (!fieldsResult.success) {
    return fieldsResult;
  }
  if (fieldsResult.data !== undefined && fieldsResult.data !== '*') {
    result.select = fieldsResult.data;
  }

  // Parse where
  const whereResult = parseWhere(params);
  if (!whereResult.success) {
    return whereResult;
  }
  if (whereResult.data !== undefined) {
    result.where = whereResult.data;
  }

  // Parse populate
  const populateResult = parsePopulate(params, opts.maxPopulateDepth);
  if (!populateResult.success) {
    return populateResult;
  }
  if (populateResult.data !== undefined) {
    result.populate = populateResult.data;
  }

  // Parse pagination
  const paginationResult = parsePagination(params, opts);
  if (!paginationResult.success) {
    return paginationResult;
  }
  if (paginationResult.data !== undefined) {
    const { limit, offset } = paginationResult.data;
    if (limit !== undefined) {
      result.limit = limit;
    }
    if (offset !== undefined) {
      result.offset = offset;
    }

    // Calculate page/pageSize if possible
    if (params['page'] !== undefined || params['pageSize'] !== undefined) {
      const page = parseInt(String(params['page'] ?? '1'), 10);
      const pageSize = parseInt(String(params['pageSize'] ?? opts.defaultPageSize), 10);
      result.page = page;
      result.pageSize = pageSize;
    }
  }

  // Parse sorting
  const sortResult = parseSort(params);
  if (!sortResult.success) {
    return sortResult;
  }
  if (sortResult.data !== undefined) {
    const sortData = sortResult.data;
    if (Array.isArray(sortData) && sortData.length > 0) {
      result.orderBy = sortData;
    }
  }

  // Return result as ParsedQuery - all fields are optional and properly typed
  return { success: true, data: result as ParsedQuery };
}

/**
 * Parse pagination parameters
 */
function parsePagination(params: RawQueryParams, options: Required<ParserOptions>): QueryParserResult | { success: true; data: ParsedPagination | undefined } {
  const { page, pageSize, limit, offset } = params;

  // If no pagination params, use defaults
  if (page === undefined && pageSize === undefined && limit === undefined && offset === undefined) {
    return {
      success: true,
      data: {
        limit: options.defaultPageSize,
        offset: 0
      }
    };
  }

  // Parse limit/offset directly
  if (limit !== undefined || offset !== undefined) {
    const parsedLimit = limit !== undefined ? parseInt(String(limit), 10) : options.defaultPageSize;
    const parsedOffset = offset !== undefined ? parseInt(String(offset), 10) : 0;

    // Validate
    if (isNaN(parsedLimit) || parsedLimit < 0) {
      return {
        success: false,
        error: new ParserError('Invalid limit value', {
          code: 'INVALID_PAGINATION',
          field: 'limit'
        })
      };
    }

    if (isNaN(parsedOffset) || parsedOffset < 0) {
      return {
        success: false,
        error: new ParserError('Invalid offset value', {
          code: 'INVALID_PAGINATION',
          field: 'offset'
        })
      };
    }

    // Check max page size
    if (parsedLimit > options.maxPageSize) {
      return {
        success: false,
        error: new ParserError(`Limit exceeds maximum page size (${options.maxPageSize})`, {
          code: 'INVALID_PAGINATION',
          field: 'limit'
        })
      };
    }

    return {
      success: true,
      data: {
        limit: parsedLimit,
        offset: parsedOffset
      }
    };
  }

  // Parse page/pageSize
  const parsedPage = page !== undefined ? parseInt(String(page), 10) : 1;
  const parsedPageSize = pageSize !== undefined ? parseInt(String(pageSize), 10) : options.defaultPageSize;

  // Validate
  if (isNaN(parsedPage) || parsedPage < 1) {
    return {
      success: false,
      error: new ParserError('Invalid page value (must be >= 1)', {
        code: 'INVALID_PAGINATION',
        field: 'page'
      })
    };
  }

  if (isNaN(parsedPageSize) || parsedPageSize < 1) {
    return {
      success: false,
      error: new ParserError('Invalid pageSize value (must be >= 1)', {
        code: 'INVALID_PAGINATION',
        field: 'pageSize'
      })
    };
  }

  // Check max page size
  if (parsedPageSize > options.maxPageSize) {
    return {
      success: false,
      error: new ParserError(`Page size exceeds maximum (${options.maxPageSize})`, {
        code: 'INVALID_PAGINATION',
        field: 'pageSize'
      })
    };
  }

  // Convert page/pageSize to limit/offset
  const resultLimit = parsedPageSize;
  const resultOffset = (parsedPage - 1) * parsedPageSize;

  return {
    success: true,
    data: {
      limit: resultLimit,
      offset: resultOffset
    }
  };
}

/**
 * Parse sort parameters
 * Examples:
 *   ?sort=name              -> orderBy: [{ field: 'name', direction: 'asc' }]
 *   ?sort=-createdAt        -> orderBy: [{ field: 'createdAt', direction: 'desc' }]
 *   ?sort=name,-createdAt   -> multiple sorts
 */
function parseSort(params: RawQueryParams): QueryParserResult | { success: true; data: ParsedSort | undefined } {
  const sortParam = params['sort'];

  if (sortParam === undefined) {
    return { success: true, data: undefined };
  }

  const sorts: OrderByItem[] = [];

  // Handle comma-separated sorts
  const sortStrings = typeof sortParam === 'string'
    ? sortParam.split(',').map((s) => s.trim())
    : Array.isArray(sortParam)
      ? sortParam.map((s) => String(s).trim())
      : [String(sortParam).trim()];

  for (const sortStr of sortStrings) {
    if (!sortStr) {
      continue;
    }

    // Check for descending order (leading -)
    const isDescending = sortStr.startsWith('-');
    const field = isDescending ? sortStr.slice(1) : sortStr;

    if (!field || !isValidFieldName(field)) {
      return {
        success: false,
        error: new ParserError(`Invalid sort field: ${sortStr}`, {
          code: 'INVALID_SYNTAX',
          field: 'sort'
        })
      };
    }

    const direction: OrderDirection = isDescending ? 'desc' : 'asc';
    sorts.push({ field, direction });
  }

  return { success: true, data: sorts.length > 0 ? sorts : undefined };
}

/**
 * Check if field name is valid
 */
function isValidFieldName(field: string): boolean {
  if (!field || field.trim() === '') {
    return false;
  }

  // Allow alphanumeric, underscores, and dots
  const pattern = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
  return pattern.test(field);
}
