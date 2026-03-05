/**
 * PostgreSQL Query Translator (~350 LOC)
 *
 * Translates database-agnostic QueryObject to PostgreSQL SQL.
 * Handles WHERE clauses, JOINs, pagination, and all operators.
 */

import type {
	QueryObject,
	WhereClause,
	ComparisonOperators,
	OrderByItem,
	QueryCountObject,
	QueryInsertObject,
	QueryUpdateObject,
	QueryDeleteObject,
	QuerySelect,
} from "forja-types/core/query-builder";
import type { QueryTranslator } from "forja-types/adapter";
import { ForjaAdapterError, throwQueryError } from "forja-types/errors/adapter";
import type { SchemaRegistry } from "forja-core/schema";
import type {
	SchemaDefinition,
	FieldDefinition,
} from "forja-types/core/schema";
import { ForjaEntry } from "forja-types";
import { PostgresQueryObject, TranslateResult } from "./types";

/**
 * Maximum nesting depth for WHERE clauses to prevent stack overflow
 */
const MAX_WHERE_DEPTH = 10;

/**
 * PostgreSQL query translator implementation
 */
export class PostgresQueryTranslator implements QueryTranslator {
	private paramIndex = 0;
	private params: unknown[] = [];
	private schemaRegistry: SchemaRegistry;

	constructor(schemaRegistry: SchemaRegistry) {
		this.schemaRegistry = schemaRegistry;
	}

	/**
	 * Reset state for new query
	 */
	private reset(): void {
		this.paramIndex = 0;
		this.params = [];
	}

	/**
	 * Get parameter placeholder ($1, $2, etc.)
	 */
	getParameterPlaceholder(index: number): string {
		return `$${index}`;
	}

	/**
	 * Add parameter and return placeholder with type-aware conversion
	 *
	 * @param value - The value to add
	 * @param currentSchema - Current schema context
	 * @param fieldPath - Field path (e.g., "price", "category.name")
	 */
	private addParam(
		value: unknown,
		currentSchema?: SchemaDefinition,
		fieldPath?: string,
	): string {
		this.paramIndex++;

		let processedValue = value;

		// Type-aware conversion based on schema
		if (currentSchema && fieldPath) {
			const field = currentSchema.fields[fieldPath];

			if (field) {
				processedValue = this.convertValueToFieldType(value, field);
			} else {
				// Field not in schema - use default conversion
				processedValue = this.defaultValueConversion(value);
			}
		} else {
			// No schema context - use default conversion
			processedValue = this.defaultValueConversion(value);
		}

		this.params.push(processedValue);
		return this.getParameterPlaceholder(this.paramIndex);
	}

	/**
	 * Convert value to match field type from schema
	 */
	private convertValueToFieldType(
		value: unknown,
		field: FieldDefinition,
	): unknown {
		// Handle null/undefined
		if (value === null || value === undefined) {
			return value;
		}

		switch (field.type) {
			case "number": {
				// Convert to number if it's a numeric string
				if (typeof value === "string") {
					const numValue = Number(value);
					if (!isNaN(numValue)) {
						return numValue;
					}
				}
				return value;
			}

			case "string": {
				// Keep as string, preserve leading zeros
				if (typeof value === "number") {
					return String(value);
				}
				return value;
			}

			case "boolean": {
				// Convert string booleans
				if (typeof value === "string") {
					if (value.toLowerCase() === "true") return true;
					if (value.toLowerCase() === "false") return false;
				}
				return value;
			}

			case "date": {
				// Keep Date objects as-is
				if (value instanceof Date) {
					return value;
				}
				// Convert string to Date
				if (typeof value === "string") {
					return new Date(value);
				}
				return value;
			}

			case "json":
			case "array": {
				// Convert to JSON string for PostgreSQL JSONB
				if (
					Array.isArray(value) ||
					(typeof value === "object" && !(value instanceof Date))
				) {
					return JSON.stringify(value);
				}
				return value;
			}

			case "enum": {
				// Keep as string
				return String(value);
			}

			default:
				return this.defaultValueConversion(value);
		}
	}

	/**
	 * Default value conversion (when no schema context)
	 */
	private defaultValueConversion(value: unknown): unknown {
		// Convert arrays and objects to JSON string for PostgreSQL JSONB
		if (
			Array.isArray(value) ||
			(typeof value === "object" && value !== null && !(value instanceof Date))
		) {
			return JSON.stringify(value);
		}

		// Keep other values as-is (don't auto-convert strings to numbers)
		return value;
	}

	/**
	 * Escape identifier (table/column name)
	 */
	escapeIdentifier(identifier: string): string {
		// Handle wildcard
		if (identifier === "*") {
			return "*";
		}

		// Validate identifier format (PostgreSQL naming rules)
		// Must start with letter or underscore, followed by letters, digits, or underscores
		// Maximum length is 63 characters
		const validIdentifierPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

		if (!validIdentifierPattern.test(identifier)) {
			throwQueryError({
				adapter: "postgres",
				message: `Invalid identifier '${identifier}': must start with letter or underscore, contain only alphanumeric characters and underscores`,
			});
		}

		if (identifier.length > 63) {
			throwQueryError({
				adapter: "postgres",
				message: `Invalid identifier '${identifier}': exceeds PostgreSQL maximum length of 63 characters`,
				suggestion: "PostgreSQL identifiers must be 63 characters or less",
			});
		}

		// Escape double quotes and wrap in double quotes
		return `"${identifier.replace(/"/g, '""')}"`;
	}

	/**
	 * Escape string value (for literals)
	 */
	escapeValue(value: unknown): string {
		if (value === null || value === undefined) {
			return "NULL";
		}

		if (typeof value === "string") {
			return `'${value.replace(/'/g, "''")}'`;
		}

		if (typeof value === "number") {
			return String(value);
		}

		if (typeof value === "boolean") {
			return value ? "TRUE" : "FALSE";
		}

		if (value instanceof Date) {
			return `'${value.toISOString()}'`;
		}

		if (Array.isArray(value)) {
			// Arrays as JSONB (PostgreSQL JSONB handles arrays natively)
			return `'${JSON.stringify(value)}'::jsonb`;
		}

		// Objects as JSONB
		return `'${JSON.stringify(value)}'::jsonb`;
	}

	/**
	 * Translate main query
	 */
	translate<T extends ForjaEntry>(query: QueryObject<T>): TranslateResult {
		this.reset();

		try {
			let sql: string;

			switch (query.type) {
				case "select":
				case "count":
					sql = this.translateSelect(query);
					break;
				case "insert":
					sql = this.translateInsert(query);
					break;
				case "update":
					sql = this.translateUpdate(query);
					break;
				case "delete":
					sql = this.translateDelete(query);
					break;
				default:
					throwQueryError({
						adapter: "postgres",
						message: `Unsupported query type: ${String((query as { type: string }).type)}`,
					});
			}

			return {
				sql,
				params: [...this.params],
				needAggregation: false,
			};
		} catch (error) {
			if (error instanceof ForjaAdapterError) {
				throw error;
			}
			throwQueryError({
				adapter: "postgres",
				message: `Query translation failed: ${error instanceof Error ? error.message : String(error)}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Translate SELECT query
	 */
	private translateSelect<T extends ForjaEntry>(
		query: PostgresQueryObject<T> | QueryCountObject<T>,
	): string {
		const parts: string[] = [];

		// Schema lookup ONCE at the beginning (used by WHERE, GROUP BY, etc.)
		let currentSchema: SchemaDefinition | undefined;
		const modelName = this.schemaRegistry.findModelByTableName(query.table);
		if (modelName) {
			currentSchema = this.schemaRegistry.get(modelName);
		}

		// Handle COUNT separately (only has where, groupBy, having)
		if (query.type === "count") {
			parts.push("SELECT COUNT(*)");
			parts.push(`FROM ${this.escapeIdentifier(query.table)}`);

			if (query.where) {
				const whereResult = this.translateWhere(
					query.where,
					this.paramIndex,
					query.table,
				);
				if (whereResult.joins.length > 0) {
					parts.push(whereResult.joins.join(" "));
				}
				parts.push(`WHERE ${whereResult.sql}`);
				this.paramIndex += whereResult.params.length;
				this.params.push(...whereResult.params);
			}

			if (query.groupBy && query.groupBy.length > 0) {
				const groupByFields = query.groupBy
					.map((field) => this.escapeIdentifier(field))
					.join(", ");
				parts.push(`GROUP BY ${groupByFields}`);
			}

			if (query.having) {
				const havingResult = this.translateWhere(query.having, this.paramIndex);
				parts.push(`HAVING ${havingResult.sql}`);
				this.paramIndex += havingResult.params.length;
				this.params.push(...havingResult.params);
			}

			return parts.join(" ");
		}

		// SELECT clause for non-count queries
		{
			const baseSelect = this.translateSelectClause(query.select, query.table);

			const metadata = query._metadata;
			const populateAggregations = metadata?.populateAggregations as
				| string
				| undefined;

			if (populateAggregations) {
				parts.push(`SELECT ${baseSelect}, ${populateAggregations}`);
			} else {
				parts.push(`SELECT ${baseSelect}`);
			}
		}

		// DISTINCT
		if ("distinct" in query && query.distinct) {
			parts[0] = parts[0]!.replace("SELECT", "SELECT DISTINCT");
		}

		// FROM clause
		parts.push(`FROM ${this.escapeIdentifier(query.table)}`);

		// WHERE clause (must come before adding JOINs to parts, to collect WHERE JOINs)
		let whereSQL: string | undefined;
		let whereJoins: string[] = [];
		if (query.where) {
			const whereResult = this.translateWhere(
				query.where,
				this.paramIndex,
				query.table,
			);
			whereSQL = whereResult.sql;
			whereJoins = whereResult.joins;
			this.paramIndex += whereResult.params.length;
			this.params.push(...whereResult.params);
		}

		// Add populate JOINs
		const metadata = query._metadata;
		const populateJoins = metadata?.populateJoins as string | undefined;

		if (populateJoins) {
			parts.push(populateJoins);
		}

		// Add WHERE JOINs (only if not already in populate JOINs)
		// This prevents duplicate JOINs when WHERE filters on populated relations
		if (whereJoins.length > 0) {
			const populateJoinSQL = populateJoins || "";
			const uniqueWhereJoins = whereJoins.filter(
				(join) => !populateJoinSQL.includes(join),
			);

			if (uniqueWhereJoins.length > 0) {
				parts.push(uniqueWhereJoins.join(" "));
			}
		}

		// Add WHERE clause
		if (whereSQL) {
			parts.push(`WHERE ${whereSQL}`);
		}

		// GROUP BY (required for json_agg aggregations)
		const hasAggregations = metadata?.populateAggregations;
		if (hasAggregations && query.populate) {
			const tableEsc = this.escapeIdentifier(query.table);
			const groupByFields: string[] = [`${tableEsc}."id"`];

			// Add populated relation primary keys to GROUP BY
			// ONLY for belongsTo and hasOne (single record relations)
			// NOT for hasMany or manyToMany (array relations with json_agg)
			// Use currentSchema (already looked up at the beginning - no repeated lookup!)
			if (currentSchema) {
				for (const relationName of Object.keys(query.populate)) {
					const field = currentSchema.fields[relationName];
					if (field && field.type === "relation") {
						const relKind = (field as any).kind;
						// Only add to GROUP BY if it's a single-record relation
						if (relKind === "belongsTo" || relKind === "hasOne") {
							const relationAlias = this.escapeIdentifier(relationName);
							groupByFields.push(`${relationAlias}."id"`);
						}
					}
				}
			}

			parts.push(`GROUP BY ${groupByFields.join(", ")}`);
		} else if (
			"groupBy" in query &&
			query.groupBy &&
			query.groupBy.length > 0
		) {
			const groupByFields = query.groupBy
				.map((field) => this.escapeIdentifier(field))
				.join(", ");
			parts.push(`GROUP BY ${groupByFields}`);
		}

		// HAVING
		if ("having" in query && query.having) {
			const havingResult = this.translateWhere(query.having, this.paramIndex);
			parts.push(`HAVING ${havingResult.sql}`);
			this.paramIndex += havingResult.params.length;
			this.params.push(...havingResult.params);
		}

		// ORDER BY
		if (query.orderBy && query.orderBy.length > 0) {
			parts.push(`ORDER BY ${this.translateOrderBy(query.orderBy)}`);
		}

		// LIMIT
		if (query.limit !== undefined) {
			parts.push(`LIMIT ${this.addParam(query.limit)}`);
		}

		// OFFSET
		if (query.offset !== undefined) {
			parts.push(`OFFSET ${this.addParam(query.offset)}`);
		}

		return parts.join(" ");
	}

	/**
	 * Translate SELECT fields with aliases
	 */
	private translateSelectClause<T extends ForjaEntry>(
		select: QuerySelect<T>,
		tableAlias?: string,
	): string {
		return select
			.map((field) => {
				const escaped = this.escapeIdentifier(field as string);
				return tableAlias
					? `${this.escapeIdentifier(tableAlias)}.${escaped}`
					: escaped;
			})
			.join(", ");
	}

	/**
	 * Translate INSERT query
	 */
	private translateInsert<T extends ForjaEntry>(
		query: QueryInsertObject<T>,
	): string {
		const dataArray = Array.isArray(query.data) ? query.data : [query.data];

		if (dataArray.length === 0 || !dataArray[0]) {
			throwQueryError({
				adapter: "postgres",
				message: "INSERT query requires data",
			});
		}

		// Schema lookup ONCE
		let currentSchema: SchemaDefinition | undefined;
		const modelName = this.schemaRegistry.findModelByTableName(query.table);
		if (modelName) {
			currentSchema = this.schemaRegistry.get(modelName);
		}

		// Use keys from first item as columns
		const firstItem = dataArray[0] as Record<string, unknown>;
		const columns = Object.keys(firstItem).map((k) => this.escapeIdentifier(k));

		// Build VALUES rows
		const valueRows: string[] = [];
		for (const item of dataArray) {
			const row = item as Record<string, unknown>;
			const values = Object.keys(firstItem).map((key) =>
				this.addParam(row[key], currentSchema, key),
			);
			valueRows.push(`(${values.join(", ")})`);
		}

		const parts: string[] = [];
		parts.push(`INSERT INTO ${this.escapeIdentifier(query.table)}`);
		parts.push(`(${columns.join(", ")})`);
		parts.push(`VALUES ${valueRows.join(", ")}`);
		parts.push(`RETURNING id`);

		return parts.join(" ");
	}

	/**
	 * Translate UPDATE query
	 */
	private translateUpdate<T extends ForjaEntry>(
		query: QueryUpdateObject<T>,
	): string {
		if (!query.data || Object.keys(query.data).length === 0) {
			throwQueryError({
				adapter: "postgres",
				message: "UPDATE query requires data",
			});
		}

		// Schema lookup ONCE
		let currentSchema: SchemaDefinition | undefined;
		const modelName = this.schemaRegistry.findModelByTableName(query.table);
		if (modelName) {
			currentSchema = this.schemaRegistry.get(modelName);
		}

		const parts: string[] = [];
		const sets: string[] = [];

		parts.push(`UPDATE ${this.escapeIdentifier(query.table)}`);

		for (const [key, value] of Object.entries(query.data)) {
			sets.push(
				`${this.escapeIdentifier(key)} = ${this.addParam(value, currentSchema, key)}`,
			);
		}

		parts.push(`SET ${sets.join(", ")}`);

		// WHERE clause (important for UPDATE!)
		if (query.where) {
			const whereResult = this.translateWhere(
				query.where,
				this.paramIndex,
				query.table,
			);

			// Add WHERE JOINs if any
			if (whereResult.joins.length > 0) {
				parts.push(whereResult.joins.join(" "));
			}

			parts.push(`WHERE ${whereResult.sql}`);
			this.paramIndex += whereResult.params.length;
			this.params.push(...whereResult.params);
		}

		parts.push(`RETURNING id`);

		return parts.join(" ");
	}

	/**
	 * Translate DELETE query
	 */
	private translateDelete<T extends ForjaEntry>(
		query: QueryDeleteObject<T>,
	): string {
		const parts: string[] = [];

		parts.push(`DELETE FROM ${this.escapeIdentifier(query.table)}`);

		// WHERE clause (important for DELETE!)
		if (query.where) {
			const whereResult = this.translateWhere(
				query.where,
				this.paramIndex,
				query.table,
			);

			// Add WHERE JOINs if any
			if (whereResult.joins.length > 0) {
				parts.push(whereResult.joins.join(" "));
			}

			parts.push(`WHERE ${whereResult.sql}`);
			this.paramIndex += whereResult.params.length;
			this.params.push(...whereResult.params);
		}

		parts.push(`RETURNING id`);

		return parts.join(" ");
	}

	/**
	 * Translate SELECT clause
	 */

	/**
	 * Translate ORDER BY clause
	 */
	private translateOrderBy<T extends ForjaEntry>(
		orderBy: readonly OrderByItem<T>[],
	): string {
		return orderBy
			.map((item) => {
				let sql = this.escapeIdentifier(item.field as string);
				sql += ` ${item.direction.toUpperCase()}`;
				if (item.nulls) {
					sql += ` NULLS ${item.nulls.toUpperCase()}`;
				}
				return sql;
			})
			.join(", ");
	}

	/**
	 * Translate WHERE clause
	 */
	translateWhere<T extends ForjaEntry>(
		where: WhereClause<T>,
		startIndex: number,
		tableName?: string,
	): {
		readonly sql: string;
		readonly params: readonly unknown[];
		readonly joins: string[];
	} {
		const savedIndex = this.paramIndex;
		const savedParams = [...this.params];

		this.paramIndex = startIndex;
		this.params = [];
		const whereJoins: string[] = [];

		try {
			// Schema lookup - ONLY ONCE at the beginning
			let currentSchema: SchemaDefinition | undefined;
			if (tableName) {
				const modelName = this.schemaRegistry.findModelByTableName(tableName);
				if (modelName) {
					currentSchema = this.schemaRegistry.get(modelName);
				}
			}

			const sql = this.translateWhereConditions(
				where,
				0,
				tableName,
				undefined,
				whereJoins,
				currentSchema,
			);
			const params = [...this.params];

			// Restore state
			this.paramIndex = savedIndex;
			this.params = savedParams;

			return { sql, params, joins: whereJoins };
		} catch (error) {
			// Restore state on error
			this.paramIndex = savedIndex;
			this.params = savedParams;
			throw error;
		}
	}

	/**
	 * Translate WHERE conditions recursively
	 *
	 * @param where - WHERE clause to translate
	 * @param depth - Current nesting depth
	 * @param tableName - Table name (for JOIN generation)
	 * @param tableAlias - Table alias (for qualified field names)
	 * @param joins - Array to collect JOIN clauses
	 * @param currentSchema - Current schema context (passed down, avoids repeated lookups)
	 */
	private translateWhereConditions<T extends ForjaEntry>(
		where: WhereClause<T>,
		depth = 0,
		tableName?: string,
		tableAlias?: string,
		joins?: string[],
		currentSchema?: SchemaDefinition,
	): string {
		// Check depth limit to prevent stack overflow
		if (depth > MAX_WHERE_DEPTH) {
			throwQueryError({
				adapter: "postgres",
				message: `WHERE clause exceeds maximum nesting depth of ${MAX_WHERE_DEPTH}`,
				suggestion: `Reduce nesting depth or increase MAX_WHERE_DEPTH (current: ${MAX_WHERE_DEPTH})`,
			});
		}

		const conditions: string[] = [];
		const currentTableAlias = tableAlias || tableName;

		for (const [key, value] of Object.entries(where)) {
			// Handle logical operators
			if (key === "$and") {
				const andConditions = (value as readonly WhereClause<T>[])
					.map(
						(condition) =>
							`(${this.translateWhereConditions(condition, depth + 1, tableName, tableAlias, joins, currentSchema)})`,
					)
					.join(" AND ");
				conditions.push(`(${andConditions})`);
				continue;
			}

			if (key === "$or") {
				const orConditions = (value as readonly WhereClause<T>[])
					.map(
						(condition) =>
							`(${this.translateWhereConditions(condition, depth + 1, tableName, tableAlias, joins, currentSchema)})`,
					)
					.join(" OR ");
				conditions.push(`(${orConditions})`);
				continue;
			}

			if (key === "$not") {
				const notCondition = this.translateWhereConditions(
					value as WhereClause<T>,
					depth + 1,
					tableName,
					tableAlias,
					joins,
					currentSchema,
				);
				conditions.push(`NOT (${notCondition})`);
				continue;
			}

			// Check if this is a relation field (use currentSchema - no lookup!)
			if (currentSchema) {
				const field = currentSchema.fields[key];

				if (field && field.type === "relation") {
					// Relation field with nested conditions
					const relationField = field as {
						foreignKey?: string;
						model?: string;
					};

					// Case 1: Simple value (number/string) → foreign key equality
					// { category: 1 } → categoryId = 1
					if (
						typeof value === "number" ||
						typeof value === "string" ||
						value === null
					) {
						if (relationField.foreignKey) {
							const fkFieldName = this.escapeIdentifier(
								relationField.foreignKey,
							);
							const qualifiedFK = currentTableAlias
								? `${this.escapeIdentifier(currentTableAlias)}.${fkFieldName}`
								: fkFieldName;

							if (value === null) {
								conditions.push(`${qualifiedFK} IS NULL`);
							} else {
								// Foreign key is always number type
								conditions.push(
									`${qualifiedFK} = ${this.addParam(value, currentSchema, relationField.foreignKey)}`,
								);
							}
							continue;
						}
					}

					// Case 2: Nested object (relation filtering)
					if (
						typeof value === "object" &&
						value !== null &&
						!Array.isArray(value) &&
						!(value instanceof Date)
					) {
						const nestedValue = value as Record<string, unknown>;

						// Check if this is a simple foreign key filter (id with operators)
						const hasOnlyId =
							Object.keys(nestedValue).length === 1 && "id" in nestedValue;

						if (hasOnlyId && relationField.foreignKey) {
							// Simple case: { category: { id: { $ne: 1 } } } → categoryId <> 1
							const idValue = nestedValue["id"];
							const fkFieldName = this.escapeIdentifier(
								relationField.foreignKey,
							);
							const qualifiedFK = currentTableAlias
								? `${this.escapeIdentifier(currentTableAlias)}.${fkFieldName}`
								: fkFieldName;

							if (
								typeof idValue === "object" &&
								idValue !== null &&
								!Array.isArray(idValue)
							) {
								// Has operators: { id: { $ne: 1 } }
								const ops = idValue as ComparisonOperators;
								for (const [operator, opValue] of Object.entries(ops)) {
									conditions.push(
										this.translateComparisonOperator(
											qualifiedFK,
											operator,
											opValue,
										),
									);
								}
							} else {
								// Simple equality: { id: 1 }
								if (idValue === null) {
									conditions.push(`${qualifiedFK} IS NULL`);
								} else {
									conditions.push(
										`${qualifiedFK} = ${this.addParam(idValue, currentSchema, relationField.foreignKey)}`,
									);
								}
							}
							continue;
						} else {
							// Complex nested relation filtering - requires JOIN
							// Lookup target schema ONCE for nested level
							const targetSchema = this.schemaRegistry.get(
								relationField.model!,
							);
							if (!targetSchema) {
								throwQueryError({
									adapter: "postgres",
									message: `Target model '${relationField.model}' not found for relation '${key}'`,
									suggestion: `Ensure model '${relationField.model}' is registered in schema registry`,
								});
							}

							const targetTable =
								targetSchema.tableName ?? relationField.model!.toLowerCase();
							const foreignKey = relationField.foreignKey!;

							const sourceTableEsc = this.escapeIdentifier(
								currentTableAlias || tableName!,
							);
							const targetTableEsc = this.escapeIdentifier(targetTable);
							const relationAlias = this.escapeIdentifier(key);
							const foreignKeyEsc = this.escapeIdentifier(foreignKey);

							// Generate JOIN based on relation kind
							let joinSQL: string;
							const relKind = (relationField as any).kind;

							if (relKind === "belongsTo") {
								// Source has FK: source.foreignKey = target.id
								joinSQL = `LEFT JOIN ${targetTableEsc} AS ${relationAlias} ON ${sourceTableEsc}.${foreignKeyEsc} = ${relationAlias}."id"`;
							} else if (relKind === "hasOne" || relKind === "hasMany") {
								// Target has FK: source.id = target.foreignKey
								joinSQL = `LEFT JOIN ${targetTableEsc} AS ${relationAlias} ON ${sourceTableEsc}."id" = ${relationAlias}.${foreignKeyEsc}`;
							} else {
								throwQueryError({
									adapter: "postgres",
									message: `Relation kind '${relKind}' not yet supported for nested WHERE filtering`,
								});
							}

							// Add JOIN to collection
							if (joins && !joins.includes(joinSQL)) {
								joins.push(joinSQL);
							}

							// Recursively translate nested conditions with TARGET SCHEMA context
							// THIS IS THE KEY: We pass targetSchema for the nested level!
							const nestedCondition = this.translateWhereConditions(
								nestedValue as WhereClause<T>,
								depth + 1,
								targetTable,
								key, // Use relation name as alias
								joins,
								targetSchema,
							);

							conditions.push(nestedCondition);
							continue;
						}
					}
				}
			}

			// Regular field handling
			const fieldName = currentTableAlias
				? `${this.escapeIdentifier(currentTableAlias)}.${this.escapeIdentifier(key)}`
				: this.escapeIdentifier(key);

			// Handle comparison operators
			if (
				typeof value === "object" &&
				value !== null &&
				!Array.isArray(value) &&
				!(value instanceof Date)
			) {
				const ops = value as ComparisonOperators;
				for (const [operator, opValue] of Object.entries(ops)) {
					conditions.push(
						this.translateComparisonOperator(
							fieldName,
							operator,
							opValue,
							currentSchema,
							key,
						),
					);
				}
			} else {
				// Simple equality
				if (value === null) {
					conditions.push(`${fieldName} IS NULL`);
				} else {
					conditions.push(
						`${fieldName} = ${this.addParam(value, currentSchema, key)}`,
					);
				}
			}
		}

		return conditions.length > 0 ? conditions.join(" AND ") : "TRUE";
	}

	/**
	 * Translate comparison operator
	 */
	private translateComparisonOperator(
		fieldName: string,
		operator: string,
		value: unknown,
		currentSchema?: SchemaDefinition,
		fieldPath?: string,
	): string {
		switch (operator) {
			case "$eq":
				return value === null
					? `${fieldName} IS NULL`
					: `${fieldName} = ${this.addParam(value, currentSchema, fieldPath)}`;

			case "$ne":
				return value === null
					? `${fieldName} IS NOT NULL`
					: `${fieldName} <> ${this.addParam(value, currentSchema, fieldPath)}`;

			case "$gt":
				return `${fieldName} > ${this.addParam(value, currentSchema, fieldPath)}`;

			case "$gte":
				return `${fieldName} >= ${this.addParam(value, currentSchema, fieldPath)}`;

			case "$lt":
				return `${fieldName} < ${this.addParam(value, currentSchema, fieldPath)}`;

			case "$lte":
				return `${fieldName} <= ${this.addParam(value, currentSchema, fieldPath)}`;

			case "$in":
				if (!Array.isArray(value)) {
					throwQueryError({
						adapter: "postgres",
						message: "$in operator requires array value",
					});
				}
				if (value.length === 0) {
					return "FALSE";
				}
				return `${fieldName} IN (${value.map((v) => this.addParam(v, currentSchema, fieldPath)).join(", ")})`;

			case "$nin":
				if (!Array.isArray(value)) {
					throwQueryError({
						adapter: "postgres",
						message: "$nin operator requires array value",
					});
				}
				if (value.length === 0) {
					return "TRUE";
				}
				return `${fieldName} NOT IN (${value.map((v) => this.addParam(v, currentSchema, fieldPath)).join(", ")})`;

			case "$like":
				return `${fieldName} LIKE ${this.addParam(value, currentSchema, fieldPath)}`;

			case "$ilike":
				return `${fieldName} ILIKE ${this.addParam(value, currentSchema, fieldPath)}`;

			case "$contains":
				return `${fieldName} ILIKE ${this.addParam(`%${String(value)}%`, currentSchema, fieldPath)}`;

			case "$notContains":
				return `${fieldName} NOT ILIKE ${this.addParam(`%${String(value)}%`, currentSchema, fieldPath)}`;

			case "$startsWith":
				return `${fieldName} ILIKE ${this.addParam(`${String(value)}%`, currentSchema, fieldPath)}`;

			case "$endsWith":
				return `${fieldName} ILIKE ${this.addParam(`%${String(value)}`, currentSchema, fieldPath)}`;

			case "$regex":
				if (value instanceof RegExp) {
					return `${fieldName} ~ ${this.addParam(value.source, currentSchema, fieldPath)}`;
				}
				return `${fieldName} ~ ${this.addParam(value, currentSchema, fieldPath)}`;

			case "$exists":
				return value ? `${fieldName} IS NOT NULL` : `${fieldName} IS NULL`;

			case "$null":
				return value ? `${fieldName} IS NULL` : `${fieldName} IS NOT NULL`;

			case "$notNull":
				return value ? `${fieldName} IS NOT NULL` : `${fieldName} IS NULL`;

			default:
				throwQueryError({
					adapter: "postgres",
					message: `Unsupported operator: ${operator}`,
				});
		}
	}
}

/**
 * Create a new PostgreSQL query translator
 */
export function createPostgresTranslator(
	schemaRegistry: SchemaRegistry,
): PostgresQueryTranslator {
	return new PostgresQueryTranslator(schemaRegistry);
}
