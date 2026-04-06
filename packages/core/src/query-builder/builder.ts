/**
 * Query Builder Base Implementation (~150 LOC)
 *
 * Fluent API for building database-agnostic queries.
 * Produces QueryObject instances that adapters translate to SQL/NoSQL.
 */

import type {
	QueryObjectForType,
	QueryType,
	SelectClause,
	WhereClause,
	PopulateClause,
	OrderByItem,
	OrderDirection,
	OrderByClause,
} from "../types/core/query-builder";

import { normalizeWhere } from "./where";
import { normalizePopulateArray } from "./populate";
import { normalizeSelect } from "./select";
import { processData } from "./data";
import { normalizeOrderBy } from "./orderby";
import {
	throwSchemaNotFound,
	throwInvalidQueryType,
	throwMissingTable,
	throwMissingData,
	throwDeleteWithoutWhere,
} from "./error-helper";
import type {
	DatrixEntry,
	ISchemaRegistry as ISchemaRegistry,
	SchemaDefinition,
} from "../types/core/schema";

/**
 * Deep clone an object (safe for JSON-serializable data)
 */
function deepClone<T>(obj: T): T {
	if (obj === null || typeof obj !== "object") {
		return obj;
	}

	if (obj instanceof Date) {
		return new Date(obj.getTime()) as T;
	}

	if (obj instanceof RegExp) {
		return new RegExp(obj.source, obj.flags) as T;
	}

	if (Array.isArray(obj)) {
		return obj.map((item) => deepClone(item)) as T;
	}

	const cloned: Record<string, unknown> = {};
	for (const key in obj) {
		if (Object.prototype.hasOwnProperty.call(obj, key)) {
			cloned[key] = deepClone(obj[key]);
		}
	}

	return cloned as T;
}

/**
 * Mutable query state for building
 */
interface MutableQueryState<T extends DatrixEntry> {
	type?: QueryType;
	table?: string;
	select?: SelectClause<T>[];
	where?: WhereClause<T>[];
	populate?: PopulateClause<T>[];
	orderBy?: OrderByClause<T>;
	limit?: number;
	offset?: number;
	data?: Partial<T>;
	dataItems?: Partial<T>[];
	distinct?: boolean;
	groupBy?: string[];
	having?: WhereClause<T>;
}

/**
 * Query builder implementation
 */
export class DatrixQueryBuilder<
	TSchema extends DatrixEntry,
	TType extends QueryType = QueryType,
> {
	private query: MutableQueryState<TSchema>;
	private readonly _modelName: string;
	private readonly _schema: SchemaDefinition;
	private readonly _registry: ISchemaRegistry;

	/**
	 * Constructor for the query builder
	 *
	 * @param modelName - Model name (e.g., 'User', 'Post')
	 * @param schemaRegistry - Schema registry for normalization and relation resolution
	 *
	 * This enables full normalization support:
	 * - SELECT: "*" → expanded to field list, reserved fields added
	 * - WHERE: relation shortcuts normalized (category: 2 → categoryId: { $eq: 2 })
	 * - POPULATE: wildcards, dot notation, nested processing, relation traversal
	 *
	 * @throws {Error} If schema not found in registry
	 *
	 * @example
	 * ```ts
	 * const builder = new DatrixQueryBuilder('User', schemaRegistry);
	 * builder.select('*').where({ role: 'admin' });
	 * ```
	 */
	constructor(
		modelName: string,
		schemaRegistry: ISchemaRegistry,
		type: TType = "select" as TType,
	) {
		this._modelName = modelName;
		this._registry = schemaRegistry;

		// Get schema from registry
		const schema = schemaRegistry.get(modelName)!;
		if (!schema) {
			throwSchemaNotFound(modelName);
		}

		this._schema = schema;
		this.query = {
			table: schema.tableName!,
			type,
		};
	}

	/**
	 * Select fields
	 */
	select(fields: SelectClause<TSchema>): this {
		if (this.query.select === undefined) {
			this.query.select = [fields];
		} else {
			this.query.select.push(fields);
		}
		return this;
	}

	/**
	 * Add WHERE conditions
	 */
	where(conditions: WhereClause<TSchema>): this {
		if (this.query.where === undefined) {
			this.query.where = [conditions];
		} else {
			this.query.where.push(conditions);
		}
		return this;
	}

	/**
	 * Populate relations
	 *
	 * Supports multiple formats:
	 * - .populate('*') - all relations
	 * - .populate(['author', 'category']) - array
	 * - .populate({ author: true }) - object
	 *
	 * Multiple calls are accumulated and merged in build()
	 */
	populate(relations: PopulateClause<TSchema>): this {
		if (this.query.populate === undefined) {
			this.query.populate = [relations];
		} else {
			this.query.populate.push(relations);
		}
		return this;
	}

	/**
	 * Order by field(s)
	 *
	 * Supports multiple formats:
	 * - Fluent: .orderBy("age", "asc")
	 * - Full: .orderBy([{ field: "age", direction: "asc" }])
	 * - Object: .orderBy({ age: "asc" })
	 * - Array: .orderBy(["age", "-name"])
	 *
	 * @example
	 * ```ts
	 * // Fluent API (single field)
	 * builder.orderBy("age", "asc").orderBy("name", "desc");
	 *
	 * // Full format
	 * builder.orderBy([{ field: "age", direction: "asc", nulls: "last" }]);
	 *
	 * // Object shortcut
	 * builder.orderBy({ age: "asc" });
	 *
	 * // String array
	 * builder.orderBy(["age", "-name"]);
	 * ```
	 */
	orderBy(clause: OrderByClause<TSchema>): this;
	orderBy(field: keyof TSchema, direction?: OrderDirection): this;
	orderBy(
		fieldOrClause: keyof TSchema | OrderByClause<TSchema>,
		direction: OrderDirection = "asc",
	): this {
		// Fluent API: orderBy("field", "asc")
		if (typeof fieldOrClause === "string" && !Array.isArray(fieldOrClause)) {
			const normalized = normalizeOrderBy(this.query.orderBy);
			const newItem: OrderByItem<TSchema> = {
				field: fieldOrClause as keyof TSchema,
				direction,
			};
			this.query.orderBy = [
				...(normalized || []),
				newItem,
			] as OrderByClause<TSchema>;
			return this;
		}

		// Clause format: orderBy([...]) or orderBy({...})
		this.query.orderBy = fieldOrClause as OrderByClause<TSchema>;
		return this;
	}

	/**
	 * Set limit
	 */
	limit(count: number): this {
		this.query.limit = count;
		return this;
	}

	/**
	 * Set offset
	 */
	offset(count: number): this {
		this.query.offset = count;
		return this;
	}

	/**
	 * Set data for UPDATE (shallow merge, single object)
	 *
	 * Multiple calls are merged (shallow merge).
	 * Only available for UPDATE queries.
	 *
	 * @param values - Data to update
	 * @returns this
	 *
	 * @example
	 * ```ts
	 * builder
	 *   .data({ name: 'John' })
	 *   .data({ age: 25 });  // Merged: { name: 'John', age: 25 }
	 * ```
	 */
	data(values: Partial<TSchema>): this {
		if (this.query.data === undefined) {
			this.query.data = values;
		} else {
			this.query.data = { ...this.query.data, ...values };
		}
		return this;
	}

	/**
	 * Push a data item for INSERT (bulk insert support)
	 *
	 * Each call adds one item to the insert batch.
	 * Only available for INSERT queries.
	 *
	 * @param item - Data item to insert
	 * @returns this
	 *
	 * @example
	 * ```ts
	 * builder
	 *   .pushData({ name: 'John', age: 25 })
	 *   .pushData({ name: 'Jane', age: 30 });
	 * // Inserts 2 rows
	 * ```
	 */
	pushData(item: Partial<TSchema>): this {
		if (this.query.dataItems === undefined) {
			this.query.dataItems = [item];
		} else {
			this.query.dataItems.push(item);
		}
		return this;
	}

	/**
	 * Set DISTINCT
	 */
	distinct(enabled = true): this {
		this.query.distinct = enabled;
		return this;
	}

	/**
	 * Group by fields
	 */
	groupBy(fields: readonly string[]): this {
		this.query.groupBy = [...(this.query.groupBy || []), ...fields];
		return this;
	}

	/**
	 * Having clause (for GROUP BY)
	 */
	having(conditions: WhereClause<TSchema>): this {
		this.query.having = conditions;
		return this;
	}

	/**
	 * Build final QueryObject
	 * @throws {DatrixQueryBuilderError} If query is invalid
	 */
	build(): QueryObjectForType<TSchema, TType> {
		// Validate required fields
		if (!this.query.type) {
			throwInvalidQueryType(this.query.type);
		}

		if (!this.query.table) {
			throwMissingTable();
		}

		const type = this.query.type!;
		const table = this.query.table!;

		// Normalize common clauses
		const normalizedWhere = normalizeWhere(
			this.query.where,
			this._schema,
			this._registry,
		);
		const normalizedSelect = normalizeSelect(
			this.query.select,
			this._schema,
			this._registry,
		);
		const normalizedPopulate = normalizePopulateArray(
			this.query.populate,
			this._modelName,
			this._registry,
		);
		const normalizedOrderBy = normalizeOrderBy(this.query.orderBy);

		// Spread helpers for reuse
		const selectSpread =
			normalizedSelect !== undefined
				? { select: normalizedSelect }
				: { select: undefined };
		const populateSpread =
			normalizedPopulate !== undefined ? { populate: normalizedPopulate } : {};
		const whereSpread =
			normalizedWhere !== undefined ? { where: normalizedWhere } : {};

		switch (type) {
			case "select": {
				return {
					type,
					table,
					...selectSpread,
					...whereSpread,
					...populateSpread,
					...(normalizedOrderBy !== undefined && {
						orderBy: normalizedOrderBy,
					}),
					...(this.query.limit !== undefined && { limit: this.query.limit }),
					...(this.query.offset !== undefined && { offset: this.query.offset }),
					...(this.query.distinct !== undefined && {
						distinct: this.query.distinct,
					}),
					...(this.query.groupBy !== undefined && {
						groupBy: this.query.groupBy as readonly string[],
					}),
					...(this.query.having !== undefined && {
						having: this.query.having,
					}),
				} as QueryObjectForType<TSchema, TType>;
			}

			case "count": {
				return {
					type,
					table,
					...whereSpread,
					...(this.query.groupBy !== undefined && {
						groupBy: this.query.groupBy as readonly string[],
					}),
					...(this.query.having !== undefined && {
						having: this.query.having,
					}),
				} as QueryObjectForType<TSchema, TType>;
			}

			case "insert": {
				const dataItems = this.query.dataItems ?? [];
				if (dataItems.length === 0) {
					throwMissingData("insert");
				}
				const processedItems = dataItems.map((item) =>
					processData<TSchema>(item, this._schema, this._registry),
				);
				const dataArray = processedItems.map(
					(p) => p.data,
				) as readonly Partial<TSchema>[];
				const relations = processedItems[0]?.relations;
				return {
					type: "insert" as const,
					table,
					data: dataArray,
					...(relations !== undefined && { relations }),
					...selectSpread,
					...populateSpread,
				} as unknown as QueryObjectForType<TSchema, TType>;
			}

			case "update": {
				if (this.query.data === undefined) {
					throwMissingData("update");
				}
				const processedData = processData<TSchema>(
					this.query.data,
					this._schema,
					this._registry,
				);
				return {
					type,
					table,
					...whereSpread,
					data: processedData.data,
					...(processedData.relations !== undefined && {
						relations: processedData.relations,
					}),
					...selectSpread,
					...populateSpread,
				} as QueryObjectForType<TSchema, TType>;
			}

			case "delete": {
				if (normalizedWhere === undefined) {
					throwDeleteWithoutWhere();
				}
				return {
					type,
					table,
					where: normalizedWhere,
					...selectSpread,
					...populateSpread,
				} as QueryObjectForType<TSchema, TType>;
			}

			default:
				throwInvalidQueryType(type);
		}
	}

	/**
	 * Clone builder (for reusability)
	 */
	clone(): DatrixQueryBuilder<TSchema, TType> {
		const cloned = new DatrixQueryBuilder<TSchema, TType>(
			this._modelName,
			this._registry,
			this.query.type as TType,
		);

		// Deep clone the query state to avoid shared references
		cloned.query = {
			...this.query,
			...(this.query.where !== undefined && {
				where: deepClone(this.query.where),
			}),
			...(this.query.populate !== undefined && {
				populate: deepClone(this.query.populate),
			}),
			...(this.query.data !== undefined && {
				data: deepClone(this.query.data),
			}),
			...(this.query.dataItems !== undefined && {
				dataItems: deepClone(this.query.dataItems),
			}),
			...(this.query.orderBy !== undefined && {
				orderBy: deepClone(this.query.orderBy),
			}),
			...(this.query.groupBy !== undefined && {
				groupBy: deepClone(this.query.groupBy),
			}),
			...(this.query.having !== undefined && {
				having: deepClone(this.query.having),
			}),
		};

		return cloned;
	}

	/**
	 * Reset builder to initial state
	 */
	reset(): this {
		this.query = {};
		return this;
	}
}

/**
 * Create a new query builder
 *
 * @param modelName - Model name (e.g., 'User', 'Post')
 * @param schemaRegistry - Schema registry
 * @returns Query builder instance
 *
 * @example
 * ```ts
 * const builder = createQueryBuilder<User>('User', registry);
 * ```
 */
export function createQueryBuilder<
	TSchema extends DatrixEntry,
	TType extends QueryType = "select",
>(
	modelName: string,
	schemaRegistry: ISchemaRegistry,
	type?: TType,
): DatrixQueryBuilder<TSchema, TType> {
	return new DatrixQueryBuilder<TSchema, TType>(
		modelName,
		schemaRegistry,
		(type ?? "select") as TType,
	);
}

export function selectFrom<TSchema extends DatrixEntry>(
	modelName: string,
	schemaRegistry: ISchemaRegistry,
): DatrixQueryBuilder<TSchema, "select"> {
	return new DatrixQueryBuilder<TSchema, "select">(
		modelName,
		schemaRegistry,
		"select",
	);
}

/**
 * Create INSERT query builder
 *
 * @param data - Single item or array of items to insert
 */
export function insertInto<TSchema extends DatrixEntry>(
	modelName: string,
	data: Partial<TSchema> | readonly Partial<TSchema>[],
	schemaRegistry: ISchemaRegistry,
): DatrixQueryBuilder<TSchema, "insert"> {
	const builder = new DatrixQueryBuilder<TSchema, "insert">(
		modelName,
		schemaRegistry,
		"insert",
	);
	const items = Array.isArray(data) ? data : [data];
	for (const item of items) {
		builder.pushData(item);
	}
	return builder;
}

export function updateTable<TSchema extends DatrixEntry>(
	modelName: string,
	data: Partial<TSchema>,
	schemaRegistry: ISchemaRegistry,
): DatrixQueryBuilder<TSchema, "update"> {
	return new DatrixQueryBuilder<TSchema, "update">(
		modelName,
		schemaRegistry,
		"update",
	).data(data);
}

export function deleteFrom<TSchema extends DatrixEntry>(
	modelName: string,
	schemaRegistry: ISchemaRegistry,
): DatrixQueryBuilder<TSchema, "delete"> {
	return new DatrixQueryBuilder<TSchema, "delete">(
		modelName,
		schemaRegistry,
		"delete",
	);
}

export function countFrom<TSchema extends DatrixEntry>(
	modelName: string,
	schemaRegistry: ISchemaRegistry,
): DatrixQueryBuilder<TSchema, "count"> {
	return new DatrixQueryBuilder<TSchema, "count">(
		modelName,
		schemaRegistry,
		"count",
	);
}
