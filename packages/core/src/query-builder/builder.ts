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
	QueryRelations,
} from "../types/core/query-builder";

import { normalizeWhere, isLogicalOperator } from "./where";
import { normalizePopulateArray } from "./populate";
import { normalizeSelect } from "./select";
import { processData } from "./data";
import { normalizeOrderBy, validateOrderBy } from "./orderby";
import {
	throwSchemaNotFound,
	throwInvalidQueryType,
	throwMissingTable,
	throwMissingData,
	throwDeleteWithoutWhere,
	throwUpdateWithoutWhere,
	throwInvalidField,
	throwInvalidValue,
} from "./error-helper";
import {
	RESERVED_FIELDS,
	type DatrixEntry,
	type ISchemaRegistry,
	type SchemaDefinition,
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
	conflictOn?: readonly string[];
	updateFields?: readonly string[];
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
	private readonly _initialType: TType;

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
		this._initialType = type;
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
	 * Set the UPSERT conflict target and the fields overwritten on conflict
	 * (omitted: every field the rows set; `[]`: leave existing rows untouched).
	 */
	onConflict(
		conflictOn: readonly string[],
		update?: readonly string[],
	): this {
		this.query.conflictOn = conflictOn;
		if (update !== undefined) {
			this.query.updateFields = update;
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
		if (!Array.isArray(fields)) {
			throwInvalidValue("groupBy", "groupBy", fields, "an array of field names");
		}
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
		// distinct without an explicit select would fall back to the wildcard
		// field list, which always includes `id` — since `id` is unique per
		// row, that silently makes `distinct` a no-op instead of erroring
		if (
			this.query.distinct === true &&
			(this.query.select === undefined || this.query.select.length === 0)
		) {
			throwInvalidValue(
				"select",
				"distinct",
				undefined,
				"an explicit select — distinct requires select so the wildcard's unique `id` field can't silently defeat deduplication",
			);
		}

		const normalizedSelect = normalizeSelect(
			this.query.select,
			this._schema,
			this._registry,
			this.query.groupBy !== undefined || this.query.distinct === true,
		);
		const normalizedPopulate = normalizePopulateArray(
			this.query.populate,
			this._modelName,
			this._registry,
		);
		const normalizedOrderBy = normalizeOrderBy(this.query.orderBy);
		validateOrderBy(normalizedOrderBy, this._schema);

		// groupBy fields are SQL identifiers — whitelist them against the schema
		if (this.query.groupBy !== undefined) {
			for (const field of this.query.groupBy) {
				const fieldDef = this._schema.fields[field];
				if (!fieldDef) {
					const availableFields = Object.keys(this._schema.fields).filter(
						(name) => this._schema.fields[name]?.type !== "relation",
					);
					throwInvalidField("groupBy", field, availableFields);
				}
				if (fieldDef.type === "relation") {
					throwInvalidValue(
						"groupBy",
						field,
						"relation field",
						"a scalar field — grouping by a relation is not supported",
					);
				}
			}

			// SELECT with GROUP BY can only project grouped columns — SQL has no
			// defined row to read an ungrouped column from once rows collapse
			// into groups (same reasoning as the having check below)
			if (type === "select") {
				const groupByFields = new Set(this.query.groupBy);
				for (const field of normalizedSelect) {
					if (!groupByFields.has(field as string)) {
						throwInvalidField("select", field as string, [
							...groupByFields,
						]);
					}
				}
			}
		}

		// having goes through the same validate/normalize pipeline as where
		const normalizedHaving =
			this.query.having !== undefined
				? normalizeWhere([this.query.having], this._schema, this._registry)
				: undefined;

		// having can only reference grouped fields — SQL has no defined row to
		// read an ungrouped column from once rows are collapsed into groups
		if (normalizedHaving !== undefined) {
			const groupByFields = new Set(this.query.groupBy ?? []);
			for (const field of collectWhereFields(normalizedHaving)) {
				if (!groupByFields.has(field)) {
					throwInvalidField("having", field, [...groupByFields]);
				}
			}
		}

		// Spread helpers for reuse
		// normalizeSelect always returns a concrete field list (wildcard-expanded
		// when the user never called .select()), never undefined
		const selectSpread = { select: normalizedSelect };
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
					...(normalizedHaving !== undefined && {
						having: normalizedHaving,
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
					...(normalizedHaving !== undefined && {
						having: normalizedHaving,
					}),
				} as QueryObjectForType<TSchema, TType>;
			}

			case "insert": {
				const { data, relations } = this.processDataItems("insert");
				return {
					type: "insert" as const,
					table,
					data,
					...(relations !== undefined && { relations }),
					...selectSpread,
					...populateSpread,
				} as unknown as QueryObjectForType<TSchema, TType>;
			}

			case "upsert": {
				const { data, relations } = this.processDataItems("upsert");
				const conflictOn = this.resolveConflictOn(data);
				const update = this.resolveUpsertUpdate(data, conflictOn);
				return {
					type: "upsert" as const,
					table,
					data,
					conflictOn,
					update,
					...(relations !== undefined && { relations }),
					...selectSpread,
					...populateSpread,
				} as unknown as QueryObjectForType<TSchema, TType>;
			}

			case "update": {
				if (this.query.data === undefined) {
					throwMissingData("update");
				}
				// Same guard as DELETE: a missing WHERE must never silently
				// update the whole table. Use .where({}) for an intentional
				// full-table update.
				if (normalizedWhere === undefined) {
					throwUpdateWithoutWhere();
				}
				const processedData = processData<TSchema>(
					this.query.data,
					this._schema,
					this._registry,
				);
				return {
					type,
					table,
					where: normalizedWhere,
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

	private processDataItems(queryType: "insert" | "upsert"): {
		data: readonly Partial<TSchema>[];
		relations: QueryRelations<TSchema> | undefined;
	} {
		const dataItems = this.query.dataItems ?? [];
		if (dataItems.length === 0) {
			throwMissingData(queryType);
		}
		const processedItems = dataItems.map((item) =>
			processData<TSchema>(item, this._schema, this._registry),
		);

		// Bulk writes share ONE relation set (taken from the first item)
		// across all records. Differing per-item relations would be
		// silently ignored — reject them instead.
		const relations = processedItems[0]?.relations;
		const firstRelationsKey = JSON.stringify(relations ?? null);
		for (let i = 1; i < processedItems.length; i++) {
			const itemRelations = processedItems[i]?.relations;
			if (JSON.stringify(itemRelations ?? null) !== firstRelationsKey) {
				throwInvalidValue(
					"data",
					`items[${i}]`,
					itemRelations ?? "no relations",
					`the same relation operations as the first item — bulk ${queryType} applies the first item's relations to every record; use single calls for per-item relations`,
				);
			}
		}

		return { data: processedItems.map((p) => p.data), relations };
	}

	private resolveConflictOn(
		rows: readonly Partial<TSchema>[],
	): readonly string[] {
		const conflictOn = (this.query.conflictOn ?? []).map((field) =>
			this.resolveColumn("conflictOn", field),
		);
		if (conflictOn.length === 0) {
			throwInvalidValue(
				"conflictOn",
				"conflictOn",
				this.query.conflictOn,
				"a non-empty array of field names",
			);
		}

		const conflictSet = new Set(conflictOn);
		const singleField =
			conflictOn.length === 1 ? this._schema.fields[conflictOn[0]!] : undefined;
		const isUniqueTarget =
			(conflictOn.length === 1 &&
				(conflictOn[0] === "id" ||
					(singleField !== undefined &&
						"unique" in singleField &&
						singleField.unique === true))) ||
			(this._schema.indexes ?? []).some(
				(index) =>
					index.unique === true &&
					index.fields.length === conflictSet.size &&
					index.fields.every((field) => conflictSet.has(field)),
			);
		if (!isUniqueTarget) {
			throwInvalidValue(
				"conflictOn",
				conflictOn.join(", "),
				conflictOn,
				"a field with `unique: true`, or exactly the fields of a unique index",
			);
		}

		// Adapters disagree on rows that conflict with each other inside one
		// statement (Postgres errors, MySQL/Mongo apply the last one).
		const seenKeys = new Set<string>();
		rows.forEach((row, i) => {
			const values = conflictOn.map((field) => row[field as keyof TSchema]);
			if (values.some((value) => value === undefined || value === null)) {
				throwInvalidValue(
					"data",
					`items[${i}]`,
					row,
					`a value for every conflictOn field (${conflictOn.join(", ")})`,
				);
			}
			const key = JSON.stringify(values);
			if (seenKeys.has(key)) {
				throwInvalidValue(
					"data",
					`items[${i}]`,
					values,
					"conflictOn values that are unique within the batch",
				);
			}
			seenKeys.add(key);
		});

		return conflictOn;
	}

	private resolveUpsertUpdate(
		rows: readonly Partial<TSchema>[],
		conflictOn: readonly string[],
	): readonly string[] {
		const rowKeys = rows.map((row) => new Set(Object.keys(row)));
		const presentInEveryRow = (column: string): boolean =>
			rowKeys.every((keys) => keys.has(column));

		if (this.query.updateFields === undefined) {
			const conflictSet = new Set(conflictOn);
			return [...(rowKeys[0] ?? [])].filter(
				(column) =>
					!(RESERVED_FIELDS as readonly string[]).includes(column) &&
					!conflictSet.has(column) &&
					presentInEveryRow(column),
			);
		}

		return this.query.updateFields.map((field) => {
			if ((RESERVED_FIELDS as readonly string[]).includes(field)) {
				throwInvalidValue(
					"update",
					field,
					field,
					"a non-reserved field — id/createdAt are never overwritten and updatedAt is managed automatically",
				);
			}
			const column = this.resolveColumn("update", field);
			if (!presentInEveryRow(column)) {
				throwInvalidValue(
					"update",
					field,
					undefined,
					"a field set in every row — otherwise the conflict update would overwrite it with an empty value",
				);
			}
			return column;
		});
	}

	/** Maps a scalar field (or belongsTo relation, to its FK column) to its column name. */
	private resolveColumn(
		component: "conflictOn" | "update",
		field: string,
	): string {
		const fieldDef = this._schema.fields[field];
		if (fieldDef?.type === "relation" && fieldDef.kind === "belongsTo") {
			return fieldDef.foreignKey!;
		}
		if (!fieldDef || fieldDef.type === "relation") {
			const availableFields = Object.keys(this._schema.fields).filter(
				(name) => this._schema.fields[name]?.type !== "relation",
			);
			throwInvalidField(component, field, availableFields);
		}
		return field;
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
			...(this.query.select !== undefined && {
				select: deepClone(this.query.select),
			}),
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
			...(this.query.conflictOn !== undefined && {
				conflictOn: [...this.query.conflictOn],
			}),
			...(this.query.updateFields !== undefined && {
				updateFields: [...this.query.updateFields],
			}),
		};

		return cloned;
	}

	/**
	 * Reset builder to initial state
	 */
	reset(): this {
		this.query = {
			table: this._schema.tableName!,
			type: this._initialType,
		};
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

export function upsertInto<TSchema extends DatrixEntry>(
	modelName: string,
	data: Partial<TSchema> | readonly Partial<TSchema>[],
	conflictOn: readonly string[],
	update: readonly string[] | undefined,
	schemaRegistry: ISchemaRegistry,
): DatrixQueryBuilder<TSchema, "upsert"> {
	const builder = new DatrixQueryBuilder<TSchema, "upsert">(
		modelName,
		schemaRegistry,
		"upsert",
	);
	const items = Array.isArray(data) ? data : [data];
	for (const item of items) {
		builder.pushData(item);
	}
	return builder.onConflict(conflictOn, update);
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

/**
 * Collect the top-level field names referenced by a WHERE/HAVING clause,
 * recursing through $and/$or/$not so a field nested in a logical operator
 * is still caught by the groupBy-subset check.
 */
function collectWhereFields(where: WhereClause<DatrixEntry>): string[] {
	const fields: string[] = [];

	for (const [key, value] of Object.entries(where)) {
		if (isLogicalOperator(key)) {
			const clauses = (
				key === "$not" ? [value] : (value as unknown[])
			) as WhereClause<DatrixEntry>[];
			for (const clause of clauses) {
				fields.push(...collectWhereFields(clause));
			}
			continue;
		}
		fields.push(key);
	}

	return fields;
}
