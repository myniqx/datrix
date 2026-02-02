/**
 * Query Builder System
 *
 * Exports database-agnostic query builder and query object types.
 */

// Export query builder
export {
  createQueryBuilder,
  selectFrom,
  insertInto,
  updateTable,
  deleteFrom,
  countFrom,
  ForjaQueryBuilder,
} from './builder';

// Export query normalizer (NEW - single source of truth)
export { QueryNormalizer } from './normalizer';

// Export where clause utilities
export { mergeWhereClauses } from './where';

// Export select clause utilities
export { normalizeSelectClause } from './select';

// Export populate clause utilities
export { mergePopulateClauses } from './populate';

// Export pagination utilities
export { calculatePagination, createPaginationMeta } from './pagination';
