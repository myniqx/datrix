/**
 * PostgreSQL Database Adapter
 *
 * Main adapter implementation for PostgreSQL.
 * Handles connection pooling, query execution, transactions, and schema operations.
 */

import type { Pool, PoolClient, QueryResultRow } from "pg";
import { Pool as PgPool } from "pg";

import { PostgresQueryTranslator } from "./query-translator";
import type { PostgresConfig } from "./types";
import { getPostgresTypeWithModifiers } from "./types";
import { QueryObject } from "@forja/types/core/query-builder";
import {
	AlterOperation,
	ConnectionState,
	DatabaseAdapter,
	QueryMetadata,
	QueryResult,
	Transaction,
} from "@forja/types/adapter";
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
} from "@forja/types/errors/adapter";
import { validateQueryObject } from "@forja/types/utils/query";
import {
	FieldDefinition,
	ForjaEntry,
	IndexDefinition,
	ISchemaRegistry,
	SchemaDefinition,
} from "@forja/types/core/schema";
import {
	FORJA_META_MODEL,
	FORJA_META_KEY_PREFIX,
} from "@forja/types/core/constants";
import { PostgresPopulator } from "./populate";
import { PgClient } from "./pg-client";
import { PostgresExporter } from "./export-import/exporter";
import { PostgresImporter } from "./export-import/importer";
import { ExportWriter, ImportReader } from "@forja/types/adapter";

/**
 * PostgreSQL adapter implementation
 */
export class PostgresAdapter implements DatabaseAdapter<PostgresConfig> {
	readonly name = "postgres";
	readonly config: PostgresConfig;

	private pool: Pool | undefined;
	private state: ConnectionState = "disconnected";
	private _schemas: ISchemaRegistry | undefined;
	private _translator: PostgresQueryTranslator | undefined;

	getTranslator(): PostgresQueryTranslator {
		return this._translator!;
	}

	constructor(config: PostgresConfig) {
		this.config = config;
	}

	/**
	 * Connect to PostgreSQL
	 */
	async connect(schemas: ISchemaRegistry): Promise<void> {
		if (this.state === "connected") {
			return;
		}
		this.state = "connecting";
		this._schemas = schemas;
		this._translator = new PostgresQueryTranslator(schemas);

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

			const client = await this.pool.connect();
			client.release();

			this.state = "connected";
		} catch (error) {
			this.state = "error";
			const message = error instanceof Error ? error.message : String(error);
			throwConnectionError({
				adapter: "postgres",
				message: `Failed to connect to PostgreSQL: ${message}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Disconnect from PostgreSQL
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
				adapter: "postgres",
				message: `Failed to disconnect from PostgreSQL: ${message}`,
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
	 * @param client - Optional PoolClient for transaction support. If provided, query runs on this client instead of pool.
	 */
	async executeQuery<TResult extends ForjaEntry>(
		query: QueryObject<TResult>,
		client?: PoolClient,
	): Promise<QueryResult<TResult>> {
		validateQueryObject(query);

		const queryRunner = client ?? this.pool;

		if (!queryRunner) {
			throwNotConnected({ adapter: "postgres" });
		}

		const pgClient = new PgClient(queryRunner!, query as any);
		let lastSql: string | undefined;

		try {
			if (query.type === "select" && query.populate) {
				const populator = new PostgresPopulator(
					pgClient,
					this.getTranslator(),
					this._schemas!,
				);

				const rows = await populator.populate<TResult>(query);
				const metadata: QueryMetadata = {
					rowCount: rows.length,
					affectedRows: 0,
				};
				return { rows, metadata };
			}

			const { sql, params } = this.getTranslator().translate(query);
			lastSql = sql;
			const result = await pgClient.query<QueryResultRow>(
				sql,
				params as unknown[],
			);

			if (query.type === "select") {
				const rows = result.rows as unknown as readonly TResult[];
				const metadata: QueryMetadata = {
					rowCount: rows.length,
					affectedRows: 0,
				};
				return { rows, metadata };
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
				return { rows: [] as TResult[], metadata };
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

			return { rows: idRows, metadata };
		} catch (error) {
			throw this.mapPostgresError(error, query, lastSql);
		}
	}

	/**
	 * Map Postgres errors to standardized ForjaAdapterError
	 */
	private mapPostgresError<TResult extends ForjaEntry>(
		error: unknown,
		query?: QueryObject<TResult>,
		sql?: string,
	): ForjaAdapterError {
		if (error instanceof ForjaAdapterError) {
			return error;
		}

		const message = error instanceof Error ? error.message : String(error);
		const details = error as {
			code?: string;
			severity?: string;
			detail?: string;
			hint?: string;
		};

		return new ForjaAdapterError(`Query execution failed: ${message}`, {
			adapter: "postgres",
			code: "ADAPTER_QUERY_ERROR",
			operation: "query",
			context: {
				...(query && { query: { type: query.type, table: query.table } }),
				...(sql && { sql }),
				...(details.code && { pgCode: details.code }),
				...(details.severity && { pgSeverity: details.severity }),
				...(details.detail && { pgDetail: details.detail }),
				...(details.hint && { pgHint: details.hint }),
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
	): Promise<QueryResult<TResult>> {
		if (!this.pool) {
			throwNotConnected({ adapter: "postgres" });
		}

		try {
			const result = await this.pool!.query(sql, params as unknown[]);

			const metadata: QueryMetadata = {
				rowCount: result.rowCount ?? 0,
				affectedRows: result.rowCount ?? 0,
			};

			return {
				rows: result.rows as readonly TResult[],
				metadata,
			};
		} catch (error) {
			throw this.mapPostgresError(error, undefined, sql);
		}
	}

	/**
	 * Begin transaction
	 */
	async beginTransaction(): Promise<Transaction> {
		if (!this.pool) {
			throwNotConnected({ adapter: "postgres" });
		}

		try {
			const client = await this.pool!.connect();
			await client.query("BEGIN");

			const transaction = new PostgresTransaction(
				client,
				this,
				`tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
			);

			return transaction;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwTransactionError({
				adapter: "postgres",
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
		client?: PoolClient,
		options?: {
			/**
			 * Set to true when called from the importer.
			 * Skips FK constraint creation (added later via ALTER TABLE) and
			 * skips upsertSchemaMeta so the importer can restore _forja data as-is.
			 */
			isImport?: boolean;
		},
	): Promise<void> {
		const queryRunner = client ?? this.pool;
		if (!queryRunner) {
			throwNotConnected({ adapter: "postgres" });
		}

		try {
			const columns: string[] = [];
			const foreignKeyConstraints: string[] = [];

			for (const [fieldName, field] of Object.entries(schema.fields)) {
				if (field.type === "relation") continue;
				const columnDef = this.buildColumnDefinition(fieldName, field);
				columns.push(columnDef);

				if (!options?.isImport && field.type === "number" && field.references) {
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

			const tableName = this.getTranslator().escapeIdentifier(
				schema.tableName!,
			);
			const allDefinitions = [...columns, ...foreignKeyConstraints];
			const sql = `CREATE TABLE ${tableName} (\n  ${allDefinitions.join(",\n  ")}\n)`;

			await queryRunner!.query(sql);

			if (schema.indexes && schema.indexes.length > 0) {
				for (const index of schema.indexes) {
					await this.addIndex(schema.tableName!, index, schema, client);
				}
			}

			if (!options?.isImport && schema.name !== FORJA_META_MODEL) {
				const metaExists = await this.tableExists(FORJA_META_MODEL);
				if (!metaExists) {
					throwMigrationError({
						adapter: "postgres",
						message: `Cannot create table '${schema.name}': '${FORJA_META_MODEL}' table does not exist yet. Create '${FORJA_META_MODEL}' first.`,
					});
				}

				await this.upsertSchemaMeta(schema, queryRunner!);
			}
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throwMigrationError({
				adapter: "postgres",
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
		client?: PoolClient,
		options?: { isImport?: boolean },
	): Promise<void> {
		const queryRunner = client ?? this.pool;
		if (!queryRunner) {
			throwNotConnected({ adapter: "postgres" });
		}

		try {
			const escapedTable = this.getTranslator().escapeIdentifier(tableName);
			await queryRunner!.query(`DROP TABLE IF EXISTS ${escapedTable}`);

			// Remove schema from _forja (skip during import — _forja data will be restored as-is)
			if (!options?.isImport && tableName !== FORJA_META_MODEL) {
				const metaKey = `${FORJA_META_KEY_PREFIX}${tableName}`;
				const escapedMetaTable =
					this.getTranslator().escapeIdentifier(FORJA_META_MODEL);
				await queryRunner!.query(
					`DELETE FROM ${escapedMetaTable} WHERE "key" = $1`,
					[metaKey],
				);
			}
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throwMigrationError({
				adapter: "postgres",
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
		client?: PoolClient,
	): Promise<void> {
		const queryRunner = client ?? this.pool;
		if (!queryRunner) {
			throwNotConnected({ adapter: "postgres" });
		}

		try {
			const translator = this.getTranslator();
			const escapedFrom = translator.escapeIdentifier(from);
			const escapedTo = translator.escapeIdentifier(to);
			await queryRunner!.query(
				`ALTER TABLE ${escapedFrom} RENAME TO ${escapedTo}`,
			);

			if (from !== FORJA_META_MODEL && to !== FORJA_META_MODEL) {
				const oldKey = `${FORJA_META_KEY_PREFIX}${from}`;
				const newKey = `${FORJA_META_KEY_PREFIX}${to}`;
				const escapedMetaTable = translator.escapeIdentifier(FORJA_META_MODEL);
				await queryRunner!.query(
					`UPDATE ${escapedMetaTable} SET "key" = $1 WHERE "key" = $2`,
					[newKey, oldKey],
				);
			}
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throwMigrationError({
				adapter: "postgres",
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
		client?: PoolClient,
	): Promise<void> {
		const queryRunner = client ?? this.pool;
		if (!queryRunner) {
			throwNotConnected({ adapter: "postgres" });
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
						const columnName = this.getTranslator().escapeIdentifier(op.column);
						const pgType = getPostgresTypeWithModifiers(op.newDefinition);
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
					await queryRunner!.query(sql);
				}
			}

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
				adapter: "postgres",
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
		client?: PoolClient,
	): Promise<void> {
		const queryRunner = client ?? this.pool;
		if (!queryRunner) {
			throwNotConnected({ adapter: "postgres" });
		}

		try {
			const tableName = tableNameParam;
			const escapedTable = this.getTranslator().escapeIdentifier(tableName);
			const indexName =
				index.name ?? `idx_${tableName}_${index.fields.join("_")}`;
			const escapedIndexName = this.getTranslator().escapeIdentifier(indexName);

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
			await queryRunner!.query(sql);
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throwMigrationError({
				adapter: "postgres",
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
		_tableName: string,
		indexName: string,
		client?: PoolClient,
	): Promise<void> {
		const queryRunner = client ?? this.pool;
		if (!queryRunner) {
			throwNotConnected({ adapter: "postgres" });
		}

		try {
			const escapedIndexName = this.getTranslator().escapeIdentifier(indexName);
			await queryRunner!.query(`DROP INDEX IF EXISTS ${escapedIndexName}`);
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throwMigrationError({
				adapter: "postgres",
				message: `Failed to drop index '${indexName}': ${message}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Get all table names
	 */
	async getTables(): Promise<readonly string[]> {
		if (!this.pool) {
			throwNotConnected({ adapter: "postgres" });
		}

		try {
			const result = await this.pool!.query<{ tablename: string }>(
				`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
			);

			return result.rows.map((row: { tablename: string }) => row.tablename);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwIntrospectionError({
				adapter: "postgres",
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
			throwNotConnected({ adapter: "postgres" });
		}

		try {
			const metaKey = `${FORJA_META_KEY_PREFIX}${tableName}`;
			const escapedMetaTable =
				this.getTranslator().escapeIdentifier(FORJA_META_MODEL);
			const metaResult = await this.pool!.query<{ value: string }>(
				`SELECT "value" FROM ${escapedMetaTable} WHERE "key" = $1`,
				[metaKey],
			);

			if (metaResult.rows.length === 0) {
				return null;
			}

			return JSON.parse(metaResult.rows[0]!.value) as SchemaDefinition;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwIntrospectionError({
				adapter: "postgres",
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
	 * Upsert schema into _forja metadata table
	 */
	private async upsertSchemaMeta(
		schema: SchemaDefinition,
		queryRunner: Pool | PoolClient,
	): Promise<void> {
		const metaKey = `${FORJA_META_KEY_PREFIX}${schema.tableName ?? schema.name}`;
		const metaValue = JSON.stringify(schema);
		const escapedMetaTable =
			this.getTranslator().escapeIdentifier(FORJA_META_MODEL);
		await queryRunner.query(
			`INSERT INTO ${escapedMetaTable} ("key", "value", "createdAt", "updatedAt")
			 VALUES ($1, $2, NOW(), NOW())
			 ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()`,
			[metaKey, metaValue],
		);
	}

	/**
	 * Read schema from _forja, apply AlterOperations, write back
	 */
	private async applyOperationsToMetaSchema(
		tableName: string,
		operations: readonly AlterOperation[],
		queryRunner: Pool | PoolClient,
	): Promise<void> {
		const metaKey = `${FORJA_META_KEY_PREFIX}${tableName}`;
		const escapedMetaTable =
			this.getTranslator().escapeIdentifier(FORJA_META_MODEL);
		const metaResult = await queryRunner.query<{ value: string }>(
			`SELECT "value" FROM ${escapedMetaTable} WHERE "key" = $1`,
			[metaKey],
		);

		if (metaResult.rows.length === 0) {
			throwMigrationError({
				adapter: "postgres",
				message: `Schema meta for table '${tableName}' not found in _forja`,
				table: tableName,
			});
		}

		const schema = JSON.parse(metaResult.rows[0]!.value) as SchemaDefinition;
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
							adapter: "postgres",
							field: op.field,
							table: tableName,
						});
					}
					fields[op.field] = op.definition;
					break;
				case "dropMetaField":
					if (fields[op.field] === undefined) {
						throwMetaFieldNotFound({
							adapter: "postgres",
							field: op.field,
							table: tableName,
						});
					}
					delete fields[op.field];
					break;
				case "modifyMetaField":
					if (fields[op.field] === undefined) {
						throwMetaFieldNotFound({
							adapter: "postgres",
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
		await queryRunner.query(
			`UPDATE ${escapedMetaTable} SET "value" = $1, "updatedAt" = NOW() WHERE "key" = $2`,
			[updatedValue, metaKey],
		);
	}

	async exportData(writer: ExportWriter): Promise<void> {
		await new PostgresExporter(this.pool!, this).export(writer);
	}

	async importData(reader: ImportReader): Promise<void> {
		await new PostgresImporter(this.pool!, this).import(reader);
	}

	/**
	 * Build column definition for CREATE/ALTER TABLE
	 */
	private buildColumnDefinition(
		fieldName: string,
		field: FieldDefinition,
	): string {
		const columnName = this.getTranslator().escapeIdentifier(fieldName);

		const shouldAutoIncrement = field.type === "number" && field.autoIncrement;

		if (shouldAutoIncrement) {
			return `${columnName} SERIAL PRIMARY KEY`;
		}

		const pgType = getPostgresTypeWithModifiers(field);
		const nullable = field.required ? " NOT NULL" : "";
		const defaultValue =
			field.default !== undefined
				? ` DEFAULT ${this.getTranslator().escapeValue(field.default)}`
				: "";

		const unique = "unique" in field && field.unique ? " UNIQUE" : "";

		return `${columnName} ${pgType}${nullable}${defaultValue}${unique}`;
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
	 */
	async executeQuery<TResult extends ForjaEntry>(
		query: QueryObject<TResult>,
	): Promise<QueryResult<TResult>> {
		if (this.committed || this.rolledBack) {
			throwQueryError({
				adapter: "postgres",
				message: "Transaction already completed",
				query: query as QueryObject,
			});
		}

		if (this.aborted) {
			throwQueryError({
				adapter: "postgres",
				message:
					"current transaction is aborted, commands ignored until end of transaction block",
				query: query as QueryObject,
			});
		}

		try {
			return await this.adapter.executeQuery<TResult>(query, this.client);
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
				adapter: "postgres",
				message: "Transaction already completed",
				sql,
			});
		}

		if (this.aborted) {
			throwQueryError({
				adapter: "postgres",
				message:
					"current transaction is aborted, commands ignored until end of transaction block",
				sql,
			});
		}

		try {
			const result = await this.client.query(sql, params as unknown[]);

			const metadata: QueryMetadata = {
				rowCount: result.rowCount ?? 0,
				affectedRows: result.rowCount ?? 0,
			};

			return {
				rows: result.rows as readonly TResult[],
				metadata,
			};
		} catch (error) {
			this.aborted = true;
			const message = error instanceof Error ? error.message : String(error);
			throwQueryError({
				adapter: "postgres",
				message: `Raw query failed: ${message}`,
				sql,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Commit transaction
	 */
	async commit(): Promise<void> {
		if (this.committed) {
			throwTransactionError({
				adapter: "postgres",
				message: "Transaction already committed",
			});
		}

		if (this.rolledBack) {
			throwTransactionError({
				adapter: "postgres",
				message: "Transaction already rolled back",
			});
		}

		try {
			await this.client.query("COMMIT");
			this.committed = true;
			this.client.release();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwTransactionError({
				adapter: "postgres",
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
				adapter: "postgres",
				message: "Transaction already committed",
			});
		}

		if (this.rolledBack) {
			throwTransactionError({
				adapter: "postgres",
				message: "Transaction already rolled back",
			});
		}

		try {
			await this.client.query("ROLLBACK");
			this.rolledBack = true;
			this.client.release();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwTransactionError({
				adapter: "postgres",
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
			const escapedName = this.adapter.getTranslator().escapeIdentifier(name);
			await this.client.query(`SAVEPOINT ${escapedName}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwTransactionError({
				adapter: "postgres",
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
			const escapedName = this.adapter.getTranslator().escapeIdentifier(name);
			await this.client.query(`ROLLBACK TO SAVEPOINT ${escapedName}`);
			this.aborted = false;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwTransactionError({
				adapter: "postgres",
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
			const escapedName = this.adapter.getTranslator().escapeIdentifier(name);
			await this.client.query(`RELEASE SAVEPOINT ${escapedName}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwTransactionError({
				adapter: "postgres",
				message: `Failed to release savepoint '${name}': ${message}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	async createTable(schema: SchemaDefinition): Promise<void> {
		return this.adapter.createTable(schema, this.client);
	}

	async dropTable(tableName: string): Promise<void> {
		return this.adapter.dropTable(tableName, this.client);
	}

	async renameTable(from: string, to: string): Promise<void> {
		return this.adapter.renameTable(from, to, this.client);
	}

	async alterTable(
		tableName: string,
		operations: readonly AlterOperation[],
	): Promise<void> {
		return this.adapter.alterTable(tableName, operations, this.client);
	}

	async addIndex(tableName: string, index: IndexDefinition): Promise<void> {
		return this.adapter.addIndex(tableName, index, undefined, this.client);
	}

	async dropIndex(tableName: string, indexName: string): Promise<void> {
		return this.adapter.dropIndex(tableName, indexName, this.client);
	}
}

/**
 * Create PostgreSQL adapter
 */
export function createPostgresAdapter(config: PostgresConfig): PostgresAdapter {
	return new PostgresAdapter(config);
}
