/**
 * Query Builder Type Definitions
 *
 * This file defines types for Forja's database-agnostic query builder.
 * Query builder produces QueryObject instances that adapters translate to SQL/NoSQL.
 */

import { ForjaEntry, ForjaRecord, Relation } from "./schema";

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
 * @template T - The entity type (extends ForjaEntry)
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
export type LogicalOperators<T extends ForjaEntry = ForjaEntry> = {
	readonly $and?: WhereClause<T>[];
	readonly $or?: WhereClause<T>[];
	readonly $not?: WhereClause<T>;
};

/**
 * Type-safe WHERE clause with nested relation support
 *
 * **Design Philosophy:**
 * - Default type: `ForjaEntry & Record<string, unknown>` (flexible but safe)
 * - Custom type: Full type safety with autocomplete
 * - Relation fields: Automatically supports nested WHERE conditions
 * - Foreign keys: Not exposed (internal implementation detail)
 *
 * **Type Inference:**
 * - Scalar fields → Direct value or ComparisonOperators
 * - Relation fields (branded as Relation<T>) → Nested WhereClause<T>
 * - Unknown fields → Fallback to `unknown` for flexibility
 *
 * @template T - The entity type (default: ForjaRecord)
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
export type WhereClause<T extends ForjaEntry> = Writable<{
	[K in keyof T]?: T[K] extends Relation<infer R>
		? WhereClause<R>
		: T[K] extends ScalarValue
			? T[K] | ComparisonOperators<T[K]>
			: unknown;
}> &
	LogicalOperators<T>;

/**
 * SELECT clause (fields to select) - Input format from user
 *
 * Accepts multiple formats:
 * - Array of field names: ['id', 'name', 'email']
 * - Single field name: 'name'
 * - Wildcard: '*' (all fields)
 */
export type SelectClause<T extends ForjaEntry> =
	| readonly (keyof T)[]
	| "*"
	| keyof T;

/**
 * Populate clause (relations to include)
 */
export type PopulateOptions<T extends ForjaEntry> = {
	readonly select?: SelectClause<T> | undefined;
	readonly where?: WhereClause<T> | undefined;
	readonly populate?: PopulateClause<T> | undefined; // Nested populate
	readonly limit?: number | undefined;
	readonly offset?: number | undefined;
	readonly orderBy?: OrderBy | undefined;
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
export type PopulateClause<T extends ForjaEntry = ForjaRecord> =
	| boolean
	| "*"
	| "true"
	| keyof T[]
	| {
			readonly [relation: string]: PopulateOptions<T> | "*" | boolean;
	  };

/**
 * Order direction
 */
export type OrderDirection = "asc" | "desc";

/**
 * Order by item
 */
export type OrderByItem = {
	readonly field: string;
	readonly direction: OrderDirection;
	readonly nulls?: "first" | "last"; // NULL ordering
};

export type OrderBy = readonly OrderByItem[];

/**
 * QuerySelect - Normalized form of SelectClause (always array, never '*')
 */
export type QuerySelect<T extends ForjaEntry = ForjaRecord> =
	readonly (keyof T)[];

/**
 * QueryPopulateOptions - Normalized options for a single relation
 */
export type QueryPopulateOptions<T extends ForjaEntry = ForjaRecord> = {
	readonly select: QuerySelect<T>;
	readonly where?: WhereClause<T>;
	readonly populate?: QueryPopulate<T>;
	readonly limit?: number;
	readonly offset?: number;
	readonly orderBy?: OrderBy;
};

/**
 * QueryPopulate - Normalized form of PopulateClause
 *
 * Type-safe: Only relation fields of T can be keys, and each maps to
 * QueryPopulateOptions of the related entity type.
 */
export type QueryPopulate<T extends ForjaEntry = ForjaRecord> = {
	readonly [K in keyof T]?: T[K] extends Relation<infer R>
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
export type NormalizedNestedData<T extends ForjaEntry> = {
	readonly data: Partial<T>;
	readonly relations?: QueryRelations<T>;
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
export type NormalizedRelationOperations<R extends ForjaEntry> = {
	readonly connect?: readonly number[];
	readonly disconnect?: readonly number[];
	readonly set?: readonly number[];
	readonly delete?: readonly number[];
	readonly create?: readonly NormalizedNestedData<R>[];
	readonly update?: readonly NormalizedRelationUpdate<R>[];
};

export interface NormalizedRelationUpdate<
	T extends ForjaEntry,
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
export type QueryRelations<T extends ForjaEntry> = {
	readonly [K in keyof T]?: T[K] extends Relation<infer R>
		? NormalizedRelationOperations<R>
		: never;
};

/**
 * Query object (database-agnostic representation)
 *
 * This is the normalized query that adapters receive.
 * All clauses are in their normalized form (QuerySelect, QueryPopulate, etc.)
 */
export interface QueryObject<T extends ForjaEntry> {
	readonly type: QueryType;
	readonly table: string;
	readonly select?: QuerySelect<T> | undefined;
	where?: WhereClause<T> | undefined;
	readonly populate?: QueryPopulate<T> | undefined;
	readonly orderBy?: OrderBy | undefined;
	readonly limit?: number | undefined;
	readonly offset?: number | undefined;
	readonly data?: Partial<T>; // For INSERT/UPDATE (scalar fields only)
	readonly relations?: QueryRelations<T> | undefined; // For INSERT/UPDATE (type-safe relation operations)
	readonly distinct?: boolean; // SELECT DISTINCT
	readonly groupBy?: readonly string[]; // GROUP BY fields
	readonly having?: WhereClause<T>; // HAVING clause
}

/**
 * Query builder interface
 *
 * Generic type TSchema allows for type-safe query building when schema type is known.
 * If TSchema extends ForjaEntry, WHERE conditions will be fully type-checked.
 *
 * @template TSchema - Entity type for type-safe queries (default: Record<string, unknown>)
 *
 * @example
 * ```ts
 * // Type-safe builder
 * const builder: QueryBuilder<Post> = createQueryBuilder('posts');
 * builder.where({ title: { $like: 'Hello%' } });  // ✅ Type-checked
 *
 * // Generic builder (backward compatible)
 * const builder2: QueryBuilder = createQueryBuilder('users');
 * builder2.where({ anyField: 'value' });  // ✅ Works but no type checking
 * ```
 */
export interface QueryBuilder<TSchema extends ForjaEntry> {
	/**
	 * Select fields
	 */
	select(fields: SelectClause<TSchema>): this;

	/**
	 * Add WHERE conditions (type-safe when TSchema is provided)
	 * Multiple .where() calls are merged with $and logic
	 */
	where(conditions: WhereClause<TSchema>): this;

	/**
	 * Add populate (relations)
	 */
	populate(relations: PopulateClause<TSchema>): this;

	/**
	 * Add order by
	 */
	orderBy(field: string, direction?: OrderDirection): this;

	/**
	 * Set limit
	 */
	limit(limit: number): this;

	/**
	 * Set offset
	 */
	offset(offset: number): this;

	/**
	 * Set data for INSERT/UPDATE
	 */
	data(data: Partial<TSchema>): this;

	/**
	 * Set distinct
	 */
	distinct(distinct?: boolean): this;

	/**
	 * Set group by
	 */
	groupBy(fields: readonly string[]): this;

	/**
	 * Set having clause (type-safe when TSchema is provided)
	 */
	having(conditions: WhereClause<TSchema>): this;

	/**
	 * Build final query object
	 */
	build(): QueryObject<TSchema>;

	/**
	 * Clone the builder
	 */
	clone(): QueryBuilder<TSchema>;
}
