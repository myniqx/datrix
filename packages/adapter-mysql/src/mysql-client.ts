/**
 * MySQL Client Wrapper
 *
 * Wraps Pool or PoolConnection to provide:
 * - Automatic SQL debug logging (non-production)
 * - Consistent error handling with DatrixAdapterError
 * - MySQL error code to Datrix error code mapping
 */

import type {
	Pool,
	PoolConnection,
	ResultSetHeader,
	RowDataPacket,
} from "mysql2/promise";
import { AdapterErrorCode, DatrixAdapterError } from "@datrix/core";
import { QueryObject } from "@datrix/core";

const IS_DEBUG = process.env["NODE_ENV"] !== "production" && false;

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
 * in development and wraps MySQL errors into DatrixAdapterError.
 */
export class MySQLClient {
	constructor(
		private readonly runner: Pool | PoolConnection,
		private readonly queryObject: QueryObject,
	) {}

	/**
	 * Execute a SQL query with optional parameters (prepared statement).
	 */
	async execute(
		sql: string,
		params?: readonly unknown[],
	): Promise<MySQLExecuteResult> {
		return this.run("execute", sql, params);
	}

	/**
	 * Run a SQL query with optional parameters (non-prepared).
	 * Supports array params for WHERE IN (?), which prepared statements cannot handle.
	 */
	async query(
		sql: string,
		params?: readonly unknown[],
	): Promise<MySQLExecuteResult> {
		return this.run("query", sql, params);
	}

	private async run(
		method: "execute" | "query",
		sql: string,
		params?: readonly unknown[],
	): Promise<MySQLExecuteResult> {
		if (IS_DEBUG && this.queryObject.table !== "_datrix_migrations") {
			console.log("[MySQL]", sql, params ?? [], {
				queryObject: JSON.stringify(this.queryObject),
			});
		}

		try {
			const result = await this.runner[method](sql, params as unknown[]);
			return result as MySQLExecuteResult;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const details = error as {
				code?: string;
				errno?: number;
				sqlState?: string;
			};

			const adapterCode = mysqlCodeToAdapterCode(details.code);

			throw new DatrixAdapterError(`Query failed: ${message}`, {
				adapter: "mysql",
				code: adapterCode as AdapterErrorCode,
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
