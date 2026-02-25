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
import { ForjaError } from "forja-types/errors";
import { JsonTransaction } from "./transaction";
import {
	FORJA_META_MODEL,
	FORJA_META_KEY_PREFIX,
} from "forja-types/core/constants";
import { createMetaTable, validateTableName } from "./table-utils";
import {
	handleCount,
	handleDelete,
	handleInsert,
	handleSelect,
	handleUpdate,
} from "./query-handlers";

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

			// Standalone mode: bootstrap _forja metadata table automatically
			if (this.config.standalone) {
				const metaResult = await createMetaTable(this);
				if (!metaResult.success) {
					this.state = "error";
					return metaResult;
				}
			}

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
		try {
			return await this.readTableSchema(tableName);
		} catch {
			return null;
		}
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
	 * Read schema for a table from _forja metadata table.
	 * Transaction-aware: reads from tx cache when inside a transaction.
	 *
	 * @param tableName - Physical table name (e.g. "users")
	 */
	async readTableSchema(tableName: string): Promise<SchemaDefinition> {
		const metaFile = await this.readTable(FORJA_META_MODEL);
		const metaKey = `${FORJA_META_KEY_PREFIX}${tableName}`;
		const row = metaFile.data.find(
			(r) => (r as Record<string, unknown>)["key"] === metaKey,
		);
		if (!row) {
			throw new Error(`Schema for '${tableName}' not found in _forja`);
		}
		return JSON.parse(
			(row as Record<string, unknown>)["value"] as string,
		) as SchemaDefinition;
	}

	/**
	 * Upsert schema into _forja metadata table
	 */
	private async upsertSchemaMeta(
		schema: SchemaDefinition,
		skipWrite: boolean,
	): Promise<Result<void, MigrationError>> {
		try {
			const metaKey = `${FORJA_META_KEY_PREFIX}${schema.tableName ?? schema.name}`;
			const metaValue = JSON.stringify(schema);
			const metaFile = await this.readTable(FORJA_META_MODEL);

			const existingIndex = metaFile.data.findIndex(
				(r) => (r as Record<string, unknown>)["key"] === metaKey,
			);

			if (existingIndex >= 0) {
				(metaFile.data[existingIndex] as Record<string, unknown>)["value"] =
					metaValue;
			} else {
				const lastInsertId = (metaFile.meta.lastInsertId ?? 0) + 1;
				metaFile.meta.lastInsertId = lastInsertId;
				metaFile.data.push({
					id: lastInsertId,
					key: metaKey,
					value: metaValue,
				} as Record<string, unknown>);
			}

			metaFile.meta.updatedAt = new Date().toISOString();

			if (skipWrite) {
				this.activeTransactionCache!.set(FORJA_META_MODEL, {
					data: metaFile,
					mtime: Date.now(),
				});
				this.activeTransactionModifiedTables!.add(FORJA_META_MODEL);
			} else {
				const filePath = this.getTablePath(FORJA_META_MODEL);
				await fs.writeFile(
					filePath,
					JSON.stringify(metaFile, null, 2),
					"utf-8",
				);
				await this.updateCache(FORJA_META_MODEL, metaFile);
			}

			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationError(
					`Failed to upsert schema meta for '${schema.name}': ${message}`,
					error,
				),
			};
		}
	}

	/**
	 * Apply AlterOperations to schema in _forja and write back
	 */
	private async applyOperationsToMetaSchema(
		tableName: string,
		operations: readonly AlterOperation[],
		skipWrite: boolean,
	): Promise<Result<void, MigrationError>> {
		try {
			const schema = await this.readTableSchema(tableName);
			const fields = { ...schema.fields };

			for (const op of operations) {
				switch (op.type) {
					case "addColumn":
						fields[op.column] = op.definition;
						break;
					case "dropColumn":
						delete fields[op.column];
						break;
					case "modifyColumn":
						fields[op.column] = op.newDefinition;
						break;
					case "renameColumn": {
						const fieldDef = fields[op.from];
						if (fieldDef !== undefined) {
							fields[op.to] = fieldDef;
							delete fields[op.from];
						}
						break;
					}
				}
			}

			const updatedSchema: SchemaDefinition = { ...schema, fields };
			return this.upsertSchemaMeta(updatedSchema, skipWrite);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationError(
					`Failed to update schema meta for '${tableName}': ${message}`,
					error,
				),
			};
		}
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

		// Standalone mode: ensure id field exists since registry is not present to add it
		if (this.config.standalone && !("id" in schema.fields)) {
			schema = {
				...schema,
				fields: {
					id: { type: "number", autoIncrement: true },
					...schema.fields,
				},
			};
		}

		if (!this.isConnected()) {
			return {
				success: false,
				error: new MigrationError("Not connected to database"),
			};
		}

		const tableName = schema.tableName!;

		const validation = validateTableName(tableName);
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

			// Track schema in _forja (skip for _forja itself)
			if (schema.name !== FORJA_META_MODEL) {
				const metaExists = await this.tableExists(FORJA_META_MODEL);
				if (!metaExists) {
					return {
						success: false,
						error: new MigrationError(
							`Cannot create table '${schema.name}': '${FORJA_META_MODEL}' table does not exist yet. Create '${FORJA_META_MODEL}' first.`,
						),
					};
				}
				const metaWriteResult = await this.upsertSchemaMeta(schema, skipWrite);
				if (!metaWriteResult.success) {
					return metaWriteResult;
				}
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

			// Remove schema from _forja
			if (tableName !== FORJA_META_MODEL) {
				// TODO: _forja table diger tablelar gibi bir table. burada kod tekrari yapmak yerine executeQuery({delete from _forja where key = metaKey}) gibi bir sey yapilabilir. eger lock problem cikarmiyorsa
				const metaKey = `${FORJA_META_KEY_PREFIX}${tableName}`;
				const metaFile = await this.readTable(FORJA_META_MODEL);
				metaFile.data = metaFile.data.filter(
					(r) => (r as Record<string, unknown>)["key"] !== metaKey,
				);
				metaFile.meta.updatedAt = new Date().toISOString();

				if (skipWrite) {
					this.activeTransactionCache!.set(FORJA_META_MODEL, {
						data: metaFile,
						mtime: Date.now(),
					});
					this.activeTransactionModifiedTables!.add(FORJA_META_MODEL);
				} else {
					const filePath = this.getTablePath(FORJA_META_MODEL);
					await fs.writeFile(
						filePath,
						JSON.stringify(metaFile, null, 2),
						"utf-8",
					);
					await this.updateCache(FORJA_META_MODEL, metaFile);
				}
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

			// Load schema from _forja for this table (transaction-aware)
			let tableSchema: SchemaDefinition | undefined;
			try {
				tableSchema = await this.readTableSchema(query.table);
			} catch {
				// Schema not found in _forja — proceed without it
			}

			const runner = new JsonQueryRunner(tableData, this, tableSchema);

			let handlerResult: Awaited<ReturnType<typeof handleSelect>>;

			switch (query.type) {
				case "count":
					handlerResult = await handleCount({ runner, query });
					if (handlerResult.earlyReturn) {
						if (lockAcquired) await this.lock.release();
						return {
							success: true,
							data: {
								rows: [] as TResult[],
								metadata: handlerResult.metadata,
							},
						};
					}
					break;
				case "select":
					handlerResult = await handleSelect({ runner, query, adapter: this });
					break;
				case "insert":
					handlerResult = await handleInsert({ runner, query });
					break;
				case "update":
					handlerResult = await handleUpdate({ runner, query });
					break;
				case "delete":
					handlerResult = await handleDelete({ runner, query });
					break;
			}

			const rows = handlerResult!.rows as TResult[];
			const metadata = handlerResult!.metadata;
			const shouldWrite = handlerResult!.shouldWrite;

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
				return {
					success: false,
					error: error as QueryError<TResult>,
				};
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

			// Apply each operation to table data rows
			for (const op of operations) {
				switch (op.type) {
					case "addColumn": {
						const defaultValue = (op.definition as { default?: unknown })
							.default;
						for (const row of json.data) {
							if (!(op.column in row)) {
								(row as Record<string, unknown>)[op.column] =
									defaultValue ?? null;
							}
						}
						break;
					}

					case "dropColumn": {
						for (const row of json.data) {
							delete (row as Record<string, unknown>)[op.column];
						}
						break;
					}

					case "modifyColumn": {
						break;
					}

					case "renameColumn": {
						for (const row of json.data) {
							const r = row as Record<string, unknown>;
							if (op.from in r) {
								r[op.to] = r[op.from];
								delete r[op.from];
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

			// Update schema in _forja
			if (tableName !== FORJA_META_MODEL) {
				const metaResult = await this.applyOperationsToMetaSchema(
					tableName,
					operations,
					skipWrite,
				);
				if (!metaResult.success) {
					return metaResult;
				}
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

		const validation = validateTableName(to);
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

			// Update key in _forja
			if (from !== FORJA_META_MODEL && to !== FORJA_META_MODEL) {
				const oldKey = `${FORJA_META_KEY_PREFIX}${from}`;
				const newKey = `${FORJA_META_KEY_PREFIX}${to}`;
				const metaFile = await this.readTable(FORJA_META_MODEL);
				const row = metaFile.data.find(
					(r) => (r as Record<string, unknown>)["key"] === oldKey,
				);
				if (row) {
					(row as Record<string, unknown>)["key"] = newKey;
					metaFile.meta.updatedAt = new Date().toISOString();

					if (skipWrite) {
						this.activeTransactionCache!.set(FORJA_META_MODEL, {
							data: metaFile,
							mtime: Date.now(),
						});
						this.activeTransactionModifiedTables!.add(FORJA_META_MODEL);
					} else {
						const metaPath = this.getTablePath(FORJA_META_MODEL);
						await fs.writeFile(
							metaPath,
							JSON.stringify(metaFile, null, 2),
							"utf-8",
						);
						await this.updateCache(FORJA_META_MODEL, metaFile);
					}
				}
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
			const schema = await this.readTableSchema(tableName);
			return { success: true, data: schema };
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
}
