/**
 * MongoDB Adapter Types
 *
 * Type definitions specific to MongoDB adapter.
 */

import type { Document, Filter, Sort, UpdateFilter } from "mongodb";

/**
 * MongoDB connection configuration
 */
export interface MongoDBConfig {
	/** MongoDB connection URI (e.g. "mongodb://localhost:27017") */
	readonly uri: string;
	/** Database name */
	readonly database: string;
	/** Maximum connection pool size */
	readonly maxPoolSize?: number;
	/** Minimum connection pool size */
	readonly minPoolSize?: number;
	/** Connection timeout in milliseconds */
	readonly connectTimeoutMS?: number;
	/** Server selection timeout in milliseconds */
	readonly serverSelectionTimeoutMS?: number;
	/** Application name for monitoring */
	readonly appName?: string;
	/** TLS/SSL options */
	readonly tls?: boolean;
	/** TLS certificate authority */
	readonly tlsCAFile?: string;
	/** Replica set name (required for transactions) */
	readonly replicaSet?: string;
	/** Auth source database */
	readonly authSource?: string;
}

/**
 * MongoDB translate result
 *
 * Unlike SQL adapters that produce { sql, params },
 * MongoDB adapter produces operation descriptors.
 */
export type MongoTranslateResult =
	| MongoFindResult
	| MongoInsertResult
	| MongoUpdateResult
	| MongoDeleteResult
	| MongoCountResult;

export interface MongoFindResult {
	readonly operation: "find";
	readonly collection: string;
	readonly filter: Filter<Document>;
	readonly projection?: Document;
	readonly sort?: Sort;
	readonly skip?: number;
	readonly limit?: number;
	/**
	 * $group key fields — set when the query uses `distinct` or `groupBy`.
	 * Presence switches execution from find() to an aggregation pipeline.
	 */
	readonly groupFields?: readonly string[];
	/** Fields of the final result rows (subset of groupFields). */
	readonly resultFields?: readonly string[];
	/** Translated HAVING filter, applied after grouping. */
	readonly having?: Filter<Document>;
}

export interface MongoInsertResult {
	readonly operation: "insertMany";
	readonly collection: string;
	readonly documents: readonly Document[];
}

export interface MongoUpdateResult {
	readonly operation: "updateMany";
	readonly collection: string;
	readonly filter: Filter<Document>;
	readonly update: UpdateFilter<Document>;
}

export interface MongoDeleteResult {
	readonly operation: "deleteMany";
	readonly collection: string;
	readonly filter: Filter<Document>;
}

export interface MongoCountResult {
	readonly operation: "countDocuments";
	readonly collection: string;
	readonly filter: Filter<Document>;
	/**
	 * GROUP BY fields — presence switches execution from countDocuments()
	 * to an aggregation pipeline ($group + $sum).
	 */
	readonly groupBy?: readonly string[];
	/** Translated HAVING filter, applied after grouping. */
	readonly having?: Filter<Document>;
}

/**
 * Counter key prefix for auto-increment IDs in _datrix collection
 * Stored as: _counter_tableName → { value: lastId }
 */
export const COUNTER_KEY_PREFIX = "_counter_";
