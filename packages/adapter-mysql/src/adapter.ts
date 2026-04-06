/**
 * MySQL Database Adapter
 *
 * Main adapter implementation for MySQL/MariaDB.
 * Handles connection pooling, query execution, transactions, and schema operations.
 */

import type {
	Pool,
	PoolConnection,
	ResultSetHeader,
	RowDataPacket,
} from "mysql2/promise";
import { createPool } from "mysql2/promise";

import { MySQLQueryTranslator } from "./query-translator";
import { MySQLPopulator } from "./populate";
import { MySQLClient } from "./mysql-client";
import { MySQLExporter } from "./export-import/exporter";
import { MySQLImporter } from "./export-import/importer";
import { ExportWriter, ImportReader } from "@forja/core/types/adapter";
import type { MySQLConfig, MySQLQueryObject } from "./types";
import { getMySQLTypeWithModifiers, parseConnectionString } from "./types";
import { QueryObject, QuerySelectObject } from "@forja/core/types";
import { ForjaEntry } from "@forja/core/types";
import {
	AlterOperation,
	ConnectionState,
	DatabaseAdapter,
	QueryMetadata,
	QueryResult,
	Transaction,
} from "@forja/core/types/adapter";
import {
	ForjaAdapterError,
	throwNotConnected,
	throwConnectionError,
	throwMigrationError,
	throwIntrospectionError,
	throwTransactionError,
	throwQueryError,
	throwMetaFieldAlreadyExists,
	throwMetaFieldNotFound,
	AdapterErrorCode,
} from "@forja/core/types/errors";
import { validateQueryObject } from "@forja/core/types/utils";
import {
	FieldDefinition,
	IndexDefinition,
	ISchemaRegistry,
	SchemaDefinition,
} from "@forja/core/types";
import { FORJA_META_MODEL, FORJA_META_KEY_PREFIX } from "@forja/core/types";
import { escapeIdentifier, escapeValue } from "./helpers";

/**
 * MySQL adapter implementation
 */
export class MySQLAdapter implements DatabaseAdapter<MySQLConfig> {
	readonly name = "mysql";
	readonly config: MySQLConfig;

	private pool: Pool | undefined;
	private state: ConnectionState = "disconnected";
	private _schemas: ISchemaRegistry | undefined;
	private _translator: MySQLQueryTranslator | undefined;

	constructor(config: MySQLConfig) {
		if (config.connectionString) {
			const parsed = parseConnectionString(config.connectionString);
			this.config = { ...config, ...parsed };
		} else {
			this.config = config;
		}
	}

	getTranslator(): MySQLQueryTranslator {
		return this._translator!;
	}

	/**
	 * Connect to MySQL
	 */
	async connect(schemas: ISchemaRegistry): Promise<void> {
		if (this.state === "connected") {
			return;
		}

		this.state = "connecting";
		this._schemas = schemas;
		this._translator = new MySQLQueryTranslator(schemas);

		try {
			// Build pool options
			const poolOptions: Record<string, unknown> = {
				host: this.config.host ?? "localhost",
				port: this.config.port ?? 3306,
				database: this.config.database,
				user: this.config.user,
				password: this.config.password,
				connectionLimit: this.config.connectionLimit ?? 10,
				queueLimit: this.config.queueLimit ?? 0,
				waitForConnections: this.config.waitForConnections ?? true,
				connectTimeout: this.config.connectTimeout ?? 10000,
				charset: this.config.charset ?? "utf8mb4",
				timezone: this.config.timezone ?? "local",
			};

			// Add SSL config if provided
			if (this.config.ssl === true) {
				poolOptions["ssl"] = {};
			} else if (typeof this.config.ssl === "object") {
				poolOptions["ssl"] = { ...this.config.ssl };
			}

			this.pool = createPool(poolOptions as Parameters<typeof createPool>[0]);

			const connection = await this.pool.getConnection();
			connection.release();

			this.state = "connected";
		} catch (error) {
			this.state = "error";
			const message = error instanceof Error ? error.message : String(error);
			throwConnectionError({
				adapter: "mysql",
				message: `Failed to connect to MySQL: ${message}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Disconnect from MySQL
	 */
	async disconnect(): Promise<void> {
		if (this.state === "disconnected") {
			return;
		}

		try {
			if (this.pool) {
				await this.pool.end();
				this.pool = undefined;
			}

			this.state = "disconnected";
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwConnectionError({
				adapter: "mysql",
				message: `Failed to disconnect from MySQL: ${message}`,
				operation: "disconnect",
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Check if connected
	 */
	isConnected(): boolean {
		return this.state === "connected" && this.pool !== undefined;
	}

	/**
	 * Get connection state
	 */
	getConnectionState(): ConnectionState {
		return this.state;
	}

	/**
	 * Execute query
	 *
	 * @param query - Query object to execute
	 * @param connection - Optional PoolConnection for transaction support. If provided, query runs on this connection instead of pool.
	 */
	async executeQuery<TResult extends ForjaEntry>(
		query: QueryObject<TResult>,
		connection?: PoolConnection,
	): Promise<QueryResult<TResult>> {
		validateQueryObject(query);

		const queryRunner = connection ?? this.pool;

		if (!queryRunner) {
			throwNotConnected({ adapter: "mysql" });
		}

		// Handle SELECT with populate
		if (
			query.type === "select" &&
			query.populate &&
			Object.keys(query.populate).length > 0
		) {
			return this.executeWithPopulate<TResult>(query, queryRunner!);
		}

		const client = new MySQLClient(queryRunner!, query as QueryObject);

		try {
			// For UPDATE: pre-fetch affected IDs (MySQL has no RETURNING clause)
			// Executor needs rows=[{id}] to build SELECT for returning full records
			let prefetchedIds: readonly TResult[] | undefined;
			if (query.type === "update" && query.where) {
				const escapedTable = escapeIdentifier(query.table);
				const whereResult = this.getTranslator().translateWhere(
					query.where,
					0,
					query.table,
				);
				const joinClause =
					whereResult.joins.length > 0 ? ` ${whereResult.joins.join(" ")}` : "";
				const idSelectSQL = `SELECT ${escapedTable}.\`id\` FROM ${escapedTable}${joinClause} WHERE ${whereResult.sql}`;
				const [idRows] = await client.execute(
					idSelectSQL,
					whereResult.params as unknown[],
				);
				prefetchedIds = idRows as unknown as readonly TResult[];
			}

			const mysqlQuery = query as MySQLQueryObject<ForjaEntry>;
			const { sql, params } = this.getTranslator().translate(mysqlQuery);

			const [result] = await client.execute(sql, params as unknown[]);

			let affectedRows = 0;
			let rows: readonly TResult[] = [];

			if (query.type === "insert") {
				const resultHeader = result as ResultSetHeader;
				affectedRows = resultHeader.affectedRows ?? 0;

				// Build id rows from insertId + affectedRows (MySQL auto_increment is sequential)
				const firstId = resultHeader.insertId;
				const idRows: TResult[] = [];
				for (let i = 0; i < affectedRows; i++) {
					idRows.push({ id: firstId + i } as TResult);
				}
				rows = idRows;
			} else if (query.type === "update") {
				const resultHeader = result as ResultSetHeader;
				affectedRows = resultHeader.affectedRows ?? 0;
				rows = prefetchedIds ?? [];
			} else if (query.type === "delete") {
				const resultHeader = result as ResultSetHeader;
				affectedRows = resultHeader.affectedRows ?? 0;
				// MySQL has no RETURNING clause. Executor pre-fetches rows via SELECT
				// before DELETE when needed (needsReturnSelect). No extra query needed here.
				rows = [];
			} else if (query.type === "count") {
				const countRows = result as RowDataPacket[];
				const countValue = countRows[0]?.["count"];
				const count =
					typeof countValue === "string"
						? parseInt(countValue, 10)
						: ((countValue as number) ?? 0);

				const metadata: QueryMetadata = {
					rowCount: 0,
					affectedRows: 0,
					count,
				};
				return { rows: [] as unknown as readonly TResult[], metadata };
			} else {
				rows = this.convertMySQLTypes(
					result as unknown as readonly TResult[],
					query.table,
				);
				affectedRows = (result as RowDataPacket[]).length;
			}

			const metadata: QueryMetadata = {
				rowCount: affectedRows,
				affectedRows,
			};

			return { rows, metadata };
		} catch (error) {
			if (error instanceof ForjaAdapterError) {
				throw error;
			}
			throw this.mapMySQLError(error, query);
		}
	}

	/**
	 * Execute query with populate
	 */
	private async executeWithPopulate<TResult extends ForjaEntry>(
		query: QuerySelectObject<TResult>,
		queryRunner: Pool | PoolConnection,
	): Promise<QueryResult<TResult>> {
		try {
			const populateQuery: QueryObject = {
				type: "select",
				table: `_populate:${query.table}`,
			} as QueryObject;
			const client = new MySQLClient(queryRunner, populateQuery);
			const populator = new MySQLPopulator(
				client,
				this.getTranslator(),
				this._schemas!,
			);

			const rawRows = await populator.populate<TResult>(query);
			const rows = this.convertMySQLTypes(rawRows, query.table);

			const metadata: QueryMetadata = {
				rowCount: rows.length,
				affectedRows: rows.length,
			};

			return { rows: rows as readonly TResult[], metadata };
		} catch (error) {
			if (error instanceof ForjaAdapterError) {
				throw error;
			}
			throw this.mapMySQLError(error, query);
		}
	}

	/**
	 * Map MySQL errors to standardized ForjaAdapterError
	 */
	private mapMySQLError<TResult extends ForjaEntry = ForjaEntry>(
		error: unknown,
		query?: QueryObject<TResult>,
		sql?: string,
	): ForjaAdapterError {
		if (error instanceof ForjaAdapterError) {
			return error;
		}

		const message = error instanceof Error ? error.message : String(error);
		const mysqlError = error as {
			code?: string;
			errno?: number;
			sqlState?: string;
		};

		// Map specific MySQL error codes to Forja error codes
		let forjaCode = "ADAPTER_QUERY_ERROR";
		if (mysqlError.errno === 1062 || mysqlError.code === "ER_DUP_ENTRY") {
			forjaCode = "ADAPTER_UNIQUE_CONSTRAINT";
		}

		return new ForjaAdapterError(`Query execution failed: ${message}`, {
			adapter: "mysql",
			code: forjaCode as AdapterErrorCode,
			operation: "query",
			context: {
				...(query && { query: { type: query.type, table: query.table } }),
				...(sql && { sql }),
				...(mysqlError.errno && { mysqlErrno: mysqlError.errno }),
				...(mysqlError.code && { mysqlCode: mysqlError.code }),
				...(mysqlError.sqlState && { sqlState: mysqlError.sqlState }),
			},
			cause: error instanceof Error ? error : undefined,
		});
	}

	/**
	 * Execute raw SQL query
	 */
	async executeRawQuery<TResult extends ForjaEntry>(
		sql: string,
		params: readonly unknown[],
		connection?: PoolConnection,
	): Promise<QueryResult<TResult>> {
		const queryRunner = connection ?? this.pool;

		if (!queryRunner) {
			throwNotConnected({ adapter: "mysql" });
		}

		const rawQuery: QueryObject = {
			type: "select",
			table: "_raw",
		} as QueryObject;
		const client = new MySQLClient(queryRunner!, rawQuery);

		try {
			const [result] = await client.execute(sql, params as unknown[]);

			const isResultSet = Array.isArray(result);
			const rows = isResultSet ? (result as unknown as readonly TResult[]) : [];
			const affectedRows = isResultSet
				? (result as RowDataPacket[]).length
				: ((result as ResultSetHeader).affectedRows ?? 0);

			const metadata: QueryMetadata = {
				rowCount: affectedRows,
				affectedRows,
			};

			return { rows, metadata };
		} catch (error) {
			if (error instanceof ForjaAdapterError) {
				throw error;
			}
			throw this.mapMySQLError(error, undefined, sql);
		}
	}

	/**
	 * Begin transaction
	 */
	async beginTransaction(): Promise<Transaction> {
		if (!this.pool) {
			throwNotConnected({ adapter: "mysql" });
		}

		try {
			const connection = await this.pool!.getConnection();
			await connection.beginTransaction();

			const transaction = new MySQLTransaction(
				connection,
				this,
				`tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
			);

			return transaction;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwTransactionError({
				adapter: "mysql",
				message: `Failed to begin transaction: ${message}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Create table from schema
	 */
	async createTable(
		schema: SchemaDefinition,
		connection?: PoolConnection,
		options?: {
			/**
			 * Set to true when called from the importer.
			 * Skips FK constraint creation (added later via ALTER TABLE) and
			 * skips upsertSchemaMeta so the importer can restore _forja data as-is.
			 */
			isImport?: boolean;
		},
	): Promise<void> {
		const queryRunner = connection ?? this.pool;
		if (!queryRunner) {
			throwNotConnected({ adapter: "mysql" });
		}

		const client = this.createClient(
			queryRunner!,
			`createTable:${schema.name}`,
		);

		try {
			const columns: string[] = [];
			const foreignKeyConstraints: string[] = [];

			for (const [fieldName, field] of Object.entries(schema.fields)) {
				if (field.type === "relation") continue;
				const columnDef = this.buildColumnDefinition(fieldName, field);
				columns.push(columnDef);

				if (!options?.isImport && field.type === "number" && field.references) {
					const col = escapeIdentifier(fieldName);
					const refTable = escapeIdentifier(field.references.table);
					const refCol = escapeIdentifier(field.references.column ?? "id");
					const onDelete = field.references.onDelete
						? ` ON DELETE ${field.references.onDelete === "setNull" ? "SET NULL" : field.references.onDelete.toUpperCase()}`
						: "";
					const onUpdate = field.references.onUpdate
						? ` ON UPDATE ${field.references.onUpdate.toUpperCase()}`
						: "";
					foreignKeyConstraints.push(
						`FOREIGN KEY (${col}) REFERENCES ${refTable} (${refCol})${onDelete}${onUpdate}`,
					);
				}
			}

			const allDefs = [...columns, ...foreignKeyConstraints];
			const tableName = escapeIdentifier(schema.tableName!);
			const sql = `CREATE TABLE ${tableName} (\n  ${allDefs.join(",\n  ")}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

			await client.execute(sql);

			// Create indexes defined in schema
			if (schema.indexes) {
				for (const index of schema.indexes) {
					await this.addIndex(schema.tableName!, index, schema, connection);
				}
			}

			// Track schema in _forja (skip during import — _forja data will be restored as-is)
			if (!options?.isImport) {
				if (schema.name !== FORJA_META_MODEL) {
					const metaExists = await this.tableExists(FORJA_META_MODEL);
					if (!metaExists) {
						throwMigrationError({
							adapter: "mysql",
							message: `Cannot create table '${schema.name}': '${FORJA_META_MODEL}' table does not exist yet. Create '${FORJA_META_MODEL}' first.`,
						});
					}
				}

				await this.upsertSchemaMeta(schema, queryRunner!);
			}
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throwMigrationError({
				adapter: "mysql",
				message: `Failed to create table '${schema.name}': ${message}`,
				table: schema.tableName,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Drop table
	 */
	async dropTable(
		tableName: string,
		connection?: PoolConnection,
		options?: { isImport?: boolean },
	): Promise<void> {
		const queryRunner = connection ?? this.pool;
		if (!queryRunner) {
			throwNotConnected({ adapter: "mysql" });
		}

		const client = this.createClient(queryRunner!, `dropTable:${tableName}`);

		try {
			const escapedTable = escapeIdentifier(tableName);
			await client.execute(`DROP TABLE IF EXISTS ${escapedTable}`);

			// Remove schema from _forja (skip during import — _forja data will be restored as-is)
			if (!options?.isImport && tableName !== FORJA_META_MODEL) {
				const metaKey = `${FORJA_META_KEY_PREFIX}${tableName}`;
				const escapedMetaTable = escapeIdentifier(FORJA_META_MODEL);
				await client.execute(
					`DELETE FROM ${escapedMetaTable} WHERE \`key\` = ?`,
					[metaKey],
				);
			}
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throwMigrationError({
				adapter: "mysql",
				message: `Failed to drop table '${tableName}': ${message}`,
				table: tableName,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Rename table
	 */
	async renameTable(
		from: string,
		to: string,
		connection?: PoolConnection,
	): Promise<void> {
		const queryRunner = connection ?? this.pool;
		if (!queryRunner) {
			throwNotConnected({ adapter: "mysql" });
		}

		const client = this.createClient(
			queryRunner!,
			`renameTable:${from}->${to}`,
		);

		try {
			const escapedFrom = escapeIdentifier(from);
			const escapedTo = escapeIdentifier(to);
			await client.execute(`RENAME TABLE ${escapedFrom} TO ${escapedTo}`);

			// Update key in _forja
			if (from !== FORJA_META_MODEL && to !== FORJA_META_MODEL) {
				const oldKey = `${FORJA_META_KEY_PREFIX}${from}`;
				const newKey = `${FORJA_META_KEY_PREFIX}${to}`;
				const escapedMetaTable = escapeIdentifier(FORJA_META_MODEL);
				await client.execute(
					`UPDATE ${escapedMetaTable} SET \`key\` = ? WHERE \`key\` = ?`,
					[newKey, oldKey],
				);
			}
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throwMigrationError({
				adapter: "mysql",
				message: `Failed to rename table '${from}' to '${to}': ${message}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Alter table
	 */
	async alterTable(
		tableName: string,
		operations: readonly AlterOperation[],
		connection?: PoolConnection,
	): Promise<void> {
		const queryRunner = connection ?? this.pool;
		if (!queryRunner) {
			throwNotConnected({ adapter: "mysql" });
		}

		const client = this.createClient(queryRunner!, `alterTable:${tableName}`);

		try {
			const escapedTable = escapeIdentifier(tableName);

			for (const op of operations) {
				let sql = "";

				switch (op.type) {
					case "addColumn": {
						const columnDef = this.buildColumnDefinition(
							op.column,
							op.definition,
						);
						sql = `ALTER TABLE ${escapedTable} ADD COLUMN ${columnDef}`;
						break;
					}

					case "dropColumn": {
						// Drop FK constraints on this column before dropping it
						const [fkRows] = await client.execute(
							`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
							[this.config.database, tableName, op.column],
						);
						for (const fkRow of fkRows as RowDataPacket[]) {
							const fkName = escapeIdentifier(
								fkRow["CONSTRAINT_NAME"] as string,
							);
							await client.execute(
								`ALTER TABLE ${escapedTable} DROP FOREIGN KEY ${fkName}`,
							);
						}

						const columnName = escapeIdentifier(op.column);
						sql = `ALTER TABLE ${escapedTable} DROP COLUMN ${columnName}`;
						break;
					}

					case "modifyColumn": {
						const columnName = escapeIdentifier(op.column);
						const mysqlType = getMySQLTypeWithModifiers(op.newDefinition);
						sql = `ALTER TABLE ${escapedTable} MODIFY COLUMN ${columnName} ${mysqlType}`;
						break;
					}

					case "renameColumn": {
						const fromColumn = escapeIdentifier(op.from);
						const toColumn = escapeIdentifier(op.to);
						sql = `ALTER TABLE ${escapedTable} RENAME COLUMN ${fromColumn} TO ${toColumn}`;
						break;
					}
				}

				if (sql) {
					await client.execute(sql);
				}
			}

			// Update schema in _forja
			if (tableName !== FORJA_META_MODEL) {
				await this.applyOperationsToMetaSchema(
					tableName,
					operations,
					queryRunner!,
				);
			}
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throwMigrationError({
				adapter: "mysql",
				message: `Failed to alter table '${tableName}': ${message}`,
				table: tableName,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Add index
	 */
	async addIndex(
		tableNameParam: string,
		index: IndexDefinition,
		schema?: SchemaDefinition,
		connection?: PoolConnection,
	): Promise<void> {
		const queryRunner = connection ?? this.pool;
		if (!queryRunner) {
			throwNotConnected({ adapter: "mysql" });
		}

		const client = this.createClient(
			queryRunner!,
			`addIndex:${tableNameParam}`,
		);

		try {
			const tableName = tableNameParam;
			const escapedTable = escapeIdentifier(tableName);
			const indexName =
				index.name ?? `idx_${tableName}_${index.fields.join("_")}`;
			const escapedIndexName = escapeIdentifier(indexName);

			const mappedFields = index.fields.map((fieldName) => {
				if (schema) {
					const field = schema.fields[fieldName];
					if (field && field.type === "relation") {
						const relationField = field as { foreignKey?: string };
						return relationField.foreignKey || fieldName;
					}
				}
				return fieldName;
			});

			const fields = mappedFields.map((f) => escapeIdentifier(f)).join(", ");
			const unique = index.unique ? "UNIQUE " : "";
			const using = index.type ? ` USING ${index.type.toUpperCase()}` : "";
			const sql = `CREATE ${unique}INDEX ${escapedIndexName} ON ${escapedTable} (${fields})${using}`;
			await client.execute(sql);
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throwMigrationError({
				adapter: "mysql",
				message: `Failed to add index on table '${tableNameParam}': ${message}`,
				table: tableNameParam,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Drop index
	 */
	async dropIndex(
		tableName: string,
		indexName: string,
		connection?: PoolConnection,
	): Promise<void> {
		const queryRunner = connection ?? this.pool;
		if (!queryRunner) {
			throwNotConnected({ adapter: "mysql" });
		}

		const client = this.createClient(queryRunner!, `dropIndex:${tableName}`);

		try {
			const escapedTable = escapeIdentifier(tableName);
			const escapedIndexName = escapeIdentifier(indexName);
			await client.execute(`DROP INDEX ${escapedIndexName} ON ${escapedTable}`);
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throwMigrationError({
				adapter: "mysql",
				message: `Failed to drop index '${indexName}': ${message}`,
				table: tableName,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Get all table names
	 */
	async getTables(): Promise<readonly string[]> {
		if (!this.pool) {
			throwNotConnected({ adapter: "mysql" });
		}

		const client = this.createClient(this.pool!, "getTables");

		try {
			const [rows] = (await client.execute(
				`SELECT TABLE_NAME as tableName FROM information_schema.tables WHERE table_schema = ? ORDER BY TABLE_NAME`,
				[this.config.database],
			)) as [RowDataPacket[], unknown];

			return rows.map((row) => row["tableName"] as string);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwIntrospectionError({
				adapter: "mysql",
				message: `Failed to get tables: ${message}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Get table schema (introspection)
	 */
	async getTableSchema(tableName: string): Promise<SchemaDefinition | null> {
		if (!this.pool) {
			throwNotConnected({ adapter: "mysql" });
		}

		try {
			const metaKey = `${FORJA_META_KEY_PREFIX}${tableName}`;
			const escapedMetaTable = escapeIdentifier(FORJA_META_MODEL);
			const client = this.createClient(
				this.pool!,
				`getTableSchema:${tableName}`,
			);
			const [rows] = (await client.execute(
				`SELECT \`value\` FROM ${escapedMetaTable} WHERE \`key\` = ?`,
				[metaKey],
			)) as [RowDataPacket[], unknown];

			if (rows.length === 0) {
				return null;
			}

			return JSON.parse(rows[0]!["value"] as string) as SchemaDefinition;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwIntrospectionError({
				adapter: "mysql",
				message: `Failed to get table schema for '${tableName}': ${message}`,
				table: tableName,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Check if table exists
	 */
	async tableExists(tableName: string): Promise<boolean> {
		if (!this.pool) {
			return false;
		}

		try {
			const client = this.createClient(this.pool, `tableExists:${tableName}`);
			const [rows] = (await client.execute(
				`SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
				[this.config.database, tableName],
			)) as [RowDataPacket[], unknown];

			return (rows[0]?.["count"] as number) > 0;
		} catch {
			return false;
		}
	}

	/**
	 * Upsert schema into _forja metadata table
	 */
	private async upsertSchemaMeta(
		schema: SchemaDefinition,
		queryRunner: Pool | PoolConnection,
	): Promise<void> {
		const client = this.createClient(queryRunner, `upsertMeta:${schema.name}`);
		const metaKey = `${FORJA_META_KEY_PREFIX}${schema.tableName ?? schema.name}`;
		const metaValue = JSON.stringify(schema);
		const escapedMetaTable = escapeIdentifier(FORJA_META_MODEL);
		await client.execute(
			`INSERT INTO ${escapedMetaTable} (\`key\`, \`value\`, \`createdAt\`, \`updatedAt\`)
			 VALUES (?, ?, NOW(), NOW())
			 ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), \`updatedAt\` = NOW()`,
			[metaKey, metaValue],
		);
	}

	/**
	 * Read schema from _forja, apply AlterOperations, write back
	 */
	private async applyOperationsToMetaSchema(
		tableName: string,
		operations: readonly AlterOperation[],
		queryRunner: Pool | PoolConnection,
	): Promise<void> {
		const client = this.createClient(queryRunner, `alterMeta:${tableName}`);
		const metaKey = `${FORJA_META_KEY_PREFIX}${tableName}`;
		const escapedMetaTable = escapeIdentifier(FORJA_META_MODEL);
		const [rows] = await client.execute(
			`SELECT \`value\` FROM ${escapedMetaTable} WHERE \`key\` = ?`,
			[metaKey],
		);

		if ((rows as RowDataPacket[]).length === 0) {
			throwMigrationError({
				adapter: "mysql",
				message: `Schema meta for table '${tableName}' not found in _forja`,
				table: tableName,
			});
		}

		const schema = JSON.parse(
			(rows as RowDataPacket[])[0]!["value"] as string,
		) as SchemaDefinition;
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
							adapter: "mysql",
							field: op.field,
							table: tableName,
						});
					}
					fields[op.field] = op.definition;
					break;
				case "dropMetaField":
					if (fields[op.field] === undefined) {
						throwMetaFieldNotFound({
							adapter: "mysql",
							field: op.field,
							table: tableName,
						});
					}
					delete fields[op.field];
					break;
				case "modifyMetaField":
					if (fields[op.field] === undefined) {
						throwMetaFieldNotFound({
							adapter: "mysql",
							field: op.field,
							table: tableName,
						});
					}
					fields[op.field] = op.newDefinition;
					break;
			}
		}

		const updatedSchema: SchemaDefinition = { ...schema, fields };
		const updatedValue = JSON.stringify(updatedSchema);
		await client.execute(
			`UPDATE ${escapedMetaTable} SET \`value\` = ?, \`updatedAt\` = NOW() WHERE \`key\` = ?`,
			[updatedValue, metaKey],
		);
	}

	/**
	 * Create a MySQLClient for schema/migration operations.
	 * Provides debug logging and error mapping for DDL statements.
	 */
	private createClient(
		queryRunner: Pool | PoolConnection,
		operation: string,
	): MySQLClient {
		const ddlQuery: QueryObject = {
			type: "select",
			table: `_ddl:${operation}`,
		} as QueryObject;
		return new MySQLClient(queryRunner, ddlQuery);
	}

	/**
	 * Convert MySQL result types to JS types based on schema.
	 * MySQL returns TINYINT(1) as 1/0 instead of true/false.
	 */
	private convertMySQLTypes<TResult extends ForjaEntry>(
		rows: readonly TResult[],
		tableName: string,
	): readonly TResult[] {
		const modelName = this._schemas!.findModelByTableName(tableName);
		if (!modelName) return rows;

		const schema = this._schemas!.get(modelName);
		if (!schema) return rows;

		// Collect fields that need conversion
		const booleanFields: string[] = [];
		const jsonFields: string[] = [];
		const relationFields: Array<{ name: string; model: string }> = [];
		for (const [fieldName, field] of Object.entries(schema.fields)) {
			if (field.type === "boolean") {
				booleanFields.push(fieldName);
			} else if (field.type === "json" || field.type === "array") {
				jsonFields.push(fieldName);
			} else if (field.type === "relation") {
				const rel = field as { model?: string };
				if (rel.model) {
					relationFields.push({ name: fieldName, model: rel.model });
				}
			}
		}

		for (const row of rows) {
			for (const field of booleanFields) {
				const value = (row as Record<string, unknown>)[field];
				if (value === 1 || value === 0) {
					(row as Record<string, unknown>)[field] = value === 1;
				}
			}
			for (const field of jsonFields) {
				const value = (row as Record<string, unknown>)[field];
				if (typeof value === "string") {
					try {
						(row as Record<string, unknown>)[field] = JSON.parse(value);
					} catch {
						// keep original string if not valid JSON
					}
				}
			}
			// Recursively convert populated relations
			for (const rel of relationFields) {
				const value = (row as Record<string, unknown>)[rel.name];
				if (value === null || value === undefined) continue;
				const targetSchema = this._schemas!.get(rel.model);
				if (!targetSchema) continue;
				const targetTable = targetSchema.tableName ?? rel.model.toLowerCase();
				if (Array.isArray(value)) {
					this.convertMySQLTypes(value as ForjaEntry[], targetTable);
				} else if (typeof value === "object") {
					this.convertMySQLTypes([value as ForjaEntry], targetTable);
				}
			}
		}

		return rows;
	}

	async exportData(writer: ExportWriter): Promise<void> {
		await new MySQLExporter(this.pool!, this).export(writer);
	}

	async importData(reader: ImportReader): Promise<void> {
		await new MySQLImporter(this.pool!, this).import(reader);
	}

	/**
	 * Build column definition for CREATE/ALTER TABLE
	 */
	private buildColumnDefinition(
		fieldName: string,
		field: FieldDefinition,
	): string {
		const columnName = escapeIdentifier(fieldName);

		const shouldAutoIncrement = field.type === "number" && field.autoIncrement;

		if (shouldAutoIncrement) {
			return `${columnName} INT AUTO_INCREMENT PRIMARY KEY`;
		}

		const mysqlType = getMySQLTypeWithModifiers(field);
		const nullable = field.required ? " NOT NULL" : "";
		const defaultValue =
			field.default !== undefined
				? ` DEFAULT ${escapeValue(field.default)}`
				: "";
		const unique = "unique" in field && field.unique ? " UNIQUE" : "";

		return `${columnName} ${mysqlType}${nullable}${defaultValue}${unique}`;
	}
}

/**
 * MySQL transaction implementation
 *
 * Delegates query execution to adapter's executeQuery with the transaction's connection.
 * This eliminates code duplication (validate, populate, result parsing, error mapping).
 */
class MySQLTransaction implements Transaction {
	readonly id: string;
	private connection: PoolConnection;
	private adapter: MySQLAdapter;
	private committed = false;
	private rolledBack = false;
	private aborted = false;

	constructor(connection: PoolConnection, adapter: MySQLAdapter, id: string) {
		this.connection = connection;
		this.adapter = adapter;
		this.id = id;
	}

	/**
	 * Execute query within transaction
	 *
	 * Delegates to adapter.executeQuery with this transaction's connection,
	 * reusing all query logic (validation, populate, result parsing, error mapping).
	 */
	async executeQuery<TResult extends ForjaEntry>(
		query: QueryObject<TResult>,
	): Promise<QueryResult<TResult>> {
		if (this.committed || this.rolledBack) {
			throwQueryError({
				adapter: "mysql",
				message: "Transaction already completed",
				query: query as QueryObject,
			});
		}

		if (this.aborted) {
			throwQueryError({
				adapter: "mysql",
				message:
					"Transaction is aborted, commands ignored until end of transaction block",
				query: query as QueryObject,
			});
		}

		try {
			return await this.adapter.executeQuery<TResult>(query, this.connection);
		} catch (error) {
			this.aborted = true;
			throw error;
		}
	}

	/**
	 * Execute raw SQL within transaction
	 */
	async executeRawQuery<TResult extends ForjaEntry>(
		sql: string,
		params: readonly unknown[],
	): Promise<QueryResult<TResult>> {
		if (this.committed || this.rolledBack) {
			throwQueryError({
				adapter: "mysql",
				message: "Transaction already completed",
				sql,
			});
		}

		if (this.aborted) {
			throwQueryError({
				adapter: "mysql",
				message:
					"Transaction is aborted, commands ignored until end of transaction block",
				sql,
			});
		}

		try {
			return await this.adapter.executeRawQuery<TResult>(
				sql,
				params,
				this.connection,
			);
		} catch (error) {
			this.aborted = true;
			throw error;
		}
	}

	/**
	 * Commit transaction
	 */
	async commit(): Promise<void> {
		if (this.committed) {
			throwTransactionError({
				adapter: "mysql",
				message: "Transaction already committed",
			});
		}

		if (this.rolledBack) {
			throwTransactionError({
				adapter: "mysql",
				message: "Transaction already rolled back",
			});
		}

		try {
			await this.connection.commit();
			this.committed = true;
			this.connection.release();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwTransactionError({
				adapter: "mysql",
				message: `Failed to commit transaction: ${message}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Rollback transaction
	 */
	async rollback(): Promise<void> {
		if (this.committed) {
			throwTransactionError({
				adapter: "mysql",
				message: "Transaction already committed",
			});
		}

		if (this.rolledBack) {
			throwTransactionError({
				adapter: "mysql",
				message: "Transaction already rolled back",
			});
		}

		try {
			await this.connection.rollback();
			this.rolledBack = true;
			this.connection.release();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwTransactionError({
				adapter: "mysql",
				message: `Failed to rollback transaction: ${message}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Create savepoint
	 */
	async savepoint(name: string): Promise<void> {
		try {
			const escapedName = escapeIdentifier(name);
			await this.connection.execute(`SAVEPOINT ${escapedName}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwTransactionError({
				adapter: "mysql",
				message: `Failed to create savepoint '${name}': ${message}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Rollback to savepoint
	 */
	async rollbackTo(name: string): Promise<void> {
		try {
			const escapedName = escapeIdentifier(name);
			await this.connection.execute(`ROLLBACK TO SAVEPOINT ${escapedName}`);
			this.aborted = false;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwTransactionError({
				adapter: "mysql",
				message: `Failed to rollback to savepoint '${name}': ${message}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Release savepoint
	 */
	async release(name: string): Promise<void> {
		try {
			const escapedName = escapeIdentifier(name);
			await this.connection.execute(`RELEASE SAVEPOINT ${escapedName}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwTransactionError({
				adapter: "mysql",
				message: `Failed to release savepoint '${name}': ${message}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	async createTable(schema: SchemaDefinition): Promise<void> {
		return this.adapter.createTable(schema, this.connection);
	}

	async dropTable(tableName: string): Promise<void> {
		return this.adapter.dropTable(tableName, this.connection);
	}

	async renameTable(from: string, to: string): Promise<void> {
		return this.adapter.renameTable(from, to, this.connection);
	}

	async alterTable(
		tableName: string,
		operations: readonly AlterOperation[],
	): Promise<void> {
		return this.adapter.alterTable(tableName, operations, this.connection);
	}

	async addIndex(tableName: string, index: IndexDefinition): Promise<void> {
		return this.adapter.addIndex(tableName, index, undefined, this.connection);
	}

	async dropIndex(tableName: string, indexName: string): Promise<void> {
		return this.adapter.dropIndex(tableName, indexName, this.connection);
	}
}

/**
 * Create MySQL adapter
 */
export function createMySQLAdapter(config: MySQLConfig): MySQLAdapter {
	return new MySQLAdapter(config);
}
