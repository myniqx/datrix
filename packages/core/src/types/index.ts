/**
 * Datrix Types
 *
 * Shared TypeScript types for the Datrix framework.
 */

export * from "./core/plugin";
export * from "./cli";

// Permission types
export * from "./core/permission";

// Core constants
export { FORJA_META_MODEL, FORJA_META_KEY_PREFIX } from "./core/constants";

// Query builder types
export {
	type QueryPrimitive,
	type ScalarValue,
	type QueryType,
	type ComparisonOperators,
	type LogicalOperators,
	type WhereClause,
	type SelectClause,
	type PopulateOptions,
	type PopulateClause,
	type OrderDirection,
	type OrderByItem,
	type QueryOrderBy as OrderBy,
	type QuerySelectObject,
	type QueryCountObject,
	type QueryInsertObject,
	type QueryUpdateObject,
	type QueryDeleteObject,
	type QueryObject,
	type QueryObjectForType,
} from "./core/query-builder";
