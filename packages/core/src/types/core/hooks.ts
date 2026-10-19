/**
 * Schema lifecycle hook types.
 */

import type { DatrixEntry } from "./entry";
import type {
	QueryInsertObject,
	QueryUpdateObject,
	QueryDeleteObject,
	QuerySelectObject,
	QueryUpsertObject,
} from "./query-builder";
import type { QueryContext } from "./query-context";

/** `records` of an upsert split by whether the row was inserted or matched. */
export interface UpsertHookResult<T extends DatrixEntry = DatrixEntry> {
	readonly created: T[];
	readonly updated: T[];
}

/**
 * Lifecycle hooks for a schema.
 *
 * Before hooks receive the current query object and must return it (optionally modified).
 * After hooks receive the result array and must return it (optionally modified).
 * ctx.metadata is shared between before and after hooks for the same operation.
 * ctx.datrix gives access to the Datrix instance for additional queries or schema inspection.
 */
export interface LifecycleHooks<T extends DatrixEntry = DatrixEntry> {
	// --- write hooks ---
	readonly beforeCreate?: (
		query: QueryInsertObject<T>,
		ctx: QueryContext,
	) => Promise<QueryInsertObject<T>> | QueryInsertObject<T>;
	readonly afterCreate?: (
		records: T[],
		ctx: QueryContext,
	) => Promise<T[]> | T[];

	readonly beforeUpdate?: (
		query: QueryUpdateObject<T>,
		ctx: QueryContext,
	) => Promise<QueryUpdateObject<T>> | QueryUpdateObject<T>;
	readonly afterUpdate?: (
		records: T[],
		ctx: QueryContext,
	) => Promise<T[]> | T[];

	readonly beforeDelete?: (
		query: QueryDeleteObject<T>,
		ctx: QueryContext,
	) => Promise<QueryDeleteObject<T>> | QueryDeleteObject<T>;
	readonly afterDelete?: (
		records: T[],
		ctx: QueryContext,
	) => Promise<void> | void;

	readonly beforeUpsert?: (
		query: QueryUpsertObject<T>,
		ctx: QueryContext,
	) => Promise<QueryUpsertObject<T>> | QueryUpsertObject<T>;
	readonly afterUpsert?: (
		records: T[],
		ctx: QueryContext,
		result: UpsertHookResult<T>,
	) => Promise<T[]> | T[];

	// --- read hooks ---
	readonly beforeFind?: (
		query: QuerySelectObject<T>,
		ctx: QueryContext,
	) => Promise<QuerySelectObject<T>> | QuerySelectObject<T>;
	readonly afterFind?: (records: T[], ctx: QueryContext) => Promise<T[]> | T[];
}
