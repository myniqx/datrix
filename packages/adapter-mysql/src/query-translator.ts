/**
 * MySQL Query Translator
 *
 * Translates database-agnostic QueryObject to MySQL SQL.
 * Handles WHERE clauses, JOINs, pagination, and all operators.
 *
 * TODO: Extract common SQL logic into BaseSQLTranslator class
 * that can be shared between MySQL and SQLite adapters.
 * See PLAN.md for detailed refactoring plan.
 */

import type {
	QueryObject,
	WhereClause,
	SelectClause,
	ComparisonOperators,
	OrderByItem,
} from "forja-types/core/query-builder";
import type { QueryTranslator } from "forja-types/adapter";
import { QueryError } from "forja-types/adapter";
import type { SchemaRegistry } from "forja-core/schema";
import type { RelationField } from "forja-types/core/schema";

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
	 * Get parameter placeholder (MySQL uses ?)
	 */
	getParameterPlaceholder(_index: number): string {
		return "?";
	}

	/**
	 * Add parameter and return placeholder
	 */
	private addParam(value: unknown): string {
		this.paramIndex++;
		this.params.push(value);
		return "?";
	}

	/**
	 * Escape identifier (table/column name) - MySQL uses backticks
	 */
	escapeIdentifier(identifier: string): string {
		if (identifier === "*") {
			return "*";
		}

		const validIdentifierPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

		if (!validIdentifierPattern.test(identifier)) {
			throw new QueryError(
				`Invalid identifier '${identifier}': must start with letter or underscore, contain only alphanumeric characters and underscores`,
			);
		}

		if (identifier.length > 64) {
			throw new QueryError(
				`Invalid identifier '${identifier}': exceeds MySQL maximum length of 64 characters`,
			);
		}

		return `\`${identifier.replace(/`/g, "``")}\``;
	}

	/**
	 * Escape string value (for literals)
	 */
	escapeValue(value: unknown): string {
		if (value === null || value === undefined) {
			return "NULL";
		}

		if (typeof value === "string") {
			return `'${value.replace(/'/g, "''").replace(/\\/g, "\\\\")}'`;
		}

		if (typeof value === "number") {
			return String(value);
		}

		if (typeof value === "boolean") {
			return value ? "1" : "0";
		}

		if (value instanceof Date) {
			return `'${value.toISOString().slice(0, 19).replace("T", " ")}'`;
		}

		if (Array.isArray(value)) {
			return `JSON_ARRAY(${value.map((v) => this.escapeValue(v)).join(", ")})`;
		}

		return `CAST('${JSON.stringify(value).replace(/'/g, "''")}' AS JSON)`;
	}

	/**
	 * Translate main query
	 */
	translate(query: QueryObject): {
		readonly sql: string;
		readonly params: readonly unknown[];
	} {
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
					throw new QueryError(
						`Unsupported query type: ${String((query as { type: string }).type)}`,
					);
			}

			return {
				sql,
				params: [...this.params],
			};
		} catch (error) {
			if (error instanceof QueryError) {
				throw error;
			}
			throw new QueryError(
				`Query translation failed: ${error instanceof Error ? error.message : String(error)}`,
				{ query: query as QueryObject },
			);
		}
	}

	/**
	 * Translate SELECT query
	 */
	private translateSelect(query: QueryObject): string {
		const parts: string[] = [];

		if (query.type === "count") {
			parts.push("SELECT COUNT(*)");
		} else {
			parts.push(
				`SELECT ${this.translateSelectClause(query.select, query.table)}`,
			);
		}

		if ("distinct" in query && query.distinct) {
			parts[0] = parts[0]!.replace("SELECT", "SELECT DISTINCT");
		}

		parts.push(`FROM ${this.escapeIdentifier(query.table)}`);

		const joins = this.generateJoins(query);
		if (joins) {
			parts.push(joins);
		}

		if (query.where) {
			const whereResult = this.translateWhere(query.where, this.paramIndex);
			parts.push(`WHERE ${whereResult.sql}`);
			this.paramIndex += whereResult.params.length;
			this.params.push(...whereResult.params);
		}

		if ("groupBy" in query && query.groupBy && query.groupBy.length > 0) {
			const groupByFields = query.groupBy
				.map((field) => this.escapeIdentifier(field))
				.join(", ");
			parts.push(`GROUP BY ${groupByFields}`);
		}

		if ("having" in query && query.having) {
			const havingResult = this.translateWhere(query.having, this.paramIndex);
			parts.push(`HAVING ${havingResult.sql}`);
			this.paramIndex += havingResult.params.length;
			this.params.push(...havingResult.params);
		}

		if (query.orderBy && query.orderBy.length > 0) {
			parts.push(`ORDER BY ${this.translateOrderBy(query.orderBy)}`);
		}

		if (query.limit !== undefined) {
			parts.push(`LIMIT ${this.addParam(query.limit)}`);
		}

		if (query.offset !== undefined) {
			parts.push(`OFFSET ${this.addParam(query.offset)}`);
		}

		return parts.join(" ");
	}

	/**
	 * Translate SELECT fields with aliases
	 */
	private translateSelectClause(
		select: SelectClause | undefined,
		tableAlias?: string,
	): string {
		if (!select || select === "*") {
			return tableAlias ? `${this.escapeIdentifier(tableAlias)}.*` : "*";
		}

		return select
			.map((field) => {
				const escaped = this.escapeIdentifier(field);
				return tableAlias
					? `${this.escapeIdentifier(tableAlias)}.${escaped}`
					: escaped;
			})
			.join(", ");
	}

	/**
	 * Generate JOIN clauses from populate and relation metadata
	 */
	private generateJoins(query: QueryObject): string {
		if (!query.populate) {
			return "";
		}

		// Find current schema from table name
		const currentModelName = this.schemaRegistry.findModelByTableName(
			query.table,
		);
		if (!currentModelName) {
			throw new QueryError(`Model not found for table: ${query.table}`);
		}

		const currentSchema = this.schemaRegistry.get(currentModelName);
		if (!currentSchema) {
			throw new QueryError(`Schema not found for model: ${currentModelName}`);
		}

		const parts: string[] = [];

		for (const [relationName, _options] of Object.entries(query.populate)) {
			// Get relation field from current schema
			const relationField = currentSchema.fields[relationName];
			if (!relationField) {
				throw new QueryError(
					`Relation field '${relationName}' not found in schema '${currentSchema.name}'`,
				);
			}

			if (relationField.type !== "relation") {
				throw new QueryError(
					`Field '${relationName}' is not a relation field in schema '${currentSchema.name}'`,
				);
			}

			const relField = relationField as RelationField;
			const targetModelName = relField.model;
			const foreignKey = relField.foreignKey!;
			const kind = relField.kind;

			// Get target schema
			const targetSchema = this.schemaRegistry.get(targetModelName);
			if (!targetSchema) {
				throw new QueryError(
					`Target model '${targetModelName}' not found for relation '${relationName}'`,
				);
			}

			const targetTable = this.escapeIdentifier(
				targetSchema.tableName ?? targetModelName.toLowerCase(),
			);
			const sourceTable = this.escapeIdentifier(query.table);
			const fk = this.escapeIdentifier(foreignKey);

			// Generate JOIN based on relation kind
			if (kind === "belongsTo") {
				// Source has FK: source.foreignKey = target.id
				parts.push(
					`LEFT JOIN ${targetTable} ON ${sourceTable}.${fk} = ${targetTable}.\`id\``,
				);
			} else if (kind === "hasOne" || kind === "hasMany") {
				// Target has FK: source.id = target.foreignKey
				parts.push(
					`LEFT JOIN ${targetTable} ON ${sourceTable}.\`id\` = ${targetTable}.${fk}`,
				);
			}
			// TODO: Handle manyToMany with join tables
		}

		return parts.join(" ");
	}

	/**
	 * Translate INSERT query
	 * Note: MySQL doesn't support RETURNING, use lastInsertId instead
	 */
	private translateInsert(query: QueryObject): string {
		if (!query.data || Object.keys(query.data).length === 0) {
			throw new QueryError("INSERT query requires data");
		}

		const parts: string[] = [];
		const columns: string[] = [];
		const values: string[] = [];

		for (const [key, value] of Object.entries(query.data)) {
			columns.push(this.escapeIdentifier(key));
			values.push(this.addParam(value));
		}

		parts.push(`INSERT INTO ${this.escapeIdentifier(query.table)}`);
		parts.push(`(${columns.join(", ")})`);
		parts.push(`VALUES (${values.join(", ")})`);

		return parts.join(" ");
	}

	/**
	 * Translate UPDATE query
	 */
	private translateUpdate(query: QueryObject): string {
		if (!query.data || Object.keys(query.data).length === 0) {
			throw new QueryError("UPDATE query requires data");
		}

		const parts: string[] = [];
		const sets: string[] = [];

		parts.push(`UPDATE ${this.escapeIdentifier(query.table)}`);

		for (const [key, value] of Object.entries(query.data)) {
			sets.push(`${this.escapeIdentifier(key)} = ${this.addParam(value)}`);
		}

		parts.push(`SET ${sets.join(", ")}`);

		if (query.where) {
			const whereResult = this.translateWhere(query.where, this.paramIndex);
			parts.push(`WHERE ${whereResult.sql}`);
			this.paramIndex += whereResult.params.length;
			this.params.push(...whereResult.params);
		}

		return parts.join(" ");
	}

	/**
	 * Translate DELETE query
	 */
	private translateDelete(query: QueryObject): string {
		const parts: string[] = [];

		parts.push(`DELETE FROM ${this.escapeIdentifier(query.table)}`);

		if (query.where) {
			const whereResult = this.translateWhere(query.where, this.paramIndex);
			parts.push(`WHERE ${whereResult.sql}`);
			this.paramIndex += whereResult.params.length;
			this.params.push(...whereResult.params);
		}

		return parts.join(" ");
	}

	/**
	 * Translate ORDER BY clause
	 * Note: MySQL doesn't support NULLS FIRST/LAST natively, use workaround
	 */
	private translateOrderBy(orderBy: readonly OrderByItem[]): string {
		return orderBy
			.map((item) => {
				const field = this.escapeIdentifier(item.field);
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
	translateWhere(
		where: WhereClause,
		startIndex: number,
	): {
		readonly sql: string;
		readonly params: readonly unknown[];
	} {
		const savedIndex = this.paramIndex;
		const savedParams = [...this.params];

		this.paramIndex = startIndex;
		this.params = [];

		try {
			const sql = this.translateWhereConditions(where);
			const params = [...this.params];

			this.paramIndex = savedIndex;
			this.params = savedParams;

			return { sql, params };
		} catch (error) {
			this.paramIndex = savedIndex;
			this.params = savedParams;
			throw error;
		}
	}

	/**
	 * Translate WHERE conditions recursively
	 */
	private translateWhereConditions(where: WhereClause, depth = 0): string {
		if (depth > MAX_WHERE_DEPTH) {
			throw new QueryError(
				`WHERE clause exceeds maximum nesting depth of ${MAX_WHERE_DEPTH}`,
			);
		}

		const conditions: string[] = [];

		for (const [key, value] of Object.entries(where)) {
			if (key === "$and") {
				const andConditions = (value as readonly WhereClause[])
					.map(
						(condition) =>
							`(${this.translateWhereConditions(condition, depth + 1)})`,
					)
					.join(" AND ");
				conditions.push(`(${andConditions})`);
				continue;
			}

			if (key === "$or") {
				const orConditions = (value as readonly WhereClause[])
					.map(
						(condition) =>
							`(${this.translateWhereConditions(condition, depth + 1)})`,
					)
					.join(" OR ");
				conditions.push(`(${orConditions})`);
				continue;
			}

			if (key === "$not") {
				const notCondition = this.translateWhereConditions(
					value as WhereClause,
					depth + 1,
				);
				conditions.push(`NOT (${notCondition})`);
				continue;
			}

			const fieldName = this.escapeIdentifier(key);

			if (
				typeof value === "object" &&
				value !== null &&
				!Array.isArray(value) &&
				!(value instanceof Date)
			) {
				const ops = value as ComparisonOperators;
				for (const [operator, opValue] of Object.entries(ops)) {
					conditions.push(
						this.translateComparisonOperator(fieldName, operator, opValue),
					);
				}
			} else {
				if (value === null) {
					conditions.push(`${fieldName} IS NULL`);
				} else {
					conditions.push(`${fieldName} = ${this.addParam(value)}`);
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
	): string {
		switch (operator) {
			case "$eq":
				return value === null
					? `${fieldName} IS NULL`
					: `${fieldName} = ${this.addParam(value)}`;

			case "$ne":
				return value === null
					? `${fieldName} IS NOT NULL`
					: `${fieldName} <> ${this.addParam(value)}`;

			case "$gt":
				return `${fieldName} > ${this.addParam(value)}`;

			case "$gte":
				return `${fieldName} >= ${this.addParam(value)}`;

			case "$lt":
				return `${fieldName} < ${this.addParam(value)}`;

			case "$lte":
				return `${fieldName} <= ${this.addParam(value)}`;

			case "$in":
				if (!Array.isArray(value)) {
					throw new QueryError(`$in operator requires array value`);
				}
				if (value.length === 0) {
					return "FALSE";
				}
				return `${fieldName} IN (${value.map((v) => this.addParam(v)).join(", ")})`;

			case "$nin":
				if (!Array.isArray(value)) {
					throw new QueryError(`$nin operator requires array value`);
				}
				if (value.length === 0) {
					return "TRUE";
				}
				return `${fieldName} NOT IN (${value.map((v) => this.addParam(v)).join(", ")})`;

			case "$like":
				return `${fieldName} LIKE ${this.addParam(value)}`;

			case "$ilike":
				return `LOWER(${fieldName}) LIKE LOWER(${this.addParam(value)})`;

			case "$contains":
				return `LOWER(${fieldName}) LIKE LOWER(${this.addParam(`%${String(value)}%`)})`;

			case "$startsWith":
				return `LOWER(${fieldName}) LIKE LOWER(${this.addParam(`${String(value)}%`)})`;

			case "$endsWith":
				return `LOWER(${fieldName}) LIKE LOWER(${this.addParam(`%${String(value)}`)})`;

			case "$regex":
				if (value instanceof RegExp) {
					return `${fieldName} REGEXP ${this.addParam(value.source)}`;
				}
				return `${fieldName} REGEXP ${this.addParam(value)}`;

			case "$exists":
				return value ? `${fieldName} IS NOT NULL` : `${fieldName} IS NULL`;

			case "$null":
				return value ? `${fieldName} IS NULL` : `${fieldName} IS NOT NULL`;

			default:
				throw new QueryError(`Unsupported operator: ${operator}`);
		}
	}
}

/**
 * Create a new MySQL query translator
 */
export function createMySQLTranslator(
	schemaRegistry: SchemaRegistry,
): MySQLQueryTranslator {
	return new MySQLQueryTranslator(schemaRegistry);
}
