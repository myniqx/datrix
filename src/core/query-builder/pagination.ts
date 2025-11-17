/**
 * Pagination Builder (~40 LOC)
 *
 * Utilities for building and validating pagination parameters.
 * Handles limit, offset, page, and pageSize calculations.
 */

import type { Result } from '@utils/types';

/**
 * Pagination configuration
 */
export interface PaginationConfig {
  readonly defaultPageSize: number;
  readonly maxPageSize: number;
  readonly defaultPage: number;
}

/**
 * Pagination parameters
 */
export interface PaginationParams {
  readonly limit: number;
  readonly offset: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Default pagination config
 */
export const DEFAULT_PAGINATION_CONFIG: PaginationConfig = {
  defaultPageSize: 25,
  maxPageSize: 100,
  defaultPage: 1
};

/**
 * Pagination builder error
 */
export class PaginationBuilderError extends Error {
  constructor(
    message: string,
    public readonly details?: {
      value?: unknown;
      min?: number;
      max?: number;
    }
  ) {
    super(message);
    this.name = 'PaginationBuilderError';
  }
}

/**
 * Calculate pagination from page and pageSize
 */
export function calculatePagination(
  page: number,
  pageSize: number,
  config: PaginationConfig = DEFAULT_PAGINATION_CONFIG
): Result<PaginationParams, PaginationBuilderError> {
  // Validate page
  if (!Number.isInteger(page) || page < 1) {
    return {
      success: false,
      error: new PaginationBuilderError(
        `Invalid page: must be a positive integer, got ${page}`,
        { value: page, min: 1 }
      )
    };
  }

  // Validate pageSize
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    return {
      success: false,
      error: new PaginationBuilderError(
        `Invalid pageSize: must be a positive integer, got ${pageSize}`,
        { value: pageSize, min: 1 }
      )
    };
  }

  // Check max page size
  if (pageSize > config.maxPageSize) {
    return {
      success: false,
      error: new PaginationBuilderError(
        `pageSize ${pageSize} exceeds maximum ${config.maxPageSize}`,
        { value: pageSize, max: config.maxPageSize }
      )
    };
  }

  // Calculate limit and offset
  const limit = pageSize;
  const offset = (page - 1) * pageSize;

  return {
    success: true,
    data: {
      limit,
      offset,
      page,
      pageSize
    }
  };
}

/**
 * Calculate pagination from limit and offset
 */
export function calculatePaginationFromLimitOffset(
  limit: number,
  offset: number,
  config: PaginationConfig = DEFAULT_PAGINATION_CONFIG
): Result<PaginationParams, PaginationBuilderError> {
  // Validate limit
  if (!Number.isInteger(limit) || limit < 1) {
    return {
      success: false,
      error: new PaginationBuilderError(
        `Invalid limit: must be a positive integer, got ${limit}`,
        { value: limit, min: 1 }
      )
    };
  }

  // Validate offset
  if (!Number.isInteger(offset) || offset < 0) {
    return {
      success: false,
      error: new PaginationBuilderError(
        `Invalid offset: must be a non-negative integer, got ${offset}`,
        { value: offset, min: 0 }
      )
    };
  }

  // Check max limit
  if (limit > config.maxPageSize) {
    return {
      success: false,
      error: new PaginationBuilderError(
        `limit ${limit} exceeds maximum ${config.maxPageSize}`,
        { value: limit, max: config.maxPageSize }
      )
    };
  }

  // Calculate page and pageSize
  const pageSize = limit;
  const page = Math.floor(offset / limit) + 1;

  return {
    success: true,
    data: {
      limit,
      offset,
      page,
      pageSize
    }
  };
}

/**
 * Parse pagination from query parameters
 */
export function parsePaginationParams(
  params: {
    page?: unknown;
    pageSize?: unknown;
    limit?: unknown;
    offset?: unknown;
  },
  config: PaginationConfig = DEFAULT_PAGINATION_CONFIG
): Result<PaginationParams, PaginationBuilderError> {
  // Priority: page+pageSize > limit+offset

  // Try page + pageSize first
  if (params.page !== undefined || params.pageSize !== undefined) {
    const page = typeof params.page === 'number' ? params.page : config.defaultPage;
    const pageSize =
      typeof params.pageSize === 'number' ? params.pageSize : config.defaultPageSize;

    return calculatePagination(page, pageSize, config);
  }

  // Try limit + offset
  if (params.limit !== undefined || params.offset !== undefined) {
    const limit =
      typeof params.limit === 'number' ? params.limit : config.defaultPageSize;
    const offset = typeof params.offset === 'number' ? params.offset : 0;

    return calculatePaginationFromLimitOffset(limit, offset, config);
  }

  // Use defaults
  return calculatePagination(config.defaultPage, config.defaultPageSize, config);
}

/**
 * Create pagination metadata for response
 */
export interface PaginationMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly total: number;
}

/**
 * Calculate pagination metadata
 */
export function createPaginationMeta(
  params: PaginationParams,
  total: number
): PaginationMeta {
  const pageCount = Math.ceil(total / params.pageSize);

  return {
    page: params.page,
    pageSize: params.pageSize,
    pageCount,
    total
  };
}
