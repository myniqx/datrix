/**
 * Query Builder System
 *
 * Exports database-agnostic query builder and query object types.
 */

// Export query types
export type {
  Primitive,
  QueryType,
  ComparisonOperators,
  LogicalOperators,
  WhereClause,
  SelectClause,
  PopulateClause,
  PopulateOptions,
  OrderDirection,
  QueryObject,
  QueryBuilder,
} from './types';

// Export query builder
export { createQueryBuilder } from './builder';

// Export where clause utilities
export { mergeWhereClauses } from './where';

// Export select clause utilities
export { normalizeSelectClause } from './select';

// Export populate clause utilities
export { mergePopulateClauses } from './populate';

// Export pagination utilities
export { calculatePagination, createPaginationMeta } from './pagination';
