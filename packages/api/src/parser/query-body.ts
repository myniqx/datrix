/**
 * Query Body Validator
 *
 * Validates JSON query bodies for the QUERY HTTP method (and its
 * POST /:model/query alias). The body carries a ParsedQuery-shaped object;
 * values arrive natively typed, so no bracket parsing is involved — but the
 * limits the bracket parser enforces (lengths, depths, field-name safety)
 * must be applied here before the query reaches core. This is the API's
 * trust boundary: populate-level where/orderBy field names pass through core
 * unchecked, so every field key is validated recursively.
 */

import type { DatrixEntry, ParsedQuery } from "@datrix/core";
import {
	ParserError,
	buildErrorLocation,
	validateFieldName,
	isValidWhereOperator,
	isLogicalOperator,
	MAX_WHERE_VALUE_LENGTH,
	MAX_LOGICAL_NESTING_DEPTH,
} from "@datrix/core";
import {
	whereError,
	populateError,
	paginationError,
	sortError,
} from "./errors";

/**
 * Options for query body validation
 */
export interface QueryBodyOptions {
	readonly maxPageSize: number;
	readonly maxPopulateDepth: number;
}

const KNOWN_BODY_KEYS = [
	"select",
	"where",
	"populate",
	"orderBy",
	"page",
	"pageSize",
] as const;

const KNOWN_POPULATE_OPTION_KEYS = [
	"select",
	"populate",
	"where",
	"orderBy",
	"limit",
	"offset",
] as const;

/** Maximum safe page number (parity with the query-string parser). */
const MAX_PAGE_NUMBER = 1000000;

/**
 * Validate a QUERY request body and return it as a ParsedQuery.
 * Throws ParserError (→ 400) on any violation.
 */
export function validateQueryBody(
	body: unknown,
	options: QueryBodyOptions,
): ParsedQuery<DatrixEntry> {
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		throw new ParserError("Query body must be a JSON object", {
			code: "INVALID_SYNTAX",
			parser: "query",
			location: buildErrorLocation([]),
			received:
				body === null ? "null" : Array.isArray(body) ? "array" : typeof body,
			expected: "JSON object with select/where/populate/orderBy/page/pageSize",
			suggestion:
				'Send a body like { "where": { "price": { "$gt": 100 } }, "pageSize": 10 }',
		});
	}

	const query = body as Record<string, unknown>;

	const unknownKeys = Object.keys(query).filter(
		(key) => !(KNOWN_BODY_KEYS as readonly string[]).includes(key),
	);
	if (unknownKeys.length > 0) {
		throw new ParserError(
			`Unknown query body keys: ${unknownKeys.join(", ")}`,
			{
				code: "UNKNOWN_PARAMETER",
				parser: "query",
				location: buildErrorLocation(unknownKeys),
				received: unknownKeys,
				expected: `Known keys: ${KNOWN_BODY_KEYS.join(", ")}`,
				suggestion:
					"Check for typos. Common mistake: use 'where' instead of 'filters'.",
			},
		);
	}

	validatePagination(query, options);
	if (query["select"] !== undefined) {
		validateSelect(query["select"], []);
	}
	if (query["where"] !== undefined) {
		validateWhere(query["where"], 0, []);
	}
	if (query["orderBy"] !== undefined) {
		validateOrderBy(query["orderBy"], []);
	}
	if (query["populate"] !== undefined) {
		validatePopulate(query["populate"], 1, options.maxPopulateDepth, []);
	}

	return query as ParsedQuery<DatrixEntry>;
}

function validatePagination(
	query: Record<string, unknown>,
	options: QueryBodyOptions,
): void {
	const page = query["page"];
	if (page !== undefined) {
		if (typeof page !== "number" || !Number.isInteger(page) || page < 1) {
			paginationError.invalidPage(String(page), ["page"]);
		} else if (page > MAX_PAGE_NUMBER) {
			paginationError.maxPageNumberExceeded(page, MAX_PAGE_NUMBER, ["page"]);
		}
	}

	const pageSize = query["pageSize"];
	if (pageSize !== undefined) {
		if (
			typeof pageSize !== "number" ||
			!Number.isInteger(pageSize) ||
			pageSize < 1
		) {
			paginationError.invalidPageSize(String(pageSize), ["pageSize"]);
		} else if (pageSize > options.maxPageSize) {
			paginationError.maxPageSizeExceeded(pageSize, options.maxPageSize, [
				"pageSize",
			]);
		}
	}
}

function validateSelect(select: unknown, path: string[]): void {
	if (select === "*") {
		return;
	}

	const fields = Array.isArray(select) ? select : [select];
	for (const field of fields) {
		if (typeof field !== "string") {
			whereError.invalidFieldName(String(field), [...path, "select"]);
		}
		const validation = validateFieldName(field as string);
		if (!validation.valid) {
			whereError.invalidFieldName(field as string, [...path, "select"], {
				fieldValidationReason: validation.reason,
			});
		}
	}
}

function validateWhere(where: unknown, depth: number, path: string[]): void {
	if (depth > MAX_LOGICAL_NESTING_DEPTH) {
		whereError.maxDepthExceeded(depth, path);
	}

	if (where === null || typeof where !== "object" || Array.isArray(where)) {
		validateWhereValue(where, path);
		return;
	}

	for (const [key, value] of Object.entries(where)) {
		if (key.startsWith("$")) {
			if (!isValidWhereOperator(key)) {
				whereError.invalidOperator(key, path);
			}

			if (isLogicalOperator(key)) {
				if (key === "$not") {
					// $not takes a single condition object
					validateWhere(value, depth + 1, [...path, key]);
					continue;
				}

				if (!Array.isArray(value)) {
					whereError.invalidOperatorValue(
						key,
						typeof value,
						[...path, key],
						value,
					);
				}
				if ((value as unknown[]).length === 0) {
					whereError.emptyLogicalOperator(key, [...path, key]);
				}
				for (const condition of value as unknown[]) {
					validateWhere(condition, depth + 1, [...path, key]);
				}
				continue;
			}

			if (key === "$in" || key === "$nin") {
				if (!Array.isArray(value)) {
					whereError.invalidOperatorValue(
						key,
						typeof value,
						[...path, key],
						value,
					);
				}
				if ((value as unknown[]).length === 0) {
					whereError.emptyArrayOperator(key, [...path, key]);
				}
				for (const item of value as unknown[]) {
					validateWhereValue(item, [...path, key]);
				}
				continue;
			}

			validateWhereValue(value, [...path, key]);
			continue;
		}

		// Field name — the only identifier-safety net for adapter-bound keys
		const validation = validateFieldName(key);
		if (!validation.valid) {
			whereError.invalidFieldName(key, path, {
				fieldValidationReason: validation.reason,
			});
		}

		if (
			value !== null &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			!(value instanceof Date)
		) {
			validateWhere(value, depth, [...path, key]);
		} else {
			validateWhereValue(value, [...path, key]);
		}
	}
}

function validateWhereValue(value: unknown, path: string[]): void {
	if (typeof value === "string" && value.length > MAX_WHERE_VALUE_LENGTH) {
		whereError.maxValueLength(value.length, path);
	}
}

function validateOrderBy(orderBy: unknown, path: string[]): void {
	const items = Array.isArray(orderBy) ? orderBy : [orderBy];

	for (const item of items) {
		if (typeof item === "string") {
			const field = item.startsWith("-") ? item.slice(1) : item;
			const validation = validateFieldName(field);
			if (!validation.valid) {
				sortError.invalidFieldName(item, [...path, "orderBy"], {
					fieldValidationReason: validation.reason,
				});
			}
			continue;
		}

		if (item !== null && typeof item === "object") {
			const { field, direction } = item as {
				field?: unknown;
				direction?: unknown;
			};
			if (typeof field !== "string") {
				sortError.invalidFieldName(String(field), [...path, "orderBy"]);
			}
			const validation = validateFieldName(field as string);
			if (!validation.valid) {
				sortError.invalidFieldName(field as string, [...path, "orderBy"], {
					fieldValidationReason: validation.reason,
				});
			}
			if (
				direction !== undefined &&
				direction !== "asc" &&
				direction !== "desc"
			) {
				sortError.invalidFieldName(String(direction), [...path, "orderBy"]);
			}
			continue;
		}

		sortError.invalidFieldName(String(item), [...path, "orderBy"]);
	}
}

function validatePopulate(
	populate: unknown,
	depth: number,
	maxDepth: number,
	path: string[],
): void {
	if (depth > maxDepth) {
		populateError.maxDepthExceeded(depth, maxDepth, path);
	}

	if (populate === "*" || populate === true) {
		return;
	}

	if (typeof populate === "string") {
		validateRelationName(populate, path);
		return;
	}

	if (Array.isArray(populate)) {
		for (const relation of populate) {
			if (typeof relation !== "string") {
				populateError.invalidType(typeof relation, path);
			}
			validateRelationName(relation as string, path);
		}
		return;
	}

	if (populate === null || typeof populate !== "object") {
		populateError.invalidType(typeof populate, path);
	}

	for (const [relation, value] of Object.entries(
		populate as Record<string, unknown>,
	)) {
		validateRelationName(relation, path);

		if (value === "*" || value === true) {
			continue;
		}

		if (value === null || typeof value !== "object" || Array.isArray(value)) {
			populateError.invalidType(typeof value, [...path, relation]);
		}

		const opts = value as Record<string, unknown>;
		const unknownKeys = Object.keys(opts).filter(
			(key) => !(KNOWN_POPULATE_OPTION_KEYS as readonly string[]).includes(key),
		);
		if (unknownKeys.length > 0) {
			throw new ParserError(
				`Unknown populate option keys: ${unknownKeys.join(", ")}`,
				{
					code: "UNKNOWN_PARAMETER",
					parser: "populate",
					location: buildErrorLocation(["populate", ...path, relation]),
					received: unknownKeys,
					expected: `Known keys: ${KNOWN_POPULATE_OPTION_KEYS.join(", ")}`,
					suggestion: "Check for typos in populate options.",
				},
			);
		}

		if (opts["select"] !== undefined) {
			validateSelect(opts["select"], [...path, relation]);
		}
		// Populate-level where/orderBy field names are NOT validated by core —
		// this recursive check is the trust boundary for HTTP bodies.
		if (opts["where"] !== undefined) {
			validateWhere(opts["where"], 0, [...path, relation, "where"]);
		}
		if (opts["orderBy"] !== undefined) {
			validateOrderBy(opts["orderBy"], [...path, relation]);
		}
		if (opts["limit"] !== undefined) {
			validatePositiveInteger(opts["limit"], "limit", [...path, relation]);
		}
		if (opts["offset"] !== undefined) {
			validateNonNegativeInteger(opts["offset"], "offset", [...path, relation]);
		}
		if (opts["populate"] !== undefined) {
			validatePopulate(opts["populate"], depth + 1, maxDepth, [
				...path,
				relation,
			]);
		}
	}
}

function validateRelationName(relation: string, path: string[]): void {
	const validation = validateFieldName(relation);
	if (!validation.valid) {
		populateError.invalidRelation(relation, [...path, relation], {
			fieldValidationReason: validation.reason,
		});
	}
}

function validatePositiveInteger(
	value: unknown,
	name: string,
	path: string[],
): void {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		paginationError.invalidLimit(String(value), [...path, name]);
	}
}

function validateNonNegativeInteger(
	value: unknown,
	name: string,
	path: string[],
): void {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		paginationError.invalidOffset(String(value), [...path, name]);
	}
}
