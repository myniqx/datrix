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
export { MongoDBQueryTranslator } from "./query-translator";
export { MongoDBPopulator } from "./populate";
export { MongoClient } from "./mongo-client";
export type {
	MongoDBConfig,
	MongoTranslateResult,
	MongoFindResult,
	MongoInsertResult,
	MongoUpdateResult,
	MongoDeleteResult,
	MongoCountResult,
} from "./types";
export { COUNTER_KEY_PREFIX } from "./types";
