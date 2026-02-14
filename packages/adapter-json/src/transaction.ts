/**
 * JSON Adapter Transaction Implementation
 *
 * Provides ACID-like transaction support for JSON file adapter.
 *
 * Strategy:
 * - BEGIN: Adapter acquires lock, creates isolated txCache
 * - QUERY: Adapter's readTable/writeTable automatically use txCache
 * - COMMIT: Adapter writes modified tables to disk, merges to main cache
 * - ROLLBACK: Adapter discards txCache, releases lock
 *
 * The transaction object is a thin wrapper that delegates to adapter.
 */

import {
	Transaction,
	TransactionError,
	QueryResult,
	QueryError,
} from "forja-types/adapter";
import { QueryObject } from "forja-types/core/query-builder";
import { ForjaEntry } from "forja-types/core/schema";
import { Result } from "forja-types/utils";
import type { JsonAdapter } from "./adapter";

/**
 * JSON Transaction
 *
 * Thin wrapper around adapter that executes queries with transaction options.
 * Actual transaction state is managed by the adapter.
 */
export class JsonTransaction implements Transaction {
	readonly id: string;

	private committed = false;
	private rolledBack = false;

	constructor(
		private adapter: JsonAdapter,
		private commitCallback: () => Promise<void>,
		private rollbackCallback: () => Promise<void>,
	) {
		this.id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
	}

	/**
	 * Check if transaction is still active
	 */
	private assertActive(): void {
		if (this.committed) {
			throw new TransactionError("Transaction already committed");
		}
		if (this.rolledBack) {
			throw new TransactionError("Transaction already rolled back");
		}
	}

	/**
	 * Execute query within transaction
	 *
	 * Uses adapter's executeQueryWithOptions with skipLock and skipWrite.
	 * Adapter automatically uses transaction cache.
	 */
	async executeQuery<TResult extends ForjaEntry>(
		query: QueryObject<TResult>,
	): Promise<Result<QueryResult<TResult>, QueryError<TResult>>> {
		this.assertActive();

		return this.adapter.executeQueryWithOptions<TResult>(query, {
			skipLock: true,
			skipWrite: true,
		});
	}

	/**
	 * Execute raw SQL query (not supported for JSON adapter)
	 */
	async executeRawQuery<TResult extends ForjaEntry>(
		_sql: string,
		_params: readonly unknown[],
	): Promise<Result<QueryResult<TResult>, QueryError<TResult>>> {
		return {
			success: false,
			error: new QueryError("Raw SQL queries are not supported by JSON adapter"),
		};
	}

	/**
	 * Commit transaction
	 *
	 * Delegates to adapter's commitTransaction which writes to disk.
	 */
	async commit(): Promise<Result<void, TransactionError>> {
		this.assertActive();

		try {
			await this.commitCallback();
			this.committed = true;
			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new TransactionError(`Commit failed: ${message}`, error),
			};
		}
	}

	/**
	 * Rollback transaction
	 *
	 * Delegates to adapter's rollbackTransaction which discards changes.
	 */
	async rollback(): Promise<Result<void, TransactionError>> {
		if (this.committed) {
			return {
				success: false,
				error: new TransactionError("Cannot rollback: transaction already committed"),
			};
		}

		if (this.rolledBack) {
			return { success: true, data: undefined };
		}

		try {
			await this.rollbackCallback();
			this.rolledBack = true;
			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new TransactionError(`Rollback failed: ${message}`, error),
			};
		}
	}

	/**
	 * Create savepoint (not yet implemented for JSON adapter)
	 */
	async savepoint(_name: string): Promise<Result<void, TransactionError>> {
		return {
			success: false,
			error: new TransactionError("Savepoints are not yet supported by JSON adapter"),
		};
	}

	/**
	 * Rollback to savepoint (not yet implemented for JSON adapter)
	 */
	async rollbackTo(_name: string): Promise<Result<void, TransactionError>> {
		return {
			success: false,
			error: new TransactionError("Savepoints are not yet supported by JSON adapter"),
		};
	}

	/**
	 * Release savepoint (not yet implemented for JSON adapter)
	 */
	async release(_name: string): Promise<Result<void, TransactionError>> {
		return {
			success: false,
			error: new TransactionError("Savepoints are not yet supported by JSON adapter"),
		};
	}
}
