/**
 * Core Constants
 *
 * Central location for all validation rules, limits, and operator definitions.
 * Used across parsers, query builders, and adapters.
 */

/**
 * Maximum field/column name length
 * Based on PostgreSQL limit (most restrictive common database)
 */
export const MAX_FIELD_NAME_LENGTH = 63;

/**
 * Maximum value length for WHERE clauses
 * Prevents DoS attacks with extremely large values
 */
export const MAX_WHERE_VALUE_LENGTH = 10000;

/**
 * Maximum nesting depth for logical operators ($or, $and)
 * Prevents stack overflow attacks
 */
export const MAX_LOGICAL_NESTING_DEPTH = 10;

/**
 * Maximum array index for indexed parameters (fields[N], populate[N])
 * Prevents DoS attacks with extremely large indices
 */
export const MAX_ARRAY_INDEX = 1000;

/**
 * Comparison operators for WHERE clauses
 */
export const COMPARISON_OPERATORS = [
	"$eq", // Equal
	"$ne", // Not equal
	"$gt", // Greater than
	"$gte", // Greater than or equal
	"$lt", // Less than
	"$lte", // Less than or equal
] as const;

/**
 * String operators for WHERE clauses
 */
export const STRING_OPERATORS = [
	"$contains", // String contains
	"$notContains", // String does not contain
	"$startsWith", // String starts with
	"$endsWith", // String ends with
	"$like", // SQL LIKE pattern
	"$ilike", // Case-insensitive LIKE
] as const;

/**
 * Array membership operators for WHERE clauses
 */
export const ARRAY_OPERATORS = [
	"$in", // Value in array
	"$nin", // Value not in array
] as const;

/**
 * Null check operators for WHERE clauses
 */
export const NULL_OPERATORS = [
	"$null", // IS NULL
	"$notNull", // IS NOT NULL
] as const;

/**
 * Logical operators for WHERE clauses
 */
export const LOGICAL_OPERATORS = [
	"$and", // Logical AND
	"$or", // Logical OR
	"$not", // Logical NOT
] as const;

/**
 * All valid WHERE operators
 */
export const ALL_WHERE_OPERATORS = [
	...COMPARISON_OPERATORS,
	...STRING_OPERATORS,
	...ARRAY_OPERATORS,
	...NULL_OPERATORS,
	...LOGICAL_OPERATORS,
] as const;

/**
 * Type of operator value expectations
 */
export type OperatorValueType =
	| "any" // Any primitive value
	| "array" // Must be array
	| "number" // Must be number
	| "string" // Must be string
	| "boolean" // Must be boolean
	| "conditions"; // Array of WHERE conditions (for logical operators)

/**
 * Operator validation rules
 * Defines what type of value each operator expects
 */
export const OPERATOR_VALUE_TYPES: Record<string, OperatorValueType> = {
	// Comparison operators - accept any value
	$eq: "any",
	$ne: "any",
	$gt: "any",
	$gte: "any",
	$lt: "any",
	$lte: "any",

	// String operators - must be string
	$contains: "string",
	$notContains: "string",
	$startsWith: "string",
	$endsWith: "string",
	$like: "string",
	$ilike: "string",

	// Array operators - must be array of values
	$in: "array",
	$nin: "array",

	// Null operators - boolean or no value needed
	$null: "boolean",
	$notNull: "boolean",

	// Logical operators - must be array of conditions
	$and: "conditions",
	$or: "conditions",
	$not: "conditions",
} as const;

/**
 * Check if a string is a valid WHERE operator
 */
export function isValidWhereOperator(
	operator: string,
): operator is (typeof ALL_WHERE_OPERATORS)[number] {
	return (ALL_WHERE_OPERATORS as readonly string[]).includes(operator);
}

/**
 * Check if an operator is a logical operator
 */
export function isLogicalOperator(
	operator: string,
): operator is (typeof LOGICAL_OPERATORS)[number] {
	return (LOGICAL_OPERATORS as readonly string[]).includes(operator);
}

/**
 * Check if an operator requires an array value
 */
export function requiresArrayValue(operator: string): boolean {
	return OPERATOR_VALUE_TYPES[operator] === "array";
}

/**
 * Check if an operator requires conditions (for logical operators)
 */
export function requiresConditions(operator: string): boolean {
	return OPERATOR_VALUE_TYPES[operator] === "conditions";
}

/**
 * Get expected value type for an operator
 */
export function getOperatorValueType(
	operator: string,
): OperatorValueType | undefined {
	return OPERATOR_VALUE_TYPES[operator];
}

/**
 * Internal metadata table name used by all adapters to store schema snapshots
 */
export const FORJA_META_MODEL = "_forja";

/**
 * Key prefix for schema entries stored in the _forja metadata table
 */
export const FORJA_META_KEY_PREFIX = "_schema_";

/**
 * Field name validation pattern
 * Must start with letter or underscore, contain only alphanumeric, underscores, and dots
 */
export const FIELD_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;

/**
 * Control characters pattern (dangerous in all contexts)
 */
export const CONTROL_CHARS_PATTERN = /[\x00-\x1F\x7F]/;

/**
 * Reserved field names (prototype pollution protection)
 */
export const RESERVED_FIELD_NAMES = [
	"__proto__",
	"constructor",
	"prototype",
] as const;

/**
 * Field validation failure reasons
 */
export type FieldInvalidReason =
	| "EMPTY"
	| "TOO_LONG"
	| "RESERVED_FIELD"
	| "CONTROL_CHARS"
	| "INVALID_FORMAT";

/**
 * Field validation result with detailed reason
 */
export type FieldValidationResult =
	| { valid: true }
	| { valid: false; reason: FieldInvalidReason; detail?: string };

/**
 * Validate field name with detailed reason on failure
 *
 * @param fieldName - Field name to validate
 * @returns Validation result with reason if invalid
 */
export function validateFieldName(fieldName: string): FieldValidationResult {
	// Empty or whitespace-only
	if (!fieldName || fieldName.trim() === "") {
		return { valid: false, reason: "EMPTY" };
	}

	// Length check
	if (fieldName.length > MAX_FIELD_NAME_LENGTH) {
		return {
			valid: false,
			reason: "TOO_LONG",
			detail: `Max ${MAX_FIELD_NAME_LENGTH} characters`,
		};
	}

	// Reserved fields check (prototype pollution protection)
	if (
		RESERVED_FIELD_NAMES.includes(
			fieldName as (typeof RESERVED_FIELD_NAMES)[number],
		)
	) {
		return { valid: false, reason: "RESERVED_FIELD", detail: fieldName };
	}

	// Control characters check
	if (CONTROL_CHARS_PATTERN.test(fieldName)) {
		return { valid: false, reason: "CONTROL_CHARS" };
	}

	// Format check
	if (!FIELD_NAME_PATTERN.test(fieldName)) {
		return { valid: false, reason: "INVALID_FORMAT" };
	}

	return { valid: true };
}

/**
 * Validate field name against universal rules (simple boolean)
 *
 * @param fieldName - Field name to validate
 * @returns True if valid, false otherwise
 */
export function isValidFieldName(fieldName: string): boolean {
	return validateFieldName(fieldName).valid;
}
