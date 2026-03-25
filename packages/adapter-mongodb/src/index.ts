/**
 * MongoDB Adapter for Forja
 *
 * Provides MongoDB database support with:
 * - Connection pooling (via MongoClient built-in pool)
 * - Transaction support (requires replica set)
 * - Auto-increment IDs via _forja counters
 * - Relation population ($lookup + batched queries)
 * - Schema metadata tracking in _forja collection
 */

export { MongoDBAdapter, createMongoDBAdapter } from "./adapter";
export type { MongoDBConfig } from "./types";
