/**
 * MySQL Client Wrapper
 *
 * Wraps Pool or PoolConnection to provide:
 * - Automatic SQL debug logging (non-production)
 * - Consistent error handling with ForjaAdapterError
 * - MySQL error code to Forja error code mapping
 */

import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { ForjaAdapterError } from "forja-types/errors/adapter";
import { QueryObject } from "forja-types";

const IS_DEBUG = process.env["NODE_ENV"] !== "production";

const MYSQL_CODE_MAP: Record<string, string> = {
	ER_DUP_ENTRY: "ADAPTER_UNIQUE_CONSTRAINT",
	ER_NO_REFERENCED_ROW_2: "ADAPTER_FOREIGN_KEY_CONSTRAINT",
	ER_ROW_IS_REFERENCED_2: "ADAPTER_FOREIGN_KEY_CONSTRAINT",
};

function mysqlCodeToAdapterCode(mysqlCode: string | undefined): string {
	if (mysqlCode && mysqlCode in MYSQL_CODE_MAP) {
		return MYSQL_CODE_MAP[mysqlCode]!;
	}
	return "ADAPTER_QUERY_ERROR";
}

export type MySQLExecuteResult = [ResultSetHeader | RowDataPacket[], unknown];

/**
 * Lightweight wrapper around mysql2 Pool/PoolConnection.
 *
 * Every query passes through a single point that logs SQL
 * in development and wraps MySQL errors into ForjaAdapterError.
 */
export class MySQLClient {
	constructor(
		private readonly runner: Pool | PoolConnection,
		private readonly queryObject: QueryObject,
	) {}

	/**
	 * Execute a SQL query with optional parameters.
	 */
	async execute(
		sql: string,
		params?: readonly unknown[],
	): Promise<MySQLExecuteResult> {
		if (IS_DEBUG) {
			console.log("[MySQL]", sql, params ?? [], {
				queryObject: JSON.stringify(this.queryObject),
			});
		}

		try {
			const result = await this.runner.execute(sql, params as unknown[]);
			return result as MySQLExecuteResult;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const details = error as {
				code?: string;
				errno?: number;
				sqlState?: string;
			};

			const adapterCode = mysqlCodeToAdapterCode(details.code);

			throw new ForjaAdapterError(`Query failed: ${message}`, {
				adapter: "mysql",
				code: adapterCode,
				operation: "query",
				context: {
					sql,
					...(params && { params }),
					...(details.code && { mysqlCode: details.code }),
					...(details.errno && { mysqlErrno: details.errno }),
					...(details.sqlState && { sqlState: details.sqlState }),
				},
				cause: error instanceof Error ? error : undefined,
			});
		}
	}
}
