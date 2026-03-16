/**
 * PostgreSQL Client Wrapper
 *
 * Wraps Pool or PoolClient to provide:
 * - Automatic SQL debug logging (non-production)
 * - Consistent error handling with ForjaAdapterError
 */

import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { AdapterErrorCode, ForjaAdapterError } from "forja-types/errors/adapter";
import { QueryObject } from "forja-types";

const IS_DEBUG = process.env["NODE_ENV"] !== "production";

const PG_CODE_MAP: Record<string, AdapterErrorCode> = {
	"23505": "ADAPTER_UNIQUE_CONSTRAINT",
	"23503": "ADAPTER_FOREIGN_KEY_CONSTRAINT",
};

function pgCodeToAdapterCode(pgCode: string | undefined): AdapterErrorCode {
	if (pgCode && pgCode in PG_CODE_MAP) {
		return PG_CODE_MAP[pgCode]!;
	}
	return "ADAPTER_QUERY_ERROR";
}

/**
 * Lightweight wrapper around pg Pool/PoolClient.
 *
 * Every query passes through a single point that logs SQL
 * in development and wraps pg errors into ForjaAdapterError.
 */
export class PgClient {
	constructor(
		private readonly runner: Pool | PoolClient,
		private readonly queryObject: QueryObject,
	) { }

	/**
	 * Execute a SQL query with optional parameters.
	 */
	async query<T extends QueryResultRow = QueryResultRow>(
		sql: string,
		params?: readonly unknown[],
	): Promise<QueryResult<T>> {
		if (IS_DEBUG) {
			console.log("[PG]", sql, params ?? [], {
				queryObject: JSON.stringify(this.queryObject),
			});
		}

		try {
			return await this.runner.query<T>(sql, params as unknown[]);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const details = error as {
				code?: string;
				severity?: string;
				detail?: string;
				hint?: string;
			};

			const adapterCode = pgCodeToAdapterCode(details.code);

			throw new ForjaAdapterError(`Query failed: ${message}`, {
				adapter: "postgres",
				code: adapterCode,
				operation: "query",
				context: {
					sql,
					...(params && { params }),
					...(details.code && { pgCode: details.code }),
					...(details.severity && { pgSeverity: details.severity }),
					...(details.detail && { pgDetail: details.detail }),
					...(details.hint && { pgHint: details.hint }),
				},
				cause: error instanceof Error ? error : undefined,
			});
		}
	}
}
