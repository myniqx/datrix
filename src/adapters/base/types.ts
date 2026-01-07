/**
 * Database Adapter Interface
 *
 * This file defines the standard interface that ALL database adapters must implement.
 * Adapters provide database-specific implementations for PostgreSQL, MySQL, MongoDB, etc.
 */

import type { Result } from '@utils/types';
import type { SchemaDefinition, FieldDefinition } from '@core/schema/types';

/**
 * Query object types
 */
export type QueryType = 'select' | 'insert' | 'update' | 'delete' | 'count';

/**
 * Comparison operators
 */
export interface ComparisonOperators {
  readonly $eq?: Primitive;
  readonly $ne?: Primitive;
  readonly $gt?: number | Date;
  readonly $gte?: number | Date;
  readonly $lt?: number | Date;
  readonly $lte?: number | Date;
  readonly $in?: readonly Primitive[];
  readonly $nin?: readonly Primitive[];
  readonly $like?: string;
  readonly $ilike?: string; // Case-insensitive LIKE
  readonly $regex?: RegExp;
}

/**
 * Logical operators
 */
export interface LogicalOperators {
  readonly $and?: readonly WhereClause[];
  readonly $or?: readonly WhereClause[];
  readonly $not?: WhereClause;
}

/**
 * Primitive values
 */
export type Primitive = string | number | boolean | null | Date;

/**
 * WHERE clause
 */
export type WhereClause = {
  readonly [field: string]:
  | Primitive
  | ComparisonOperators
  | readonly WhereClause[];
} & Partial<LogicalOperators>;

/**
 * SELECT clause (fields to select)
 */
export type SelectClause = readonly string[] | '*';

/**
 * Populate clause (relations to include)
 */
export type PopulateClause = {
  readonly [relation: string]: '*' | {
    readonly select?: SelectClause;
    readonly where?: WhereClause;
    readonly populate?: PopulateClause; // Nested populate
    readonly limit?: number;
    readonly offset?: number;
  };
};

/**
 * Order by direction
 */
export type OrderDirection = 'asc' | 'desc';

/**
 * Order by item
 */
export interface OrderByItem {
  readonly field: string;
  readonly direction: OrderDirection;
}

/**
 * Query object (database-agnostic)
 */
export interface QueryObject {
  readonly type: QueryType;
  readonly table: string;
  readonly select?: SelectClause;
  readonly where?: WhereClause;
  readonly populate?: PopulateClause;
  readonly orderBy?: readonly OrderByItem[];
  readonly limit?: number;
  readonly offset?: number;
  readonly data?: Record<string, unknown>; // For INSERT/UPDATE
  readonly returning?: SelectClause; // Fields to return after INSERT/UPDATE
  readonly meta?: Record<string, unknown>; // For internal plugin communication
}

/**
 * Query result metadata
 */
export interface QueryMetadata {
  readonly rowCount?: number;
  readonly affectedRows?: number;
  readonly insertId?: string | number;
}

/**
 * Query result
 */
export interface QueryResult<T = unknown> {
  readonly rows: readonly T[];
  readonly metadata: QueryMetadata;
}

/**
 * Transaction interface
 */
export interface Transaction {
  readonly id: string;

  query<TResult>(
    query: QueryObject
  ): Promise<Result<QueryResult<TResult>, QueryError>>;

  rawQuery<TResult>(
    sql: string,
    params: readonly unknown[]
  ): Promise<Result<QueryResult<TResult>, QueryError>>;

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
  | { readonly type: 'addColumn'; readonly column: string; readonly definition: FieldDefinition }
  | { readonly type: 'dropColumn'; readonly column: string }
  | { readonly type: 'modifyColumn'; readonly column: string; readonly newDefinition: FieldDefinition }
  | { readonly type: 'renameColumn'; readonly from: string; readonly to: string };

/**
 * Index definition
 */
export interface IndexDefinition {
  readonly name?: string;
  readonly fields: readonly string[];
  readonly unique?: boolean;
  readonly type?: 'btree' | 'hash' | 'gist' | 'gin';
}

/**
 * Connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Database adapter interface
 *
 * ALL database adapters MUST implement this interface
 */
export interface DatabaseAdapter<TConfig = Record<string, unknown>> {
  // Metadata
  readonly name: string;
  readonly config: TConfig;

  // Connection management
  connect(): Promise<Result<void, ConnectionError>>;
  disconnect(): Promise<Result<void, ConnectionError>>;
  isConnected(): boolean;
  getConnectionState(): ConnectionState;

  // Query execution
  executeQuery<TResult>(
    query: QueryObject
  ): Promise<Result<QueryResult<TResult>, QueryError>>;

  executeRawQuery<TResult>(
    sql: string,
    params: readonly unknown[]
  ): Promise<Result<QueryResult<TResult>, QueryError>>;

  // Transaction support
  beginTransaction(): Promise<Result<Transaction, TransactionError>>;

  // Schema operations (for migrations)
  createTable(schema: SchemaDefinition): Promise<Result<void, MigrationError>>;
  dropTable(tableName: string): Promise<Result<void, MigrationError>>;
  alterTable(
    tableName: string,
    operations: readonly AlterOperation[]
  ): Promise<Result<void, MigrationError>>;

  // Index operations
  addIndex(
    tableName: string,
    index: IndexDefinition
  ): Promise<Result<void, MigrationError>>;
  dropIndex(
    tableName: string,
    indexName: string
  ): Promise<Result<void, MigrationError>>;

  // Introspection
  getTables(): Promise<Result<readonly string[], QueryError>>;
  getTableSchema(
    tableName: string
  ): Promise<Result<SchemaDefinition, QueryError>>;
  tableExists(tableName: string): Promise<boolean>;
}

/**
 * Base error class for adapters
 */
export class AdapterError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(
    message: string,
    options?: { code?: string; details?: unknown }
  ) {
    super(message);
    this.name = 'AdapterError';
    this.code = options?.code ?? 'UNKNOWN';
    this.details = options?.details;
  }
}

/**
 * Connection error
 */
export class ConnectionError extends AdapterError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'CONNECTION_ERROR', details });
    this.name = 'ConnectionError';
  }
}

/**
 * Query error
 */
export class QueryError extends AdapterError {
  readonly query: QueryObject | undefined;
  readonly sql: string | undefined;

  constructor(
    message: string,
    options?: { query?: QueryObject; sql?: string; details?: unknown }
  ) {
    super(message, { code: 'QUERY_ERROR', details: options?.details });
    this.name = 'QueryError';
    this.query = options?.query;
    this.sql = options?.sql;
  }
}

/**
 * Transaction error
 */
export class TransactionError extends AdapterError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'TRANSACTION_ERROR', details });
    this.name = 'TransactionError';
  }
}

/**
 * Migration error
 */
export class MigrationError extends AdapterError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'MIGRATION_ERROR', details });
    this.name = 'MigrationError';
  }
}

/**
 * Type guard for DatabaseAdapter
 */
export function isDatabaseAdapter(
  value: unknown
): value is DatabaseAdapter {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'config' in value &&
    'connect' in value &&
    'disconnect' in value &&
    'executeQuery' in value &&
    typeof (value as DatabaseAdapter).connect === 'function' &&
    typeof (value as DatabaseAdapter).disconnect === 'function' &&
    typeof (value as DatabaseAdapter).executeQuery === 'function'
  );
}

/**
 * Adapter factory type
 */
export type AdapterFactory<TConfig = Record<string, unknown>> = (
  config: TConfig
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
  | 'numbered' // PostgreSQL: $1, $2, $3
  | 'question' // MySQL: ?, ?, ?
  | 'named'; // Named: :param1, :param2

/**
 * SQL dialect
 */
export type SqlDialect = 'postgres' | 'mysql' | 'sqlite';

/**
 * Query translator interface
 */
export interface QueryTranslator {
  translate(query: QueryObject): {
    readonly sql: string;
    readonly params: readonly unknown[];
  };

  translateWhere(
    where: WhereClause,
    startIndex: number
  ): {
    readonly sql: string;
    readonly params: readonly unknown[];
  };

  escapeIdentifier(identifier: string): string;
  escapeValue(value: unknown): string;
  getParameterPlaceholder(index: number): string;
}
