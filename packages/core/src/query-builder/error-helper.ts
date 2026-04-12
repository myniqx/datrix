/**
 * Query Builder Error Helpers
 *
 * Centralized error creation for query builder operations.
 * Covers: builder, where, select, populate, pagination components.
 */

import {
	DatrixQueryBuilderError,
	type QueryBuilderComponent,
} from "../types/errors";

/**
 * Throw invalid field error
 *
 * @param component - Query builder component
 * @param field - Field name
 * @param availableFields - List of valid fields
 *
 * @example
 * ```ts
 * throwInvalidField('select', 'invalidField', ['id', 'name', 'email']);
 * ```
 */
export function throwInvalidField(
	component: QueryBuilderComponent,
	field: string,
	availableFields?: readonly string[],
): never {
	throw new DatrixQueryBuilderError(
		`Invalid field '${field}' in ${component} clause`,
		{
			code: "INVALID_FIELD",
			component,
			field,
			context: availableFields ? { availableFields } : undefined,
			suggestion: availableFields
				? `Use one of: ${availableFields.join(", ")}`
				: `Check that '${field}' exists in the schema`,
			expected: availableFields ? availableFields.join(" | ") : undefined,
			received: field,
		},
	);
}

/**
 * Throw invalid operator error
 *
 * @param field - Field name
 * @param operator - Invalid operator
 * @param validOperators - List of valid operators
 *
 * @example
 * ```ts
 * throwInvalidOperator('age', '$invalid', ['$eq', '$ne', '$gt', '$lt']);
 * ```
 */
export function throwInvalidOperator(
	field: string,
	operator: string,
	validOperators: readonly string[],
): never {
	throw new DatrixQueryBuilderError(
		`Invalid operator '${operator}' for field '${field}'`,
		{
			code: "INVALID_OPERATOR",
			component: "where",
			field,
			context: { operator, validOperators },
			suggestion: `Use one of: ${validOperators.join(", ")}`,
			expected: validOperators.join(" | "),
			received: operator,
		},
	);
}

/**
 * Throw invalid value error
 *
 * @param component - Query builder component
 * @param field - Field name
 * @param value - Invalid value
 * @param expectedType - Expected type
 *
 * @example
 * ```ts
 * throwInvalidValue('where', 'age', 'invalid', 'number');
 * ```
 */
export function throwInvalidValue(
	component: QueryBuilderComponent,
	field: string,
	value: unknown,
	expectedType: string,
): never {
	const receivedType = Array.isArray(value)
		? "array"
		: value === null
			? "null"
			: typeof value;

	throw new DatrixQueryBuilderError(
		`Invalid value for field '${field}'. Expected ${expectedType}, got ${receivedType}`,
		{
			code: "INVALID_VALUE",
			component,
			field,
			context: { value, expectedType, receivedType },
			suggestion: `Provide a ${expectedType} value for '${field}'`,
			expected: expectedType,
			received: value,
		},
	);
}

/**
 * Throw max depth exceeded error
 *
 * @param component - Query builder component
 * @param currentDepth - Current nesting depth
 * @param maxDepth - Maximum allowed depth
 *
 * @example
 * ```ts
 * throwMaxDepthExceeded('where', 11, 10);
 * ```
 */
export function throwMaxDepthExceeded(
	component: QueryBuilderComponent,
	currentDepth: number,
	maxDepth: number,
): never {
	throw new DatrixQueryBuilderError(
		`Maximum nesting depth exceeded in ${component} clause. Depth: ${currentDepth}, Max: ${maxDepth}`,
		{
			code: "MAX_DEPTH_EXCEEDED",
			component,
			context: { depth: currentDepth, maxDepth },
			suggestion: `Reduce nesting depth to ${maxDepth} or less`,
			expected: `depth <= ${maxDepth}`,
			received: currentDepth,
		},
	);
}

/**
 * Throw empty clause error
 *
 * @param component - Query builder component
 *
 * @example
 * ```ts
 * throwEmptyClause('select');
 * ```
 */
export function throwEmptyClause(component: QueryBuilderComponent): never {
	throw new DatrixQueryBuilderError(`Empty ${component} clause`, {
		code: "EMPTY_CLAUSE",
		component,
		suggestion: `Provide at least one item in ${component} clause`,
	});
}

/**
 * Throw duplicate field error
 *
 * @param component - Query builder component
 * @param field - Duplicate field name
 *
 * @example
 * ```ts
 * throwDuplicateField('select', 'email');
 * ```
 */
export function throwDuplicateField(
	component: QueryBuilderComponent,
	field: string,
): never {
	throw new DatrixQueryBuilderError(
		`Duplicate field '${field}' in ${component} clause`,
		{
			code: "DUPLICATE_FIELD",
			component,
			field,
			suggestion: `Remove duplicate '${field}' field`,
		},
	);
}

/**
 * Throw missing table error
 *
 * @example
 * ```ts
 * throwMissingTable();
 * ```
 */
export function throwMissingTable(): never {
	throw new DatrixQueryBuilderError("Query must have a table name", {
		code: "MISSING_TABLE",
		component: "builder",
		suggestion:
			"Call .from('tableName') or .table('tableName') before building",
	});
}

/**
 * Throw missing WHERE clause error for DELETE queries
 */
export function throwDeleteWithoutWhere(): never {
	throw new DatrixQueryBuilderError(
		"DELETE query requires a WHERE clause. Use deleteAll() to delete all records explicitly.",
		{
			code: "DELETE_WITHOUT_WHERE",
			component: "builder",
			suggestion:
				"Add .where() clause or use deleteAll() for full table deletion",
		},
	);
}

/**
 * Throw missing data error for INSERT/UPDATE queries
 */
export function throwMissingData(queryType: "insert" | "update"): never {
	throw new DatrixQueryBuilderError(
		`${queryType.toUpperCase()} query requires data`,
		{
			code: "MISSING_DATA",
			component: "builder",
			suggestion:
				queryType === "insert"
					? "Provide at least one data item to insert"
					: "Provide data object with fields to update",
		},
	);
}

/**
 * Throw invalid query type error
 *
 * @param receivedType - Received query type
 *
 * @example
 * ```ts
 * throwInvalidQueryType('invalid');
 * ```
 */
export function throwInvalidQueryType(receivedType: unknown): never {
	throw new DatrixQueryBuilderError(`Invalid query type: ${receivedType}`, {
		code: "INVALID_QUERY_TYPE",
		component: "builder",
		suggestion: "Use one of: select, insert, update, delete, count",
		expected: "select | insert | update | delete | count",
		received: receivedType,
	});
}

/**
 * Throw schema not found error
 *
 * @param modelName - Model name that was not found
 *
 * @example
 * ```ts
 * throwSchemaNotFound('InvalidModel');
 * ```
 */
export function throwSchemaNotFound(modelName: string): never {
	throw new DatrixQueryBuilderError(
		`Schema not found for model: ${modelName}`,
		{
			code: "SCHEMA_NOT_FOUND",
			component: "builder",
			context: { modelName },
			suggestion: `Check that '${modelName}' is registered in the schema registry`,
			received: modelName,
		},
	);
}

/**
 * Throw multiple invalid fields error
 *
 * @param component - Query builder component
 * @param invalidFields - List of invalid field names
 * @param availableFields - List of valid fields
 *
 * @example
 * ```ts
 * throwInvalidFields('select', ['field1', 'field2'], ['id', 'name', 'email']);
 * ```
 */
export function throwInvalidFields(
	component: QueryBuilderComponent,
	invalidFields: readonly string[],
	availableFields?: readonly string[],
): never {
	const fieldList = invalidFields.join(", ");
	throw new DatrixQueryBuilderError(
		`Invalid field(s) in ${component} clause: ${fieldList}`,
		{
			code: "INVALID_FIELD",
			component,
			field: invalidFields[0],
			context: { invalidFields, availableFields },
			suggestion: availableFields
				? `Use one of: ${availableFields.join(", ")}`
				: `Check that these fields exist in the schema`,
			expected: availableFields ? availableFields.join(" | ") : undefined,
			received: fieldList,
		},
	);
}

/**
 * Throw relation field in select error
 *
 * @param relationFields - List of relation field names
 * @param modelName - Model name
 *
 * @example
 * ```ts
 * throwRelationInSelect(['category', 'author'], 'Product');
 * ```
 */
export function throwRelationInSelect(
	relationFields: readonly string[],
	modelName: string,
): never {
	const fieldList = relationFields.join(", ");
	throw new DatrixQueryBuilderError(
		`Cannot select relation field(s) in model '${modelName}': ${fieldList}. Use populate() to include relations.`,
		{
			code: "RELATION_IN_SELECT",
			component: "select",
			field: relationFields[0],
			context: { relationFields, modelName },
			suggestion: `Use .populate('${relationFields[0]}') instead of selecting it`,
		},
	);
}

/**
 * Throw type coercion failed error
 *
 * @param field - Field name
 * @param value - Value that failed coercion
 * @param expectedType - Expected type
 *
 * @example
 * ```ts
 * throwCoercionFailed('price', 'invalid', 'number');
 * // Error: Cannot convert value 'invalid' to number for field 'price'
 * ```
 */
export function throwCoercionFailed(
	field: string,
	value: unknown,
	expectedType: string,
): never {
	const displayValue = typeof value === "string" ? `'${value}'` : String(value);
	throw new DatrixQueryBuilderError(
		`Cannot convert value ${displayValue} to ${expectedType} for field '${field}'`,
		{
			code: "COERCION_FAILED",
			component: "where",
			field,
			context: { value, expectedType, receivedType: typeof value },
			suggestion: `Provide a valid ${expectedType} value for '${field}'`,
			expected: expectedType,
			received: value,
		},
	);
}
