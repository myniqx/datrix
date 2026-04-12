/**
 * Query Builder Type Definitions
 *
 * This file defines types for Datrix's database-agnostic query builder.
 * Query builder produces QueryObject instances that adapters translate to SQL/NoSQL.
 */

import { DatrixEntry, DatrixRecord, RelationInput } from "./schema";

/**
 * Primitive values that can be used in queries
 * (includes Date, excludes undefined)
 */
export type QueryPrimitive = string | number | boolean | null | Date;

/**
 * Scalar value types (for type-safe WHERE conditions)
 */
export type ScalarValue = string | number | boolean | Date;

/**
 * Query operation types
 */
export type QueryType = "select" | "insert" | "update" | "delete" | "count";

/**
 * Type-safe comparison operators
 *
 * Operators are type-aware based on the field type:
 * - String fields: All string operators ($like, $regex, etc.)
 * - Number/Date fields: Comparison operators ($gt, $gte, etc.)
 * - All fields: Equality and existence operators
 *
 * @template T - The field value type
 *
 * @example
 * ```ts
 * // String field
 * const nameOp: ComparisonOperators<string> = { $like: 'John%' };  // ✅
 * const nameOp2: ComparisonOperators<string> = { $gt: 5 };         // ❌ Type error
 *
 * // Number field
 * const ageOp: ComparisonOperators<number> = { $gte: 18 };         // ✅
 * const ageOp2: ComparisonOperators<number> = { $like: 'x' };      // ❌ Type error
 * ```
 */
export type ComparisonOperators<T = QueryPrimitive> = {
	readonly $eq?: T;
	readonly $ne?: T;
	readonly $gt?: T extends number | Date ? T : never;
	readonly $gte?: T extends number | Date ? T : never;
	readonly $lt?: T extends number | Date ? T : never;
	readonly $lte?: T extends number | Date ? T : never;
	readonly $in?: readonly T[];
	readonly $nin?: readonly T[];
	readonly $like?: T extends string ? string : never;
	readonly $ilike?: T extends string ? string : never;
	readonly $startsWith?: T extends string ? string : never;
	readonly $endsWith?: T extends string ? string : never;
	readonly $contains?: T extends string ? string : never;
	readonly $notContains?: T extends string ? string : never;
	readonly $icontains?: T extends string ? string : never;
	readonly $regex?: T extends string ? RegExp | string : never;
	readonly $exists?: boolean;
	readonly $null?: boolean;
	readonly $notNull?: boolean;
};

/**
 * Type-safe logical operators
 *
 * Logical operators ($and, $or, $not) are now type-aware and preserve
 * the type information through nested conditions.
 *
 * @template T - The entity type (extends DatrixEntry)
 *
 * @example
 * ```ts
 * const condition: LogicalOperators<Post> = {
 *   $and: [
 *     { title: { $like: 'Hello%' } },
 *     { author: { name: { $eq: 'John' } } }
 *   ]
 * };
 * ```
 */
export type LogicalOperators<T extends DatrixEntry = DatrixRecord> = {
	readonly $and?: WhereClause<T>[];
	readonly $or?: WhereClause<T>[];
	readonly $not?: WhereClause<T>;
};

/**
 * Type-safe WHERE clause with nested relation support
 *
 * **Design Philosophy:**
 * - Default type: `DatrixEntry & Record<string, unknown>` (flexible but safe)
 * - Custom type: Full type safety with autocomplete
 * - Relation fields: Automatically supports nested WHERE conditions
 * - Foreign keys: Not exposed (internal implementation detail)
 *
 * **Type Inference:**
 * - Scalar fields → Direct value or ComparisonOperators
 * - Relation fields (branded as Relation<T>) → Nested WhereClause<T>
 * - Unknown fields → Fallback to `unknown` for flexibility
 *
 * @template T - The entity type (default: DatrixRecord)
 *
 * @example
 * ```ts
 * // 1. Without type (flexible, works with any field)
 * const where: WhereClause = {
 *   id: 5,
 *   anyField: 'value'
 * };
 *
 * // 2. With type (type-safe, autocomplete enabled)
 * type Post = {
 *   id: number;
 *   title: string;
 *   price: number;
 *   author: Relation<User>;
 * };
 *
 * const where: WhereClause<Post> = {
 *   title: { $like: 'Hello%' },        // ✅ String operators
 *   price: { $gte: 10 },               // ✅ Number operators
 *   author: {                          // ✅ Nested relation WHERE
 *     name: { $eq: 'John' },
 *     verified: { $eq: true }
 *   }
 * };
 *
 * // 3. Complex nested queries
 * const complexWhere: WhereClause<Post> = {
 *   $and: [
 *     { price: { $gt: 10 } },
 *     {
 *       author: {
 *         company: {                   // ✅ Deep nesting
 *           country: {
 *             name: { $eq: 'Turkey' }
 *           }
 *         }
 *       }
 *     }
 *   ]
 * };
 *
 * // ❌ Type errors (when using typed version)
 * const invalid: WhereClause<Post> = {
 *   title: { $gt: 5 },                 // ❌ $gt not valid for strings
 *   price: { $like: 'x' },             // ❌ $like not valid for numbers
 *   author: 5                          // ❌ Must use nested WHERE, not direct ID
 * };
 * ```
 */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Fallback WHERE clause for untyped queries.
 * Accepts any field name with scalar values or comparison operators.
 */
export type FallbackWhereClause = {
	[key: string]:
		| QueryPrimitive
		| ComparisonOperators
		| FallbackWhereClause
		| FallbackWhereClause[]
		| undefined;
	$and?: FallbackWhereClause[];
	$or?: FallbackWhereClause[];
	$not?: FallbackWhereClause;
};

/**
 * Typed WHERE clause for specific model types.
 */
type TypedWhereClause<T extends DatrixEntry> = Writable<{
	[K in keyof T]?: T[K] extends RelationInput<infer R extends DatrixEntry>
		? WhereClause<R>
		: NonNullable<T[K]> extends DatrixEntry
			? WhereClause<NonNullable<T[K]>>
			: NonNullable<T[K]> extends DatrixEntry[]
				? WhereClause<NonNullable<T[K]>[number]>
				: NonNullable<T[K]> extends ScalarValue
					? NonNullable<T[K]> | ComparisonOperators<NonNullable<T[K]>>
					: never;
}> &
	LogicalOperators<T>;

export type WhereClause<T extends DatrixEntry = DatrixRecord> =
	DatrixRecord extends T ? FallbackWhereClause : TypedWhereClause<T>;

/**
 * SELECT clause (fields to select) - Input format from user
 *
 * Accepts multiple formats:
 * - Array of field names: ['id', 'name', 'email']
 * - Single field name: 'name'
 * - Wildcard: '*' (all fields)
 */
export type SelectClause<T extends DatrixEntry = DatrixRecord> =
	| (DatrixRecord extends T ? readonly string[] : readonly (keyof T)[])
	| "*"
	| (DatrixRecord extends T ? string : keyof T);

/**
 * Populate clause (relations to include)
 */
export type PopulateOptions<T extends DatrixEntry> = {
	readonly select?: SelectClause<T> | undefined;
	readonly where?: WhereClause<T> | undefined;
	readonly populate?: PopulateClause<T> | undefined; // Nested populate
	readonly limit?: number | undefined;
	readonly offset?: number | undefined;
	readonly orderBy?: QueryOrderBy | undefined;
};

/**
 * Populate clause type
 *
 * Accepts multiple formats:
 * - Wildcard/true: '*' or true (populate all relations)
 * - Dot notation array: ['relation1', 'relation1.nested', 'relation2']
 * - Object notation: { relation1: true, relation2: { select: [...] } }
 * - false: No populate (explicit opt-out)
 */
type TypedPopulateValue<T> =
	NonNullable<T> extends DatrixEntry
		? PopulateOptions<NonNullable<T>> | "*" | boolean
		: NonNullable<T> extends DatrixEntry[]
			? PopulateOptions<NonNullable<T>[number]> | "*" | boolean
			: PopulateOptions<DatrixRecord> | "*" | boolean;

type TypedPopulateClause<T extends DatrixEntry> = {
	readonly [K in keyof T]?: TypedPopulateValue<T[K]>;
};

export type PopulateClause<T extends DatrixEntry = DatrixRecord> =
	| boolean
	| "*"
	| "true"
	| (DatrixRecord extends T ? readonly string[] : readonly (keyof T)[])
	| (DatrixRecord extends T
			? Record<string, PopulateOptions<DatrixRecord> | "*" | boolean>
			: TypedPopulateClause<T>);

/**
 * Order direction
 */
export type OrderDirection = "asc" | "desc";

/**
 * Order by item (typed — field constrained to model keys)
 */
export type OrderByItem<T extends DatrixEntry> = {
	readonly field: keyof T;
	readonly direction: OrderDirection;
	readonly nulls?: "first" | "last";
};

/**
 * Order by item (fallback — field is any string)
 */
export type FallbackOrderByItem = {
	readonly field: string;
	readonly direction: OrderDirection;
	readonly nulls?: "first" | "last";
};

export type QueryOrderBy<T extends DatrixEntry = DatrixRecord> =
	DatrixRecord extends T
		? readonly FallbackOrderByItem[]
		: readonly OrderByItem<T>[];

/**
 * OrderByClause - Input format for orderBy (before normalization)
 *
 * Supports three formats:
 * 1. Full format: [{ field: "age", direction: "asc", nulls: "last" }]
 * 2. Object shortcut: { age: "asc" } (single field only, order not guaranteed for multiple)
 * 3. String array: ["age", "-name"] (- prefix = desc, order guaranteed)
 *
 * @example
 * ```ts
 * // Full format - most explicit, supports nulls
 * orderBy: [{ field: "age", direction: "asc", nulls: "last" }]
 *
 * // Object shortcut - simple single field
 * orderBy: { age: "asc" }
 *
 * // String array - multiple fields with guaranteed order
 * orderBy: ["age", "-createdAt"]  // age ASC, createdAt DESC
 * ```
 */
export type OrderByClause<T extends DatrixEntry = DatrixRecord> =
	DatrixRecord extends T
		?
				| readonly FallbackOrderByItem[]
				| Record<string, OrderDirection>
				| readonly string[]
		:
				| QueryOrderBy<T>
				| Partial<Record<keyof T, OrderDirection>>
				| readonly (keyof T | `-${string & keyof T}`)[];

/**
 * QuerySelect - Normalized form of SelectClause (always array, never '*')
 *
 * - Default (DatrixRecord): readonly string[] — flexible, accepts any field name
 * - Specific type:          readonly (keyof T)[] — type-safe, only valid fields
 */
export type QuerySelect<T extends DatrixEntry = DatrixRecord> =
	DatrixRecord extends T ? readonly string[] : readonly (keyof T)[];

/**
 * QueryPopulateOptions - Normalized options for a single relation
 */
export type QueryPopulateOptions<T extends DatrixEntry> = {
	readonly select: QuerySelect<T>;
	readonly where?: WhereClause<T> | undefined;
	readonly populate?: QueryPopulate<T> | undefined;
	readonly limit?: number | undefined;
	readonly offset?: number | undefined;
	readonly orderBy?: QueryOrderBy | undefined;
};

/**
 * QueryPopulate - Normalized form of PopulateClause
 *
 * Type-safe: Only relation fields of T can be keys, and each maps to
 * QueryPopulateOptions of the related entity type.
 */
export type QueryPopulate<T extends DatrixEntry = DatrixRecord> = {
	readonly [K in keyof T]?: T[K] extends RelationInput<
		infer R extends DatrixEntry
	>
		? QueryPopulateOptions<R>
		: never;
};

/**
 * Normalized nested data for create/update operations (output of processData)
 *
 * After normalization:
 * - Scalar fields go to 'data'
 * - Relation operations go to 'relations' (can be recursive)
 *
 * @template T - The entity type
 */
export type NormalizedNestedData<T extends DatrixEntry> = {
	readonly data: Partial<T>;
	readonly relations?: QueryRelations<T> | undefined;
};

/**
 * Normalized relation operations for QueryObject (output format)
 *
 * This is what processData() produces - fully normalized and type-safe:
 * - connect/disconnect/set/delete: number[] (normalized from flexible input)
 * - create: NormalizedNestedData<R> or array (recursive normalization)
 * - update: { where, data, relations } or array (recursive normalization)
 *
 * @template R - The related entity type
 *
 * @example
 * ```ts
 * // Input (flexible RelationInput):
 * {
 *   author: { connect: 5 },
 *   tags: {
 *     connect: [{ id: 1 }, 2],
 *     create: [{ name: 'Tech', category: { connect: 3 } }]
 *   }
 * }
 *
 * // Output (normalized NormalizedRelationOperations):
 * {
 *   author: { connect: [5] },
 *   tags: {
 *     connect: [1, 2],
 *     create: [{
 *       data: { name: 'Tech', categoryId: 3 },
 *       relations: undefined
 *     }]
 *   }
 * }
 * ```
 */
export type NormalizedRelationOperations<R extends DatrixEntry> = {
	readonly connect?: readonly number[];
	readonly disconnect?: readonly number[];
	readonly set?: readonly number[];
	readonly delete?: readonly number[];
	readonly create?: readonly NormalizedNestedData<R>[];
	readonly update?: readonly NormalizedRelationUpdate<R>[];
};

export interface NormalizedRelationUpdate<
	T extends DatrixEntry,
> extends NormalizedNestedData<T> {
	readonly where: { readonly id: number };
}

/**
 * Type-safe relation operations for QueryObject
 *
 * Maps each relation field to its normalized operations.
 * This is the OUTPUT format after processData() normalization.
 *
 * @template T - The entity type
 *
 * @example
 * ```ts
 * type Post = {
 *   id: number;
 *   title: string;
 *   author: Relation<User>;
 *   tags: Relation<Tag>;
 * };
 *
 * const relations: QueryRelations<Post> = {
 *   author: { connect: [5] },  // ✅ normalized to number[]
 *   tags: {
 *     set: [1, 2, 3],           // ✅ number[] (not flexible input)
 *     create: [{                // ✅ NormalizedNestedData
 *       data: { name: 'New Tag' },
 *       relations: undefined
 *     }]
 *   }
 * };
 * ```
 */
export type QueryRelations<T extends DatrixEntry> = {
	readonly [K in keyof T]?: T[K] extends RelationInput<
		infer R extends DatrixEntry
	>
		? NormalizedRelationOperations<R>
		: never;
};

/**
 * Query object base - common fields for all query types
 */
interface QueryBase {
	readonly table: string;
}

/**
 * SELECT query - read rows with filtering, sorting, pagination, population
 */
export interface QuerySelectObject<T extends DatrixEntry> extends QueryBase {
	readonly type: "select";
	readonly select: QuerySelect<T>;
	where?: WhereClause<T>;
	readonly populate?: QueryPopulate<T> | undefined;
	readonly orderBy?: QueryOrderBy | undefined;
	readonly limit?: number | undefined;
	readonly offset?: number | undefined;
	readonly distinct?: boolean | undefined;
	readonly groupBy?: readonly string[] | undefined;
	readonly having?: WhereClause<T> | undefined;
}

/**
 * COUNT query - count rows matching conditions
 */
export interface QueryCountObject<T extends DatrixEntry> extends QueryBase {
	readonly type: "count";
	where?: WhereClause<T>;
	readonly groupBy?: readonly string[];
	readonly having?: WhereClause<T>;
}

/**
 * INSERT query - bulk insert with data array
 * select/populate are used by executor to fetch inserted records after insert
 */
export interface QueryInsertObject<T extends DatrixEntry> extends QueryBase {
	readonly type: "insert";
	readonly data: readonly Partial<T>[];
	readonly relations?: QueryRelations<T> | undefined;
	readonly select?: QuerySelect<T> | undefined;
	readonly populate?: QueryPopulate<T> | undefined;
}

/**
 * UPDATE query - update rows matching conditions
 * select/populate are used by executor to fetch updated records after update
 */
export interface QueryUpdateObject<T extends DatrixEntry> extends QueryBase {
	readonly type: "update";
	readonly data: Partial<T>;
	where?: WhereClause<T>;
	readonly relations?: QueryRelations<T> | undefined;
	readonly select?: QuerySelect<T> | undefined;
	readonly populate?: QueryPopulate<T> | undefined;
}

/**
 * DELETE query - delete rows matching conditions
 * select/populate are used by executor to fetch records before deletion
 * where is required — use deleteAll() explicitly if you want to delete everything
 */
export interface QueryDeleteObject<T extends DatrixEntry> extends QueryBase {
	readonly type: "delete";
	where: WhereClause<T>;
	readonly select?: QuerySelect<T>;
	readonly populate?: QueryPopulate<T>;
}

/**
 * Query object (database-agnostic representation)
 *
 * Discriminated union on `type` field. Each query type has only the fields it needs:
 * - SELECT: select, where, populate, orderBy, limit, offset, distinct, groupBy, having
 * - COUNT: where, groupBy, having
 * - INSERT: data (array), relations
 * - UPDATE: data (single), where, relations
 * - DELETE: where
 */
export type QueryObject<T extends DatrixEntry = DatrixRecord> =
	| QuerySelectObject<T>
	| QueryCountObject<T>
	| QueryInsertObject<T>
	| QueryUpdateObject<T>
	| QueryDeleteObject<T>;

/**
 * Map QueryType to its corresponding QueryObject variant
 */
export type QueryObjectForType<
	T extends DatrixEntry,
	TType extends QueryType,
> = TType extends "select"
	? QuerySelectObject<T>
	: TType extends "count"
		? QueryCountObject<T>
		: TType extends "insert"
			? QueryInsertObject<T>
			: TType extends "update"
				? QueryUpdateObject<T>
				: TType extends "delete"
					? QueryDeleteObject<T>
					: QueryObject<T>;
