import fs from "node:fs/promises";
import path from "node:path";
import {
	AlterOperation,
	ConnectionState,
	DatabaseAdapter,
	QueryResult,
	Transaction,
} from "@datrix/core";
import { QueryObject } from "@datrix/core";
import { DatrixEntry, IndexDefinition, SchemaDefinition } from "@datrix/core";
import { validateQueryObject } from "@datrix/core";
import {
	CacheEntry,
	ExecuteQueryOptions,
	JsonAdapterConfig,
	JsonTableFile,
	SchemaOperationOptions,
} from "./types";
import { JsonQueryRunner } from "./runner";
import { SimpleLock } from "./lock";
import {
	DatrixAdapterError,
	throwNotConnected,
	throwConnectionError,
	throwMigrationError,
	throwTransactionError,
	throwQueryError,
	throwMetaFieldAlreadyExists,
	throwMetaFieldNotFound,
} from "@datrix/core";
import { JsonTransaction } from "./transaction";
import { DATRIX_META_MODEL, DATRIX_META_KEY_PREFIX } from "@datrix/core";
import { createMetaTable, validateTableName } from "./table-utils";
import { JsonExporter } from "./export-import/exporter";
import { JsonImporter } from "./export-import/importer";
import type { ExportWriter, ImportReader } from "@datrix/core";
import {
	handleCount,
	handleDelete,
	handleInsert,
	handleSelect,
	handleUpdate,
} from "./query-handlers";
import { isInTransactionContext } from "./tx-context";
import { atomicWriteFile } from "./fs-utils";

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

	/**
	 * Resolvers waiting for the current transaction to end (commit/rollback),
	 * so `beginTransaction` can queue instead of throwing when one is already
	 * active.
	 */
	private transactionEndWaiters: Array<() => void> = [];

	/**
	 * In-memory index over `_datrix`: modelName -> tableName and
	 * tableName -> SchemaDefinition. Avoids a `fs.readdir` + full linear scan
	 * of `_datrix.data` on every `getSchemaByModelName` call (previously
	 * repeated per-row inside insert/delete loops — see issue.md Part 7).
	 * Rebuilt lazily whenever `_datrix`'s cache entry mtime changes.
	 */
	private schemaIndex: {
		mtime: number;
		byModel: Map<string, string>;
		byTable: Map<string, SchemaDefinition>;
	} | null = null;

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
	async connect(): Promise<void> {
		if (this.state === "connected") {
			return;
		}

		this.state = "connecting";

		try {
			await fs.mkdir(this.config.root, { recursive: true });
			this.state = "connected";

			// Standalone mode: bootstrap _datrix metadata table automatically
			if (this.config.standalone) {
				try {
					await createMetaTable(this);
				} catch (error) {
					this.state = "error";
					throw error;
				}
			}
		} catch (error) {
			this.state = "error";
			const message = error instanceof Error ? error.message : String(error);
			throwConnectionError({
				adapter: "json",
				message: `Failed to access root directory: ${message}`,
				cause: error instanceof Error ? error : new Error(String(error)),
			});
		}
	}

	async disconnect(): Promise<void> {
		if (this.activeTransactionCache) {
			await this.rollbackTransaction();
		}
		this.cache.clear();
		this.state = "disconnected";
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
	 * 1. Check tombstone (if transaction active AND this call is part of it)
	 * 2. Transaction cache (if active AND this call is part of it)
	 * 3. Main cache (with mtime validation)
	 * 4. Disk
	 *
	 * Only calls originating from the active `JsonTransaction` (tracked via
	 * `isInTransactionContext()`) see the transaction cache/tombstones. Plain
	 * `executeQuery` calls made while a transaction is in progress always read
	 * main cache/disk, so they never dirty-read uncommitted transaction state.
	 */
	private async readTable(tableName: string): Promise<JsonTableFile> {
		const filePath = this.getTablePath(tableName);
		const useTxCache = this.activeTransactionCache && isInTransactionContext();

		// 1. Check tombstone first - table was dropped in this transaction
		if (useTxCache && this.activeTransactionDeletedTables?.has(tableName)) {
			throwMigrationError({
				adapter: "json",
				message: `Table '${tableName}' does not exist`,
				table: tableName,
			});
		}

		// 2. Check transaction cache (if this call is part of the transaction)
		if (useTxCache) {
			const txCached = this.activeTransactionCache!.get(tableName);
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
				// If this call is part of the transaction, copy to tx cache for isolation
				if (useTxCache) {
					// Deep copy to prevent mutation of main cache
					const txData = JSON.parse(JSON.stringify(cached.data));
					this.activeTransactionCache!.set(tableName, { data: txData, mtime });
					return txData;
				}
				return cached.data;
			}

			// Cache miss or stale - read from disk
			const content = await fs.readFile(filePath, "utf-8");
			const data: JsonTableFile = JSON.parse(content);

			// Store in appropriate cache
			if (useTxCache) {
				this.activeTransactionCache!.set(tableName, { data, mtime });
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
	 * Get schema directly from table file (cache-aware). Uses the in-memory
	 * `_datrix` index (see `getSchemaIndex`) instead of a linear scan.
	 *
	 * @param tableName - Table name (e.g., "users")
	 * @returns Schema definition or null if not found
	 */
	async getSchemaByTableName(
		tableName: string,
	): Promise<SchemaDefinition | null> {
		try {
			const index = await this.getSchemaIndex();
			return index.byTable.get(tableName) ?? null;
		} catch {
			return null;
		}
	}

	/**
	 * Get schema by model name. Uses the in-memory `_datrix` index (O(1) after
	 * the first build) instead of `fs.readdir` + a full linear scan per call.
	 *
	 * @param modelName - Model name from schema (e.g., "User")
	 * @returns Schema definition or null if not found
	 */
	async getSchemaByModelName(
		modelName: string,
	): Promise<SchemaDefinition | null> {
		try {
			const index = await this.getSchemaIndex();
			const tableName = index.byModel.get(modelName);
			return tableName ? (index.byTable.get(tableName) ?? null) : null;
		} catch {
			return null;
		}
	}

	/**
	 * Build (or reuse, if `_datrix` hasn't changed) the modelName/tableName
	 * schema index described on `schemaIndex`.
	 */
	private async getSchemaIndex(): Promise<{
		mtime: number;
		byModel: Map<string, string>;
		byTable: Map<string, SchemaDefinition>;
	}> {
		const metaFile = await this.readTable(DATRIX_META_MODEL);
		// readTable doesn't expose the mtime it used, so re-derive a cheap
		// version marker from the meta file's own `updatedAt` — it's bumped on
		// every _datrix write (upsertSchemaMeta/dropTable/renameTable/alterTable).
		const version = Date.parse(metaFile.meta.updatedAt) || 0;

		if (this.schemaIndex && this.schemaIndex.mtime === version) {
			return this.schemaIndex;
		}

		const byModel = new Map<string, string>();
		const byTable = new Map<string, SchemaDefinition>();

		for (const r of metaFile.data) {
			const record = r as Record<string, unknown>;
			const key = record["key"];
			if (typeof key !== "string" || !key.startsWith(DATRIX_META_KEY_PREFIX)) {
				continue;
			}
			const tableName = key.slice(DATRIX_META_KEY_PREFIX.length);
			try {
				const schema = JSON.parse(record["value"] as string) as SchemaDefinition;
				byTable.set(tableName, schema);
				byModel.set(schema.name, tableName);
			} catch {
				// Corrupt schema entry — skip it, don't fail the whole index build
			}
		}

		this.schemaIndex = { mtime: version, byModel, byTable };
		return this.schemaIndex;
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
	 * Read schema for a table from _datrix metadata table.
	 * Transaction-aware: reads from tx cache when inside a transaction.
	 *
	 * @param tableName - Physical table name (e.g. "users")
	 */
	async readTableSchema(tableName: string): Promise<SchemaDefinition> {
		const metaFile = await this.readTable(DATRIX_META_MODEL);
		const metaKey = `${DATRIX_META_KEY_PREFIX}${tableName}`;
		const row = metaFile.data.find(
			(r) => (r as Record<string, unknown>)["key"] === metaKey,
		);
		if (!row) {
			throwMigrationError({
				adapter: "json",
				message: `Schema for '${tableName}' not found in _datrix`,
				table: tableName,
			});
		}
		return JSON.parse(
			(row as Record<string, unknown>)["value"] as string,
		) as SchemaDefinition;
	}

	/**
	 * Upsert schema into _datrix metadata table
	 */
	private async upsertSchemaMeta(
		schema: SchemaDefinition,
		skipWrite: boolean,
	): Promise<void> {
		const metaKey = `${DATRIX_META_KEY_PREFIX}${schema.tableName ?? schema.name}`;
		const metaValue = JSON.stringify(schema);
		const metaFile = await this.readTable(DATRIX_META_MODEL);

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
			this.activeTransactionCache!.set(DATRIX_META_MODEL, {
				data: metaFile,
				mtime: Date.now(),
			});
			this.activeTransactionModifiedTables!.add(DATRIX_META_MODEL);
		} else {
			const filePath = this.getTablePath(DATRIX_META_MODEL);
			await atomicWriteFile(filePath, JSON.stringify(metaFile, null, 2));
			await this.updateCache(DATRIX_META_MODEL, metaFile);
		}
	}

	/**
	 * Apply AlterOperations to schema in _datrix and write back
	 */
	private async applyOperationsToMetaSchema(
		tableName: string,
		operations: readonly AlterOperation[],
		skipWrite: boolean,
	): Promise<void> {
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
					// Update relation fields that reference the renamed column
					for (const [key, def] of Object.entries(fields)) {
						if (def.type === "relation" && def.foreignKey === op.from) {
							fields[key] = { ...def, foreignKey: op.to };
						}
					}
					break;
				}
				case "addMetaField":
					if (fields[op.field] !== undefined) {
						throwMetaFieldAlreadyExists({
							adapter: "json",
							field: op.field,
							table: tableName,
						});
					}
					fields[op.field] = op.definition;
					break;
				case "dropMetaField":
					if (fields[op.field] === undefined) {
						throwMetaFieldNotFound({
							adapter: "json",
							field: op.field,
							table: tableName,
						});
					}
					delete fields[op.field];
					break;
				case "modifyMetaField":
					if (fields[op.field] === undefined) {
						throwMetaFieldNotFound({
							adapter: "json",
							field: op.field,
							table: tableName,
						});
					}
					fields[op.field] = op.newDefinition;
					break;
			}
		}

		const updatedSchema: SchemaDefinition = { ...schema, fields };
		await this.upsertSchemaMeta(updatedSchema, skipWrite);
	}

	/**
	 * Invalidate cache for a specific table
	 */
	private invalidateCache(tableName: string): void {
		this.cache.delete(tableName);
	}

	/**
	 * Drop the entire in-memory cache. Used by the importer after swapping in
	 * a full staging-directory import — table files on disk have all changed
	 * out from under any per-table cache entries.
	 */
	clearCache(): void {
		this.cache.clear();
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

	async exportData(writer: ExportWriter): Promise<void> {
		await new JsonExporter(this.config.root, this).export(writer);
	}

	async importData(reader: ImportReader): Promise<void> {
		await new JsonImporter(this.config.root, this).import(reader);
	}

	async createTable(
		schema: SchemaDefinition,
		options?: {
			/**
			 * Set to true when called from the importer.
			 * Skips upsertSchemaMeta so the importer can restore _datrix data as-is.
			 */
			isImport?: boolean;
		},
	): Promise<void> {
		return this.createTableWithOptions(schema, undefined, options?.isImport);
	}

	/**
	 * Create table with options (for transaction support)
	 */
	async createTableWithOptions(
		schema: SchemaDefinition,
		options?: SchemaOperationOptions,
		isImport?: boolean,
	): Promise<void> {
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
			throwNotConnected({ adapter: "json" });
		}

		const tableName = schema.tableName!;

		validateTableName(tableName);

		// Check if table exists in transaction cache first
		if (this.activeTransactionCache?.has(tableName)) {
			throwMigrationError({
				adapter: "json",
				message: `Table '${schema.name}' already exists`,
				table: tableName,
			});
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
				throwMigrationError({
					adapter: "json",
					message: `Table '${schema.name}' already exists`,
				});
			} catch (err) {
				if (err instanceof DatrixAdapterError) throw err;
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
			await atomicWriteFile(filePath, JSON.stringify(initialContent, null, 2));
			await this.updateCache(tableName, initialContent);
		}

		// Track schema in _datrix (skip during import — _datrix data will be restored as-is)
		if (!isImport) {
			if (schema.name !== DATRIX_META_MODEL) {
				const metaExists = await this.tableExists(DATRIX_META_MODEL);
				if (!metaExists) {
					throwMigrationError({
						adapter: "json",
						message: `Cannot create table '${schema.name}': '${DATRIX_META_MODEL}' table does not exist yet. Create '${DATRIX_META_MODEL}' first.`,
					});
				}
			}
			await this.upsertSchemaMeta(schema, skipWrite);
		}
	}

	async dropTable(tableName: string): Promise<void> {
		return this.dropTableWithOptions(tableName);
	}

	/**
	 * Drop table with options (for transaction support)
	 */
	async dropTableWithOptions(
		tableName: string,
		options?: SchemaOperationOptions,
	): Promise<void> {
		const skipWrite = options?.skipWrite ?? false;
		const isImport = options?.isImport ?? false;

		if (!this.isConnected()) {
			throwNotConnected({ adapter: "json" });
		}

		// Check if table was already deleted in this transaction
		if (this.activeTransactionDeletedTables?.has(tableName)) {
			throwMigrationError({
				adapter: "json",
				message: `Table '${tableName}' does not exist`,
			});
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
			throwMigrationError({
				adapter: "json",
				message: `Table '${tableName}' does not exist`,
			});
		}

		if (skipWrite) {
			// Transaction mode: add to tombstone, remove from tx cache
			this.activeTransactionDeletedTables!.add(tableName);
			this.activeTransactionCache!.delete(tableName);
		} else {
			// Normal mode: delete from disk
			const filePath = this.getTablePath(tableName);
			try {
				await fs.unlink(filePath);
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
					throwMigrationError({
						adapter: "json",
						message: `Failed to delete table '${tableName}': ${err instanceof Error ? err.message : String(err)}`,
						table: tableName,
						cause: err instanceof Error ? err : new Error(String(err)),
					});
				}
			}
			this.invalidateCache(tableName);
		}

		// Remove schema from _datrix (skip during import — _datrix data will be restored as-is)
		if (!isImport && tableName !== DATRIX_META_MODEL) {
			// TODO: _datrix table diger tablelar gibi bir table. burada kod tekrari yapmak yerine executeQuery({delete from _datrix where key = metaKey}) gibi bir sey yapilabilir. eger lock problem cikarmiyorsa
			const metaKey = `${DATRIX_META_KEY_PREFIX}${tableName}`;
			const metaFile = await this.readTable(DATRIX_META_MODEL);
			metaFile.data = metaFile.data.filter(
				(r) => (r as Record<string, unknown>)["key"] !== metaKey,
			);
			metaFile.meta.updatedAt = new Date().toISOString();

			if (skipWrite) {
				this.activeTransactionCache!.set(DATRIX_META_MODEL, {
					data: metaFile,
					mtime: Date.now(),
				});
				this.activeTransactionModifiedTables!.add(DATRIX_META_MODEL);
			} else {
				const filePath = this.getTablePath(DATRIX_META_MODEL);
				await atomicWriteFile(filePath, JSON.stringify(metaFile, null, 2));
				await this.updateCache(DATRIX_META_MODEL, metaFile);
			}
		}
	}

	/**
	 * Execute query (public interface)
	 *
	 * This is the standard DatabaseAdapter interface method.
	 * Internally calls executeQueryWithOptions with default options.
	 */
	async executeQuery<TResult extends DatrixEntry>(
		query: QueryObject<TResult>,
	): Promise<QueryResult<TResult>> {
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
	async executeQueryWithOptions<TResult extends DatrixEntry>(
		query: QueryObject<TResult>,
		options?: ExecuteQueryOptions,
	): Promise<QueryResult<TResult>> {
		const skipLock = options?.skipLock ?? false;
		const skipWrite = options?.skipWrite ?? false;

		validateQueryObject(query);

		if (!this.isConnected()) {
			throwNotConnected({ adapter: "json" });
		}

		const isWriteOp = ["insert", "update", "delete"].includes(query.type);
		const needsLock = !skipLock && (isWriteOp || this.readLockEnabled);
		let lockAcquired = false;

		if (needsLock) {
			try {
				await this.lock.acquire();
				lockAcquired = true;
			} catch (err) {
				throwQueryError({
					adapter: "json",
					message: `Failed to acquire lock: ${err instanceof Error ? err.message : String(err)}`,
					query: query as QueryObject,
					cause: err instanceof Error ? err : new Error(String(err)),
				});
			}
		}

		try {
			let tableData: JsonTableFile<Record<string, unknown>>;

			try {
				tableData = await this.readTable(query.table);
			} catch (err) {
				const message =
					err instanceof Error && err.name === "SyntaxError"
						? `Table file '${query.table}.json' is corrupted: ${err.message}`
						: err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT"
							? `Table '${query.table}' not found`
							: `Failed to read table '${query.table}': ${err instanceof Error ? err.message : String(err)}`;
				throwQueryError({
					adapter: "json",
					message,
					query: query as QueryObject,
					cause: err instanceof Error ? err : new Error(String(err)),
				});
			}

			// Handle missing data field
			if (!tableData!.data || !Array.isArray(tableData!.data)) {
				tableData!.data = [];
			}

			// Copy-at-boundary for write ops: mutate a copy, not the cache's own
			// table object. The copy is only swapped into the cache after a
			// successful disk write (see issue.md Part 2) — a failed write
			// leaves the cache exactly as it was.
			const isWriteOp = ["insert", "update", "delete"].includes(query.type);
			const workingTableData = isWriteOp
				? ({
						meta: { ...tableData!.meta },
						data: tableData!.data.map((row) => ({ ...row })),
					} as JsonTableFile<Record<string, unknown>>)
				: tableData!;

			// Load schema from _datrix for this table (transaction-aware)
			let tableSchema: SchemaDefinition | undefined;
			try {
				tableSchema = await this.readTableSchema(query.table);
			} catch {
				// Schema not found in _datrix — proceed without it
			}

			const runner = new JsonQueryRunner(workingTableData, this, tableSchema);

			let handlerResult: Awaited<ReturnType<typeof handleSelect>> | undefined;

			switch (query.type) {
				case "count":
					handlerResult = await handleCount({ runner, query });
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
					handlerResult = await handleDelete({
						runner,
						query,
						adapter: this,
						queryOptions: { skipLock: true, skipWrite },
					});
					break;
			}

			if (handlerResult!.earlyReturn) {
				return {
					rows: [] as TResult[],
					metadata: handlerResult!.metadata,
				};
			}

			const rows = handlerResult!.rows as TResult[];
			const metadata = handlerResult!.metadata;
			const shouldWrite = handlerResult!.shouldWrite;

			// Handle write
			if (shouldWrite) {
				workingTableData.meta.updatedAt = new Date().toISOString();

				if (skipWrite) {
					// Transaction mode: commit the mutated copy into the tx cache
					// (not the disk) — the transaction will write on commit.
					if (this.activeTransactionCache && this.activeTransactionModifiedTables) {
						this.activeTransactionCache.set(query.table, {
							data: workingTableData,
							mtime: Date.now(),
						});
						this.activeTransactionModifiedTables.add(query.table);
					}
				} else {
					// Normal mode: write the mutated copy to disk, then swap it
					// into the cache — a failed write never touches the cache.
					const filePath = this.getTablePath(query.table);
					await atomicWriteFile(
						filePath,
						JSON.stringify(workingTableData, null, 2),
					);
					await this.updateCache(query.table, workingTableData);
				}
			}

			metadata.rowCount = rows.length;

			return {
				rows: rows as TResult[],
				metadata,
			};
		} finally {
			if (lockAcquired) await this.lock.release();
		}
	}

	async executeRawQuery<TResult extends DatrixEntry>(
		_sql: string,
		_params: readonly unknown[],
	): Promise<QueryResult<TResult>> {
		throwQueryError({
			adapter: "json",
			message: "executeRawQuery is not supported by JsonAdapter",
		});
	}

	/**
	 * Wait for the currently active transaction (if any) to commit/rollback,
	 * up to `lockTimeout`. Throws if the timeout elapses first.
	 */
	private async waitForCurrentTransaction(): Promise<void> {
		if (!this.activeTransactionCache) return;

		const timeout = this.config.lockTimeout ?? 5000;

		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				const idx = this.transactionEndWaiters.indexOf(onEnd);
				if (idx >= 0) this.transactionEndWaiters.splice(idx, 1);
				reject(
					new DatrixAdapterError(
						"Timed out waiting for the active transaction to end",
						{
							adapter: "json",
							code: "ADAPTER_TRANSACTION_ERROR",
							operation: "transaction",
						},
					),
				);
			}, timeout);

			const onEnd = (): void => {
				clearTimeout(timer);
				resolve();
			};

			this.transactionEndWaiters.push(onEnd);
		});

		// The slot may have been re-claimed by another waiter between the
		// notification and our wake-up — keep waiting until it's actually free.
		await this.waitForCurrentTransaction();
	}

	private notifyTransactionEnded(): void {
		const waiters = this.transactionEndWaiters;
		this.transactionEndWaiters = [];
		for (const waiter of waiters) waiter();
	}

	/**
	 * Begin a new transaction
	 *
	 * Acquires lock and creates isolated transaction cache.
	 * All reads/writes within transaction use txCache.
	 *
	 * If another transaction is already active, waits for it to end
	 * (commit/rollback) instead of throwing, up to `lockTimeout`.
	 */
	async beginTransaction(): Promise<Transaction> {
		if (!this.isConnected()) {
			throwNotConnected({ adapter: "json" });
		}

		await this.waitForCurrentTransaction();

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

			return transaction;
		} catch (err) {
			throwTransactionError({
				adapter: "json",
				message: `Failed to begin transaction: ${err instanceof Error ? err.message : String(err)}`,
				cause: err instanceof Error ? err : new Error(String(err)),
			});
		}
	}

	/**
	 * Commit transaction - write modified tables to disk
	 * @internal Called by JsonTransaction.commit()
	 */
	private async commitTransaction(): Promise<void> {
		if (!this.activeTransactionCache || !this.activeTransactionModifiedTables) {
			throwTransactionError({
				adapter: "json",
				message: "No active transaction to commit",
			});
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
					await atomicWriteFile(filePath, JSON.stringify(entry.data, null, 2));

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
			this.notifyTransactionEnded();
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
		this.notifyTransactionEnded();
	}

	async alterTable(
		tableName: string,
		operations: readonly AlterOperation[],
	): Promise<void> {
		return this.alterTableWithOptions(tableName, operations);
	}

	/**
	 * Alter table with options (for transaction support)
	 */
	async alterTableWithOptions(
		tableName: string,
		operations: readonly AlterOperation[],
		options?: SchemaOperationOptions,
	): Promise<void> {
		const skipWrite = options?.skipWrite ?? false;

		if (!this.isConnected()) {
			throwNotConnected({ adapter: "json" });
		}

		const json = await this.readTable(tableName);

		// Apply each operation to table data rows
		for (const op of operations) {
			switch (op.type) {
				case "addColumn": {
					const defaultValue = (op.definition as { default?: unknown }).default;
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
			await atomicWriteFile(filePath, JSON.stringify(json, null, 2));
			await this.updateCache(tableName, json);
		}

		// Update schema in _datrix
		if (tableName !== DATRIX_META_MODEL) {
			await this.applyOperationsToMetaSchema(tableName, operations, skipWrite);
		}
	}

	async renameTable(from: string, to: string): Promise<void> {
		return this.renameTableWithOptions(from, to);
	}

	/**
	 * Rename table with options (for transaction support)
	 */
	async renameTableWithOptions(
		from: string,
		to: string,
		options?: SchemaOperationOptions,
	): Promise<void> {
		const skipWrite = options?.skipWrite ?? false;

		if (!this.isConnected()) {
			throwNotConnected({ adapter: "json" });
		}

		validateTableName(to);

		// Check source table exists
		if (this.activeTransactionDeletedTables?.has(from)) {
			throwMigrationError({
				adapter: "json",
				message: `Table '${from}' does not exist`,
			});
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
			throwMigrationError({
				adapter: "json",
				message: `Table '${to}' already exists`,
			});
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
			await atomicWriteFile(toPath, JSON.stringify(json, null, 2));
			await fs.unlink(fromPath);
			this.invalidateCache(from);
			await this.updateCache(to, json);
		}

		// Update key + schema content in _datrix, and fix up any FK references
		// in OTHER schemas that pointed at the renamed table.
		if (from !== DATRIX_META_MODEL && to !== DATRIX_META_MODEL) {
			const oldKey = `${DATRIX_META_KEY_PREFIX}${from}`;
			const newKey = `${DATRIX_META_KEY_PREFIX}${to}`;
			const metaFile = await this.readTable(DATRIX_META_MODEL);
			let metaChanged = false;

			for (const r of metaFile.data) {
				const record = r as Record<string, unknown>;
				const key = record["key"];
				if (typeof key !== "string" || !key.startsWith(DATRIX_META_KEY_PREFIX)) {
					continue;
				}

				let schema = JSON.parse(record["value"] as string) as SchemaDefinition;
				let schemaChanged = false;

				if (key === oldKey) {
					record["key"] = newKey;
					schema = { ...schema, tableName: to };
					schemaChanged = true;
				}

				for (const field of Object.values(schema.fields)) {
					const ref = (field as { references?: { table: string } }).references;
					if (ref?.table === from) {
						(ref as { table: string }).table = to;
						schemaChanged = true;
					}
				}

				if (schemaChanged) {
					record["value"] = JSON.stringify(schema);
					metaChanged = true;
				}
			}

			if (metaChanged) {
				metaFile.meta.updatedAt = new Date().toISOString();

				if (skipWrite) {
					this.activeTransactionCache!.set(DATRIX_META_MODEL, {
						data: metaFile,
						mtime: Date.now(),
					});
					this.activeTransactionModifiedTables!.add(DATRIX_META_MODEL);
				} else {
					const metaPath = this.getTablePath(DATRIX_META_MODEL);
					await atomicWriteFile(metaPath, JSON.stringify(metaFile, null, 2));
					await this.updateCache(DATRIX_META_MODEL, metaFile);
				}
			}
		}
	}

	async addIndex(tableName: string, index: IndexDefinition): Promise<void> {
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
	): Promise<void> {}

	async dropIndex(tableName: string, indexName: string): Promise<void> {
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
	): Promise<void> {}

	async getTables(): Promise<readonly string[]> {
		if (!this.isConnected()) {
			throwNotConnected({ adapter: "json" });
		}
		const files = await fs.readdir(this.config.root);
		const tables = files
			.filter((f) => f.endsWith(".json"))
			.map((f) => f.slice(0, -".json".length));
		return tables;
	}

	async getTableSchema(tableName: string): Promise<SchemaDefinition | null> {
		if (!this.isConnected()) {
			throwNotConnected({ adapter: "json" });
		}
		try {
			const schema = await this.readTableSchema(tableName);
			return schema;
		} catch {
			return null;
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
