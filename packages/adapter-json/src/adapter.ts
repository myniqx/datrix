import fs from "node:fs/promises";
import path from "node:path";
import {
	AlterOperation,
	ConnectionError,
	ConnectionState,
	DatabaseAdapter,
	MigrationError,
	QueryError,
	QueryResult,
	Transaction,
	TransactionError,
} from "forja-types/adapter";
import { QueryObject, QuerySelectObject } from "forja-types/core/query-builder";
import {
	ForjaEntry,
	IndexDefinition,
	SchemaDefinition,
} from "forja-types/core/schema";
import { Result } from "forja-types/utils";
import { validateQueryObject } from "forja-types/utils/query";
import { JsonAdapterConfig, JsonTableFile } from "./types";
import { JsonQueryRunner } from "./runner";
import { SimpleLock } from "./lock";
import { JsonPopulator } from "./populate";
import {
	throwQueryMissingData,
	throwUniqueConstraintField,
	throwUniqueConstraintIndex,
	throwForeignKeyConstraint,
} from "./error-helper";
import { ForjaError } from "forja-types/errors";
import { JsonTransaction } from "./transaction";

/**
 * Cache entry for table data
 */
export interface CacheEntry {
	data: JsonTableFile;
	mtime: number;
}

/**
 * Options for executeQuery to support transactions
 */
export interface ExecuteQueryOptions {
	/** Skip lock acquisition (transaction already holds lock) */
	skipLock?: boolean;
	/** Skip writing to disk (transaction will write on commit) */
	skipWrite?: boolean;
}

/**
 * Options for schema operations to support transactions
 */
export interface SchemaOperationOptions {
	/** Skip lock acquisition (transaction already holds lock) */
	skipLock?: boolean;
	/** Skip writing to disk (transaction will write on commit) */
	skipWrite?: boolean;
}

/**
 * JSON File Adapter
 */
export class JsonAdapter implements DatabaseAdapter<JsonAdapterConfig> {
	readonly name = "json";
	readonly config: JsonAdapterConfig;
	private state: ConnectionState = "disconnected";
	private cache = new Map<string, CacheEntry>();
	private lock: SimpleLock;
	private cacheEnabled: boolean;
	private readLockEnabled: boolean;

	/**
	 * Active transaction cache reference
	 * When a transaction is active, all reads/writes go through this cache first.
	 * Set by beginTransaction, cleared by commit/rollback.
	 */
	private activeTransactionCache: Map<string, CacheEntry> | null = null;

	/**
	 * Track modified tables during transaction for commit
	 */
	private activeTransactionModifiedTables: Set<string> | null = null;

	/**
	 * Tombstone set for tables deleted during transaction.
	 * Prevents fallback to main cache or disk for dropped tables.
	 */
	private activeTransactionDeletedTables: Set<string> | null = null;

	constructor(config: JsonAdapterConfig) {
		this.config = config;
		this.lock = new SimpleLock(
			config.root,
			config.lockTimeout,
			config.staleTimeout,
		);
		this.cacheEnabled = config.cache !== false; // default: true
		this.readLockEnabled = config.readLock === true; // default: false
	}

	/**
	 * Connect involves ensuring the root directory exists
	 */
	async connect(): Promise<Result<void, ConnectionError>> {
		if (this.state === "connected") {
			return { success: true, data: undefined };
		}

		this.state = "connecting";

		try {
			await fs.mkdir(this.config.root, { recursive: true });
			this.state = "connected";
			return { success: true, data: undefined };
		} catch (error) {
			this.state = "error";
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new ConnectionError(
					`Failed to access root directory: ${message}`,
					error,
				),
			};
		}
	}

	async disconnect(): Promise<Result<void, ConnectionError>> {
		this.state = "disconnected";
		return { success: true, data: undefined };
	}

	isConnected(): boolean {
		return this.state === "connected";
	}

	getConnectionState(): ConnectionState {
		return this.state;
	}

	/**
	 * Validate table name for security
	 */
	private validateTableName(tableName: string): Result<void, MigrationError> {
		if (tableName.includes("\x00")) {
			return {
				success: false,
				error: new MigrationError("Invalid table name: contains null byte"),
			};
		}

		if (tableName.includes("/") || tableName.includes("\\")) {
			return {
				success: false,
				error: new MigrationError(
					"Invalid table name: contains path separators",
				),
			};
		}

		if (tableName.includes("..")) {
			return {
				success: false,
				error: new MigrationError(
					"Invalid table name: contains parent directory reference",
				),
			};
		}

		return { success: true, data: undefined };
	}

	/**
	 * Helper to get file path for a table
	 */
	private getTablePath(tableName: string): string {
		return path.join(this.config.root, `${tableName}.json`);
	}

	/**
	 * Read table with cache support
	 *
	 * Cache lookup order:
	 * 1. Check tombstone (if transaction active and table was dropped)
	 * 2. Transaction cache (if active)
	 * 3. Main cache (with mtime validation)
	 * 4. Disk
	 *
	 * When transaction is active, new reads are cached in transaction cache.
	 * This ensures isolation - transaction sees its own writes.
	 */
	private async readTable(tableName: string): Promise<JsonTableFile> {
		const filePath = this.getTablePath(tableName);

		// 1. Check tombstone first - table was dropped in this transaction
		if (this.activeTransactionDeletedTables?.has(tableName)) {
			throw new Error(`Table '${tableName}' does not exist`);
		}

		// 2. Check transaction cache (if transaction active)
		if (this.activeTransactionCache) {
			const txCached = this.activeTransactionCache.get(tableName);
			if (txCached) {
				return txCached.data;
			}
		}

		// 2. Check main cache (with mtime validation)
		if (this.cacheEnabled) {
			const stat = await fs.stat(filePath);
			const mtime = stat.mtimeMs;

			const cached = this.cache.get(tableName);
			if (cached && cached.mtime === mtime) {
				// If transaction active, copy to tx cache for isolation
				if (this.activeTransactionCache) {
					// Deep copy to prevent mutation of main cache
					const txData = JSON.parse(JSON.stringify(cached.data));
					this.activeTransactionCache.set(tableName, { data: txData, mtime });
					return txData;
				}
				return cached.data;
			}

			// Cache miss or stale - read from disk
			const content = await fs.readFile(filePath, "utf-8");
			const data: JsonTableFile = JSON.parse(content);

			// Store in appropriate cache
			if (this.activeTransactionCache) {
				this.activeTransactionCache.set(tableName, { data, mtime });
			} else {
				this.cache.set(tableName, { data, mtime });
			}

			return data;
		}

		// 3. No cache - read from disk
		const content = await fs.readFile(filePath, "utf-8");
		return JSON.parse(content);
	}

	/**
	 * Get cached table data (for external use like Populate)
	 */
	async getCachedTable(tableName: string): Promise<JsonTableFile | null> {
		try {
			return await this.readTable(tableName);
		} catch {
			return null;
		}
	}

	/**
	 * Get schema directly from table file (cache-aware)
	 * This is faster than going through Forja registry and ensures consistency
	 *
	 * @param tableName - Table name (e.g., "users")
	 * @returns Schema definition or null if not found
	 */
	async getSchemaByTableName(
		tableName: string,
	): Promise<SchemaDefinition | null> {
		const tableData = await this.getCachedTable(tableName);
		return tableData?.schema ?? null;
	}

	/**
	 * Get schema by model name
	 * Requires scanning all tables to find matching schema.name
	 * Prefer getSchemaByTableName when table name is known (faster)
	 *
	 * @param modelName - Model name from schema (e.g., "User")
	 * @returns Schema definition or null if not found
	 */
	async getSchemaByModelName(
		modelName: string,
	): Promise<SchemaDefinition | null> {
		try {
			const tablesResult = await this.getTables();
			if (!tablesResult.success) {
				return null;
			}

			for (const tableName of tablesResult.data) {
				const schema = await this.getSchemaByTableName(tableName);
				if (schema?.name === modelName) {
					return schema;
				}
			}
			return null;
		} catch {
			return null;
		}
	}

	/**
	 * Find table name by schema model name
	 *
	 * @param modelName - Model name (e.g., "User")
	 * @returns Table name or null if not found
	 */
	async findTableNameByModelName(modelName: string): Promise<string | null> {
		const schema = await this.getSchemaByModelName(modelName);
		return schema?.tableName ?? null;
	}

	/**
	 * Invalidate cache for a specific table
	 */
	private invalidateCache(tableName: string): void {
		this.cache.delete(tableName);
	}

	/**
	 * Update cache after write operation
	 */
	private async updateCache(
		tableName: string,
		data: JsonTableFile,
	): Promise<void> {
		if (!this.cacheEnabled) return;

		const filePath = this.getTablePath(tableName);
		try {
			const stat = await fs.stat(filePath);
			this.cache.set(tableName, { data, mtime: stat.mtimeMs });
		} catch {
			this.invalidateCache(tableName);
		}
	}

	async createTable(
		schema: SchemaDefinition,
	): Promise<Result<void, MigrationError>> {
		return this.createTableWithOptions(schema);
	}

	/**
	 * Create table with options (for transaction support)
	 */
	async createTableWithOptions(
		schema: SchemaDefinition,
		options?: SchemaOperationOptions,
	): Promise<Result<void, MigrationError>> {
		const skipWrite = options?.skipWrite ?? false;

		if (!this.isConnected()) {
			return {
				success: false,
				error: new MigrationError("Not connected to database"),
			};
		}

		const tableName = schema.tableName!;

		const validation = this.validateTableName(tableName);
		if (!validation.success) {
			return validation;
		}

		try {
			// Check if table exists in transaction cache first
			if (this.activeTransactionCache?.has(tableName)) {
				return {
					success: false,
					error: new MigrationError(`Table '${schema.name}' already exists`),
				};
			}

			// Check if table was deleted in this transaction - allow recreation
			const wasDeleted = this.activeTransactionDeletedTables?.has(tableName);
			if (wasDeleted) {
				// Remove from tombstone - we're recreating
				this.activeTransactionDeletedTables!.delete(tableName);
			}

			// Check disk only if not in transaction or table wasn't deleted
			if (!wasDeleted) {
				const filePath = this.getTablePath(tableName);
				try {
					await fs.access(filePath);
					return {
						success: false,
						error: new MigrationError(`Table '${schema.name}' already exists`),
					};
				} catch {
					// File does not exist, proceed
				}
			}

			const initialContent: JsonTableFile = {
				meta: {
					version: 1,
					updatedAt: new Date().toISOString(),
					name: schema.name,
				},
				schema: schema,
				data: [],
			};

			if (skipWrite) {
				// Transaction mode: write to transaction cache
				this.activeTransactionCache!.set(tableName, {
					data: initialContent,
					mtime: Date.now(),
				});
				this.activeTransactionModifiedTables!.add(tableName);
			} else {
				// Normal mode: write to disk and update cache
				const filePath = this.getTablePath(tableName);
				await fs.writeFile(
					filePath,
					JSON.stringify(initialContent, null, 2),
					"utf-8",
				);
				await this.updateCache(tableName, initialContent);
			}

			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationError(`Adapter error: ${message}`, error),
			};
		}
	}

	async dropTable(tableName: string): Promise<Result<void, MigrationError>> {
		return this.dropTableWithOptions(tableName);
	}

	/**
	 * Drop table with options (for transaction support)
	 */
	async dropTableWithOptions(
		tableName: string,
		options?: SchemaOperationOptions,
	): Promise<Result<void, MigrationError>> {
		const skipWrite = options?.skipWrite ?? false;

		if (!this.isConnected()) {
			return {
				success: false,
				error: new MigrationError("Not connected to database"),
			};
		}

		try {
			// Check if table was already deleted in this transaction
			if (this.activeTransactionDeletedTables?.has(tableName)) {
				return {
					success: false,
					error: new MigrationError(`Table '${tableName}' does not exist`),
				};
			}

			// Check if table exists (in tx cache, main cache, or disk)
			const existsInTxCache = this.activeTransactionCache?.has(tableName);
			const existsInMainCache = this.cache.has(tableName);
			let existsOnDisk = false;

			if (!existsInTxCache && !existsInMainCache) {
				const filePath = this.getTablePath(tableName);
				try {
					await fs.access(filePath);
					existsOnDisk = true;
				} catch {
					// Not on disk
				}
			}

			if (!existsInTxCache && !existsInMainCache && !existsOnDisk) {
				return {
					success: false,
					error: new MigrationError(`Table '${tableName}' does not exist`),
				};
			}

			if (skipWrite) {
				// Transaction mode: add to tombstone, remove from tx cache
				this.activeTransactionDeletedTables!.add(tableName);
				this.activeTransactionCache!.delete(tableName);
			} else {
				// Normal mode: delete from disk
				const filePath = this.getTablePath(tableName);
				await fs.unlink(filePath);
				this.invalidateCache(tableName);
			}

			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationError(`Adapter error: ${message}`, error),
			};
		}
	}

	/**
	 * Execute query (public interface)
	 *
	 * This is the standard DatabaseAdapter interface method.
	 * Internally calls executeQueryWithOptions with default options.
	 */
	async executeQuery<TResult extends ForjaEntry>(
		query: QueryObject<TResult>,
	): Promise<Result<QueryResult<TResult>, QueryError<TResult>>> {
		return this.executeQueryWithOptions(query);
	}

	/**
	 * Execute query with options (for transaction support)
	 *
	 * @param query - Query to execute
	 * @param options - Execution options
	 * @param options.skipLock - Skip lock acquisition (transaction already holds lock)
	 * @param options.skipWrite - Skip writing to disk (transaction will write on commit)
	 */
	async executeQueryWithOptions<TResult extends ForjaEntry>(
		query: QueryObject<TResult>,
		options?: ExecuteQueryOptions,
	): Promise<Result<QueryResult<TResult>, QueryError<TResult>>> {
		const skipLock = options?.skipLock ?? false;
		const skipWrite = options?.skipWrite ?? false;

		const validation = validateQueryObject(query);
		if (!validation.success) {
			return {
				success: false,
				error: new QueryError(
					`Invalid QueryObject: ${validation.error.message}`,
					{
						query,
					},
				),
			};
		}

		if (!this.isConnected()) {
			return {
				success: false,
				error: new QueryError("Not connected to database", {
					code: "CONNECTION_ERROR",
					query,
				}),
			};
		}

		const isWriteOp = ["insert", "update", "delete"].includes(query.type);
		const needsLock = !skipLock && (isWriteOp || this.readLockEnabled);
		let lockAcquired = false;

		if (needsLock) {
			try {
				await this.lock.acquire();
				lockAcquired = true;
			} catch (err) {
				return {
					success: false,
					error: new QueryError(
						`Failed to acquire lock: ${err instanceof Error ? err.message : String(err)}`,
						{ query },
					),
				};
			}
		}

		try {
			let tableData: JsonTableFile<Record<string, unknown>>;

			try {
				tableData = await this.readTable(query.table);
			} catch (err) {
				if (lockAcquired) await this.lock.release();
				return {
					success: false,
					error: new QueryError(`Table '${query.table}' not found`, {
						code: "TABLE_NOT_FOUND",
						query,
						details: err,
					}),
				};
			}

			// Handle missing data field
			if (!tableData.data || !Array.isArray(tableData.data)) {
				tableData.data = [];
			}

			const runner = new JsonQueryRunner(tableData, this);

			let rows: TResult[] = [];
			const metadata: {
				rowCount: number;
				affectedRows: number;
				insertIds?: number[];
			} = { rowCount: 0, affectedRows: 0 };
			let shouldWrite = false;

			switch (query.type) {
				case "select":
				case "count": {
					// Step 1: Filter and sort (WITHOUT projection - keep all fields for populate)
					if (query.type === "select" && query.populate) {
						rows = await runner.filterAndSort(query);
					} else {
						// No populate - use normal flow with projection
						rows = (await runner.run(query)) as TResult[];
					}

					// Step 2: Populate (all fields available)
					if (query.type === "select" && query.populate) {
						const populator = new JsonPopulator(this);
						rows = await populator.populate(rows, query);

						// Step 3: Apply select recursively (preserves populated fields, applies nested selects)
						rows = this.applySelectRecursive<TResult>(
							rows,
							query.select,
							query.populate,
						) as TResult[];
					}

					if (query.type === "count") {
						if (lockAcquired) await this.lock.release();
						return {
							success: true,
							data: {
								rows: [] as TResult[],
								metadata: { rowCount: 0, affectedRows: 0, count: rows.length },
							},
						};
					}
					break;
				}

				case "insert": {
					if (!query.data || !Array.isArray(query.data)) {
						throwQueryMissingData("insert", query.table);
					}

					const insertedIds: number[] = [];
					const isJunctionTable = tableData.schema?._isJunctionTable === true;

					for (const item of query.data) {
						const newItem = { ...item };

						// Junction table: skip existing relations silently (idempotent connect)
						if (isJunctionTable) {
							const alreadyExists = tableData.data.some((row) =>
								Object.keys(newItem).every(
									(key) => key === "id" || row[key] === newItem[key],
								),
							);
							if (alreadyExists) continue;
						}

						if (!newItem["id"]) {
							tableData.meta.lastInsertId =
								(tableData.meta.lastInsertId ?? 0) + 1;
							newItem["id"] = tableData.meta.lastInsertId;
						} else {
							const manualId = Number(newItem["id"]);
							if (
								!isNaN(manualId) &&
								manualId > (tableData.meta.lastInsertId ?? 0)
							) {
								tableData.meta.lastInsertId = manualId;
							}
						}

						// Apply default values from schema (like SQL DEFAULT)
						this.applyDefaultValues(tableData, newItem);

						// Check constraints before inserting
						await this.checkForeignKeyConstraints(tableData, newItem);
						this.checkUniqueConstraints(tableData, newItem);
						tableData.data.push(newItem);
						insertedIds.push(newItem["id"] as number);
					}

					rows = insertedIds.map((id) => ({ id })) as TResult[];
					metadata.affectedRows = insertedIds.length;
					metadata.insertIds = insertedIds;
					shouldWrite = true;
					break;
				}

				case "update": {
					if (!query.data) {
						throwQueryMissingData("update", query.table);
					}
					const updateQuery: QuerySelectObject<TResult> = {
						...(query as unknown as QuerySelectObject<TResult>),
						limit: undefined,
						offset: undefined,
						orderBy: undefined,
					};
					const rowsToUpdate = await runner.filterAndSort(updateQuery);

					// Check constraints for each row being updated
					for (const row of rowsToUpdate) {
						const updatedData = { ...row, ...query.data };
						await this.checkForeignKeyConstraints(tableData, updatedData);
						this.checkUniqueConstraints(
							tableData,
							updatedData,
							row["id"] as number,
						);
					}

					for (const row of rowsToUpdate) {
						Object.assign(row, query.data);
					}

					const updatedIds = rowsToUpdate.map((r) => r["id"] as number);
					rows = updatedIds.map((id) => ({ id })) as TResult[];
					metadata.affectedRows = updatedIds.length;
					shouldWrite = true;
					break;
				}

				case "delete": {
					const deleteQuery: QuerySelectObject<TResult> = {
						...(query as unknown as QuerySelectObject<TResult>),
						limit: undefined,
						offset: undefined,
						orderBy: undefined,
					};
					const rowsToDelete = await runner.filterAndSort(deleteQuery);
					const idsToDelete = new Set(rowsToDelete.map((r) => r.id));

					const originalLength = tableData.data.length;
					tableData.data = tableData.data.filter(
						(d) => !idsToDelete.has(d["id"] as number),
					);

					const deletedIds = rowsToDelete.map((r) => r["id"] as number);
					rows = deletedIds.map((id) => ({ id })) as TResult[];
					metadata.affectedRows = originalLength - tableData.data.length;
					shouldWrite = true;
					break;
				}
			}

			// Handle write
			if (shouldWrite) {
				if (skipWrite) {
					// Transaction mode: track modified table, don't write to disk
					if (this.activeTransactionModifiedTables) {
						this.activeTransactionModifiedTables.add(query.table);
					}
				} else {
					// Normal mode: write to disk immediately
					tableData.meta.updatedAt = new Date().toISOString();
					const filePath = this.getTablePath(query.table);
					await fs.writeFile(
						filePath,
						JSON.stringify(tableData, null, 2),
						"utf-8",
					);
					await this.updateCache(query.table, tableData);
				}
			}

			metadata.rowCount = rows.length;

			if (lockAcquired) await this.lock.release();

			return {
				success: true,
				data: {
					rows: rows as TResult[],
					metadata,
				},
			};
		} catch (error) {
			if (lockAcquired) await this.lock.release();

			// Re-throw ForjaError as-is (already has detailed context)
			if (error instanceof ForjaError) {
				throw error;
			}

			// Wrap unexpected errors
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new QueryError(`Adapter error: ${message}`, { details: error }),
			};
		}
	}

	async executeRawQuery<TResult extends ForjaEntry>(
		sql: string,
	): Promise<Result<QueryResult<TResult>, QueryError<TResult>>> {
		return {
			success: false,
			error: new QueryError("executeRawQuery is not supported by JsonAdapter", {
				sql,
			}),
		};
	}

	/**
	 * Begin a new transaction
	 *
	 * Acquires lock and creates isolated transaction cache.
	 * All reads/writes within transaction use txCache.
	 */
	async beginTransaction(): Promise<Result<Transaction, TransactionError>> {
		if (!this.isConnected()) {
			return {
				success: false,
				error: new TransactionError("Not connected to database"),
			};
		}

		if (this.activeTransactionCache) {
			return {
				success: false,
				error: new TransactionError("A transaction is already active"),
			};
		}

		try {
			// Acquire lock for entire transaction duration
			await this.lock.acquire();

			// Initialize transaction state
			this.activeTransactionCache = new Map<string, CacheEntry>();
			this.activeTransactionModifiedTables = new Set<string>();
			this.activeTransactionDeletedTables = new Set<string>();

			// Create transaction with commit/rollback callbacks
			const transaction = new JsonTransaction(
				this,
				// Commit callback
				async () => {
					await this.commitTransaction();
				},
				// Rollback callback
				async () => {
					await this.rollbackTransaction();
				},
			);

			return { success: true, data: transaction };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				success: false,
				error: new TransactionError(
					`Failed to begin transaction: ${message}`,
					err,
				),
			};
		}
	}

	/**
	 * Commit transaction - write modified tables to disk
	 * @internal Called by JsonTransaction.commit()
	 */
	private async commitTransaction(): Promise<void> {
		if (!this.activeTransactionCache || !this.activeTransactionModifiedTables) {
			throw new TransactionError("No active transaction to commit");
		}

		try {
			// 1. Delete dropped tables from disk
			if (this.activeTransactionDeletedTables) {
				for (const tableName of this.activeTransactionDeletedTables) {
					const filePath = this.getTablePath(tableName);
					try {
						await fs.unlink(filePath);
					} catch {
						// File might not exist on disk (created and dropped in same tx)
					}
					// Remove from main cache
					this.cache.delete(tableName);
				}
			}

			// 2. Write all modified tables to disk
			for (const tableName of this.activeTransactionModifiedTables) {
				// Skip if table was deleted
				if (this.activeTransactionDeletedTables?.has(tableName)) continue;

				const entry = this.activeTransactionCache.get(tableName);
				if (entry) {
					// Write to disk
					entry.data.meta.updatedAt = new Date().toISOString();
					const filePath = this.getTablePath(tableName);
					await fs.writeFile(
						filePath,
						JSON.stringify(entry.data, null, 2),
						"utf-8",
					);

					// Update mtime and merge to main cache
					const stat = await fs.stat(filePath);
					entry.mtime = stat.mtimeMs;
					this.cache.set(tableName, entry);
				}
			}
		} finally {
			// Clear transaction state and release lock
			this.activeTransactionCache = null;
			this.activeTransactionModifiedTables = null;
			this.activeTransactionDeletedTables = null;
			await this.lock.release();
		}
	}

	/**
	 * Rollback transaction - discard changes
	 * @internal Called by JsonTransaction.rollback()
	 */
	private async rollbackTransaction(): Promise<void> {
		// Simply discard transaction cache - main cache unchanged
		this.activeTransactionCache = null;
		this.activeTransactionModifiedTables = null;
		this.activeTransactionDeletedTables = null;
		await this.lock.release();
	}

	async alterTable(
		tableName: string,
		operations: readonly AlterOperation[],
	): Promise<Result<void, MigrationError>> {
		return this.alterTableWithOptions(tableName, operations);
	}

	/**
	 * Alter table with options (for transaction support)
	 */
	async alterTableWithOptions(
		tableName: string,
		operations: readonly AlterOperation[],
		options?: SchemaOperationOptions,
	): Promise<Result<void, MigrationError>> {
		const skipWrite = options?.skipWrite ?? false;

		if (!this.isConnected()) {
			return {
				success: false,
				error: new MigrationError("Not connected to database"),
			};
		}

		try {
			const json = await this.readTable(tableName);

			if (!json.schema) {
				return {
					success: false,
					error: new MigrationError(`Table '${tableName}' has no schema`),
				};
			}

			// Apply each operation
			for (const op of operations) {
				switch (op.type) {
					case "addColumn": {
						// Add field to schema
						json.schema.fields[op.column] = op.definition;

						// Add default value to existing rows
						const defaultValue = (op.definition as { default?: unknown })
							.default;
						for (const row of json.data) {
							if (!(op.column in row)) {
								row[op.column] = defaultValue ?? null;
							}
						}
						break;
					}

					case "dropColumn": {
						// Remove field from schema
						delete json.schema.fields[op.column];

						// Remove column from all rows
						for (const row of json.data) {
							delete row[op.column];
						}
						break;
					}

					case "modifyColumn": {
						// Update field definition in schema
						json.schema.fields[op.column] = op.newDefinition;
						break;
					}

					case "renameColumn": {
						// Rename field in schema
						const fieldDef = json.schema.fields[op.from];
						if (fieldDef) {
							delete json.schema.fields[op.from];
							json.schema.fields[op.to] = fieldDef;
						}

						// Rename column in all rows
						for (const row of json.data) {
							if (op.from in row) {
								row[op.to] = row[op.from];
								delete row[op.from];
							}
						}
						break;
					}
				}
			}

			json.meta.updatedAt = new Date().toISOString();

			if (skipWrite) {
				// Transaction mode: update transaction cache
				this.activeTransactionCache!.set(tableName, {
					data: json,
					mtime: Date.now(),
				});
				this.activeTransactionModifiedTables!.add(tableName);
			} else {
				// Normal mode: write to disk
				const filePath = this.getTablePath(tableName);
				await fs.writeFile(filePath, JSON.stringify(json, null, 2), "utf-8");
				await this.updateCache(tableName, json);
			}

			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationError(`Adapter error: ${message}`, error),
			};
		}
	}

	async renameTable(
		from: string,
		to: string,
	): Promise<Result<void, MigrationError>> {
		return this.renameTableWithOptions(from, to);
	}

	/**
	 * Rename table with options (for transaction support)
	 */
	async renameTableWithOptions(
		from: string,
		to: string,
		options?: SchemaOperationOptions,
	): Promise<Result<void, MigrationError>> {
		const skipWrite = options?.skipWrite ?? false;

		if (!this.isConnected()) {
			return {
				success: false,
				error: new MigrationError("Not connected to database"),
			};
		}

		const validation = this.validateTableName(to);
		if (!validation.success) {
			return validation;
		}

		try {
			// Check source table exists
			if (this.activeTransactionDeletedTables?.has(from)) {
				return {
					success: false,
					error: new MigrationError(`Table '${from}' does not exist`),
				};
			}

			// Check target table doesn't exist
			const targetExistsInTxCache = this.activeTransactionCache?.has(to);
			const targetExistsInMainCache = this.cache.has(to);
			let targetExistsOnDisk = false;

			if (!targetExistsInTxCache && !targetExistsInMainCache) {
				const toPath = this.getTablePath(to);
				try {
					await fs.access(toPath);
					targetExistsOnDisk = true;
				} catch {
					// Not on disk - good
				}
			}

			// Target exists and not in tombstone = error
			const targetInTombstone = this.activeTransactionDeletedTables?.has(to);
			if (
				(targetExistsInTxCache ||
					targetExistsInMainCache ||
					targetExistsOnDisk) &&
				!targetInTombstone
			) {
				return {
					success: false,
					error: new MigrationError(`Table '${to}' already exists`),
				};
			}

			// Read source table (will throw if doesn't exist)
			const json = await this.readTable(from);

			// Update schema tableName
			if (json.schema) {
				(json as any).schema = { ...json.schema, tableName: to };
			}
			json.meta.updatedAt = new Date().toISOString();

			if (skipWrite) {
				// Transaction mode: add new table to cache, tombstone old table
				this.activeTransactionCache!.set(to, {
					data: json,
					mtime: Date.now(),
				});
				this.activeTransactionModifiedTables!.add(to);
				this.activeTransactionDeletedTables!.add(from);
				this.activeTransactionCache!.delete(from);
				// Remove target from tombstone if it was there (we're overwriting)
				this.activeTransactionDeletedTables!.delete(to);
			} else {
				// Normal mode: rename file on disk
				const fromPath = this.getTablePath(from);
				const toPath = this.getTablePath(to);
				await fs.writeFile(toPath, JSON.stringify(json, null, 2), "utf-8");
				await fs.unlink(fromPath);
				this.invalidateCache(from);
				await this.updateCache(to, json);
			}

			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationError(`Adapter error: ${message}`, error),
			};
		}
	}

	async addIndex(
		tableName: string,
		index: IndexDefinition,
	): Promise<Result<void, MigrationError>> {
		return this.addIndexWithOptions(tableName, index);
	}

	/**
	 * Add index with options (for transaction support)
	 * Note: JSON adapter doesn't actually create indexes, but we track the operation
	 */
	async addIndexWithOptions(
		_tableName: string,
		_index: IndexDefinition,
		_options?: SchemaOperationOptions,
	): Promise<Result<void, MigrationError>> {
		return { success: true, data: undefined };
	}

	async dropIndex(
		tableName: string,
		indexName: string,
	): Promise<Result<void, MigrationError>> {
		return this.dropIndexWithOptions(tableName, indexName);
	}

	/**
	 * Drop index with options (for transaction support)
	 * Note: JSON adapter doesn't actually manage indexes, but we track the operation
	 */
	async dropIndexWithOptions(
		_tableName: string,
		_indexName: string,
		_options?: SchemaOperationOptions,
	): Promise<Result<void, MigrationError>> {
		return { success: true, data: undefined };
	}

	async getTables(): Promise<Result<readonly string[], QueryError>> {
		if (!this.isConnected()) {
			return {
				success: false,
				error: new QueryError("Not connected to database", {
					code: "CONNECTION_ERROR",
				}),
			};
		}
		try {
			const files = await fs.readdir(this.config.root);
			const tables = files
				.filter((f) => f.endsWith(".json"))
				.map((f) => f.replace(".json", ""));
			return { success: true, data: tables };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new QueryError(`Adapter error: ${message}`, { details: error }),
			};
		}
	}

	async getTableSchema(
		tableName: string,
	): Promise<Result<SchemaDefinition, QueryError>> {
		if (!this.isConnected()) {
			return {
				success: false,
				error: new QueryError("Not connected to database", {
					code: "CONNECTION_ERROR",
				}),
			};
		}
		try {
			const json = await this.readTable(tableName);

			if (json.schema) {
				return { success: true, data: json.schema as SchemaDefinition };
			}

			return {
				success: false,
				error: new QueryError(`Schema not found for table '${tableName}'`),
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new QueryError(`Adapter error: ${message}`, { details: error }),
			};
		}
	}

	async tableExists(tableName: string): Promise<boolean> {
		if (!this.isConnected()) return false;
		try {
			await fs.access(this.getTablePath(tableName));
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Apply SELECT recursively (preserves populated fields)
	 * This ensures that:
	 * 1. Top-level select keeps populated relation fields
	 * 2. Nested populate selects are applied to related data
	 *
	 * @param rows - Data rows (may contain populated relations)
	 * @param select - Fields to select at this level
	 * @param populate - Populate configuration (contains nested selects)
	 * @returns Rows with select applied recursively
	 */
	private applySelectRecursive<T extends ForjaEntry>(
		rows: T[],
		select?: QuerySelectObject<T>["select"],
		populate?: QuerySelectObject<T>["populate"],
	): Partial<T>[] {
		if (!rows || rows.length === 0) {
			return rows;
		}

		let result = rows as Partial<T>[];

		// Apply top-level select (but preserve populated fields)
		if (select && (select as unknown as string) !== "*") {
			const fieldsToKeep = new Set(select);

			// Add populated relation fields to keep them
			if (populate) {
				for (const relationName of Object.keys(populate)) {
					fieldsToKeep.add(relationName as keyof T);
				}
			}

			// Project fields
			result = rows.map((row) => {
				const projected: Partial<T> = {};
				for (const field of fieldsToKeep) {
					if (field in row) {
						projected[field] = row[field];
					}
				}
				return projected;
			});
		}

		// Apply nested select to populated relations
		if (populate) {
			for (const [relationName, options] of Object.entries(populate)) {
				if (typeof options === "boolean") continue;

				const nestedSelect = options === "*" ? "*" : options.select;
				const nestedPopulate = options === "*" ? undefined : options.populate;

				for (const row of result) {
					const relationValue = row[relationName as keyof T] as T;
					if (!relationValue) continue;

					if (Array.isArray(relationValue)) {
						// hasMany relation
						row[relationName as keyof T] = this.applySelectRecursive<T>(
							relationValue,
							nestedSelect,
							nestedPopulate,
						) as T[keyof T];
					} else {
						// belongsTo/hasOne relation
						row[relationName as keyof T] = this.applySelectRecursive<T>(
							[relationValue],
							nestedSelect,
							nestedPopulate,
						)[0] as T[keyof T];
					}
				}
			}
		}

		return result;
	}

	/**
	 * Apply default values from schema for fields not provided
	 *
	 * This mimics SQL DEFAULT behavior - if a field has a default value
	 * defined in the schema and the field is not provided (undefined),
	 * the default value is applied.
	 *
	 * @param tableData - Table data with schema
	 * @param data - Data being inserted (mutated in place)
	 */
	private applyDefaultValues(
		tableData: JsonTableFile,
		data: Record<string, unknown>,
	): void {
		const schema = tableData.schema;
		if (!schema?.fields) return;

		for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
			// Skip if value is already provided (including null - explicit null is intentional)
			if (fieldName in data) continue;

			// Check if field has a default value
			const defaultValue = (fieldDef as { default?: unknown }).default;
			if (defaultValue !== undefined) {
				data[fieldName] = defaultValue;
			}
		}
	}

	/**
	 * Check foreign key constraints before insert/update
	 *
	 * Validates that all foreign key values reference existing records
	 * in their target tables. This mimics SQL FK constraint behavior.
	 *
	 * @param tableData - Table data with schema
	 * @param data - Data to be inserted/updated
	 * @throws ForjaJsonAdapterError if FK constraint violated
	 */
	private async checkForeignKeyConstraints(
		tableData: JsonTableFile,
		data: Record<string, unknown>,
	): Promise<void> {
		const schema = tableData.schema;
		if (!schema?.fields) return;

		for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
			// Only check relation fields with foreignKey
			if (fieldDef.type !== "relation") continue;

			const relationField = fieldDef as {
				type: "relation";
				model: string;
				foreignKey?: string;
				kind?: string;
			};

			// Only belongsTo/hasOne have inline foreign keys
			if (
				relationField.kind !== "belongsTo" &&
				relationField.kind !== "hasOne"
			) {
				continue;
			}

			const foreignKey = relationField.foreignKey ?? `${fieldName}Id`;
			const fkValue = data[foreignKey];

			// Skip if FK is not in data or is null (null is allowed)
			if (fkValue === undefined || fkValue === null) continue;

			// Get target table
			const targetSchema = await this.getSchemaByModelName(relationField.model);
			if (!targetSchema) {
				// Target model not found - skip check (will fail elsewhere)
				continue;
			}

			const targetTable =
				targetSchema.tableName ?? relationField.model.toLowerCase();
			const targetData = await this.getCachedTable(targetTable);

			if (!targetData) {
				// Target table not found - skip check
				continue;
			}

			// Check if referenced record exists
			const exists = targetData.data.some((row) => row["id"] === fkValue);

			if (!exists) {
				throwForeignKeyConstraint(
					foreignKey,
					fkValue,
					relationField.model,
					schema.tableName ?? "unknown",
				);
			}
		}
	}

	/**
	 * Check unique constraints before insert/update
	 *
	 * @param tableData - Table data with schema and existing records
	 * @param newData - Data to be inserted/updated
	 * @param excludeId - For updates, exclude current record from check
	 * @throws Error if unique constraint violated
	 */
	private checkUniqueConstraints(
		tableData: JsonTableFile,
		newData: Record<string, unknown>,
		excludeId?: number | string,
	): void {
		const schema = tableData.schema!;
		const existingData = tableData.data;

		// 1. Check unique fields (field.unique === true)
		for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
			if (!(fieldDef as { unique: boolean }).unique) continue;

			const value = newData[fieldName];
			if (value === undefined || value === null) continue;

			const duplicate = existingData.find(
				(row) => row[fieldName] === value && row["id"] !== excludeId,
			);

			if (duplicate) {
				throwUniqueConstraintField(
					fieldName,
					value,
					tableData.schema?.tableName ?? "unknown",
				);
			}
		}

		// 2. Check unique indexes
		if (!schema.indexes) return;

		for (const index of schema.indexes) {
			if (!index.unique) continue;

			// Get values for all fields in index
			const indexValues = index.fields.map((f) => newData[f]);

			// Skip if any value is undefined
			if (indexValues.some((v) => v === undefined || v === null)) continue;

			// Check if combination exists
			const duplicate = existingData.find(
				(row) =>
					index.fields.every((f) => row[f] === newData[f]) &&
					row["id"] !== excludeId,
			);

			if (duplicate) {
				throwUniqueConstraintIndex(
					index.fields,
					tableData.schema?.tableName ?? "unknown",
				);
			}
		}
	}
}
