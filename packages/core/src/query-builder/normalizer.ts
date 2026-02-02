/**
 * Query Normalizer (DEPRECATED)
 *
 * This file is DEPRECATED and will be removed.
 * Normalization logic has been moved to individual modules:
 * - SELECT → select.ts (normalizeSelect)
 * - WHERE → where.ts (normalizeWhere)
 * - POPULATE → populate.ts (normalizePopulate)
 *
 * This empty class exists only for backward compatibility.
 * DO NOT add new code here.
 */

import type { SchemaRegistry as ISchemaRegistry } from "forja-types/core/schema";

/**
 * @deprecated Use normalizeSelect, normalizeWhere, normalizePopulate from respective modules
 */
export class QueryNormalizer {
  constructor(private readonly schemas: ISchemaRegistry) {}
}
