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

import { Transaction, QueryResult, AlterOperation } from "@forja/types/adapter";
import {
	throwTransactionAlreadyCommitted,
	throwTransactionAlreadyRolledBack,
	throwTransactionSavepointNotSupported,
	throwRawQueryNotSupported,
} from "@forja/types/errors";
import { QueryObject } from "@forja/types/core/query-builder";
import {
	ForjaEntry,
	IndexDefinition,
	SchemaDefinition,
} from "@forja/types/core/schema";
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
			throwTransactionAlreadyCommitted({ adapter: "json" });
		}
		if (this.rolledBack) {
			throwTransactionAlreadyRolledBack({ adapter: "json" });
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
	): Promise<QueryResult<TResult>> {
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
	): Promise<QueryResult<TResult>> {
		throwRawQueryNotSupported({ adapter: "json" });
	}

	// ========================================
	// SchemaOperations implementation
	// ========================================

	/**
	 * Create table within transaction
	 */
	async createTable(schema: SchemaDefinition): Promise<void> {
		this.assertActive();
		return this.adapter.createTableWithOptions(schema, { skipWrite: true });
	}

	/**
	 * Drop table within transaction
	 */
	async dropTable(tableName: string): Promise<void> {
		this.assertActive();
		return this.adapter.dropTableWithOptions(tableName, { skipWrite: true });
	}

	/**
	 * Rename table within transaction
	 */
	async renameTable(from: string, to: string): Promise<void> {
		this.assertActive();
		return this.adapter.renameTableWithOptions(from, to, { skipWrite: true });
	}

	/**
	 * Alter table within transaction
	 */
	async alterTable(
		tableName: string,
		operations: readonly AlterOperation[],
	): Promise<void> {
		this.assertActive();
		return this.adapter.alterTableWithOptions(tableName, operations, {
			skipWrite: true,
		});
	}

	/**
	 * Add index within transaction
	 */
	async addIndex(tableName: string, index: IndexDefinition): Promise<void> {
		this.assertActive();
		return this.adapter.addIndexWithOptions(tableName, index, {
			skipWrite: true,
		});
	}

	/**
	 * Drop index within transaction
	 */
	async dropIndex(tableName: string, indexName: string): Promise<void> {
		this.assertActive();
		return this.adapter.dropIndexWithOptions(tableName, indexName, {
			skipWrite: true,
		});
	}

	/**
	 * Commit transaction
	 *
	 * Delegates to adapter's commitTransaction which writes to disk.
	 */
	async commit(): Promise<void> {
		this.assertActive();
		await this.commitCallback();
		this.committed = true;
	}

	/**
	 * Rollback transaction
	 *
	 * Delegates to adapter's rollbackTransaction which discards changes.
	 */
	async rollback(): Promise<void> {
		if (this.committed) {
			throwTransactionAlreadyCommitted({ adapter: "json" });
		}

		if (this.rolledBack) {
			return;
		}

		await this.rollbackCallback();
		this.rolledBack = true;
	}

	/**
	 * Create savepoint (not yet implemented for JSON adapter)
	 */
	async savepoint(_name: string): Promise<void> {
		throwTransactionSavepointNotSupported({ adapter: "json" });
	}

	/**
	 * Rollback to savepoint (not yet implemented for JSON adapter)
	 */
	async rollbackTo(_name: string): Promise<void> {
		throwTransactionSavepointNotSupported({ adapter: "json" });
	}

	/**
	 * Release savepoint (not yet implemented for JSON adapter)
	 */
	async release(_name: string): Promise<void> {
		throwTransactionSavepointNotSupported({ adapter: "json" });
	}
}
