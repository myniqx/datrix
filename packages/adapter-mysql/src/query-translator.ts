/**
 * MySQL Query Translator
 *
 * Translates database-agnostic QueryObject to MySQL SQL.
 * Handles WHERE clauses, JOINs, pagination, and all operators.
 */

import type {
	QueryObject,
	WhereClause,
	ComparisonOperators,
	OrderByItem,
	QueryInsertObject,
	QueryUpdateObject,
	QueryDeleteObject,
	QuerySelect,
	QueryCountObject,
} from "@forja/core";
import type { QueryTranslator } from "@forja/core";
import { ForjaAdapterError, throwQueryError } from "@forja/core";
import type {
	SchemaDefinition,
	FieldDefinition,
	ISchemaRegistry,
} from "@forja/core";
import { ForjaEntry } from "@forja/core";
import { MySQLQueryObject, TranslateResult } from "./types";
import { escapeIdentifier, escapeValue } from "./helpers";

/**
 * Maximum nesting depth for WHERE clauses to prevent stack overflow
 */
const MAX_WHERE_DEPTH = 10;

/**
 * MySQL query translator implementation
 */
export class MySQLQueryTranslator implements QueryTranslator {
	private paramIndex = 0;
	private params: unknown[] = [];
	private schemaRegistry: ISchemaRegistry;

	constructor(schemaRegistry: ISchemaRegistry) {
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
	 * Get parameter placeholder (MySQL uses ?)
	 */
	getParameterPlaceholder(_index: number): string {
		return "?";
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
		return "?";
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
				// Convert to 1/0 for MySQL TINYINT
				if (typeof value === "boolean") {
					return value ? 1 : 0;
				}
				if (typeof value === "string") {
					if (value.toLowerCase() === "true") return 1;
					if (value.toLowerCase() === "false") return 0;
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
				// Convert to JSON string for MySQL JSON type
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
		// Convert arrays and objects to JSON string for MySQL JSON type
		if (
			Array.isArray(value) ||
			(typeof value === "object" && value !== null && !(value instanceof Date))
		) {
			return JSON.stringify(value);
		}

		// Keep other values as-is (don't auto-convert strings to numbers)
		return value;
	}

	// Interface delegation to standalone helpers
	escapeIdentifier(identifier: string): string {
		return escapeIdentifier(identifier);
	}
	escapeValue(value: unknown): string {
		return escapeValue(value);
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
					sql = this.translateSelect(query as MySQLQueryObject<T>);
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
						adapter: "mysql",
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
				adapter: "mysql",
				message: `Query translation failed: ${error instanceof Error ? error.message : String(error)}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Translate SELECT query
	 */
	private translateSelect<T extends ForjaEntry>(
		query: MySQLQueryObject<T> | QueryCountObject<T>,
	): string {
		const parts: string[] = [];

		// Schema lookup ONCE at the beginning
		let currentSchema: SchemaDefinition | undefined;
		const modelName = this.schemaRegistry.findModelByTableName(query.table);
		if (modelName) {
			currentSchema = this.schemaRegistry.get(modelName);
		}

		// Handle COUNT separately (only has where, groupBy, having)
		if (query.type === "count") {
			parts.push("SELECT COUNT(*) as `count`");
			parts.push(`FROM ${escapeIdentifier(query.table)}`);

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
					.map((field) => escapeIdentifier(field))
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
		parts.push(`FROM ${escapeIdentifier(query.table)}`);

		// WHERE clause (collect JOINs)
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
		if (whereJoins.length > 0) {
			const populateJoinSQL = populateJoins || "";
			const uniqueWhereJoins = whereJoins.filter(
				(join) => !populateJoinSQL.includes(join),
			);

			if (uniqueWhereJoins.length > 0) {
				parts.push(uniqueWhereJoins.join(" "));
				// WHERE JOINs (especially manyToMany) can produce duplicate rows
				parts[0] = parts[0]!.replace("SELECT", "SELECT DISTINCT");
			}
		}

		// Add WHERE clause
		if (whereSQL) {
			parts.push(`WHERE ${whereSQL}`);
		}

		// GROUP BY (required for JSON aggregations)
		const hasAggregations = metadata?.populateAggregations;
		if (hasAggregations && query.populate) {
			const tableEsc = escapeIdentifier(query.table);
			const groupByFields: string[] = [`${tableEsc}.\`id\``];

			// Add populated relation primary keys to GROUP BY
			// ONLY for belongsTo and hasOne (single record relations)
			if (currentSchema) {
				for (const relationName of Object.keys(query.populate)) {
					const field = currentSchema.fields[relationName];
					if (field && field.type === "relation") {
						const relKind = (field as { kind?: string }).kind;
						if (relKind === "belongsTo" || relKind === "hasOne") {
							const relationAlias = escapeIdentifier(relationName);
							groupByFields.push(`${relationAlias}.\`id\``);
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
				.map((field) => escapeIdentifier(field))
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
			parts.push(
				`ORDER BY ${this.translateOrderBy(query.orderBy as unknown as readonly OrderByItem<ForjaEntry>[])}`,
			);
		}

		// LIMIT (MySQL requires LIMIT when OFFSET is used)
		if (query.limit !== undefined) {
			parts.push(`LIMIT ${this.addParam(query.limit)}`);
		} else if (query.offset !== undefined) {
			// MySQL/MariaDB: OFFSET without LIMIT is a syntax error
			parts.push(`LIMIT ${this.addParam(2147483647)}`);
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
		select: QuerySelect<T> | undefined,
		tableAlias?: string,
	): string {
		if (!select) {
			return tableAlias ? `${escapeIdentifier(tableAlias)}.*` : "*";
		}

		return select
			.map((field) => {
				const escaped = escapeIdentifier(field as string);
				return tableAlias
					? `${escapeIdentifier(tableAlias)}.${escaped}`
					: escaped;
			})
			.join(", ");
	}

	/**
	 * Translate INSERT query with bulk support
	 */
	private translateInsert<T extends ForjaEntry>(
		query: QueryInsertObject<T>,
	): string {
		const dataArray = Array.isArray(query.data) ? query.data : [query.data];

		if (dataArray.length === 0 || !dataArray[0]) {
			throwQueryError({
				adapter: "mysql",
				message: "INSERT query requires data",
			});
		}

		// Schema lookup ONCE
		let currentSchema: SchemaDefinition | undefined;
		const modelName = this.schemaRegistry.findModelByTableName(query.table);
		if (modelName) {
			currentSchema = this.schemaRegistry.get(modelName);
		}

		// Collect all unique keys across all items for column list
		const columnSet = new Set<string>();
		for (const item of dataArray) {
			for (const key of Object.keys(item as Record<string, unknown>)) {
				columnSet.add(key);
			}
		}
		const columnKeys = [...columnSet];
		const columns = columnKeys.map((k) => escapeIdentifier(k));

		// Build VALUES rows (missing keys get DEFAULT)
		const valueRows: string[] = [];
		for (const item of dataArray) {
			const row = item as Record<string, unknown>;
			const values = columnKeys.map((key) => {
				if (key in row) {
					return this.addParam(row[key], currentSchema, key);
				}
				return "DEFAULT";
			});
			valueRows.push(`(${values.join(", ")})`);
		}

		const parts: string[] = [];
		parts.push(`INSERT INTO ${escapeIdentifier(query.table)}`);
		parts.push(`(${columns.join(", ")})`);
		parts.push(`VALUES ${valueRows.join(", ")}`);

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
				adapter: "mysql",
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
		const tableName = escapeIdentifier(query.table);

		parts.push(`UPDATE ${tableName}`);

		// Process WHERE first to get JOINs, but defer adding params
		let whereSql: string | undefined;
		let whereJoins: string[] = [];
		if (query.where) {
			const whereResult = this.translateWhere(
				query.where,
				0, // placeholder index, will be adjusted
				query.table,
			);
			whereSql = whereResult.sql;
			whereJoins = whereResult.joins;
		}

		// MySQL UPDATE JOIN syntax: UPDATE t JOIN ... SET ... WHERE ...
		if (whereJoins.length > 0) {
			parts.push(whereJoins.join(" "));
		}

		const hasJoins = whereJoins.length > 0;
		for (const [key, value] of Object.entries(query.data)) {
			const col = hasJoins
				? `${tableName}.${escapeIdentifier(key)}`
				: escapeIdentifier(key);
			sets.push(`${col} = ${this.addParam(value, currentSchema, key)}`);
		}

		parts.push(`SET ${sets.join(", ")}`);

		// Now add WHERE params (after SET params, matching SQL order)
		if (whereSql) {
			// Re-translate WHERE with correct param offset
			const whereResult = this.translateWhere(
				query.where!,
				this.paramIndex,
				query.table,
			);
			parts.push(`WHERE ${whereResult.sql}`);
			this.paramIndex += whereResult.params.length;
			this.params.push(...whereResult.params);
		}

		return parts.join(" ");
	}

	/**
	 * Translate DELETE query
	 */
	private translateDelete<T extends ForjaEntry>(
		query: QueryDeleteObject<T>,
	): string {
		const parts: string[] = [];
		const tableName = escapeIdentifier(query.table);

		// WHERE clause
		if (query.where) {
			const whereResult = this.translateWhere(
				query.where,
				this.paramIndex,
				query.table,
			);

			if (whereResult.joins.length > 0) {
				// MySQL multi-table DELETE syntax: DELETE t FROM t JOIN ... WHERE ...
				parts.push(`DELETE ${tableName} FROM ${tableName}`);
				parts.push(whereResult.joins.join(" "));
			} else {
				parts.push(`DELETE FROM ${tableName}`);
			}

			parts.push(`WHERE ${whereResult.sql}`);
			this.paramIndex += whereResult.params.length;
			this.params.push(...whereResult.params);
		} else {
			parts.push(`DELETE FROM ${tableName}`);
		}

		return parts.join(" ");
	}

	/**
	 * Translate ORDER BY clause
	 * Note: MySQL doesn't support NULLS FIRST/LAST natively, use workaround
	 */
	private translateOrderBy<T extends ForjaEntry>(
		orderBy: readonly OrderByItem<T>[],
	): string {
		return orderBy
			.map((item) => {
				const field = escapeIdentifier(item.field as string);
				const direction = item.direction.toUpperCase();

				if (item.nulls) {
					const nullsFirst = item.nulls.toUpperCase() === "FIRST";
					return `CASE WHEN ${field} IS NULL THEN ${nullsFirst ? 0 : 1} ELSE ${nullsFirst ? 1 : 0} END, ${field} ${direction}`;
				}

				return `${field} ${direction}`;
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
		tableAlias?: string,
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
				tableAlias,
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
				adapter: "mysql",
				message: `WHERE clause exceeds maximum nesting depth of ${MAX_WHERE_DEPTH}`,
			});
		}

		const conditions: string[] = [];
		const currentTableAlias = tableAlias || tableName;

		for (const [key, value] of Object.entries(where)) {
			// Handle logical operators
			if (key === "$and" || key === "$or") {
				const operator = key === "$and" ? "AND" : "OR";
				const joinedConditions = (value as readonly WhereClause<T>[])
					.map(
						(condition) =>
							`(${this.translateWhereConditions(condition, depth + 1, tableName, tableAlias, joins, currentSchema)})`,
					)
					.join(` ${operator} `);
				conditions.push(`(${joinedConditions})`);
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
						kind?: string;
					};

					// Case 1: Simple value (number/string) -> foreign key equality
					if (
						typeof value === "number" ||
						typeof value === "string" ||
						value === null
					) {
						if (relationField.foreignKey) {
							const fkFieldName = escapeIdentifier(relationField.foreignKey);
							const qualifiedFK = currentTableAlias
								? `${escapeIdentifier(currentTableAlias)}.${fkFieldName}`
								: fkFieldName;

							if (value === null) {
								conditions.push(`${qualifiedFK} IS NULL`);
							} else {
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
							// Simple case: { category: { id: { $ne: 1 } } } -> categoryId <> 1
							const idValue = nestedValue["id"];
							const fkFieldName = escapeIdentifier(relationField.foreignKey);
							const qualifiedFK = currentTableAlias
								? `${escapeIdentifier(currentTableAlias)}.${fkFieldName}`
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
							const targetSchema = this.schemaRegistry.get(
								relationField.model!,
							);
							if (!targetSchema) {
								// TODO: bunlar zaten query builderde yakalaniyor.. tekrara gerek var mi
								throwQueryError({
									adapter: "mysql",
									message: `Target model '${relationField.model}' not found for relation '${key}'`,
								});
							}

							const targetTable =
								targetSchema.tableName ?? relationField.model!.toLowerCase();

							const sourceTableEsc = escapeIdentifier(
								currentTableAlias || tableName!,
							);
							const targetTableEsc = escapeIdentifier(targetTable);
							const relationAlias = escapeIdentifier(key);

							// Generate JOIN based on relation kind
							let joinSQL: string;
							const relKind = relationField.kind;

							if (relKind === "belongsTo") {
								const foreignKeyEsc = escapeIdentifier(
									relationField.foreignKey!,
								);
								// Source has FK: source.foreignKey = target.id
								joinSQL = `LEFT JOIN ${targetTableEsc} AS ${relationAlias} ON ${sourceTableEsc}.${foreignKeyEsc} = ${relationAlias}.\`id\``;
							} else if (relKind === "hasOne" || relKind === "hasMany") {
								const foreignKeyEsc = escapeIdentifier(
									relationField.foreignKey!,
								);
								// Target has FK: source.id = target.foreignKey
								joinSQL = `LEFT JOIN ${targetTableEsc} AS ${relationAlias} ON ${sourceTableEsc}.\`id\` = ${relationAlias}.${foreignKeyEsc}`;
							} else if (relKind === "manyToMany") {
								// ManyToMany: requires junction table (two JOINs)
								const junctionTable = (relationField as { through?: string })
									.through!;
								const currentModelName =
									this.schemaRegistry.findModelByTableName(tableName!);
								const currentSchemaForFK = currentModelName
									? this.schemaRegistry.get(currentModelName)
									: currentSchema;
								const sourceFK = `${currentSchemaForFK?.name ?? currentModelName}Id`;
								const targetFK = `${relationField.model}Id`;

								const junctionAlias = `${key}_junction`;
								const junctionTableEsc = escapeIdentifier(junctionTable);
								const junctionAliasEsc = escapeIdentifier(junctionAlias);
								const sourceFKEsc = escapeIdentifier(sourceFK);
								const targetFKEsc = escapeIdentifier(targetFK);

								const junctionJoin = `LEFT JOIN ${junctionTableEsc} AS ${junctionAliasEsc} ON ${sourceTableEsc}.\`id\` = ${junctionAliasEsc}.${sourceFKEsc}`;
								const targetJoin = `LEFT JOIN ${targetTableEsc} AS ${relationAlias} ON ${junctionAliasEsc}.${targetFKEsc} = ${relationAlias}.\`id\``;

								if (joins && !joins.includes(junctionJoin)) {
									joins.push(junctionJoin);
								}
								joinSQL = targetJoin;
							} else {
								throwQueryError({
									adapter: "mysql",
									message: `Relation kind '${relKind}' not supported for nested WHERE filtering`,
								});
							}

							// Add JOIN to collection
							if (joins && !joins.includes(joinSQL)) {
								joins.push(joinSQL);
							}

							// Recursively translate nested conditions with TARGET SCHEMA context
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
				? `${escapeIdentifier(currentTableAlias)}.${escapeIdentifier(key)}`
				: escapeIdentifier(key);

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
					// TODO: bu verinin de query builderde normalize edilmesi lazim.
					throwQueryError({
						adapter: "mysql",
						message: "$in operator requires array value",
					});
				}
				if (value.length === 0) {
					return "FALSE";
				}
				return `${fieldName} IN (${value.map((v) => this.addParam(v, currentSchema, fieldPath)).join(", ")})`;

			case "$nin":
				if (!Array.isArray(value)) {
					// TODO: bu verinin de query builderde normalize edilmesi lazim.
					throwQueryError({
						adapter: "mysql",
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
				// MySQL doesn't have ILIKE, use LOWER() workaround
				return `LOWER(${fieldName}) LIKE LOWER(${this.addParam(value, currentSchema, fieldPath)})`;

			case "$contains":
				return `LOWER(${fieldName}) LIKE LOWER(${this.addParam(`%${String(value)}%`, currentSchema, fieldPath)})`;

			case "$notContains":
				return `LOWER(${fieldName}) NOT LIKE LOWER(${this.addParam(`%${String(value)}%`, currentSchema, fieldPath)})`;

			case "$startsWith":
				return `LOWER(${fieldName}) LIKE LOWER(${this.addParam(`${String(value)}%`, currentSchema, fieldPath)})`;

			case "$endsWith":
				return `LOWER(${fieldName}) LIKE LOWER(${this.addParam(`%${String(value)}`, currentSchema, fieldPath)})`;

			case "$regex":
				// MySQL uses REGEXP
				if (value instanceof RegExp) {
					return `${fieldName} REGEXP ${this.addParam(value.source, currentSchema, fieldPath)}`;
				}
				return `${fieldName} REGEXP ${this.addParam(value, currentSchema, fieldPath)}`;

			case "$exists":
				return value ? `${fieldName} IS NOT NULL` : `${fieldName} IS NULL`;

			case "$null":
				return value ? `${fieldName} IS NULL` : `${fieldName} IS NOT NULL`;

			case "$notNull":
				return value ? `${fieldName} IS NOT NULL` : `${fieldName} IS NULL`;

			default:
				throwQueryError({
					adapter: "mysql",
					message: `Unsupported operator: ${operator}`,
				});
		}
	}
}
