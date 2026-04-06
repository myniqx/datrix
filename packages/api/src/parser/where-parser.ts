/**
 * Where Parser
 *
 * Parses where query params into WhereClause.
 * Examples:
 *   ?where[status]=active
 *   ?where[price][$gt]=100
 *   ?where[name][$contains]=john
 */

import type { FallbackWhereClause } from "@forja/core";
import type { RawQueryParams } from "@forja/core";
import {
	validateFieldName,
	isValidWhereOperator,
	isLogicalOperator,
	getOperatorValueType,
} from "@forja/core";
import { whereError } from "./errors";

/**
 * Parse where parameter
 * Throws ParserError on validation failure
 *
 * @param params - Raw query parameters
 * @returns WhereClause or undefined
 * @throws {ParserError} When validation fails
 */
export function parseWhere(
	params: RawQueryParams,
): FallbackWhereClause | undefined {
	const whereClause: Record<string, unknown> = {};

	// Find all where[...] parameters
	for (const [key, value] of Object.entries(params)) {
		if (!key.startsWith("where[")) {
			continue;
		}

		// Extract path: where[a][b][c] -> ["a", "b", "c"]
		const parts = key
			.slice(5)
			.split("]")
			.filter((p) => p.startsWith("["))
			.map((p) => p.slice(1));
		if (parts.length === 0) continue;

		// Validate parts (field names and operators)
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i]!;

			// Check if it's an operator (starts with $)
			if (part.startsWith("$")) {
				// Validate operator
				if (!isValidWhereOperator(part)) {
					whereError.invalidOperator(part, parts.slice(0, i), {
						operatorPath: key,
					});
				}

				// Operators cannot be at the start (i=0) unless they are logical operators
				if (i === 0 && !isLogicalOperator(part)) {
					whereError.invalidFieldName(part, [], {
						fieldValidationReason: "INVALID_FORMAT",
					});
				}
			} else if (/^\d+$/.test(part)) {
				// It's a numeric index - validate context
				// Index can only appear after logical operators ($or, $and)
				if (i === 0) {
					whereError.arrayIndexAtStart(part, []);
				}

				const previousPart = parts[i - 1]!;
				if (!["$or", "$and", "$in", "$nin"].includes(previousPart)) {
					whereError.invalidArrayIndex(part, previousPart, parts.slice(0, i), {
						previousOperator: previousPart,
						operatorPath: key,
					});
				}
			} else {
				// It's a field name - validate it
				const validation = validateFieldName(part);
				if (!validation.valid) {
					whereError.invalidFieldName(part, parts.slice(0, i), {
						fieldValidationReason: validation.reason,
					});
				}
			}
		}

		// Build the nested structure
		let current = whereClause;
		const pathParts = [...parts];
		for (let i = 0; i < pathParts.length; i++) {
			const part = pathParts[i]!;
			const isLast = i === pathParts.length - 1;

			if (isLast) {
				// Find operator context for proper value parsing
				// Only use operator context for STRING operators (not array operators like $in, $nin)
				// Array operators' elements should be parsed normally (as numbers, strings, etc.)
				let operatorContext: string | undefined;
				const isArrayIndex = /^\d+$/.test(part);

				if (part.startsWith("$")) {
					// Current part is the operator: where[field][$op]=value
					const expectedType = getOperatorValueType(part);
					// Only set context for string operators (to prevent number coercion)
					if (expectedType === "string") {
						operatorContext = part;
					}
				}
				// Note: For array indices (e.g., $in[0]), we don't set operatorContext
				// because array elements should be parsed as their natural types

				// Parse the value with operator context
				const parsedValue = parseValue(value, operatorContext);

				// Validate operator value type only when operator itself is the last part
				// (not for array indices like $in[0], $nin[1])
				if (part.startsWith("$") && !isArrayIndex) {
					validateOperatorValue(part, parsedValue, pathParts);
				}

				current[part] = parsedValue;
			} else {
				if (current[part] === undefined) {
					current[part] = {};
				}
				current = current[part] as Record<string, unknown>;
			}
		}
	}

	// Transform into Final WhereClause
	const transformResult = transformToFinalWhere(whereClause);
	const finalClause = transformResult as FallbackWhereClause;

	// If no where parameters found, return undefined
	if (Object.keys(finalClause).length === 0) {
		return undefined;
	}

	// Validate nesting depth
	validateNestingDepth(finalClause);

	return finalClause;
}

/**
 * Post-process the object to handle logical operators which should be arrays
 */
function transformToFinalWhere(obj: unknown): unknown {
	if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
		return obj;
	}

	const typedObj = obj as Record<string, unknown>;
	const result: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(typedObj)) {
		// Operators that require array transformation
		// NOTE: $not is NOT an array operator - it takes a single object, not an array
		const arrayOperators = ["$or", "$and", "$in", "$nin"];

		if (arrayOperators.includes(key)) {
			// Transform object with numeric keys into array
			if (
				typeof value === "object" &&
				value !== null &&
				!Array.isArray(value)
			) {
				const valueObj = value as Record<string, unknown>;
				const keys = Object.keys(valueObj);

				// Validate that all keys are numeric
				const numericKeys: number[] = [];
				for (const k of keys) {
					const num = Number(k);
					if (isNaN(num) || !Number.isInteger(num) || num < 0) {
						whereError.invalidArrayIndexFormat(k, key, [key]);
					}
					numericKeys.push(num);
				}

				// Sort and validate consecutive sequence starting from 0
				const sortedKeys = numericKeys.sort((a, b) => a - b);

				if (sortedKeys.length > 0 && sortedKeys[0] !== 0) {
					whereError.arrayIndexNotStartingFromZero(sortedKeys[0]!, key, [key]);
				}

				for (let i = 0; i < sortedKeys.length; i++) {
					if (sortedKeys[i] !== i) {
						whereError.arrayIndexNotConsecutive(i, key, [key], sortedKeys);
					}
				}

				// For $in/$nin, values are primitives - don't recursively transform
				// For $or/$and, values are conditions - recursively transform
				if (["$in", "$nin"].includes(key)) {
					result[key] = sortedKeys.map((idx) => valueObj[String(idx)]);
				} else {
					const transformed: unknown[] = [];
					for (const idx of sortedKeys) {
						const transformResult = transformToFinalWhere(
							valueObj[String(idx)],
						);
						transformed.push(transformResult);
					}
					result[key] = transformed;
				}
			} else {
				const transformResult = transformToFinalWhere(value);
				result[key] = transformResult;
			}
		} else {
			const transformResult = transformToFinalWhere(value);
			result[key] = transformResult;
		}
	}

	return result;
}

/**
 * Parse value from string/array
 * Handles: strings, numbers, booleans, null, arrays (for $in, $nin)
 *
 * @param value - The raw value to parse
 * @param operator - Optional operator context for type-aware parsing
 */
function parseValue(
	value: string | readonly string[] | undefined,
	operator?: string,
): unknown {
	if (value === undefined) {
		return undefined;
	}

	// Handle array (for $in, $nin operators)
	if (Array.isArray(value)) {
		const parsed: unknown[] = [];
		for (const v of value) {
			if (typeof v === "string") {
				const result = parseSingleValue(v, operator);
				parsed.push(result);
			} else {
				parsed.push(v);
			}
		}
		return parsed;
	}

	if (typeof value === "string") {
		return parseSingleValue(value, operator);
	}

	return value;
}

/**
 * Parse a single value from string
 * Returns Result to handle validation errors
 *
 * @param value - The raw string value to parse
 * @param operator - Optional operator context for type-aware parsing
 */
function parseSingleValue(value: string, operator?: string): unknown {
	// Import MAX_WHERE_VALUE_LENGTH
	const MAX_WHERE_VALUE_LENGTH = 1000;

	// Check value length first - reject instead of truncate
	if (value.length > MAX_WHERE_VALUE_LENGTH) {
		whereError.maxValueLength(value.length, []);
	}

	// If operator expects string, return as-is (no type coercion)
	if (operator) {
		const expectedType = getOperatorValueType(operator);
		if (expectedType === "string") {
			return value;
		}
	}

	// Handle special values
	if (value === "null") {
		return null;
	}

	if (value === "true") {
		return true;
	}

	if (value === "false") {
		return false;
	}

	/*
	// Try to parse as number
	const num = Number(value);
	if (!isNaN(num) && value.trim() !== '') {
		return num;
	}
	*/

	// Return as string
	return value;
}

/**
 * Validate operator value type
 */
function validateOperatorValue(
	operator: string,
	value: unknown,
	path: string[],
): void {
	const expectedType = getOperatorValueType(operator);

	if (!expectedType) {
		// Unknown operator (shouldn't happen, already validated)
		return;
	}

	// Check type-specific requirements
	if (expectedType === "array") {
		if (!Array.isArray(value)) {
			whereError.invalidOperatorValue(operator, typeof value, path, value);
		}

		// Check if array is empty
		if ((value as []).length === 0) {
			whereError.emptyArrayOperator(operator, path);
		}
	}
}

/**
 * Validate nesting depth for logical operators
 */
function validateNestingDepth(
	clause: FallbackWhereClause,
	depth: number = 0,
	path: string[] = [],
): void {
	const MAX_LOGICAL_NESTING_DEPTH = 10;

	if (depth > MAX_LOGICAL_NESTING_DEPTH) {
		whereError.maxDepthExceeded(depth, path);
	}

	// Check nested logical operators
	for (const [key, value] of Object.entries(clause)) {
		if (isLogicalOperator(key) && Array.isArray(value)) {
			// Validate that logical operators have array of conditions
			if (value.length === 0) {
				whereError.emptyLogicalOperator(key, [...path, key]);
			}

			// Recursively check each condition
			for (const condition of value) {
				if (typeof condition === "object" && condition !== null) {
					validateNestingDepth(condition as FallbackWhereClause, depth + 1, [
						...path,
						key,
					]);
				}
			}
		} else if (
			typeof value === "object" &&
			value !== null &&
			!Array.isArray(value)
		) {
			// Recursively check nested objects
			validateNestingDepth(value as FallbackWhereClause, depth, [...path, key]);
		}
	}
}
