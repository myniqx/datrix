/**
 * Field Validator Implementation (~150 LOC)
 *
 * Validates individual field values against their field definitions.
 * Zero external dependencies - all validation is custom.
 *
 * TODO: Add native 'email' field type for automatic email validation
 * Currently, email validation requires explicit pattern in schema:
 * { type: 'string', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ }
 * Future: { type: 'email', required: true }
 */

import type {
	FieldDefinition,
	StringField,
	NumberField,
	EnumField,
	ArrayField,
	DateField,
} from "@forja/core/types/core/schema";
import { createValidationError, formatErrorMessage } from "./errors";
import { FieldValidationResult } from "@forja/core/types/core/validator";

/**
 * Type guards
 */
const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number =>
	typeof value === "number" && !isNaN(value);
const isBoolean = (value: unknown): value is boolean =>
	typeof value === "boolean";
const isDate = (value: unknown): value is Date =>
	value instanceof Date && !isNaN(value.getTime());
const isArray = (value: unknown): value is readonly unknown[] =>
	Array.isArray(value);
const isNullOrUndefined = (value: unknown): value is null | undefined =>
	value === null || value === undefined;

/**
 * Maximum nesting depth for array/object validation
 */
const MAX_VALIDATION_DEPTH = 10;

/**
 * Main field validator function
 */
export function validateField<T = unknown>(
	value: unknown,
	field: FieldDefinition,
	fieldName: string,
	depth = 0,
): FieldValidationResult<T> {
	// Check depth limit to prevent infinite recursion
	if (depth > MAX_VALIDATION_DEPTH) {
		return {
			success: false,
			error: [
				createValidationError(
					fieldName,
					"CUSTOM",
					`Maximum validation depth (${MAX_VALIDATION_DEPTH}) exceeded`,
					{ value: depth },
				),
			],
		};
	}
	// Check required
	if (field.required && isNullOrUndefined(value)) {
		return {
			success: false,
			error: [
				createValidationError(
					fieldName,
					"REQUIRED",
					formatErrorMessage("REQUIRED", fieldName),
				),
			],
		};
	}

	// If optional and null/undefined, skip validation
	if (!field.required && isNullOrUndefined(value)) {
		return { success: true, data: value as T };
	}

	// Type-specific validation
	switch (field.type) {
		case "string":
			return validateString(
				value,
				field as StringField,
				fieldName,
			) as FieldValidationResult<T>;
		case "number":
			return validateNumber(
				value,
				field as NumberField,
				fieldName,
			) as FieldValidationResult<T>;
		case "boolean":
			return validateBoolean(value, fieldName) as FieldValidationResult<T>;
		case "date":
			return validateDate(
				value,
				field as DateField,
				fieldName,
			) as FieldValidationResult<T>;
		case "enum":
			return validateEnum(
				value,
				field as EnumField,
				fieldName,
			) as FieldValidationResult<T>;
		case "array":
			return validateArray(
				value,
				field as ArrayField,
				fieldName,
				depth,
			) as FieldValidationResult<T>;
		case "json":
			return validateJSON(value, fieldName) as FieldValidationResult<T>;
		case "relation":
			return validateRelation(value, fieldName) as FieldValidationResult<T>;
		default:
			return { success: true, data: value as T };
	}
}

/**
 * Validate string field
 */
function validateString(
	value: unknown,
	field: StringField,
	fieldName: string,
): FieldValidationResult<string> {
	if (!isString(value)) {
		return {
			success: false,
			error: [
				createValidationError(
					fieldName,
					"TYPE_MISMATCH",
					formatErrorMessage("TYPE_MISMATCH", fieldName, {
						expected: "string",
						actual: typeof value,
					}),
				),
			],
		};
	}

	const errors = [];

	// Min length
	if (field.minLength !== undefined && value.length < field.minLength) {
		errors.push(
			createValidationError(
				fieldName,
				"MIN_LENGTH",
				formatErrorMessage("MIN_LENGTH", fieldName, { min: field.minLength }),
				{ value: value.length, expected: field.minLength },
			),
		);
	}

	// Max length
	if (field.maxLength !== undefined && value.length > field.maxLength) {
		errors.push(
			createValidationError(
				fieldName,
				"MAX_LENGTH",
				formatErrorMessage("MAX_LENGTH", fieldName, { max: field.maxLength }),
				{ value: value.length, expected: field.maxLength },
			),
		);
	}

	// Pattern
	if (field.pattern && !field.pattern.test(value)) {
		errors.push(
			createValidationError(
				fieldName,
				"PATTERN",
				formatErrorMessage("PATTERN", fieldName, { pattern: field.pattern }),
				{ value },
			),
		);
	}

	// Custom validator
	if (field.validator) {
		const result = field.validator(value);
		if (result !== true) {
			errors.push(
				createValidationError(fieldName, "CUSTOM", result, { value }),
			);
		}
	}

	if (errors.length > 0) {
		return { success: false, error: errors };
	}

	return { success: true, data: value };
}

/**
 * Validate number field
 */
function validateNumber(
	value: unknown,
	field: NumberField,
	fieldName: string,
): FieldValidationResult<number> {
	if (!isNumber(value)) {
		return {
			success: false,
			error: [
				createValidationError(
					fieldName,
					"TYPE_MISMATCH",
					formatErrorMessage("TYPE_MISMATCH", fieldName, {
						expected: "number",
						actual: typeof value,
					}),
				),
			],
		};
	}

	const errors = [];

	// Integer check
	if (field.integer && !Number.isInteger(value)) {
		errors.push(
			createValidationError(
				fieldName,
				"INVALID_FORMAT",
				`Field '${fieldName}' must be an integer`,
				{ value },
			),
		);
	}

	// Min value
	if (field.min !== undefined && value < field.min) {
		errors.push(
			createValidationError(
				fieldName,
				"MIN_VALUE",
				formatErrorMessage("MIN_VALUE", fieldName, { min: field.min }),
				{ value, expected: field.min },
			),
		);
	}

	// Max value
	if (field.max !== undefined && value > field.max) {
		errors.push(
			createValidationError(
				fieldName,
				"MAX_VALUE",
				formatErrorMessage("MAX_VALUE", fieldName, { max: field.max }),
				{ value, expected: field.max },
			),
		);
	}

	// Custom validator
	if (field.validator) {
		const result = field.validator(value);
		if (result !== true) {
			errors.push(
				createValidationError(fieldName, "CUSTOM", result, { value }),
			);
		}
	}

	if (errors.length > 0) {
		return { success: false, error: errors };
	}

	return { success: true, data: value };
}

/**
 * Validate boolean field
 */
function validateBoolean(
	value: unknown,
	fieldName: string,
): FieldValidationResult<boolean> {
	if (!isBoolean(value)) {
		return {
			success: false,
			error: [
				createValidationError(
					fieldName,
					"TYPE_MISMATCH",
					formatErrorMessage("TYPE_MISMATCH", fieldName, {
						expected: "boolean",
						actual: typeof value,
					}),
				),
			],
		};
	}

	return { success: true, data: value };
}

/**
 * Validate date field
 */
function validateDate(
	value: unknown,
	field: DateField,
	fieldName: string,
): FieldValidationResult<Date> {
	// First check if it's a Date object at all (not string, not number)
	if (!(value instanceof Date)) {
		return {
			success: false,
			error: [
				createValidationError(
					fieldName,
					"TYPE_MISMATCH",
					formatErrorMessage("TYPE_MISMATCH", fieldName, {
						expected: "Date",
						actual: typeof value,
					}),
				),
			],
		};
	}

	// Then check if it's a valid Date (not NaN)
	if (!isDate(value)) {
		return {
			success: false,
			error: [
				createValidationError(
					fieldName,
					"INVALID_DATE",
					formatErrorMessage("INVALID_DATE", fieldName),
				),
			],
		};
	}

	const errors = [];

	// Min date
	if (field.min && value < field.min) {
		errors.push(
			createValidationError(
				fieldName,
				"MIN_VALUE",
				`Field '${fieldName}' must be after ${field.min.toISOString()}`,
				{ value, expected: field.min },
			),
		);
	}

	// Max date
	if (field.max && value > field.max) {
		errors.push(
			createValidationError(
				fieldName,
				"MAX_VALUE",
				`Field '${fieldName}' must be before ${field.max.toISOString()}`,
				{ value, expected: field.max },
			),
		);
	}

	if (errors.length > 0) {
		return { success: false, error: errors };
	}

	return { success: true, data: value };
}

/**
 * Validate enum field
 */
function validateEnum(
	value: unknown,
	field: EnumField,
	fieldName: string,
): FieldValidationResult<string> {
	if (!isString(value)) {
		return {
			success: false,
			error: [
				createValidationError(
					fieldName,
					"TYPE_MISMATCH",
					formatErrorMessage("TYPE_MISMATCH", fieldName, {
						expected: "string",
						actual: typeof value,
					}),
				),
			],
		};
	}

	if (!field.values.includes(value)) {
		return {
			success: false,
			error: [
				createValidationError(
					fieldName,
					"INVALID_ENUM",
					formatErrorMessage("INVALID_ENUM", fieldName, {
						expected: field.values.join(", "),
					}),
					{ value, expected: field.values },
				),
			],
		};
	}

	return { success: true, data: value };
}

/**
 * Validate array field
 */
function validateArray(
	value: unknown,
	field: ArrayField,
	fieldName: string,
	depth: number,
): FieldValidationResult<readonly unknown[]> {
	if (!isArray(value)) {
		return {
			success: false,
			error: [
				createValidationError(
					fieldName,
					"TYPE_MISMATCH",
					formatErrorMessage("TYPE_MISMATCH", fieldName, {
						expected: "array",
						actual: typeof value,
					}),
				),
			],
		};
	}

	const errors = [];

	// Min items
	if (field.minItems !== undefined && value.length < field.minItems) {
		errors.push(
			createValidationError(
				fieldName,
				"MIN_ITEMS",
				formatErrorMessage("MIN_ITEMS", fieldName, { min: field.minItems }),
				{ value: value.length, expected: field.minItems },
			),
		);
	}

	// Max items
	if (field.maxItems !== undefined && value.length > field.maxItems) {
		errors.push(
			createValidationError(
				fieldName,
				"MAX_ITEMS",
				formatErrorMessage("MAX_ITEMS", fieldName, { max: field.maxItems }),
				{ value: value.length, expected: field.maxItems },
			),
		);
	}

	// Unique items check
	if (field.unique) {
		const seen = new Set<unknown>();
		const duplicates = new Set<unknown>();

		for (const item of value) {
			// Use JSON.stringify for deep comparison of objects/arrays
			const itemKey =
				typeof item === "object" && item !== null ? JSON.stringify(item) : item;

			if (seen.has(itemKey)) {
				duplicates.add(item);
			} else {
				seen.add(itemKey);
			}
		}

		if (duplicates.size > 0) {
			errors.push(
				createValidationError(
					fieldName,
					"UNIQUE",
					formatErrorMessage("UNIQUE", fieldName),
					{ value: Array.from(duplicates) },
				),
			);
		}
	}

	// Validate each item
	for (let i = 0; i < value.length; i++) {
		const item = value[i];
		const itemResult = validateField(
			item,
			field.items,
			`${fieldName}[${i}]`,
			depth + 1,
		);
		if (!itemResult.success) {
			errors.push(...itemResult.error);
		}
	}

	if (errors.length > 0) {
		return { success: false, error: errors };
	}

	return { success: true, data: value };
}

/**
 * Validate JSON field
 * JSON fields can be objects, arrays, or any valid JSON type
 */
function validateJSON(
	value: unknown,
	fieldName: string,
): FieldValidationResult<unknown> {
	// JSON field accepts: objects, arrays, strings, numbers, booleans, null
	// Reject: undefined, Date objects (should be serialized to string first)
	if (value === undefined || isDate(value)) {
		return {
			success: false,
			error: [
				createValidationError(
					fieldName,
					"TYPE_MISMATCH",
					formatErrorMessage("TYPE_MISMATCH", fieldName, {
						expected:
							"valid JSON type (object, array, string, number, boolean, null)",
						actual: value === undefined ? "undefined" : "Date",
					}),
				),
			],
		};
	}

	return { success: true, data: value };
}

/**
 * Validate relation field
 * Supports both shortcut (ID) and RelationInput object
 */
function validateRelation(
	value: unknown,
	fieldName: string,
): FieldValidationResult<unknown> {
	// 1. Shortcut: ID (string or number)
	if (typeof value === "string" || typeof value === "number") {
		return { success: true, data: value };
	}

	// 2. RelationInput object: { connect, disconnect, set, create, update, delete }
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		const input = value as Record<string, unknown>;
		const validKeys = [
			"connect",
			"disconnect",
			"set",
			"create",
			"update",
			"delete",
		];

		// Check if at least one valid key exists
		const hasValidKey = validKeys.some((key) => key in input);
		if (!hasValidKey) {
			return {
				success: false,
				error: [
					createValidationError(
						fieldName,
						"INVALID_FORMAT",
						`Relation field '${fieldName}' must be an ID or a valid RelationInput object`,
						{ value },
					),
				],
			};
		}

		// Structural validation for common keys (shallow)
		if (input["connect"]) {
			const connect = input["connect"];
			if (Array.isArray(connect)) {
				if (!connect.every((item) => typeof item === "number")) {
					return {
						success: false,
						error: [
							createValidationError(
								fieldName,
								"INVALID_FORMAT",
								"connect must be a number or array of numbers",
							),
						],
					};
				}
			} else if (typeof connect !== "number") {
				return {
					success: false,
					error: [
						createValidationError(
							fieldName,
							"INVALID_FORMAT",
							"connect must be a number or array of numbers",
						),
					],
				};
			}
		}

		// If 'set' is provided, it must be an array of numbers
		if (input["set"]) {
			if (
				!Array.isArray(input["set"]) ||
				!(input["set"] as unknown[]).every((item) => typeof item === "number")
			) {
				return {
					success: false,
					error: [
						createValidationError(
							fieldName,
							"INVALID_FORMAT",
							"set must be an array of numbers",
						),
					],
				};
			}
		}

		return { success: true, data: value };
	}

	return {
		success: false,
		error: [
			createValidationError(
				fieldName,
				"TYPE_MISMATCH",
				formatErrorMessage("TYPE_MISMATCH", fieldName, {
					expected: "ID or RelationInput object",
					actual: typeof value,
				}),
			),
		],
	};
}
