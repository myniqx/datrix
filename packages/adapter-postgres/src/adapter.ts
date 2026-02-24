/**
 * PostgreSQL Database Adapter (~500 LOC)
 *
 * Main adapter implementation for PostgreSQL.
 * Handles connection pooling, query execution, transactions, and schema operations.
 */

import type { Pool, PoolClient, QueryResultRow } from "pg";
import { Pool as PgPool } from "pg";

import { PostgresQueryTranslator } from "./query-translator";
import type { PostgresConfig } from "./types";
import { getPostgresTypeWithModifiers } from "./types";
import { QueryObject } from "forja-types/core/query-builder";
import {
	AlterOperation,
	ConnectionError,
	ConnectionState,
	DatabaseAdapter,
	MigrationError,
	QueryError,
	QueryMetadata,
	QueryResult,
	Transaction,
	TransactionError,
} from "forja-types/adapter";
import { Result } from "forja-types/utils";
import { validateQueryObject } from "forja-types/utils/query";
import {
	FieldDefinition,
	FieldType,
	ForjaEntry,
	IndexDefinition,
	SchemaDefinition,
} from "forja-types/core/schema";
import { Forja } from "forja-core";
import { PostgresPopulator } from "./populate";

/**
 * PostgreSQL adapter implementation
 */
export class PostgresAdapter implements DatabaseAdapter<PostgresConfig> {
	readonly name = "postgres";
	readonly config: PostgresConfig;

	private pool: Pool | undefined;
	private state: ConnectionState = "disconnected";
	private _translator: PostgresQueryTranslator | undefined;

	getTranslator(): PostgresQueryTranslator {
		if (!this._translator) {
			const schemaRegistry = Forja.getInstance().getSchemas();
			this._translator = new PostgresQueryTranslator(schemaRegistry);
		}
		return this._translator;
	}

	constructor(config: PostgresConfig) {
		this.config = config;
	}

	/**
	 * Connect to PostgreSQL
	 */
	async connect(): Promise<Result<void, ConnectionError>> {
		if (this.state === "connected") {
			return { success: true, data: undefined };
		}
		this.state = "connecting";

		try {
			this.pool = new PgPool({
				host: this.config.host,
				port: this.config.port,
				database: this.config.database,
				user: this.config.user,
				password: this.config.password,
				ssl: this.config.ssl,
				connectionTimeoutMillis: this.config.connectionTimeoutMillis ?? 5000,
				idleTimeoutMillis: this.config.idleTimeoutMillis ?? 30000,
				max: this.config.max ?? 10,
				min: this.config.min ?? 2,
				application_name: this.config.applicationName ?? "forja",
			});

			// Test connection
			const client = await this.pool.connect();
			client.release();

			this.state = "connected";
			return { success: true, data: undefined };
		} catch (error) {
			this.state = "error";
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new ConnectionError(
					`Failed to connect to PostgreSQL: ${message}`,
					error,
				),
			};
		}
	}

	/**
	 * Disconnect from PostgreSQL
	 */
	async disconnect(): Promise<Result<void, ConnectionError>> {
		if (this.state === "disconnected") {
			return { success: true, data: undefined };
		}

		try {
			if (this.pool) {
				await this.pool.end();
				this.pool = undefined;
			}

			this.state = "disconnected";
			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new ConnectionError(
					`Failed to disconnect from PostgreSQL: ${message}`,
					error,
				),
			};
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
	 * @param client - Optional PoolClient for transaction support. If provided, query runs on this client instead of pool.
	 */
	async executeQuery<TResult extends ForjaEntry>(
		query: QueryObject<TResult>,
		client?: PoolClient,
	): Promise<Result<QueryResult<TResult>, QueryError<TResult>>> {
		// Runtime validation of QueryObject structure
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

		const queryRunner = client ?? this.pool;

		if (!queryRunner) {
			return {
				success: false,
				error: new QueryError("Not connected to database", {
					code: "CONNECTION_ERROR",
					query,
				}),
			};
		}

		let lastSql: string | undefined;

		try {
			if (query.type === "select" && query.populate) {
				const schemaRegistry = Forja.getInstance().getSchemas();
				const populator = new PostgresPopulator(
					queryRunner,
					this.getTranslator(),
					schemaRegistry,
				);

				const rows = await populator.populate<TResult>(query);
				const metadata: QueryMetadata = {
					rowCount: rows.length,
					affectedRows: 0,
				};
				return { success: true, data: { rows, metadata } };
			}

			const { sql, params } = this.getTranslator().translate(query);
			lastSql = sql;
			const result = await queryRunner.query<QueryResultRow>(
				sql,
				params as unknown[],
			);

			if (query.type === "select") {
				const rows = result.rows as unknown as readonly TResult[];
				const metadata: QueryMetadata = {
					rowCount: rows.length,
					affectedRows: 0,
				};
				return { success: true, data: { rows, metadata } };
			}

			if (query.type === "count") {
				const countRow = result.rows[0] as
					| { count: string | number }
					| undefined;
				const count = countRow
					? typeof countRow.count === "string"
						? parseInt(countRow.count, 10)
						: countRow.count
					: 0;
				const metadata: QueryMetadata = {
					rowCount: 0,
					affectedRows: 0,
					count,
				};
				return { success: true, data: { rows: [] as TResult[], metadata } };
			}

			// insert, update, delete — rows contain {id} from RETURNING id
			const ids = result.rows.map((r) => {
				const row = r as { id: string | number };
				return typeof row.id === "string" ? parseInt(row.id, 10) : row.id;
			});
			const idRows = ids.map((id) => ({ id })) as TResult[];
			const metadata: QueryMetadata = {
				rowCount: ids.length,
				affectedRows: ids.length,
				...(query.type === "insert" && { insertIds: ids }),
			};

			return { success: true, data: { rows: idRows, metadata } };
		} catch (error) {
			return {
				success: false,
				error: this.mapPostgresError(error, query, lastSql),
			};
		}
	}

	/**
	 * Map Postgres errors to standardized QueryError
	 */
	private mapPostgresError<TResult extends ForjaEntry>(
		error: unknown,
		query?: QueryObject<TResult>,
		sql?: string,
	): QueryError<TResult> {
		const message = error instanceof Error ? error.message : String(error);
		const details = error as {
			code?: string;
			severity?: string;
			detail?: string;
			hint?: string;
		};
		let code = "QUERY_ERROR";

		// Postgres error codes (https://www.postgresql.org/docs/current/errcodes-appendix.html)
		if (details && typeof details.code === "string") {
			switch (details.code) {
				case "23505": // unique_violation
					code = "UNIQUE_VIOLATION";
					break;
				case "23503": // foreign_key_violation
					code = "FOREIGN_KEY_VIOLATION";
					break;
				case "23502": // not_null_violation
					code = "NOT_NULL_VIOLATION";
					break;
				case "42P01": // undefined_table
					code = "TABLE_NOT_FOUND";
					break;
				case "42703": // undefined_column
					code = "COLUMN_NOT_FOUND";
					break;
			}
		}

		return new QueryError(`Query execution failed: ${message}`, {
			code,
			query,
			sql,
			details: error,
		});
	}

	/**
	 * Execute raw SQL query
	 */
	async executeRawQuery<TResult extends ForjaEntry>(
		sql: string,
		params: readonly unknown[],
	): Promise<Result<QueryResult<TResult>, QueryError<TResult>>> {
		if (!this.pool) {
			return {
				success: false,
				error: new QueryError("Not connected to database", {
					code: "CONNECTION_ERROR",
					sql,
				}),
			};
		}

		try {
			const result = await this.pool.query(sql, params as unknown[]);

			const metadata: QueryMetadata = {
				rowCount: result.rowCount ?? 0,
				affectedRows: result.rowCount ?? 0,
			};

			return {
				success: true,
				data: {
					rows: result.rows as readonly TResult[],
					metadata,
				},
			};
		} catch (error) {
			return {
				success: false,
				error: this.mapPostgresError(error, undefined, sql),
			};
		}
	}

	/**
	 * Begin transaction
	 */
	async beginTransaction(): Promise<Result<Transaction, TransactionError>> {
		if (!this.pool) {
			return {
				success: false,
				error: new TransactionError("Not connected to database"),
			};
		}

		try {
			const client = await this.pool.connect();
			await client.query("BEGIN");

			const transaction = new PostgresTransaction(
				client,
				this,
				`tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
			);

			return { success: true, data: transaction };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new TransactionError(
					`Failed to begin transaction: ${message}`,
					error,
				),
			};
		}
	}

	/**
	 * Create table from schema
	 */
	async createTable(
		schema: SchemaDefinition,
	): Promise<Result<void, MigrationError>> {
		if (!this.pool) {
			return {
				success: false,
				error: new MigrationError("Not connected to database"),
			};
		}

		try {
			const columns: string[] = [];
			const foreignKeyConstraints: string[] = [];

			// Add fields
			for (const [fieldName, field] of Object.entries(schema.fields)) {
				if (field.type === "relation") continue;
				const columnDef = this.buildColumnDefinition(fieldName, field);
				columns.push(columnDef);

				// Collect FOREIGN KEY constraints from number fields with references
				if (field.type === "number" && field.references) {
					const col = this.getTranslator().escapeIdentifier(fieldName);
					const refTable = this.getTranslator().escapeIdentifier(
						field.references.table,
					);
					const refCol = this.getTranslator().escapeIdentifier(
						field.references.column ?? "id",
					);
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

			// Build CREATE TABLE statement
			const tableName = this.getTranslator().escapeIdentifier(
				schema.tableName!,
			);
			const allDefinitions = [...columns, ...foreignKeyConstraints];
			const sql = `CREATE TABLE ${tableName} (\n  ${allDefinitions.join(",\n  ")}\n)`;

			console.log("Creating Schema", { sql });
			await this.pool.query(sql);

			// Create indexes (including unique constraints)
			if (schema.indexes && schema.indexes.length > 0) {
				for (const index of schema.indexes) {
					const indexResult = await this.addIndex(
						schema.tableName!,
						index,
						schema,
					);
					if (!indexResult.success) {
						return indexResult;
					}
				}
			}

			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationError(
					`Failed to create table '${schema.name}': ${message}`,
					error,
				),
			};
		}
	}

	/**
	 * Drop table
	 */
	async dropTable(tableName: string): Promise<Result<void, MigrationError>> {
		if (!this.pool) {
			return {
				success: false,
				error: new MigrationError("Not connected to database"),
			};
		}

		try {
			const escapedTable = this.getTranslator().escapeIdentifier(tableName);
			await this.pool.query(`DROP TABLE IF EXISTS ${escapedTable}`);

			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationError(
					`Failed to drop table '${tableName}': ${message}`,
					error,
				),
			};
		}
	}

	/**
	 * Rename table
	 */
	async renameTable(
		from: string,
		to: string,
	): Promise<Result<void, MigrationError>> {
		if (!this.pool) {
			return {
				success: false,
				error: new MigrationError("Not connected to database"),
			};
		}

		try {
			const translator = this.getTranslator();
			const escapedFrom = translator.escapeIdentifier(from);
			const escapedTo = translator.escapeIdentifier(to);
			await this.pool.query(
				`ALTER TABLE ${escapedFrom} RENAME TO ${escapedTo}`,
			);

			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationError(
					`Failed to rename table '${from}' to '${to}': ${message}`,
					error,
				),
			};
		}
	}

	/**
	 * Alter table
	 */
	async alterTable(
		tableName: string,
		operations: readonly AlterOperation[],
	): Promise<Result<void, MigrationError>> {
		if (!this.pool) {
			return {
				success: false,
				error: new MigrationError("Not connected to database"),
			};
		}

		try {
			const escapedTable = this.getTranslator().escapeIdentifier(tableName);

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
						const columnName = this.getTranslator().escapeIdentifier(op.column);
						sql = `ALTER TABLE ${escapedTable} DROP COLUMN ${columnName}`;
						break;
					}

					case "modifyColumn": {
						// PostgreSQL uses ALTER COLUMN for modifications
						const columnName = this.getTranslator().escapeIdentifier(op.column);
						const pgType = getPostgresTypeWithModifiers(op.newDefinition.type);
						sql = `ALTER TABLE ${escapedTable} ALTER COLUMN ${columnName} TYPE ${pgType}`;
						break;
					}

					case "renameColumn": {
						const fromColumn = this.getTranslator().escapeIdentifier(op.from);
						const toColumn = this.getTranslator().escapeIdentifier(op.to);
						sql = `ALTER TABLE ${escapedTable} RENAME COLUMN ${fromColumn} TO ${toColumn}`;
						break;
					}
				}

				if (sql) {
					await this.pool.query(sql);
				}
			}

			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationError(
					`Failed to alter table '${tableName}': ${message}`,
					error,
				),
			};
		}
	}

	/**
	 * Add index
	 */
	async addIndex(
		tableNameParam: string,
		index: IndexDefinition,
		schema?: SchemaDefinition,
	): Promise<Result<void, MigrationError>> {
		if (!this.pool) {
			return {
				success: false,
				error: new MigrationError("Not connected to database"),
			};
		}

		try {
			const tableName = tableNameParam;
			const escapedTable = this.getTranslator().escapeIdentifier(tableName);
			const indexName =
				index.name ?? `idx_${tableName}_${index.fields.join("_")}`;
			const escapedIndexName = this.getTranslator().escapeIdentifier(indexName);

			// Map field names: if field is a relation, use foreignKey instead
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

			const fields = mappedFields
				.map((f) => this.getTranslator().escapeIdentifier(f))
				.join(", ");
			const unique = index.unique ? "UNIQUE " : "";
			const using = index.type ? ` USING ${index.type.toUpperCase()}` : "";
			const sql = `CREATE ${unique}INDEX ${escapedIndexName} ON ${escapedTable}${using} (${fields})`;
			await this.pool.query(sql);
			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationError(
					`Failed to add index on table '${tableNameParam}': ${message}`,
					error,
				),
			};
		}
	}

	/**
	 * Drop index
	 */
	async dropIndex(
		_tableName: string,
		indexName: string,
	): Promise<Result<void, MigrationError>> {
		if (!this.pool) {
			return {
				success: false,
				error: new MigrationError("Not connected to database"),
			};
		}

		try {
			const escapedIndexName = this.getTranslator().escapeIdentifier(indexName);
			await this.pool.query(`DROP INDEX IF EXISTS ${escapedIndexName}`);

			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationError(
					`Failed to drop index '${indexName}': ${message}`,
					error,
				),
			};
		}
	}

	/**
	 * Get all table names
	 */
	async getTables<TResult extends ForjaEntry>(): Promise<
		Result<readonly string[], QueryError<TResult>>
	> {
		if (!this.pool) {
			return {
				success: false,
				error: new QueryError("Not connected to database", {
					code: "CONNECTION_ERROR",
				}),
			};
		}

		try {
			const result = await this.pool.query<{ tablename: string }>(
				`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
			);

			const tables = result.rows.map(
				(row: { tablename: string }) => row.tablename,
			);
			return { success: true, data: tables };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new QueryError(`Failed to get tables: ${message}`, {
					details: error,
				}),
			};
		}
	}

	/**
	 * Get table schema (introspection)
	 */
	async getTableSchema<TResult extends ForjaEntry>(
		tableName: string,
	): Promise<Result<SchemaDefinition, QueryError<TResult>>> {
		if (!this.pool) {
			return {
				success: false,
				error: new QueryError("Not connected to database", {
					code: "CONNECTION_ERROR",
				}),
			};
		}

		try {
			// Query information_schema for column details
			const columnResult = await this.pool.query<{
				column_name: string;
				data_type: string;
				udt_name: string;
				is_nullable: string;
				column_default: string | null;
			}>(
				`SELECT column_name, data_type, udt_name, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = 'public'
         AND table_name = $1
         ORDER BY ordinal_position`,
				[tableName],
			);

			if (columnResult.rows.length === 0) {
				return {
					success: false,
					error: new QueryError(`Table '${tableName}' not found`, {
						code: "TABLE_NOT_FOUND",
					}),
				};
			}

			const fields: Record<string, FieldDefinition> = {};

			for (const row of columnResult.rows) {
				const fieldType = this.mapPostgresTypeToFieldType(
					row.data_type,
					row.udt_name,
				);

				const fieldDef = {
					type: fieldType,
					required: row.is_nullable === "NO",
					...(row.column_default !== null && {
						default: this.parsePostgresDefault(row.column_default),
					}),
				} as FieldDefinition;

				fields[row.column_name] = fieldDef;
			}

			return {
				success: true,
				data: {
					name: tableName,
					fields,
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new QueryError(
					`Failed to get table schema for '${tableName}': ${message}`,
					{ details: error },
				),
			};
		}
	}

	/**
	 * Map Postgres data type to Forja FieldType
	 */
	private mapPostgresTypeToFieldType(
		_dataType: string,
		udtName: string,
	): FieldType {
		const type = udtName.toLowerCase();

		if (
			type.includes("int") ||
			type.includes("float") ||
			type.includes("double") ||
			type.includes("numeric") ||
			type.includes("decimal") ||
			type.includes("real")
		) {
			return "number";
		}
		if (type.includes("bool")) {
			return "boolean";
		}
		if (
			type.includes("timestamp") ||
			type.includes("date") ||
			type.includes("time")
		) {
			return "date";
		}
		if (type.includes("json")) {
			return "json";
		}
		if (type.startsWith("_")) {
			return "array";
		}
		if (
			type === "uuid" ||
			type === "text" ||
			type === "varchar" ||
			type === "char" ||
			type === "bpchar"
		) {
			return "string";
		}

		return "string"; // Default to string
	}

	/**
	 * Parse Postgres default value string
	 */
	private parsePostgresDefault(defaultValue: string): unknown {
		if (defaultValue === null) return undefined;

		// Remove type cast (e.g., 'active'::character varying -> 'active')
		let cleaned = defaultValue.split("::")[0];

		// Remove single quotes for strings
		if (cleaned && cleaned.startsWith("'") && cleaned.endsWith("'")) {
			cleaned = cleaned.substring(1, cleaned.length - 1);
		}

		// Common function defaults
		if (
			cleaned &&
			(cleaned.toUpperCase().includes("NOW()") ||
				cleaned.toUpperCase().includes("CURRENT_TIMESTAMP"))
		) {
			return "NOW()";
		}

		// Numeric and boolean defaults
		if (cleaned === "true") return true;
		if (cleaned === "false") return false;

		const num = Number(cleaned);
		if (!isNaN(num) && cleaned !== "") return num;

		return cleaned;
	}

	/**
	 * Check if table exists
	 */
	async tableExists(tableName: string): Promise<boolean> {
		if (!this.pool) {
			return false;
		}

		try {
			const result = await this.pool.query<{ exists: boolean }>(
				`SELECT EXISTS (
          SELECT FROM pg_tables
          WHERE schemaname = 'public'
          AND tablename = $1
        ) as exists`,
				[tableName],
			);

			return result.rows[0]?.exists ?? false;
		} catch {
			return false;
		}
	}

	/**
	 * Build column definition for CREATE/ALTER TABLE
	 */
	private buildColumnDefinition(
		fieldName: string,
		field: FieldDefinition,
	): string {
		const columnName = this.getTranslator().escapeIdentifier(fieldName);

		// Check if field should be auto-increment
		const shouldAutoIncrement = field.type === "number" && field.autoIncrement;

		if (shouldAutoIncrement) {
			return `${columnName} SERIAL PRIMARY KEY`;
		}

		const pgType = getPostgresTypeWithModifiers(field.type);
		const nullable = field.required ? " NOT NULL" : "";
		const defaultValue =
			field.default !== undefined
				? ` DEFAULT ${this.getTranslator().escapeValue(field.default)}`
				: "";

		return `${columnName} ${pgType}${nullable}${defaultValue}`;
	}
}

/**
 * PostgreSQL transaction implementation
 *
 * Delegates query execution to adapter's executeQuery with the transaction's client.
 * This eliminates code duplication (validate, populate, count parse, id mapping).
 */
class PostgresTransaction implements Transaction {
	readonly id: string;
	private client: PoolClient;
	private adapter: PostgresAdapter;
	private committed = false;
	private rolledBack = false;
	private aborted = false;

	constructor(client: PoolClient, adapter: PostgresAdapter, id: string) {
		this.client = client;
		this.adapter = adapter;
		this.id = id;
	}

	/**
	 * Execute query within transaction
	 *
	 * Delegates to adapter.executeQuery with this transaction's client,
	 * reusing all query logic (validation, populate, count parse, id mapping).
	 */
	async executeQuery<TResult extends ForjaEntry>(
		query: QueryObject<TResult>,
	): Promise<Result<QueryResult<TResult>, QueryError<TResult>>> {
		if (this.committed || this.rolledBack) {
			return {
				success: false,
				error: new QueryError("Transaction already completed", { query }),
			};
		}

		if (this.aborted) {
			return {
				success: false,
				error: new QueryError(
					"current transaction is aborted, commands ignored until end of transaction block",
					{ query },
				),
			};
		}

		const result = await this.adapter.executeQuery<TResult>(query, this.client);
		if (!result.success) {
			this.aborted = true;
		}
		return result;
	}

	/**
	 * Execute raw SQL within transaction
	 */
	async executeRawQuery<TResult extends ForjaEntry>(
		sql: string,
		params: readonly unknown[],
	): Promise<Result<QueryResult<TResult>, QueryError<TResult>>> {
		if (this.committed || this.rolledBack) {
			return {
				success: false,
				error: new QueryError("Transaction already completed", { sql }),
			};
		}

		if (this.aborted) {
			return {
				success: false,
				error: new QueryError(
					"current transaction is aborted, commands ignored until end of transaction block",
					{ sql },
				),
			};
		}

		try {
			const result = await this.client.query(sql, params as unknown[]);

			const metadata: QueryMetadata = {
				rowCount: result.rowCount ?? 0,
				affectedRows: result.rowCount ?? 0,
			};

			return {
				success: true,
				data: {
					rows: result.rows as readonly TResult[],
					metadata,
				},
			};
		} catch (error) {
			this.aborted = true;
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new QueryError(`Raw query failed: ${message}`, {
					sql,
					details: error,
				}),
			};
		}
	}

	/**
	 * Commit transaction
	 */
	async commit(): Promise<Result<void, TransactionError>> {
		if (this.committed) {
			return {
				success: false,
				error: new TransactionError("Transaction already committed"),
			};
		}

		if (this.rolledBack) {
			return {
				success: false,
				error: new TransactionError("Transaction already rolled back"),
			};
		}

		try {
			await this.client.query("COMMIT");
			this.committed = true;
			this.client.release();

			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new TransactionError(
					`Failed to commit transaction: ${message}`,
					error,
				),
			};
		}
	}

	/**
	 * Rollback transaction
	 */
	async rollback(): Promise<Result<void, TransactionError>> {
		if (this.committed) {
			return {
				success: false,
				error: new TransactionError("Transaction already committed"),
			};
		}

		if (this.rolledBack) {
			return {
				success: false,
				error: new TransactionError("Transaction already rolled back"),
			};
		}

		try {
			await this.client.query("ROLLBACK");
			this.rolledBack = true;
			this.client.release();

			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new TransactionError(
					`Failed to rollback transaction: ${message}`,
					error,
				),
			};
		}
	}

	/**
	 * Create savepoint
	 */
	async savepoint(name: string): Promise<Result<void, TransactionError>> {
		try {
			const escapedName = this.adapter.getTranslator().escapeIdentifier(name);
			await this.client.query(`SAVEPOINT ${escapedName}`);
			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new TransactionError(
					`Failed to create savepoint '${name}': ${message}`,
					error,
				),
			};
		}
	}

	/**
	 * Rollback to savepoint
	 */
	async rollbackTo(name: string): Promise<Result<void, TransactionError>> {
		try {
			const escapedName = this.adapter.getTranslator().escapeIdentifier(name);
			await this.client.query(`ROLLBACK TO SAVEPOINT ${escapedName}`);
			this.aborted = false;
			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new TransactionError(
					`Failed to rollback to savepoint '${name}': ${message}`,
					error,
				),
			};
		}
	}

	/**
	 * Release savepoint
	 */
	async release(name: string): Promise<Result<void, TransactionError>> {
		try {
			const escapedName = this.adapter.getTranslator().escapeIdentifier(name);
			await this.client.query(`RELEASE SAVEPOINT ${escapedName}`);
			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new TransactionError(
					`Failed to release savepoint '${name}': ${message}`,
					error,
				),
			};
		}
	}
}

/**
 * Create PostgreSQL adapter
 */
export function createPostgresAdapter(config: PostgresConfig): PostgresAdapter {
	return new PostgresAdapter(config);
}
