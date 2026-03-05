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
import type { MySQLConfig, MySQLQueryObject } from "./types";
import { getMySQLTypeWithModifiers, parseConnectionString } from "./types";
import { QueryObject, QuerySelectObject } from "forja-types/core/query-builder";
import { ForjaEntry } from "forja-types";
import {
	AlterOperation,
	ConnectionState,
	DatabaseAdapter,
	QueryMetadata,
	QueryResult,
	Transaction,
} from "forja-types/adapter";
import {
	ForjaAdapterError,
	throwNotConnected,
	throwConnectionError,
	throwMigrationError,
	throwIntrospectionError,
	throwTransactionError,
	throwQueryError,
} from "forja-types/errors/adapter";
import { validateQueryObject } from "forja-types/utils/query";
import {
	FieldDefinition,
	FieldType,
	IndexDefinition,
	SchemaDefinition,
} from "forja-types/core/schema";
import { Forja } from "forja-core";
import {
	FORJA_META_MODEL,
	FORJA_META_KEY_PREFIX,
} from "forja-types/core/constants";

/**
 * MySQL adapter implementation
 */
export class MySQLAdapter implements DatabaseAdapter<MySQLConfig> {
	readonly name = "mysql";
	readonly config: MySQLConfig;

	private pool: Pool | undefined;
	private state: ConnectionState = "disconnected";
	readonly translator: MySQLQueryTranslator;
	private populator: MySQLPopulator | undefined;

	constructor(config: MySQLConfig) {
		if (config.connectionString) {
			const parsed = parseConnectionString(config.connectionString);
			this.config = { ...config, ...parsed };
		} else {
			this.config = config;
		}
		const schemaRegistry = Forja.getInstance().getSchemas();
		this.translator = new MySQLQueryTranslator(schemaRegistry);
	}

	/**
	 * Connect to MySQL
	 */
	async connect(): Promise<void> {
		if (this.state === "connected") {
			return;
		}

		this.state = "connecting";

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

			// Initialize populator
			const schemaRegistry = Forja.getInstance().getSchemas();
			this.populator = new MySQLPopulator(
				this.pool,
				this.translator,
				schemaRegistry,
			);

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
				this.populator = undefined;
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
			Object.keys(query.populate).length > 0 &&
			this.populator
		) {
			return this.executeWithPopulate<TResult>(query);
		}

		let lastSql: string | undefined;

		try {
			const mysqlQuery = query as MySQLQueryObject<ForjaEntry>;
			const { sql, params } = this.translator.translate(mysqlQuery);
			lastSql = sql;

			const [result] = await queryRunner!.execute(sql, params as unknown[]);

			let insertId: string | number | undefined;
			let affectedRows = 0;
			let rows: readonly TResult[] = [];

			if (
				query.type === "insert" ||
				query.type === "update" ||
				query.type === "delete"
			) {
				const resultHeader = result as ResultSetHeader;
				affectedRows = resultHeader.affectedRows ?? 0;
				if (query.type === "insert") {
					insertId = resultHeader.insertId;
				}
			} else {
				rows = result as unknown as readonly TResult[];
				affectedRows = (result as RowDataPacket[]).length;
			}

			const metadata: QueryMetadata = {
				rowCount: affectedRows,
				affectedRows,
				...(insertId !== undefined && { insertId }),
			};

			return { rows, metadata };
		} catch (error) {
			throw this.mapMySQLError(error, query, lastSql);
		}
	}

	/**
	 * Execute query with populate
	 */
	private async executeWithPopulate<TResult extends ForjaEntry>(
		query: QuerySelectObject<TResult>,
	): Promise<QueryResult<TResult>> {
		if (!this.populator) {
			throwQueryError({
				adapter: "mysql",
				message: "Populator not initialized",
				query: query as QueryObject,
			});
		}

		try {
			const rows = await this.populator!.populate<TResult>(query);

			const metadata: QueryMetadata = {
				rowCount: rows.length,
				affectedRows: rows.length,
			};

			return { rows: rows as readonly TResult[], metadata };
		} catch (error) {
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
		const message = error instanceof Error ? error.message : String(error);
		const mysqlError = error as {
			code?: string;
			errno?: number;
			sqlState?: string;
		};

		return new ForjaAdapterError(`Query execution failed: ${message}`, {
			adapter: "mysql",
			code: "ADAPTER_QUERY_ERROR",
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

		try {
			const [result] = await queryRunner!.execute(sql, params as unknown[]);

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
	): Promise<void> {
		const queryRunner = connection ?? this.pool;
		if (!queryRunner) {
			throwNotConnected({ adapter: "mysql" });
		}

		try {
			const columns: string[] = [];

			for (const [fieldName, field] of Object.entries(schema.fields)) {
				const columnDef = this.buildColumnDefinition(fieldName, field);
				columns.push(columnDef);
			}

			const tableName = this.translator.escapeIdentifier(schema.tableName!);
			const sql = `CREATE TABLE ${tableName} (\n  ${columns.join(",\n  ")}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

			await queryRunner!.execute(sql);

			// Track schema in _forja (skip for _forja itself — it tracks others)
			if (schema.name !== FORJA_META_MODEL) {
				const metaExists = await this.tableExists(FORJA_META_MODEL);
				if (!metaExists) {
					throwMigrationError({
						adapter: "mysql",
						message: `Cannot create table '${schema.name}': '${FORJA_META_MODEL}' table does not exist yet. Create '${FORJA_META_MODEL}' first.`,
					});
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
	): Promise<void> {
		const queryRunner = connection ?? this.pool;
		if (!queryRunner) {
			throwNotConnected({ adapter: "mysql" });
		}

		try {
			const escapedTable = this.translator.escapeIdentifier(tableName);
			await queryRunner!.execute(`DROP TABLE IF EXISTS ${escapedTable}`);

			// Remove schema from _forja
			if (tableName !== FORJA_META_MODEL) {
				const metaKey = `${FORJA_META_KEY_PREFIX}${tableName}`;
				const escapedMetaTable =
					this.translator.escapeIdentifier(FORJA_META_MODEL);
				await queryRunner!.execute(
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

		try {
			const escapedFrom = this.translator.escapeIdentifier(from);
			const escapedTo = this.translator.escapeIdentifier(to);
			await queryRunner!.execute(`RENAME TABLE ${escapedFrom} TO ${escapedTo}`);

			// Update key in _forja
			if (from !== FORJA_META_MODEL && to !== FORJA_META_MODEL) {
				const oldKey = `${FORJA_META_KEY_PREFIX}${from}`;
				const newKey = `${FORJA_META_KEY_PREFIX}${to}`;
				const escapedMetaTable =
					this.translator.escapeIdentifier(FORJA_META_MODEL);
				await queryRunner!.execute(
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

		try {
			const escapedTable = this.translator.escapeIdentifier(tableName);

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
						const columnName = this.translator.escapeIdentifier(op.column);
						sql = `ALTER TABLE ${escapedTable} DROP COLUMN ${columnName}`;
						break;
					}

					case "modifyColumn": {
						const columnName = this.translator.escapeIdentifier(op.column);
						const mysqlType = getMySQLTypeWithModifiers(op.newDefinition.type);
						sql = `ALTER TABLE ${escapedTable} MODIFY COLUMN ${columnName} ${mysqlType}`;
						break;
					}

					case "renameColumn": {
						const fromColumn = this.translator.escapeIdentifier(op.from);
						const toColumn = this.translator.escapeIdentifier(op.to);
						sql = `ALTER TABLE ${escapedTable} RENAME COLUMN ${fromColumn} TO ${toColumn}`;
						break;
					}
				}

				if (sql) {
					await queryRunner!.execute(sql);
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
		connection?: PoolConnection,
	): Promise<void> {
		const queryRunner = connection ?? this.pool;
		if (!queryRunner) {
			throwNotConnected({ adapter: "mysql" });
		}

		try {
			const tableName = tableNameParam;
			const escapedTable = this.translator.escapeIdentifier(tableName);
			const indexName =
				index.name ?? `idx_${tableName}_${index.fields.join("_")}`;
			const escapedIndexName = this.translator.escapeIdentifier(indexName);
			const fields = index.fields
				.map((f) => this.translator.escapeIdentifier(f))
				.join(", ");
			const unique = index.unique ? "UNIQUE " : "";
			const using = index.type ? ` USING ${index.type.toUpperCase()}` : "";
			const sql = `CREATE ${unique}INDEX ${escapedIndexName} ON ${escapedTable} (${fields})${using}`;
			await queryRunner!.execute(sql);
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

		try {
			const escapedTable = this.translator.escapeIdentifier(tableName);
			const escapedIndexName = this.translator.escapeIdentifier(indexName);
			await queryRunner!.execute(
				`DROP INDEX ${escapedIndexName} ON ${escapedTable}`,
			);
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

		try {
			const [rows] = await this.pool!.execute<RowDataPacket[]>(
				`SELECT TABLE_NAME as tableName FROM information_schema.tables WHERE table_schema = ? ORDER BY TABLE_NAME`,
				[this.config.database],
			);

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
			const escapedMetaTable =
				this.translator.escapeIdentifier(FORJA_META_MODEL);
			const [rows] = await this.pool!.execute<RowDataPacket[]>(
				`SELECT \`value\` FROM ${escapedMetaTable} WHERE \`key\` = ?`,
				[metaKey],
			);

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
	 * Map MySQL data type to Forja FieldType
	 */
	private mapMySQLTypeToFieldType(dataType: string): FieldType {
		const type = dataType.toLowerCase();

		if (
			type.includes("int") ||
			type.includes("float") ||
			type.includes("double") ||
			type.includes("decimal") ||
			type.includes("numeric")
		) {
			return "number";
		}
		if (type === "tinyint") {
			return "boolean";
		}
		if (
			type.includes("datetime") ||
			type.includes("timestamp") ||
			type.includes("date")
		) {
			return "date";
		}
		if (type === "json") {
			return "json";
		}
		if (
			type.includes("text") ||
			type.includes("char") ||
			type.includes("varchar")
		) {
			return "string";
		}

		return "string";
	}

	/**
	 * Parse MySQL default value
	 */
	private parseMySQLDefault(defaultValue: string | null): unknown {
		if (defaultValue === null) return undefined;

		if (
			defaultValue.toUpperCase() === "CURRENT_TIMESTAMP" ||
			defaultValue.toUpperCase().includes("NOW()")
		) {
			return "NOW()";
		}

		if (defaultValue === "true" || defaultValue === "1") return true;
		if (defaultValue === "false" || defaultValue === "0") return false;

		const num = Number(defaultValue);
		if (!isNaN(num) && defaultValue !== "") return num;

		if (defaultValue.startsWith("'") && defaultValue.endsWith("'")) {
			return defaultValue.slice(1, -1);
		}

		return defaultValue;
	}

	/**
	 * Check if table exists
	 */
	async tableExists(tableName: string): Promise<boolean> {
		if (!this.pool) {
			return false;
		}

		try {
			const [rows] = await this.pool.execute<RowDataPacket[]>(
				`SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
				[this.config.database, tableName],
			);

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
		const metaKey = `${FORJA_META_KEY_PREFIX}${schema.tableName ?? schema.name}`;
		const metaValue = JSON.stringify(schema);
		const escapedMetaTable = this.translator.escapeIdentifier(FORJA_META_MODEL);
		await queryRunner.execute(
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
		const metaKey = `${FORJA_META_KEY_PREFIX}${tableName}`;
		const escapedMetaTable = this.translator.escapeIdentifier(FORJA_META_MODEL);
		const [rows] = await queryRunner.execute<RowDataPacket[]>(
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
					break;
				}
			}
		}

		const updatedSchema: SchemaDefinition = { ...schema, fields };
		const updatedValue = JSON.stringify(updatedSchema);
		await queryRunner.execute(
			`UPDATE ${escapedMetaTable} SET \`value\` = ?, \`updatedAt\` = NOW() WHERE \`key\` = ?`,
			[updatedValue, metaKey],
		);
	}

	/**
	 * Build column definition for CREATE/ALTER TABLE
	 */
	private buildColumnDefinition(
		fieldName: string,
		field: FieldDefinition,
	): string {
		const columnName = this.translator.escapeIdentifier(fieldName);
		const mysqlType = getMySQLTypeWithModifiers(field.type);
		const nullable = field.required ? " NOT NULL" : "";
		const defaultValue =
			field.default !== undefined
				? ` DEFAULT ${this.translator.escapeValue(field.default)}`
				: "";

		return `${columnName} ${mysqlType}${nullable}${defaultValue}`;
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
			const escapedName = this.adapter.translator.escapeIdentifier(name);
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
			const escapedName = this.adapter.translator.escapeIdentifier(name);
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
			const escapedName = this.adapter.translator.escapeIdentifier(name);
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
		return this.adapter.addIndex(tableName, index, this.connection);
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
