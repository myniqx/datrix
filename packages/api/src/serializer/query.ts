/**
 * Query Serializer
 *
 * Converts ParsedQuery objects into RawQueryParams query strings.
 */

import { ForjaEntry, ForjaRecord } from "@forja/core/types";
import { ParsedQuery, RawQueryParams } from "@forja/core/types/api/parser";
import {
	WhereClause,
	PopulateClause,
	PopulateOptions,
	QueryPrimitive,
} from "@forja/core/types";

export function queryToParams<T extends ForjaEntry = ForjaRecord>(
	query: ParsedQuery<T> | undefined,
): string {
	if (!query) return "";

	const serialized = serializeQuery(query);

	const parts: string[] = [];
	Object.entries(serialized).forEach(([key, value]) => {
		if (Array.isArray(value)) {
			value.forEach((v) => {
				// Only encode the value, keep [ ] in key for readability
				parts.push(`${key}=${encodeURIComponent(String(v))}`);
			});
		} else if (value !== undefined) {
			// Only encode the value, keep [ ] in key for readability
			parts.push(`${key}=${encodeURIComponent(String(value))}`);
		}
	});

	return parts.join("&");
}

/**
 * Serialize ParsedQuery into RawQueryParams
 *
 * @param query - The parsed query object to serialize
 * @returns Records of query parameters
 */
export function serializeQuery<T extends ForjaEntry = ForjaEntry>(
	query: ParsedQuery<T>,
): RawQueryParams {
	const params: Record<string, string | string[]> = {};

	const validKeys = [
		"select",
		"where",
		"populate",
		"orderBy",
		"page",
		"pageSize",
	];
	const queryKeys = Object.keys(query);
	const unknownKeys = queryKeys.filter((key) => !validKeys.includes(key));

	if (unknownKeys.length > 0) {
		throw new Error(
			`Unknown query keys: ${unknownKeys.join(", ")}. Valid keys are: ${validKeys.join(", ")}`,
		);
	}

	// 1. Fields (select)
	if (query.select) {
		if (query.select === "*") {
			params["fields"] = "*";
		} else if (Array.isArray(query.select)) {
			params["fields"] = query.select.join(",");
		}
	}

	// 2. Where
	if (query.where) {
		serializeWhere(query.where, "where", params);
	}

	// 3. Populate
	if (query.populate) {
		serializePopulate(query.populate, "populate", params);
	}

	// 4. OrderBy (sort)
	if (query.orderBy) {
		if (typeof query.orderBy === "string") {
			// Simple string format: 'name' or '-name'
			params["sort"] = query.orderBy;
		} else if (Array.isArray(query.orderBy)) {
			// Array format: ['name', '-createdAt'] or [{ field: 'name', direction: 'asc' }]
			const sortStrings = query.orderBy.map((item) => {
				if (typeof item === "string") {
					// String item: 'name' or '-name'
					return item;
				} else {
					// Object item: { field: 'name', direction: 'asc' }
					return item.direction === "desc" ? `-${item.field}` : item.field;
				}
			});
			if (sortStrings.length > 0) {
				params["sort"] = sortStrings.join(",");
			}
		}
	}

	// 5. Pagination (page/pageSize only)
	if (query.page !== undefined) params["page"] = String(query.page);
	if (query.pageSize !== undefined) params["pageSize"] = String(query.pageSize);

	return params;
}

/**
 * Recursive helper to serialize where clause
 */
function serializeWhere<T extends ForjaEntry>(
	where: WhereClause<T> | QueryPrimitive | readonly WhereClause<T>[],
	prefix: string,
	params: Record<string, string | string[]>,
) {
	if (where === null || typeof where !== "object") {
		params[prefix] = String(where);
		return;
	}

	for (const [key, value] of Object.entries(where)) {
		const newPrefix = `${prefix}[${key}]`;

		if (Array.isArray(value)) {
			// Handle logical operators like $or, $and, $not which take arrays of conditions
			if (["$or", "$and", "$not"].includes(key)) {
				value.forEach((item, index) => {
					serializeWhere(item, `${newPrefix}[${index}]`, params);
				});
			} else {
				// Handle $in, $nin which take arrays of values
				value.forEach((item, index) => {
					params[`${newPrefix}[${index}]`] = String(item);
				});
			}
		} else if (value !== null && typeof value === "object") {
			serializeWhere(value, newPrefix, params);
		} else {
			params[newPrefix] = String(value);
		}
	}
}

/**
 * Recursive helper to serialize populate clause
 */
function serializePopulate<T extends ForjaEntry>(
	populate: PopulateClause<T> | "*",
	prefix: string,
	params: Record<string, string | string[] | true>,
) {
	if (populate === "*") {
		params[prefix] = "*";
		return;
	}

	if (populate === "true") {
		params[prefix] = true;
		return;
	}

	if (populate === true) {
		params[prefix] = true;
		return;
	}

	// Handle string[] format: ['relation1', 'relation2']
	// Serialize as indexed array (preserves array format)
	if (Array.isArray(populate)) {
		populate.forEach((relation: string, index: number) => {
			params[`${prefix}[${index}]`] = String(relation);
		});
		return;
	}

	if (typeof populate !== "object") return;

	for (const [relation, options] of Object.entries(populate)) {
		const relPrefix = `${prefix}[${relation}]`;

		if (options === "*" || options === true) {
			params[relPrefix] = options;
		} else if (typeof options === "object") {
			const opts = options as PopulateOptions<T>;

			// select fields in populate
			if (opts.select) {
				if (opts.select === "*") {
					params[`${relPrefix}[fields]`] = "*";
				} else if (Array.isArray(opts.select)) {
					opts.select.forEach((field: string, index: number) => {
						params[`${relPrefix}[fields][${index}]`] = field;
					});
				}
			}

			// nested populate
			if (opts.populate) {
				serializePopulate(opts.populate, `${relPrefix}[populate]`, params);
			}
		}
	}
}
