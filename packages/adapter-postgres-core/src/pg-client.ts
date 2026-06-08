/**
 * PostgreSQL Client Wrapper
 *
 * Wraps Pool or PoolClient to provide:
 * - Automatic SQL debug logging (non-production)
 * - Consistent error handling with DatrixAdapterError
 */

import { AdapterErrorCode, DatrixAdapterError } from "@datrix/core";
import { QueryObject } from "@datrix/core";
import type { PgQueryResult, PgRunner } from "./driver";

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
 * Lightweight wrapper around a PgRunner (pool, connection, etc.).
 *
 * Every query passes through a single point that logs SQL
 * in development and wraps driver errors into DatrixAdapterError.
 */
export class PgClient {
	constructor(
		private readonly runner: PgRunner,
		private readonly queryObject: QueryObject,
	) {}

	/**
	 * Execute a SQL query with optional parameters.
	 */
	async query<T = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
	): Promise<PgQueryResult<T>> {
		if (IS_DEBUG) {
			console.log("[PG]", sql, params ?? [], {
				queryObject: JSON.stringify(this.queryObject),
			});
		}

		try {
			return await this.runner.query<T>(sql, params);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const details = error as {
				code?: string;
				severity?: string;
				detail?: string;
				hint?: string;
			};

			const adapterCode = pgCodeToAdapterCode(details.code);

			throw new DatrixAdapterError(`Query failed: ${message}`, {
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
