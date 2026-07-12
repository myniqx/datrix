/**
 * MongoDB Query Translator
 *
 * Translates database-agnostic QueryObject into MongoDB operation descriptors.
 * Unlike SQL translators that produce SQL strings, this produces
 * MongoDB filter/update/pipeline objects.
 */

import type { Document, Filter, Sort } from "mongodb";
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
	QuerySelectObject,
	ISchemaRegistry,
} from "@datrix/core";
import type { SchemaDefinition, FieldDefinition } from "@datrix/core";
import { DatrixEntry } from "@datrix/core";
import { throwQueryError } from "@datrix/core";
import type {
	MongoTranslateResult,
	MongoFindResult,
	MongoInsertResult,
	MongoUpdateResult,
	MongoDeleteResult,
	MongoCountResult,
} from "./types";
import { validateIdentifier } from "./helpers";

/**
 * Maximum nesting depth for WHERE clauses to prevent stack overflow
 */
const MAX_WHERE_DEPTH = 10;

/**
 * MongoDB query translator implementation
 */
export class MongoDBQueryTranslator {
	constructor(private readonly schemaRegistry: ISchemaRegistry) {}

	/**
	 * Translate a QueryObject into a MongoDB operation descriptor
	 */
	translate<T extends DatrixEntry>(
		query: QueryObject<T>,
	): MongoTranslateResult {
		switch (query.type) {
			case "select":
				return this.translateSelect(query as QuerySelectObject<T>);
			case "count":
				return this.translateCount(query as QueryCountObject<T>);
			case "insert":
				return this.translateInsert(query as QueryInsertObject<T>);
			case "update":
				return this.translateUpdate(query as QueryUpdateObject<T>);
			case "delete":
				return this.translateDelete(query as QueryDeleteObject<T>);
			default:
				throwQueryError({
					adapter: "mongodb",
					message: `Unsupported query type: ${String((query as { type: string }).type)}`,
				});
		}
	}

	/**
	 * Translate SELECT query → MongoDB find operation
	 */
	private translateSelect<T extends DatrixEntry>(
		query: QuerySelectObject<T>,
	): MongoFindResult {
		validateIdentifier(query.table);

		const filter = query.where
			? this.translateWhere(query.where, query.table)
			: {};

		let projection = this.translateProjection(query.select);
		if (projection === undefined) {
			// select: undefined (post-write refetch, contract §3/§8) must be
			// treated as "all non-hidden scalar columns" — otherwise hidden FK
			// fields leak into the result. Only stays undefined when the schema
			// itself is unknown (e.g. `_datrix` internals).
			projection = this.buildDefaultProjection(query.table);
		}
		const sort = query.orderBy
			? this.translateSort(query.orderBy as readonly OrderByItem<DatrixEntry>[])
			: undefined;

		const result: MongoFindResult = {
			operation: "find",
			collection: query.table,
			filter,
			...(projection !== undefined && { projection }),
			...(sort !== undefined && { sort }),
			...(query.offset !== undefined && { skip: query.offset }),
			...(query.limit !== undefined && { limit: query.limit }),
		};

		return result;
	}

	/**
	 * Translate COUNT query → MongoDB countDocuments operation
	 */
	private translateCount<T extends DatrixEntry>(
		query: QueryCountObject<T>,
	): MongoCountResult {
		validateIdentifier(query.table);

		const filter = query.where
			? this.translateWhere(query.where, query.table)
			: {};

		return {
			operation: "countDocuments",
			collection: query.table,
			filter,
		};
	}

	/**
	 * Translate INSERT query → MongoDB insertMany operation
	 *
	 * Note: id assignment is handled by the adapter (not translator).
	 * Documents arrive here already with their `id` field set.
	 */
	private translateInsert<T extends DatrixEntry>(
		query: QueryInsertObject<T>,
	): MongoInsertResult {
		validateIdentifier(query.table);

		const dataArray = Array.isArray(query.data) ? query.data : [query.data];

		if (dataArray.length === 0) {
			throwQueryError({
				adapter: "mongodb",
				message: "INSERT query requires data",
			});
		}

		const currentSchema = this.getSchema(query.table);
		const documents = dataArray.map((item) =>
			this.convertInsertValues(item as Record<string, unknown>, currentSchema),
		);

		return {
			operation: "insertMany",
			collection: query.table,
			documents,
		};
	}

	/**
	 * Translate UPDATE query → MongoDB updateMany operation
	 */
	private translateUpdate<T extends DatrixEntry>(
		query: QueryUpdateObject<T>,
	): MongoUpdateResult {
		validateIdentifier(query.table);

		if (!query.data || Object.keys(query.data).length === 0) {
			throwQueryError({
				adapter: "mongodb",
				message: "UPDATE query requires data",
			});
		}

		const filter = query.where
			? this.translateWhere(query.where, query.table)
			: {};

		const currentSchema = this.getSchema(query.table);
		const setFields: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(
			query.data as Record<string, unknown>,
		)) {
			setFields[key] = this.convertValueForField(value, currentSchema, key);
		}

		return {
			operation: "updateMany",
			collection: query.table,
			filter,
			update: { $set: setFields },
		};
	}

	/**
	 * Translate DELETE query → MongoDB deleteMany operation
	 */
	private translateDelete<T extends DatrixEntry>(
		query: QueryDeleteObject<T>,
	): MongoDeleteResult {
		validateIdentifier(query.table);

		const filter = query.where
			? this.translateWhere(query.where, query.table)
			: {};

		return {
			operation: "deleteMany",
			collection: query.table,
			filter,
		};
	}

	/**
	 * Translate WHERE clause → MongoDB filter
	 */
	translateWhere<T extends DatrixEntry>(
		where: WhereClause<T>,
		tableName?: string,
	): Filter<Document> {
		const currentSchema = tableName ? this.getSchema(tableName) : undefined;
		return this.translateWhereConditions(where, 0, currentSchema);
	}

	/**
	 * Translate WHERE conditions recursively
	 */
	private translateWhereConditions<T extends DatrixEntry>(
		where: WhereClause<T>,
		depth: number,
		currentSchema?: SchemaDefinition,
	): Filter<Document> {
		if (depth > MAX_WHERE_DEPTH) {
			throwQueryError({
				adapter: "mongodb",
				message: `WHERE clause exceeds maximum nesting depth of ${MAX_WHERE_DEPTH}`,
			});
		}

		const filter: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(where)) {
			// Logical operators
			if (key === "$and") {
				filter["$and"] = (value as readonly WhereClause<T>[]).map((condition) =>
					this.translateWhereConditions(condition, depth + 1, currentSchema),
				);
				continue;
			}

			if (key === "$or") {
				filter["$or"] = (value as readonly WhereClause<T>[]).map((condition) =>
					this.translateWhereConditions(condition, depth + 1, currentSchema),
				);
				continue;
			}

			if (key === "$not") {
				const notFilter = this.translateWhereConditions(
					value as WhereClause<T>,
					depth + 1,
					currentSchema,
				);
				// MongoDB $not works at field level, so we wrap with $nor for top-level NOT
				filter["$nor"] = [notFilter];
				continue;
			}

			// Any key that is not exactly $and/$or/$not must be a plain field name.
			// Reject operator-like or dotted keys before they can reach MongoDB
			// (prevents e.g. `{ $where: "..." }` from becoming server-side JS).
			validateIdentifier(key);

			// Check if this is a relation field
			if (currentSchema) {
				const field = currentSchema.fields[key];
				if (field && field.type === "relation") {
					const relationField = field as {
						foreignKey?: string;
						model?: string;
						kind?: string;
					};

					// Simple value → foreign key equality
					if (
						typeof value === "number" ||
						typeof value === "string" ||
						value === null
					) {
						if (
							!relationField.foreignKey ||
							(relationField.kind !== "belongsTo" &&
								relationField.kind !== "hasOne")
						) {
							throwQueryError({
								adapter: "mongodb",
								message: `relation shortcut '${key}' cannot be translated`,
							});
						}
						filter[relationField.foreignKey] =
							value === null
								? null
								: this.convertValueForField(
										value,
										currentSchema,
										relationField.foreignKey,
									);
						continue;
					}

					// Nested object → relation filtering
					if (
						typeof value === "object" &&
						value !== null &&
						!Array.isArray(value) &&
						!(value instanceof Date)
					) {
						const nestedValue = value as Record<string, unknown>;
						const hasOnlyId =
							Object.keys(nestedValue).length === 1 && "id" in nestedValue;

						if (hasOnlyId && relationField.foreignKey) {
							const idValue = nestedValue["id"];
							if (
								typeof idValue === "object" &&
								idValue !== null &&
								!Array.isArray(idValue)
							) {
								// Has operators: { id: { $ne: 1 } }
								const { fieldFilter, extraFilters } =
									this.translateComparisonOperators(
										idValue as ComparisonOperators,
										currentSchema,
										relationField.foreignKey,
									);
								filter[relationField.foreignKey] = fieldFilter;
								if (extraFilters.length > 0) {
									const fk = relationField.foreignKey;
									const andConditions = extraFilters.map((extra) => ({
										[fk]: extra,
									}));
									const existingAnd = filter["$and"] as
										| Record<string, unknown>[]
										| undefined;
									filter["$and"] = existingAnd
										? [...existingAnd, ...andConditions]
										: andConditions;
								}
							} else {
								filter[relationField.foreignKey] =
									idValue === null ? null : idValue;
							}
							continue;
						}

						// Complex nested relation filtering
						// For MongoDB we translate nested conditions as-is
						// The populator handles cross-collection lookups
						const targetSchema = relationField.model
							? this.schemaRegistry.get(relationField.model)
							: undefined;
						const nestedFilter = this.translateWhereConditions(
							nestedValue as WhereClause<T>,
							depth + 1,
							targetSchema,
						);
						// Store under relation name - populator will handle $lookup
						filter[key] = nestedFilter;
						continue;
					}
				}
			}

			// Regular field handling
			if (
				typeof value === "object" &&
				value !== null &&
				!Array.isArray(value) &&
				!(value instanceof Date)
			) {
				// Comparison operators
				const { fieldFilter, extraFilters } = this.translateComparisonOperators(
					value as ComparisonOperators,
					currentSchema,
					key,
				);
				filter[key] = fieldFilter;
				if (extraFilters.length > 0) {
					const andConditions = extraFilters.map((extra) => ({
						[key]: extra,
					}));
					const existingAnd = filter["$and"] as
						| Record<string, unknown>[]
						| undefined;
					filter["$and"] = existingAnd
						? [...existingAnd, ...andConditions]
						: andConditions;
				}
			} else {
				// Simple equality
				filter[key] =
					value === null
						? null
						: this.convertValueForField(value, currentSchema, key);
			}
		}

		return filter as Filter<Document>;
	}

	/**
	 * Translate comparison operators for a single field.
	 *
	 * Returns the primary field filter plus any "extra" pattern filters that
	 * could not be merged into the same object (multiple pattern operators
	 * on one field would otherwise silently overwrite each other's `$regex`
	 * key). Callers must AND the extras in via `$and` at the field level.
	 */
	private translateComparisonOperators(
		ops: ComparisonOperators,
		currentSchema?: SchemaDefinition,
		fieldPath?: string,
	): {
		fieldFilter: Record<string, unknown>;
		extraFilters: Record<string, unknown>[];
	} {
		const result: Record<string, unknown> = {};
		const extraFilters: Record<string, unknown>[] = [];

		const simpleOps = ["$eq", "$ne", "$gt", "$gte", "$lt", "$lte"] as const;
		const arrayOps = ["$in", "$nin"] as const;

		/**
		 * Write a pattern-match condition (`$regex`/`$options` or `$not`) into
		 * `result`, or push it to `extraFilters` if the key is already taken by
		 * a previous pattern operator on this same field.
		 */
		const writePattern = (condition: Record<string, unknown>): void => {
			const keys = Object.keys(condition);
			const collides = keys.some((k) => k in result);
			if (collides) {
				extraFilters.push(condition);
			} else {
				Object.assign(result, condition);
			}
		};

		for (const [operator, opValue] of Object.entries(ops)) {
			if (simpleOps.includes(operator as any)) {
				result[operator] =
					opValue === null
						? null
						: this.convertValueForField(opValue, currentSchema, fieldPath);
				continue;
			}

			if (arrayOps.includes(operator as any)) {
				if (!Array.isArray(opValue)) {
					throwQueryError({
						adapter: "mongodb",
						message: `${operator} operator requires array value`,
					});
				}
				result[operator] = opValue.map((v) =>
					this.convertValueForField(v, currentSchema, fieldPath),
				);
				continue;
			}

			switch (operator) {
				case "$like":
					writePattern({ $regex: this.likeToRegex(String(opValue)) });
					break;
				case "$ilike":
					writePattern({
						$regex: this.likeToRegex(String(opValue)),
						$options: "i",
					});
					break;
				case "$contains":
					// Case-sensitive LIKE %value% (contract §4)
					writePattern({ $regex: this.escapeRegex(String(opValue)) });
					break;
				case "$icontains":
					// Case-insensitive LIKE %value%
					writePattern({
						$regex: this.escapeRegex(String(opValue)),
						$options: "i",
					});
					break;
				case "$notContains":
					// Case-sensitive NOT LIKE %value%
					writePattern({
						$not: { $regex: this.escapeRegex(String(opValue)) },
					});
					break;
				case "$startsWith":
					writePattern({
						$regex: `^${this.escapeRegex(String(opValue))}`,
						$options: "i",
					});
					break;
				case "$endsWith":
					writePattern({
						$regex: `${this.escapeRegex(String(opValue))}$`,
						$options: "i",
					});
					break;
				case "$regex":
					if (opValue instanceof RegExp) {
						writePattern(
							opValue.flags
								? { $regex: opValue.source, $options: opValue.flags }
								: { $regex: opValue.source },
						);
					} else {
						writePattern({ $regex: String(opValue) });
					}
					break;
				case "$exists":
				case "$notNull":
					// Contract semantics: $exists / $notNull ≡ IS NOT NULL.
					// MongoDB's native $exists means "field present" (even if null),
					// which is NOT the same thing — never emit it.
					if (opValue) {
						result["$ne"] = null;
					} else {
						result["$eq"] = null;
					}
					break;
				case "$null":
					if (opValue) {
						result["$eq"] = null;
					} else {
						result["$ne"] = null;
					}
					break;
				default:
					throwQueryError({
						adapter: "mongodb",
						message: `Unsupported operator: ${operator}`,
					});
			}
		}

		return { fieldFilter: result, extraFilters };
	}

	/**
	 * Translate SELECT fields → MongoDB projection
	 */
	private translateProjection<T extends DatrixEntry>(
		select: QuerySelect<T>,
	): Document | undefined {
		if (!select || select.length === 0) return undefined;

		const selectArr = select as readonly string[];
		const hasWildcard = selectArr.includes("*");
		if (hasWildcard) return undefined;

		const projection: Record<string, number> = {};
		for (const field of selectArr) {
			validateIdentifier(field);
			projection[field] = 1;
		}
		// Always include id
		projection["id"] = 1;
		// Exclude MongoDB's _id from results
		projection["_id"] = 0;

		return projection;
	}

	/**
	 * Build a default projection from the schema when `select` is undefined
	 * (post-write refetch, contract §3/§8): every non-relation, non-hidden
	 * field, plus `id`. Returns undefined when the schema itself is unknown
	 * (e.g. `_datrix` internals), since there is nothing to derive a
	 * projection from in that case.
	 */
	private buildDefaultProjection(tableName: string): Document | undefined {
		const schema = this.getSchema(tableName);
		if (!schema) return undefined;

		const projection: Record<string, number> = {};
		for (const [fieldName, field] of Object.entries(schema.fields)) {
			if (field.type === "relation") continue;
			if (field.hidden) continue;
			projection[fieldName] = 1;
		}
		projection["id"] = 1;
		projection["_id"] = 0;

		return projection;
	}

	/**
	 * Translate ORDER BY → MongoDB sort
	 */
	private translateSort<T extends DatrixEntry>(
		orderBy: readonly OrderByItem<T>[],
	): Sort {
		const sort: Record<string, 1 | -1> = {};
		for (const item of orderBy) {
			validateIdentifier(item.field as string);
			sort[item.field as string] = item.direction === "asc" ? 1 : -1;
		}
		return sort;
	}

	/**
	 * Convert SQL LIKE pattern to MongoDB regex
	 * % → .* (any characters)
	 * _ → . (single character)
	 */
	private likeToRegex(pattern: string): string {
		const escaped = this.escapeRegex(pattern);
		return `^${escaped.replace(/%/g, ".*").replace(/_/g, ".")}$`;
	}

	/**
	 * Escape special regex characters
	 */
	private escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	/**
	 * Convert a value based on field type from schema
	 */
	private convertValueForField(
		value: unknown,
		currentSchema?: SchemaDefinition,
		fieldPath?: string,
	): unknown {
		if (value === null || value === undefined) return value;

		if (!currentSchema || !fieldPath) return value;

		const field = currentSchema.fields[fieldPath];
		if (!field) return value;

		return this.convertValueToFieldType(value, field);
	}

	/**
	 * Convert value to match field type from schema
	 */
	private convertValueToFieldType(
		value: unknown,
		field: FieldDefinition,
	): unknown {
		if (value === null || value === undefined) return value;

		switch (field.type) {
			case "number": {
				if (typeof value === "string") {
					const numValue = Number(value);
					if (!isNaN(numValue)) return numValue;
				}
				return value;
			}
			case "string":
			case "enum": {
				if (typeof value === "number") return String(value);
				return value;
			}
			case "boolean": {
				if (typeof value === "string") {
					if (value.toLowerCase() === "true") return true;
					if (value.toLowerCase() === "false") return false;
				}
				return value;
			}
			case "date": {
				if (value instanceof Date) return value;
				if (typeof value === "string") return new Date(value);
				return value;
			}
			default:
				return value;
		}
	}

	/**
	 * Convert insert data values based on schema
	 */
	private convertInsertValues(
		data: Record<string, unknown>,
		currentSchema?: SchemaDefinition,
	): Document {
		const doc: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(data)) {
			doc[key] = this.convertValueForField(value, currentSchema, key);
		}
		return doc;
	}

	/**
	 * Get schema by table name (returns undefined if not found)
	 */
	private getSchema(tableName: string): SchemaDefinition | undefined {
		const modelName = this.schemaRegistry.findModelByTableName(tableName);
		if (!modelName) return undefined;
		return this.schemaRegistry.get(modelName);
	}
}
