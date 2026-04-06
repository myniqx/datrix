/**
 * Schema lifecycle hook types.
 */

import type { ForjaEntry } from "./entry";
import type {
	QueryInsertObject,
	QueryUpdateObject,
	QueryDeleteObject,
	QuerySelectObject,
} from "./query-builder";
import type { QueryContext } from "./query-context";

/**
 * Lifecycle hooks for a schema.
 *
 * Before hooks receive the current query object and must return it (optionally modified).
 * After hooks receive the result array and must return it (optionally modified).
 * ctx.metadata is shared between before and after hooks for the same operation.
 * ctx.forja gives access to the Forja instance for additional queries or schema inspection.
 */
export interface LifecycleHooks<T extends ForjaEntry = ForjaEntry> {
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

	// --- read hooks ---
	readonly beforeFind?: (
		query: QuerySelectObject<T>,
		ctx: QueryContext,
	) => Promise<QuerySelectObject<T>> | QuerySelectObject<T>;
	readonly afterFind?: (records: T[], ctx: QueryContext) => Promise<T[]> | T[];
}
