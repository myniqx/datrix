/**
 * MongoDB Adapter for Datrix
 *
 * Provides MongoDB database support with:
 * - Connection pooling (via MongoClient built-in pool)
 * - Transaction support (requires replica set)
 * - Auto-increment IDs via _datrix counters
 * - Relation population ($lookup + batched queries)
 * - Schema metadata tracking in _datrix collection
 */

export { MongoDBAdapter, createMongoDBAdapter } from "./adapter";
export type { MongoDBConfig } from "./types";
