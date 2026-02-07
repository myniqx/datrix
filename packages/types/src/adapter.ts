/**
 * Database Adapter Interface
 *
 * This file defines the standard interface that ALL database adapters must implement.
 * Adapters provide database-specific implementations for PostgreSQL, MySQL, MongoDB, etc.
 */

import { QueryObject, WhereClause } from "./core/query-builder";
import {
	FieldDefinition,
	ForjaEntry,
	IndexDefinition,
	SchemaDefinition,
} from "./core/schema";
import { Result } from "./utils";
import { ForjaError } from "./errors";

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
 * Allows executor to accept either one without caring about the source.
 */
export interface QueryRunner {
	executeQuery<TResult extends ForjaEntry>(
		query: QueryObject<TResult>,
	): Promise<Result<QueryResult<TResult>, QueryError>>;

	executeRawQuery<TResult extends ForjaEntry>(
		sql: string,
		params: readonly unknown[],
	): Promise<Result<QueryResult<TResult>, QueryError>>;
}

/**
 * Transaction interface
 */
export interface Transaction extends QueryRunner {
	readonly id: string;

	commit(): Promise<Result<void, TransactionError>>;
	rollback(): Promise<Result<void, TransactionError>>;

	// Savepoints
	savepoint(name: string): Promise<Result<void, TransactionError>>;
	rollbackTo(name: string): Promise<Result<void, TransactionError>>;
	release(name: string): Promise<Result<void, TransactionError>>;
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
 * ALL database adapters MUST implement this interface
 */
export interface DatabaseAdapter<TConfig = Record<string, unknown>> extends QueryRunner {
	// Metadata
	readonly name: string;
	readonly config: TConfig;

	// Connection management
	connect(): Promise<Result<void, ConnectionError>>;
	disconnect(): Promise<Result<void, ConnectionError>>;
	isConnected(): boolean;
	getConnectionState(): ConnectionState;

	// Transaction support
	beginTransaction(): Promise<Result<Transaction, TransactionError>>;

	// Schema operations (for migrations)
	createTable(schema: SchemaDefinition): Promise<Result<void, MigrationError>>;
	dropTable(tableName: string): Promise<Result<void, MigrationError>>;
	alterTable(
		tableName: string,
		operations: readonly AlterOperation[],
	): Promise<Result<void, MigrationError>>;

	// Index operations
	addIndex(
		tableName: string,
		index: IndexDefinition,
	): Promise<Result<void, MigrationError>>;
	dropIndex(
		tableName: string,
		indexName: string,
	): Promise<Result<void, MigrationError>>;

	// Introspection
	getTables(): Promise<Result<readonly string[], QueryError>>;
	getTableSchema(
		tableName: string,
	): Promise<Result<SchemaDefinition, QueryError>>;
	tableExists(tableName: string): Promise<boolean>;
}

/**
 * Base error class for adapters
 */
export class AdapterError<
	TContext extends Record<string, unknown> = Record<string, unknown>,
> extends ForjaError<TContext> {
	constructor(
		message: string,
		options?: {
			code?: string;
			details?: unknown;
			context?: TContext;
			cause?: Error;
			suggestion?: string;
			expected?: string;
			received?: unknown;
		},
	) {
		super(message, {
			code: options?.code ?? "ADAPTER_ERROR",
			operation: "adapter",
			context: options?.context,
			cause: options?.cause,
			suggestion: options?.suggestion,
			expected: options?.expected,
			received: options?.received,
		});
		this.name = "AdapterError";
	}
}

/**
 * Connection error
 */
export class ConnectionError extends AdapterError {
	constructor(message: string, details?: unknown) {
		super(message, { code: "CONNECTION_ERROR", details });
		this.name = "ConnectionError";
	}
}

/**
 * Query error
 */
export class QueryError<
	T extends ForjaEntry = ForjaEntry,
> extends AdapterError {
	readonly query: QueryObject<T> | undefined;
	readonly sql: string | undefined;

	constructor(
		message: string,
		options?: {
			code?: string;
			query?: QueryObject<T> | undefined;
			sql?: string | undefined;
			details?: unknown;
		},
	) {
		super(message, {
			code: options?.code ?? "QUERY_ERROR",
			details: options?.details,
		});
		this.name = "QueryError";
		this.query = options?.query;
		this.sql = options?.sql;
	}
}

/**
 * Transaction error
 */
export class TransactionError extends AdapterError {
	constructor(message: string, details?: unknown) {
		super(message, { code: "TRANSACTION_ERROR", details });
		this.name = "TransactionError";
	}
}

/**
 * Migration error
 */
export class MigrationError extends AdapterError {
	constructor(message: string, details?: unknown) {
		super(message, { code: "MIGRATION_ERROR", details });
		this.name = "MigrationError";
	}
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
