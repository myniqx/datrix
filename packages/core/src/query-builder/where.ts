/**
 * WHERE Clause Builder
 *
 * All WHERE-related operations: merging, validation, normalization.
 * Handles comparison operators, logical operators, nested conditions, and relation shortcuts.
 */

import type {
	ComparisonOperators,
	WhereClause,
} from "../types/core/query-builder";
import type {
	FieldType,
	SchemaDefinition,
	RelationField,
	ISchemaRegistry,
	ForjaEntry,
	FieldDefinition,
} from "../types/core/schema";
import {
	throwInvalidOperator,
	throwInvalidValue,
	throwMaxDepthExceeded,
	throwInvalidField,
	throwCoercionFailed,
} from "./error-helper";

/**
 * All supported comparison operators
 */
export const COMPARISON_OPERATORS = [
	"$eq",
	"$ne",
	"$gt",
	"$gte",
	"$lt",
	"$lte",
	"$in",
	"$nin",
	"$like",
	"$ilike",
	"$startsWith",
	"$endsWith",
	"$contains",
	"$notContains",
	"$icontains",
	"$regex",
	"$exists",
	"$null",
	"$notNull",
] as const;

/**
 * Operators that always expect boolean values
 */
const BOOLEAN_OPERATORS = ["$exists", "$null", "$notNull"] as const;

/**
 * Operators that always expect string values (regardless of field type)
 */
const STRING_OPERATORS = [
	"$like",
	"$ilike",
	"$startsWith",
	"$endsWith",
	"$contains",
	"$notContains",
	"$icontains",
	"$regex",
] as const;

/**
 * Coerce a value to the expected field type
 *
 * API'den gelen string değerleri schema'daki field tipine göre dönüştürür.
 *
 * @param value - The value to coerce (often a string from API)
 * @param fieldDef - Field definition from schema
 * @param fieldName - Field name for error messages
 * @returns Coerced value in the correct type
 * @throws {ForjaQueryBuilderError} If coercion fails
 *
 * @example
 * ```ts
 * coerceValue("100", { type: "number" }, "price") // → 100
 * coerceValue("true", { type: "boolean" }, "active") // → true
 * coerceValue("2024-01-01", { type: "date" }, "createdAt") // → Date object
 * coerceValue("hello", { type: "number" }, "price") // → throws error
 * ```
 */
export function coerceValue(
	value: unknown,
	fieldDef: FieldDefinition,
	fieldName: string,
): unknown {
	// null/undefined pass through
	if (value === null || value === undefined) {
		return value;
	}

	// Already correct type - no coercion needed
	if (isCorrectType(value, fieldDef.type)) {
		return value;
	}

	// String coercion based on field type
	if (typeof value === "string") {
		return coerceString(value, fieldDef.type, fieldName);
	}

	// Array coercion (for $in, $nin operators)
	if (Array.isArray(value)) {
		return value.map((item) => coerceValue(item, fieldDef, fieldName));
	}

	// Value is not string and not correct type - error
	throwCoercionFailed(fieldName, value, fieldDef.type);
}

/**
 * Check if value is already the correct type
 *
 * Supports all FieldType values from schema.ts:
 * string, number, boolean, date, json, enum, array, relation, file
 */
function isCorrectType(value: unknown, fieldType: FieldType): boolean {
	switch (fieldType) {
		case "string":
		case "enum":
		case "file":
			return typeof value === "string";
		case "number":
			return typeof value === "number" && !Number.isNaN(value);
		case "boolean":
			return typeof value === "boolean";
		case "date":
			return value instanceof Date && !Number.isNaN(value.getTime());
		case "json":
			return typeof value === "object";
		case "array":
			return Array.isArray(value);
		case "relation":
			return typeof value === "number" || typeof value === "string";
		default:
			return true;
	}
}

/**
 * Coerce string value to target type
 *
 * Supports all FieldType values from schema.ts:
 * string, number, boolean, date, json, enum, array, relation, file
 */
function coerceString(
	value: string,
	fieldType: FieldType,
	fieldName: string,
): unknown {
	switch (fieldType) {
		case "string":
		case "enum":
		case "file":
			return value;

		case "number": {
			const num = Number(value);
			if (Number.isNaN(num)) {
				throwCoercionFailed(fieldName, value, "number");
			}
			return num;
		}

		case "boolean": {
			const lower = value.toLowerCase();
			if (lower === "true" || lower === "1") {
				return true;
			}
			if (lower === "false" || lower === "0") {
				return false;
			}
			throwCoercionFailed(fieldName, value, "boolean");
		}

		case "date": {
			const date = new Date(value);
			if (Number.isNaN(date.getTime())) {
				throwCoercionFailed(fieldName, value, "date");
			}
			return date;
		}

		case "json": {
			try {
				return JSON.parse(value);
			} catch {
				throwCoercionFailed(fieldName, value, "json");
			}
		}

		case "array": {
			try {
				const parsed = JSON.parse(value);
				if (!Array.isArray(parsed)) {
					throwCoercionFailed(fieldName, value, "array");
				}
				return parsed;
			} catch {
				throwCoercionFailed(fieldName, value, "array");
			}
		}

		case "relation": {
			// Try to parse as number first, otherwise keep as string ID
			const num = Number(value);
			return Number.isNaN(num) ? value : num;
		}

		default:
			return value;
	}
}

/**
 * Maximum nesting depth for WHERE clauses to prevent stack overflow
 */
const MAX_WHERE_DEPTH = 10;

/**
 * Check if value is a comparison operator object
 */
export function isComparisonOperators(
	value: unknown,
): value is ComparisonOperators {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	return Object.keys(value).some((key) =>
		(COMPARISON_OPERATORS as readonly string[]).includes(key),
	);
}

/**
 * Check if value is a logical operator
 */
export function isLogicalOperator(key: string): boolean {
	return ["$and", "$or", "$not"].includes(key);
}

/**
 * Validate comparison operator value
 *
 * Note: This validation is lenient for string values because coercion
 * happens in normalizeWhereClause and will convert strings to proper types.
 * We only validate structural correctness here (e.g., $in must be array).
 *
 * @throws {ForjaQueryBuilderError} If operator or value is invalid
 */
export function validateComparisonOperator(
	field: string,
	operator: string,
	value: unknown,
	_fieldType: FieldType,
): void {
	switch (operator) {
		case "$eq":
		case "$ne":
			// Any primitive is valid (strings will be coerced later)
			if (
				typeof value !== "string" &&
				typeof value !== "number" &&
				typeof value !== "boolean" &&
				value !== null &&
				!(value instanceof Date)
			) {
				throwInvalidValue("where", field, value, "primitive value");
			}
			break;

		case "$gt":
		case "$gte":
		case "$lt":
		case "$lte":
			// Numbers, dates, or strings (strings will be coerced to number/date)
			if (
				typeof value !== "number" &&
				typeof value !== "string" &&
				!(value instanceof Date)
			) {
				throwInvalidValue("where", field, value, "number, Date, or string");
			}
			break;

		case "$in":
		case "$nin":
			// Array of primitives
			if (!Array.isArray(value)) {
				throwInvalidValue("where", field, value, "array");
			}
			break;

		case "$like":
		case "$ilike":
		case "$contains":
		case "$icontains":
		case "$notContains":
		case "$startsWith":
		case "$endsWith":
			// String only
			if (typeof value !== "string") {
				throwInvalidValue("where", field, value, "string");
			}
			break;

		case "$regex":
			// RegExp or string
			if (!(value instanceof RegExp) && typeof value !== "string") {
				throwInvalidValue("where", field, value, "RegExp or string");
			}
			break;

		case "$exists":
		case "$null":
		case "$notNull":
			// Boolean or string (strings like "true"/"false" will be coerced)
			if (typeof value !== "boolean" && typeof value !== "string") {
				throwInvalidValue("where", field, value, "boolean or string");
			}
			break;

		default:
			throwInvalidOperator(field, operator, COMPARISON_OPERATORS);
	}
}

/**
 * Validate where clause against schema
 * @param where - WHERE clause to validate
 * @param schema - Schema definition
 * @param schemaRegistry - Schema registry for nested relation validation
 * @param depth - Current nesting depth
 * @throws {ForjaQueryBuilderError} If where clause is invalid
 */
export function validateWhereClause<T extends ForjaEntry>(
	where: WhereClause<T>,
	schema: SchemaDefinition,
	schemaRegistry?: ISchemaRegistry,
	depth = 0,
): void {
	// Check depth limit
	if (depth > MAX_WHERE_DEPTH) {
		throwMaxDepthExceeded("where", depth, MAX_WHERE_DEPTH);
	}

	const availableFields = Object.keys(schema.fields);

	for (const [key, value] of Object.entries(where)) {
		// Handle logical operators
		if (isLogicalOperator(key)) {
			if (key === "$and" || key === "$or") {
				if (!Array.isArray(value)) {
					throwInvalidValue("where", key, value, "array of conditions");
				}

				// Recursively validate each condition
				for (const condition of value as readonly WhereClause<T>[]) {
					validateWhereClause(condition, schema, schemaRegistry, depth + 1);
				}
			} else if (key === "$not") {
				// Recursively validate nested condition
				validateWhereClause(
					value as WhereClause<T>,
					schema,
					schemaRegistry,
					depth + 1,
				);
			}
			continue;
		}

		// Check field exists in schema
		if (!availableFields.includes(key)) {
			throwInvalidField("where", key, availableFields);
		}

		const fieldDef = schema.fields[key]!;

		// Handle relation fields
		if (fieldDef.type === "relation") {
			const relationField = fieldDef as RelationField;

			// Primitive value shortcut: { category: 2 }
			if (typeof value === "string" || typeof value === "number") {
				continue;
			}

			// Object value - could be $null/$notNull or nested WHERE
			if (
				typeof value === "object" &&
				value !== null &&
				!(value instanceof Date)
			) {
				const valueObj = value as Record<string, unknown>;
				const keys = Object.keys(valueObj);

				// Check for $null or $notNull operators on relation (FK null check)
				// { organization: { $null: true } } - valid for belongsTo/hasOne
				if (
					keys.length === 1 &&
					(keys[0] === "$null" || keys[0] === "$notNull")
				) {
					const opValue = valueObj[keys[0]];
					// Validate that the value is boolean or string that can be coerced
					if (typeof opValue !== "boolean" && typeof opValue !== "string") {
						throwInvalidValue("where", key, opValue, "boolean or string");
					}
					continue;
				}

				// Nested WHERE for relation - validate against target schema
				if (schemaRegistry) {
					const targetSchema = schemaRegistry.get(relationField.model);
					if (targetSchema) {
						validateWhereClause(
							value as WhereClause<T>,
							targetSchema,
							schemaRegistry,
							depth + 1,
						);
					}
				}
			}
			continue;
		}

		// Handle comparison operators
		if (isComparisonOperators(value)) {
			const ops = value as ComparisonOperators;
			for (const [operator, opValue] of Object.entries(ops)) {
				validateComparisonOperator(key, operator, opValue, fieldDef.type);
			}
		}
		// Simple equality check
		else {
			// Validate primitive value
			if (
				typeof value !== "string" &&
				typeof value !== "number" &&
				typeof value !== "boolean" &&
				value !== null &&
				!(value instanceof Date)
			) {
				throwInvalidValue("where", key, value, "primitive value");
			}
		}
	}
}

/**
 * Normalize and validate WHERE arrays
 *
 * Complete WHERE processing pipeline:
 * 1. Merge multiple .where() calls with $and
 * 2. Validate fields and operators (BEFORE normalization)
 *    - Including nested relation WHERE validation
 * 3. Normalize relation shortcuts (category: 2 → categoryId: { $eq: 2 })
 * 4. Recursively process logical operators ($and, $or, $not)
 *
 * @param wheres - Array of where clauses from multiple .where() calls
 * @param schema - Schema definition for validation and normalization
 * @param registry - Schema registry for nested relation validation
 * @returns Normalized and validated WHERE clause
 *
 * @example
 * ```ts
 * // Multiple where calls
 * normalizeWhere([{ age: { $gte: 18 } }, { role: 'admin' }], schema, registry)
 * // → { $and: [{ age: { $gte: 18 } }, { role: 'admin' }] }
 *
 * // Relation shortcut normalization
 * normalizeWhere([{ category: 2 }], productSchema, registry)
 * // → { categoryId: { $eq: 2 } }
 *
 * // Nested relation WHERE validation
 * normalizeWhere([{ category: { invalidField: 'value' } }], productSchema, registry)
 * // → throws ForjaQueryBuilderError (invalidField doesn't exist in Category schema)
 *
 * // Validation errors caught first
 * normalizeWhere([{ invalidField: 'value' }], schema, registry)
 * // → throws ForjaQueryBuilderError (BEFORE normalization)
 * ```
 */
export function normalizeWhere<T extends ForjaEntry>(
	wheres: WhereClause<T>[] | undefined,
	schema: SchemaDefinition,
	registry: ISchemaRegistry,
): WhereClause<T> | undefined {
	if (!wheres || wheres.length === 0) {
		return undefined;
	}

	// 1. Merge multiple where clauses with $and
	let mergedWhere: WhereClause<T>;
	if (wheres.length === 1) {
		mergedWhere = wheres[0]!;
	} else {
		mergedWhere = { $and: wheres } as WhereClause<T>;
	}

	// 2. Validate BEFORE normalization (catches errors early)
	//    Including nested relation WHERE validation
	validateWhereClause(mergedWhere, schema, registry);

	// 3. Normalize relation shortcuts and logical operators
	return normalizeWhereClause(mergedWhere, schema, registry);
}

/**
 * Normalize WHERE clause recursively
 *
 * Internal function that handles:
 * - Type coercion: "100" → 100 (based on field type)
 * - Relation shortcuts: { category: 2 } → { categoryId: { $eq: 2 } }
 * - Nested relation WHERE: Recursively normalize target schema
 * - Logical operators: Recursively process $and, $or, $not
 * - Comparison operators: Coerce values inside $eq, $gt, $in, etc.
 *
 * @param where - WHERE clause to normalize
 * @param schema - Schema definition
 * @param registry - Schema registry for nested relation schemas
 * @returns Normalized WHERE clause with coerced values
 */
function normalizeWhereClause<T extends ForjaEntry>(
	where: WhereClause<T>,
	schema: SchemaDefinition,
	registry: ISchemaRegistry,
): WhereClause<T> {
	const normalized: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(where)) {
		// Handle logical operators recursively
		if (key === "$and" || key === "$or") {
			normalized[key] = (value as WhereClause<T>[]).map((clause) =>
				normalizeWhereClause(clause, schema, registry),
			);
			continue;
		}

		if (key === "$not") {
			normalized[key] = normalizeWhereClause(
				value as WhereClause<T>,
				schema,
				registry,
			);
			continue;
		}

		// Get field definition
		const fieldDef = schema.fields[key];
		if (!fieldDef) {
			// Unknown field - keep as-is (validation will catch this)
			normalized[key] = value;
			continue;
		}

		// Handle relation fields
		if (fieldDef.type === "relation") {
			const relationField = fieldDef as RelationField;
			const kind = relationField.kind;

			// Only normalize for belongsTo/hasOne (they have FK in current table)
			if (kind === "belongsTo" || kind === "hasOne") {
				const foreignKey = relationField.foreignKey!;

				// Primitive value shortcut: { category: 2 } → { categoryId: { $eq: 2 } }
				if (typeof value === "string" || typeof value === "number") {
					const coercedValue = coerceValue(value, { type: "number" }, key);
					normalized[foreignKey] = { $eq: coercedValue };
					continue;
				}

				// Object value - check if it's $null/$notNull operator for FK
				if (
					typeof value === "object" &&
					value !== null &&
					!(value instanceof Date)
				) {
					const valueObj = value as Record<string, unknown>;
					const keys = Object.keys(valueObj);

					// Check for $null or $notNull operators on relation
					// { organization: { $null: true } } → { organizationId: { $null: true } }
					if (
						keys.length === 1 &&
						(keys[0] === "$null" || keys[0] === "$notNull")
					) {
						const operator = keys[0];
						const operatorValue = valueObj[operator];
						const coercedValue = coerceValue(
							operatorValue,
							{ type: "boolean" },
							key,
						);
						normalized[foreignKey] = { [operator]: coercedValue };
						continue;
					}

					// Nested WHERE - recursively normalize with target schema
					const targetSchema = registry.get(relationField.model);
					if (targetSchema) {
						normalized[key] = normalizeWhereClause(
							value as WhereClause<T>,
							targetSchema,
							registry,
						);
						continue;
					}
				}
			}

			// hasMany/manyToMany or fallback: keep as-is
			normalized[key] = value;
			continue;
		}

		// Handle comparison operators - coerce values inside
		if (isComparisonOperators(value)) {
			const coercedOps: Record<string, unknown> = {};
			for (const [operator, opValue] of Object.entries(
				value as ComparisonOperators,
			)) {
				// Boolean operators - $exists, $null, $notNull
				if ((BOOLEAN_OPERATORS as readonly string[]).includes(operator)) {
					coercedOps[operator] = coerceValue(opValue, { type: "boolean" }, key);
				}
				// String operators - always keep as string regardless of field type
				else if ((STRING_OPERATORS as readonly string[]).includes(operator)) {
					coercedOps[operator] = opValue; // Keep as string
				}
				// All other operators - coerce based on field type
				else {
					coercedOps[operator] = coerceValue(opValue, fieldDef, key);
				}
			}
			normalized[key] = coercedOps;
			continue;
		}

		// Simple equality - coerce based on field type
		normalized[key] = coerceValue(value, fieldDef, key);
	}

	return normalized as WhereClause<T>;
}
