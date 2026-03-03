/**
 * Database Adapter Interface
 *
 * This file defines the standard interface that ALL database adapters must implement.
 * Adapters provide database-specific implementations for PostgreSQL, MySQL, MongoDB, etc.
 *
 * Error handling: All methods throw ForjaAdapterError on failure instead of returning Result.
 */

import { QueryObject, WhereClause } from "./core/query-builder";
import {
	FieldDefinition,
	ForjaEntry,
	IndexDefinition,
	SchemaDefinition,
} from "./core/schema";
import { ForjaAdapterError } from "./errors/adapter";

export { ForjaAdapterError };

/**
 * Query result metadata
 */
export interface QueryMetadata {
	readonly rowCount?: number;
	readonly affectedRows?: number;
	readonly insertIds?: readonly number[];
	readonly count?: number;
}

/**
 * Query result
 */
export interface QueryResult<T = unknown> {
	readonly rows: readonly T[];
	readonly metadata: QueryMetadata;
}

/**
 * Common query execution interface shared by DatabaseAdapter and Transaction.
 */
export interface QueryRunner {
	executeQuery<TResult extends ForjaEntry>(
		query: QueryObject<TResult>,
	): Promise<QueryResult<TResult>>;

	executeRawQuery<TResult extends ForjaEntry>(
		sql: string,
		params: readonly unknown[],
	): Promise<QueryResult<TResult>>;
}

/**
 * Schema operations interface - shared by DatabaseAdapter and Transaction.
 * Migrations should use Transaction for atomic DDL operations.
 */
export interface SchemaOperations {
	createTable(schema: SchemaDefinition): Promise<void>;
	dropTable(tableName: string): Promise<void>;
	renameTable(from: string, to: string): Promise<void>;
	alterTable(
		tableName: string,
		operations: readonly AlterOperation[],
	): Promise<void>;
	addIndex(tableName: string, index: IndexDefinition): Promise<void>;
	dropIndex(tableName: string, indexName: string): Promise<void>;
}

/**
 * Transaction interface
 *
 * Extends both QueryRunner and SchemaOperations to support:
 * - Query execution within transaction
 * - Schema modifications within transaction (for atomic migrations)
 */
export interface Transaction extends QueryRunner, SchemaOperations {
	readonly id: string;

	commit(): Promise<void>;
	rollback(): Promise<void>;

	// Savepoints
	savepoint(name: string): Promise<void>;
	rollbackTo(name: string): Promise<void>;
	release(name: string): Promise<void>;
}

/**
 * Alter table operations
 */
export type AlterOperation =
	| {
			readonly type: "addColumn";
			readonly column: string;
			readonly definition: FieldDefinition;
	  }
	| { readonly type: "dropColumn"; readonly column: string }
	| {
			readonly type: "modifyColumn";
			readonly column: string;
			readonly newDefinition: FieldDefinition;
	  }
	| {
			readonly type: "renameColumn";
			readonly from: string;
			readonly to: string;
	  };

/**
 * Connection state
 */
export type ConnectionState =
	| "disconnected"
	| "connecting"
	| "connected"
	| "error";

/**
 * Database adapter interface
 *
 * ALL database adapters MUST implement this interface.
 * Extends QueryRunner for query execution and SchemaOperations for DDL.
 *
 * Note: For migrations, prefer using Transaction (from beginTransaction())
 * to ensure atomic DDL operations where supported by the database.
 */
export interface DatabaseAdapter<TConfig = Record<string, unknown>>
	extends QueryRunner, SchemaOperations {
	// Metadata
	readonly name: string;
	readonly config: TConfig;

	// Connection management
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	isConnected(): boolean;
	getConnectionState(): ConnectionState;

	// Transaction support
	beginTransaction(): Promise<Transaction>;

	// Introspection
	getTables(): Promise<readonly string[]>;
	getTableSchema(tableName: string): Promise<SchemaDefinition>;
	tableExists(tableName: string): Promise<boolean>;
}

/**
 * Type guard for DatabaseAdapter
 */
export function isDatabaseAdapter(value: unknown): value is DatabaseAdapter {
	return (
		typeof value === "object" &&
		value !== null &&
		"name" in value &&
		"config" in value &&
		"connect" in value &&
		"disconnect" in value &&
		"executeQuery" in value &&
		typeof (value as DatabaseAdapter).connect === "function" &&
		typeof (value as DatabaseAdapter).disconnect === "function" &&
		typeof (value as DatabaseAdapter).executeQuery === "function"
	);
}

/**
 * Adapter factory type
 */
export type AdapterFactory<TConfig = Record<string, unknown>> = (
	config: TConfig,
) => DatabaseAdapter<TConfig>;

/**
 * Registered adapters
 */
export type AdapterRegistry = {
	readonly postgres?: AdapterFactory;
	readonly mysql?: AdapterFactory;
	readonly mongodb?: AdapterFactory;
};

/**
 * Adapter name
 */
export type AdapterName = keyof AdapterRegistry;

/**
 * Query builder context
 */
export interface QueryBuilderContext {
	readonly schema: SchemaDefinition;
	readonly adapter: DatabaseAdapter;
}

/**
 * SQL parameter placeholder style
 */
export type ParameterStyle =
	| "numbered" // PostgreSQL: $1, $2, $3
	| "question" // MySQL: ?, ?, ?
	| "named"; // Named: :param1, :param2

/**
 * SQL dialect
 */
export type SqlDialect = "postgres" | "mysql" | "sqlite";

/**
 * Query translator interface
 */
export interface QueryTranslator<T extends ForjaEntry = ForjaEntry> {
	translate(query: QueryObject<T>): {
		readonly sql: string;
		readonly params: readonly unknown[];
	};

	translateWhere(
		where: WhereClause<T>,
		startIndex: number,
	): {
		readonly sql: string;
		readonly params: readonly unknown[];
	};

	escapeIdentifier(identifier: string): string;
	escapeValue(value: unknown): string;
	getParameterPlaceholder(index: number): string;
}
