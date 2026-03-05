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
import {
	ParserError,
	buildErrorLocation,
	type RawQueryParams,
	type ParserOptions,
	type ParsedPagination,
	type ParsedSort,
	type ParsedQuery,
} from "forja-types/api/parser";
import { validateFieldName } from "forja-types/core/constants";
import { parseFields } from "./fields-parser";
import { parseWhere } from "./where-parser";
import { parsePopulate } from "./populate-parser";
import { paginationError, sortError } from "./errors";
import { ForjaRecord } from "forja-types";

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
): ParsedQuery<ForjaRecord> {
	const opts: Required<ParserOptions> = {
		...DEFAULT_OPTIONS,
		...options,
	};

	const fields = parseFields(params);
	const where = parseWhere(params);
	const populate = parsePopulate(params, opts.maxPopulateDepth);
	const pagination = parsePagination(params, opts);
	const sort = parseSort(params);

	const unknownParams = detectUnknownParams(params);
	if (unknownParams.length > 0) {
		throw new ParserError(
			`Unknown query parameters: ${unknownParams.join(", ")}`,
			{
				code: "UNKNOWN_PARAMETER",
				parser: "query",
				location: buildErrorLocation(unknownParams),
				received: unknownParams,
				expected:
					"Known parameters: fields, where, populate, page, pageSize, sort",
				suggestion:
					"Check for typos. Common mistake: use 'where' instead of 'filters'.",
			},
		);
	}

	const result: ParsedQuery<ForjaRecord> = {
		...(fields !== undefined && fields !== "*" && { select: fields }),
		...(where !== undefined && { where }),
		...(populate !== undefined && { populate }),
		...(pagination !== undefined && {
			page: pagination.page ?? 1,
			pageSize: pagination.pageSize ?? opts.defaultPageSize,
		}),
		...(sort !== undefined && Array.isArray(sort) && sort.length > 0 && { orderBy: sort }),
	};

	return result;
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
		pageSize !== undefined
			? parseInt(String(pageSize), 10)
			: options.defaultPageSize;

	// Maximum safe page number to prevent overflow
	const MAX_PAGE_NUMBER = 1000000;

	// Validate page
	if (isNaN(parsedPage) || parsedPage < 1) {
		paginationError.invalidPage(page ?? "", ["page"]);
	}

	if (parsedPage > MAX_PAGE_NUMBER) {
		paginationError.maxPageNumberExceeded(parsedPage, MAX_PAGE_NUMBER, [
			"page",
		]);
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

	const sorts: OrderByItem<ForjaRecord>[] = [];

	// Handle comma-separated sorts
	const sortStrings =
		typeof sortParam === "string"
			? sortParam.split(",").map((s) => s.trim())
			: Array.isArray(sortParam)
				? sortParam.map((s) => String(s).trim())
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

/**
 * Known query parameter prefixes
 *
 * Any key not matching these is considered unknown.
 * This catches typos like "filters" (should be "where"),
 * "limit" (should be "pageSize"), etc.
 */
const KNOWN_PARAM_PREFIXES = [
	"fields",
	"where",
	"populate",
	"page",
	"pageSize",
	"sort",
] as const;

/**
 * Detect unknown/unrecognized query parameters
 *
 * Returns list of parameter keys that don't match any known prefix.
 * This prevents silent failures where typos like "filters" are ignored.
 */
function detectUnknownParams(params: RawQueryParams): string[] {
	const unknownKeys: string[] = [];

	for (const key of Object.keys(params)) {
		const isKnown = KNOWN_PARAM_PREFIXES.some(
			(prefix) => key === prefix || key.startsWith(`${prefix}[`),
		);

		if (!isKnown) {
			unknownKeys.push(key);
		}
	}

	return unknownKeys;
}
