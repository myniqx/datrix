/**
 * Query Executor Error Helpers
 *
 * Centralized error creation for query executor operations.
 */

import { ForjaError } from "forja-types/errors";

/**
 * Throw unsupported query type error
 *
 * @param queryType - The unsupported query type
 *
 * @example
 * ```ts
 * throwUnsupportedQueryType('invalid');
 * // Error: Unsupported query type: invalid
 * ```
 */
export function throwUnsupportedQueryType(queryType: unknown): never {
	throw new ForjaError(`Unsupported query type: ${queryType}`, {
		code: "UNSUPPORTED_QUERY_TYPE",
		context: { queryType },
		suggestion: "Use one of: select, insert, update, delete, count",
		expected: "select | insert | update | delete | count",
		received: queryType,
	});
}
