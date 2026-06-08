/**
 * PostgreSQL Adapter Entry Point
 *
 * Exports all PostgreSQL adapter components.
 */

export { PostgresCoreAdapter, createPostgresCoreAdapter } from "./adapter";
export type { PostgresCoreConfig } from "./types";
export type {
	PgRunner,
	PgConnection,
	PgQueryResult,
} from "./driver";
