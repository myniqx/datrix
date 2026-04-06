/**
 * Parser Error Helpers
 *
 * Centralized error creation for all parsers.
 * Provides clean, type-safe error handling with rich context.
 */

import {
	ParserError,
	buildErrorLocation,
	type WhereErrorContext,
	type PopulateErrorContext,
	type FieldsErrorContext,
	type PaginationErrorContext,
	type SortErrorContext,
} from "@forja/core/types/api";
import {
	MAX_WHERE_VALUE_LENGTH,
	MAX_LOGICAL_NESTING_DEPTH,
} from "@forja/core/types";

/**
 * Where Parser Errors
 */
export const whereError = {
	invalidOperator(
		operator: string,
		path: string[],
		context?: Partial<WhereErrorContext>,
	) {
		throw new ParserError(`Invalid WHERE operator: ${operator}`, {
			code: "INVALID_OPERATOR",
			parser: "where",
			location: buildErrorLocation(["where", ...path], {
				queryParam: context?.operatorPath,
			}),
			received: operator,
			expected:
				"One of: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $contains, $startsWith, $endsWith, $like, $ilike, $null, $notNull, $and, $or, $not",
			suggestion:
				"Use a valid WHERE operator. See documentation for full list.",
			context: {
				operator,
				...context,
			},
		});
	},

	invalidFieldName(
		fieldName: string,
		path: string[],
		context?: Partial<WhereErrorContext>,
	) {
		const reasonDetail = context?.fieldValidationReason
			? ` (Reason: ${context.fieldValidationReason})`
			: "";

		throw new ParserError(
			`Invalid field name in WHERE clause: ${fieldName}${reasonDetail}`,
			{
				code: "INVALID_FIELD_NAME",
				parser: "where",
				location: buildErrorLocation(["where", ...path]),
				received: fieldName,
				expected:
					"Field name must start with letter/underscore and contain only alphanumeric characters, underscores, and dots",
				suggestion:
					"Use valid field names (e.g., 'name', 'user_id', 'profile.age')",
				context: {
					operator: fieldName,
					...context,
				},
			},
		);
	},

	invalidArrayIndex(
		index: string,
		operator: string,
		path: string[],
		context?: Partial<WhereErrorContext>,
	) {
		throw new ParserError(
			`Array index [${index}] can only follow array operators ($or, $and, $not, $in, $nin), found after: ${context?.previousOperator || "unknown"}`,
			{
				code: "ARRAY_INDEX_ERROR",
				parser: "where",
				location: buildErrorLocation(["where", ...path], {
					index: parseInt(index, 10),
					queryParam: context?.operatorPath,
				}),
				received: index,
				expected: "Array index after $or, $and, $not, $in, or $nin",
				suggestion: "Array indices can only be used with array operators",
				context: {
					operator,
					arrayIndex: parseInt(index, 10),
					...context,
				},
			},
		);
	},

	arrayIndexAtStart(index: string, _path: string[]): never {
		throw new ParserError(
			"Array index cannot appear at the beginning of WHERE clause",
			{
				code: "ARRAY_INDEX_ERROR",
				parser: "where",
				location: buildErrorLocation(["where"], {
					index: parseInt(index, 10),
				}),
				received: index,
				expected: "Field name or operator before array index",
				suggestion:
					"WHERE clause must start with a field name, not an array index",
				context: {
					arrayIndex: parseInt(index, 10),
				},
			},
		);
	},

	invalidArrayIndexFormat(index: string, operator: string, path: string[]) {
		throw new ParserError(
			`Invalid array index in ${operator}: ${index} (must be non-negative integer)`,
			{
				code: "ARRAY_INDEX_ERROR",
				parser: "where",
				location: buildErrorLocation(["where", ...path]),
				received: index,
				expected: "Non-negative integer (0, 1, 2, ...)",
				suggestion: "Use valid array indices starting from 0",
				context: {
					operator,
					arrayIndex: NaN,
				},
			},
		);
	},

	arrayIndexNotStartingFromZero(
		firstIndex: number,
		operator: string,
		path: string[],
	) {
		throw new ParserError(
			`Array indices for ${operator} must start from 0, found: ${firstIndex}`,
			{
				code: "CONSECUTIVE_INDEX_ERROR",
				parser: "where",
				location: buildErrorLocation(["where", ...path], {
					index: firstIndex,
				}),
				received: firstIndex,
				expected: "Array indices starting from 0",
				suggestion: "Start array indices at 0: use [0], [1], [2], etc.",
				context: {
					operator,
					arrayIndex: firstIndex,
				},
			},
		);
	},

	arrayIndexNotConsecutive(
		missingIndex: number,
		operator: string,
		path: string[],
		foundIndices?: number[],
	) {
		const indicesStr = foundIndices
			? `. Found: [${foundIndices.join(", ")}]`
			: "";

		throw new ParserError(
			`Array indices for ${operator} must be consecutive. Missing index: ${missingIndex}${indicesStr}`,
			{
				code: "CONSECUTIVE_INDEX_ERROR",
				parser: "where",
				location: buildErrorLocation(["where", ...path], {
					index: missingIndex,
				}),
				received: foundIndices
					? `Indices: [${foundIndices.join(", ")}]`
					: `Gap at index ${missingIndex}`,
				expected: "Consecutive indices: [0, 1, 2, ...]",
				suggestion: `Add ${operator}[${missingIndex}] to fix the gap`,
				context: {
					operator,
					missingIndex,
					foundIndices,
				},
			},
		);
	},

	maxValueLength(actualLength: number, path: string[]) {
		throw new ParserError(
			`WHERE value exceeds maximum length of ${MAX_WHERE_VALUE_LENGTH} characters`,
			{
				code: "MAX_LENGTH_EXCEEDED",
				parser: "where",
				location: buildErrorLocation(["where", ...path]),
				received: `${actualLength} characters`,
				expected: `Maximum ${MAX_WHERE_VALUE_LENGTH} characters`,
				suggestion:
					"Reduce the length of your query value or use a different approach",
				context: {
					operator: "value_length",
				},
			},
		);
	},

	maxDepthExceeded(depth: number, path: string[]) {
		const pathStr = path.length > 0 ? ` at path: ${path.join(".")}` : "";

		throw new ParserError(
			`WHERE clause nesting depth exceeds maximum of ${MAX_LOGICAL_NESTING_DEPTH}${pathStr}`,
			{
				code: "MAX_DEPTH_EXCEEDED",
				parser: "where",
				location: buildErrorLocation(["where", ...path], {
					depth,
				}),
				received: `Depth: ${depth}${pathStr}`,
				expected: `Maximum depth: ${MAX_LOGICAL_NESTING_DEPTH}`,
				suggestion: "Simplify query structure or split into multiple requests",
				context: {
					operator: "nesting_depth",
					currentPath: path.join("."),
					depth,
				},
			},
		);
	},

	emptyLogicalOperator(operator: string, path: string[]) {
		throw new ParserError(
			`Logical operator ${operator} requires at least one condition`,
			{
				code: "EMPTY_VALUE",
				parser: "where",
				location: buildErrorLocation(["where", ...path]),
				received: "empty array",
				expected: "At least one condition",
				suggestion: `Add at least one condition to ${operator} operator`,
				context: {
					operator,
				},
			},
		);
	},

	emptyArrayOperator(operator: string, path: string[]) {
		throw new ParserError(`Operator ${operator} requires a non-empty array`, {
			code: "EMPTY_VALUE",
			parser: "where",
			location: buildErrorLocation(["where", ...path]),
			received: "empty array",
			expected: "Non-empty array",
			suggestion: `Provide at least one value for ${operator} operator`,
			context: {
				operator,
			},
		});
	},

	invalidOperatorValue(
		operator: string,
		valueType: string,
		path: string[],
		receivedValue?: unknown,
	) {
		const valuePreview =
			receivedValue !== undefined
				? `: ${JSON.stringify(receivedValue).slice(0, 50)}`
				: "";

		throw new ParserError(
			`Operator ${operator} requires array but received ${valueType}${valuePreview}`,
			{
				code: "INVALID_VALUE_TYPE",
				parser: "where",
				location: buildErrorLocation(["where", ...path]),
				received: `${valueType}${valuePreview}`,
				expected: "array (e.g., [1, 2, 3])",
				suggestion: `Use array format: where[field][${operator}][0]=value1&where[field][${operator}][1]=value2`,
				context: {
					operator,
					receivedType: valueType,
				},
			},
		);
	},
};

/**
 * Populate Parser Errors
 */
export const populateError = {
	invalidRelation(
		relation: string,
		path: string[],
		context?: Partial<PopulateErrorContext>,
	) {
		throw new ParserError(`Invalid relation name: ${relation}`, {
			code: "INVALID_FIELD_NAME",
			parser: "populate",
			location: buildErrorLocation(["populate", ...path], {
				depth: context?.currentDepth,
			}),
			received: relation,
			expected:
				"Relation name must start with letter/underscore and contain only alphanumeric characters and underscores",
			suggestion: "Use valid relation names (e.g., 'author', 'user_profile')",
			context: {
				relation,
				...context,
			},
		});
	},

	maxDepthExceeded(
		depth: number,
		maxDepth: number,
		path: string[],
		context?: Partial<PopulateErrorContext>,
	) {
		throw new ParserError("Maximum populate depth exceeded", {
			code: "MAX_DEPTH_EXCEEDED",
			parser: "populate",
			location: buildErrorLocation(["populate", ...path], {
				depth,
			}),
			received: depth,
			expected: `Maximum depth: ${maxDepth}`,
			suggestion:
				"Reduce nesting level or increase maxPopulateDepth in parser options",
			context: {
				currentDepth: depth,
				maxDepth,
				relationPath: path.join("."),
				...context,
			},
		});
	},

	emptyValue(path: string[]) {
		throw new ParserError("Populate value cannot be empty", {
			code: "EMPTY_VALUE",
			parser: "populate",
			location: buildErrorLocation(["populate", ...path]),
			received: "empty string",
			expected: "Relation name or wildcard (*)",
			suggestion: "Provide a relation name or use * to populate all relations",
			context: {},
		});
	},

	invalidType(type: string, path: string[]) {
		throw new ParserError("Populate value must be a string or array", {
			code: "INVALID_VALUE_TYPE",
			parser: "populate",
			location: buildErrorLocation(["populate", ...path]),
			received: type,
			expected: "string or array",
			suggestion: "Use a string (e.g., 'author') or array format",
			context: {},
		});
	},

	invalidFieldName(
		fieldName: string,
		path: string[],
		context?: Partial<PopulateErrorContext>,
	): never {
		const reasonDetail = context?.fieldValidationReason
			? ` (Reason: ${context.fieldValidationReason})`
			: "";

		throw new ParserError(
			`Invalid field name in populate: ${fieldName}${reasonDetail}`,
			{
				code: "INVALID_FIELD_NAME",
				parser: "populate",
				location: buildErrorLocation(["populate", ...path]),
				received: fieldName,
				expected:
					"Field name must start with letter/underscore and contain only alphanumeric characters, underscores, and dots",
				suggestion:
					"Use valid field names (e.g., 'name', 'user_id', 'profile.age')",
				context: {
					fieldName,
					...context,
				},
			},
		);
	},
};

/**
 * Fields Parser Errors
 */
export const fieldsError = {
	invalidFieldNames(
		invalidFields: readonly string[],
		path: string[],
		context?: Partial<FieldsErrorContext>,
	) {
		const reasonDetail =
			context?.validationReasons && context.validationReasons.length > 0
				? ` (Reasons: ${context.validationReasons.join(", ")})`
				: "";

		throw new ParserError(
			`Invalid field names: ${invalidFields.join(", ")}${reasonDetail}`,
			{
				code: "INVALID_FIELD_NAME",
				parser: "fields",
				location: buildErrorLocation(["fields", ...path]),
				received: invalidFields,
				expected:
					"Field names must start with letter/underscore and contain only alphanumeric characters, underscores, and dots",
				suggestion:
					"Use valid field names (e.g., 'name', 'user_id', 'profile.age')",
				context: {
					invalidFields: invalidFields as string[],
					...context,
				},
			},
		);
	},

	emptyValue(path: string[]) {
		throw new ParserError(
			"Fields parameter is empty or contains only whitespace",
			{
				code: "EMPTY_VALUE",
				parser: "fields",
				location: buildErrorLocation(["fields", ...path]),
				received: "empty string",
				expected: "Field name(s) or wildcard (*)",
				suggestion:
					"Provide field names (e.g., 'name,email') or use * for all fields",
				context: {},
			},
		);
	},

	suspiciousParams(params: readonly string[], path: string[]) {
		throw new ParserError(`Unknown fields parameters: ${params.join(", ")}`, {
			code: "UNKNOWN_PARAMETER",
			parser: "fields",
			location: buildErrorLocation(["fields", ...path]),
			received: params,
			expected: "fields or fields[N] format",
			suggestion:
				"Use 'fields=name,email' or 'fields[0]=name&fields[1]=email' format",
			context: {
				suspiciousParams: params as string[],
			},
		});
	},

	invalidFormat(path: string[]) {
		throw new ParserError("Invalid fields format", {
			code: "INVALID_SYNTAX",
			parser: "fields",
			location: buildErrorLocation(["fields", ...path]),
			received: "unknown format",
			expected: "string or array",
			suggestion: "Use 'fields=name,email' or 'fields[0]=name' format",
			context: {},
		});
	},
};

/**
 * Pagination Parser Errors
 */
export const paginationError = {
	invalidLimit(
		value: string | number | readonly string[] | undefined,
		path: string[],
		context?: Partial<PaginationErrorContext>,
	) {
		throw new ParserError(`Invalid limit value: "${value}"`, {
			code: "INVALID_PAGINATION",
			parser: "pagination",
			location: buildErrorLocation(["pagination", ...path]),
			received: value,
			expected: "Positive integer",
			suggestion: "Provide a positive integer for limit (e.g., limit=10)",
			context: {
				parameter: "limit",
				...context,
			},
		});
	},

	invalidOffset(
		value: string | number | readonly string[] | undefined,
		path: string[],
		context?: Partial<PaginationErrorContext>,
	) {
		throw new ParserError(`Invalid offset value: "${value}"`, {
			code: "INVALID_PAGINATION",
			parser: "pagination",
			location: buildErrorLocation(["pagination", ...path]),
			received: value,
			expected: "Non-negative integer",
			suggestion: "Provide a non-negative integer for offset (e.g., offset=0)",
			context: {
				parameter: "offset",
				...context,
			},
		});
	},

	invalidPage(
		value: string | number | readonly string[],
		path: string[],
		context?: Partial<PaginationErrorContext>,
	) {
		throw new ParserError(`Invalid page value: "${value}" (must be >= 1)`, {
			code: "INVALID_PAGINATION",
			parser: "pagination",
			location: buildErrorLocation(["pagination", ...path]),
			received: value,
			expected: "Integer >= 1",
			suggestion: "Provide a positive integer for page (e.g., page=1)",
			context: {
				parameter: "page",
				minValue: 1,
				...context,
			},
		});
	},

	invalidPageSize(
		value: string | number | readonly string[] | undefined,
		path: string[],
		context?: Partial<PaginationErrorContext>,
	) {
		throw new ParserError(`Invalid pageSize value: "${value}" (must be >= 1)`, {
			code: "INVALID_PAGINATION",
			parser: "pagination",
			location: buildErrorLocation(["pagination", ...path]),
			received: value,
			expected: "Integer >= 1",
			suggestion: "Provide a positive integer for pageSize (e.g., pageSize=25)",
			context: {
				parameter: "pageSize",
				minValue: 1,
				...context,
			},
		});
	},

	maxPageSizeExceeded(value: number, max: number, path: string[]) {
		throw new ParserError(`Page size exceeds maximum (${max})`, {
			code: "MAX_VALUE_VIOLATION",
			parser: "pagination",
			location: buildErrorLocation(["pagination", ...path]),
			received: value,
			expected: `Maximum: ${max}`,
			suggestion: `Reduce pageSize to ${max} or less`,
			context: {
				parameter: "pageSize",
				maxValue: max,
			},
		});
	},

	maxLimitExceeded(value: number, max: number, path: string[]) {
		throw new ParserError(`Limit exceeds maximum page size (${max})`, {
			code: "MAX_VALUE_VIOLATION",
			parser: "pagination",
			location: buildErrorLocation(["pagination", ...path]),
			received: value,
			expected: `Maximum: ${max}`,
			suggestion: `Reduce limit to ${max} or less`,
			context: {
				parameter: "limit",
				maxValue: max,
			},
		});
	},

	maxPageNumberExceeded(value: number, max: number, path: string[]) {
		throw new ParserError(`Page number exceeds maximum (${max})`, {
			code: "PAGE_OUT_OF_RANGE",
			parser: "pagination",
			location: buildErrorLocation(["pagination", ...path]),
			received: value,
			expected: `Maximum: ${max}`,
			suggestion: `Use page number ${max} or less`,
			context: {
				parameter: "page",
				maxValue: max,
			},
		});
	},
};

/**
 * Sort Parser Errors
 */
export const sortError = {
	emptyValue(path: string[]) {
		throw new ParserError("Sort value cannot be empty", {
			code: "EMPTY_VALUE",
			parser: "sort",
			location: buildErrorLocation(["sort", ...path]),
			received: "empty string",
			expected: "Field name(s) with optional direction",
			suggestion:
				"Provide field names (e.g., 'name' or '-createdAt' for descending)",
			context: {},
		});
	},

	invalidFieldName(
		field: string,
		path: string[],
		context?: Partial<SortErrorContext>,
	) {
		const reasonDetail = context?.fieldValidationReason
			? ` (Reason: ${context.fieldValidationReason})`
			: "";

		throw new ParserError(`Invalid sort field: ${field}${reasonDetail}`, {
			code: "INVALID_FIELD_NAME",
			parser: "sort",
			location: buildErrorLocation(["sort", ...path]),
			received: field,
			expected:
				"Field name must start with letter/underscore and contain only alphanumeric characters, underscores, and dots. Use '-' prefix for descending order.",
			suggestion:
				"Use valid field names (e.g., 'name', '-createdAt', 'user.age')",
			context: {
				sortField: field,
				parameter: "sort",
				...context,
			},
		});
	},
};
