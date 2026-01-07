/**
 * PostgreSQL Database Adapter (~500 LOC)
 *
 * Main adapter implementation for PostgreSQL.
 * Handles connection pooling, query execution, transactions, and schema operations.
 */

import type { Pool, PoolClient } from 'pg';
import { Pool as PgPool } from 'pg';
import {
  QueryError,
  ConnectionError,
  TransactionError,
  MigrationError,
  type DatabaseAdapter,
  type QueryObject,
  type QueryResult,
  type QueryMetadata,
  type Transaction,
  type ConnectionState,
  type AlterOperation,
  type IndexDefinition
} from '../base/types';
import type { SchemaDefinition, FieldDefinition, FieldType } from '@core/schema/types';
import type { Result } from '@utils/types';
import { PostgresQueryTranslator } from './query-translator';
import type { PostgresConfig } from './types';
import { getPostgresTypeWithModifiers } from './types';
import { validateQueryObject } from '@utils/query';

/**
 * PostgreSQL adapter implementation
 */
export class PostgresAdapter implements DatabaseAdapter<PostgresConfig> {
  readonly name = 'postgres';
  readonly config: PostgresConfig;

  private pool: Pool | undefined;
  private state: ConnectionState = 'disconnected';
  private readonly translator: PostgresQueryTranslator;

  constructor(config: PostgresConfig) {
    this.config = config;
    this.translator = new PostgresQueryTranslator();
  }

  /**
   * Connect to PostgreSQL
   */
  async connect(): Promise<Result<void, ConnectionError>> {
    if (this.state === 'connected') {
      return { success: true, data: undefined };
    }

    this.state = 'connecting';

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
        application_name: this.config.applicationName ?? 'forja'
      });

      // Test connection
      const client = await this.pool.connect();
      client.release();

      this.state = 'connected';
      return { success: true, data: undefined };
    } catch (error) {
      this.state = 'error';
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'CONNECTION_ERROR';
          readonly details = error;
          constructor() {
            super(`Failed to connect to PostgreSQL: ${message}`);
            this.name = 'ConnectionError';
          }
        })()
      };
    }
  }

  /**
   * Disconnect from PostgreSQL
   */
  async disconnect(): Promise<Result<void, ConnectionError>> {
    if (this.state === 'disconnected') {
      return { success: true, data: undefined };
    }

    try {
      if (this.pool) {
        await this.pool.end();
        this.pool = undefined;
      }

      this.state = 'disconnected';
      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'CONNECTION_ERROR';
          readonly details = error;
          constructor() {
            super(`Failed to disconnect from PostgreSQL: ${message}`);
            this.name = 'ConnectionError';
          }
        })()
      };
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === 'connected' && this.pool !== undefined;
  }

  /**
   * Get connection state
   */
  getConnectionState(): ConnectionState {
    return this.state;
  }

  /**
   * Execute query
   */
  async executeQuery<TResult>(
    query: QueryObject
  ): Promise<Result<QueryResult<TResult>, QueryError>> {
    // Runtime validation of QueryObject structure
    const validation = validateQueryObject(query);
    if (!validation.success) {
      return {
        success: false,
        error: new QueryError(`Invalid QueryObject: ${validation.error.message}`, { query })
      };
    }

    if (!this.pool) {
      return {
        success: false,
        error: new QueryError('Not connected to database', { query })
      };
    }

    let lastSql: string | undefined;

    try {
      // Translate query to SQL
      const { sql, params } = this.translator.translate(query);
      lastSql = sql;

      // Execute query
      const result = await this.pool.query(sql, params as unknown[]);

      // Build metadata
      let insertId: string | number | undefined;

      // Handle INSERT with RETURNING
      if (query.type === 'insert' && result.rows.length > 0) {
        const firstRow = result.rows[0] as Record<string, unknown>;
        insertId = firstRow['id'] as string | number;
      }

      const metadata: QueryMetadata = {
        rowCount: result.rowCount ?? 0,
        affectedRows: result.rowCount ?? 0,
        ...(insertId !== undefined && { insertId })
      };

      return {
        success: true,
        data: {
          rows: result.rows as readonly TResult[],
          metadata
        }
      };
    } catch (error) {
      return {
        success: false,
        error: this.mapPostgresError(error, query, lastSql)
      };
    }
  }

  /**
   * Map Postgres errors to standardized QueryError
   */
  private mapPostgresError(error: unknown, query?: QueryObject, sql?: string): QueryError {
    const message = error instanceof Error ? error.message : String(error);
    const details = error as { code?: string; severity?: string; detail?: string; hint?: string };
    let code = 'QUERY_ERROR';

    // Postgres error codes (https://www.postgresql.org/docs/current/errcodes-appendix.html)
    if (details && typeof details.code === 'string') {
      switch (details.code) {
        case '23505': // unique_violation
          code = 'UNIQUE_VIOLATION';
          break;
        case '23503': // foreign_key_violation
          code = 'FOREIGN_KEY_VIOLATION';
          break;
        case '23502': // not_null_violation
          code = 'NOT_NULL_VIOLATION';
          break;
        case '42P01': // undefined_table
          code = 'TABLE_NOT_FOUND';
          break;
        case '42703': // undefined_column
          code = 'COLUMN_NOT_FOUND';
          break;
      }
    }

    return new QueryError(`Query execution failed: ${message}`, {
      code,
      query,
      sql,
      details: error
    });
  }

  /**
   * Execute raw SQL query
   */
  async executeRawQuery<TResult>(
    sql: string,
    params: readonly unknown[]
  ): Promise<Result<QueryResult<TResult>, QueryError>> {
    if (!this.pool) {
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'QUERY_ERROR';
          readonly query = undefined;
          readonly sql = sql;
          readonly details = undefined;
          constructor() {
            super('Not connected to database');
            this.name = 'QueryError';
          }
        })()
      };
    }

    try {
      const result = await this.pool.query(sql, params as unknown[]);

      const metadata: QueryMetadata = {
        rowCount: result.rowCount ?? 0,
        affectedRows: result.rowCount ?? 0
      };

      return {
        success: true,
        data: {
          rows: result.rows as readonly TResult[],
          metadata
        }
      };
    } catch (error) {
      return {
        success: false,
        error: this.mapPostgresError(error, undefined, sql)
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
        error: new (class extends Error {
          readonly code = 'TRANSACTION_ERROR';
          readonly details = undefined;
          constructor() {
            super('Not connected to database');
            this.name = 'TransactionError';
          }
        })()
      };
    }

    try {
      const client = await this.pool.connect();
      await client.query('BEGIN');

      const transaction = new PostgresTransaction(
        client,
        this.translator,
        this.mapPostgresError.bind(this),
        `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
      );

      return { success: true, data: transaction };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'TRANSACTION_ERROR';
          readonly details = error;
          constructor() {
            super(`Failed to begin transaction: ${message}`);
            this.name = 'TransactionError';
          }
        })()
      };
    }
  }

  /**
   * Create table from schema
   */
  async createTable(
    schema: SchemaDefinition
  ): Promise<Result<void, MigrationError>> {
    if (!this.pool) {
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'MIGRATION_ERROR';
          readonly details = undefined;
          constructor() {
            super('Not connected to database');
            this.name = 'MigrationError';
          }
        })()
      };
    }

    try {
      const columns: string[] = [];

      // Add fields
      for (const [fieldName, field] of Object.entries(schema.fields)) {
        const columnDef = this.buildColumnDefinition(fieldName, field);
        columns.push(columnDef);
      }

      // Build CREATE TABLE statement
      const tableName = this.translator.escapeIdentifier(schema.name);
      const sql = `CREATE TABLE ${tableName} (\n  ${columns.join(',\n  ')}\n)`;

      await this.pool.query(sql);

      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'MIGRATION_ERROR';
          readonly details = error;
          constructor() {
            super(`Failed to create table '${schema.name}': ${message}`);
            this.name = 'MigrationError';
          }
        })()
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
        error: new (class extends Error {
          readonly code = 'MIGRATION_ERROR';
          readonly details = undefined;
          constructor() {
            super('Not connected to database');
            this.name = 'MigrationError';
          }
        })()
      };
    }

    try {
      const escapedTable = this.translator.escapeIdentifier(tableName);
      await this.pool.query(`DROP TABLE IF EXISTS ${escapedTable}`);

      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'MIGRATION_ERROR';
          readonly details = error;
          constructor() {
            super(`Failed to drop table '${tableName}': ${message}`);
            this.name = 'MigrationError';
          }
        })()
      };
    }
  }

  /**
   * Alter table
   */
  async alterTable(
    tableName: string,
    operations: readonly AlterOperation[]
  ): Promise<Result<void, MigrationError>> {
    if (!this.pool) {
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'MIGRATION_ERROR';
          readonly details = undefined;
          constructor() {
            super('Not connected to database');
            this.name = 'MigrationError';
          }
        })()
      };
    }

    try {
      const escapedTable = this.translator.escapeIdentifier(tableName);

      for (const op of operations) {
        let sql = '';

        switch (op.type) {
          case 'addColumn': {
            const columnDef = this.buildColumnDefinition(
              op.column,
              op.definition
            );
            sql = `ALTER TABLE ${escapedTable} ADD COLUMN ${columnDef}`;
            break;
          }

          case 'dropColumn': {
            const columnName = this.translator.escapeIdentifier(op.column);
            sql = `ALTER TABLE ${escapedTable} DROP COLUMN ${columnName}`;
            break;
          }

          case 'modifyColumn': {
            // PostgreSQL uses ALTER COLUMN for modifications
            const columnName = this.translator.escapeIdentifier(op.column);
            const pgType = getPostgresTypeWithModifiers(op.newDefinition.type);
            sql = `ALTER TABLE ${escapedTable} ALTER COLUMN ${columnName} TYPE ${pgType}`;
            break;
          }

          case 'renameColumn': {
            const fromColumn = this.translator.escapeIdentifier(op.from);
            const toColumn = this.translator.escapeIdentifier(op.to);
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
        error: new (class extends Error {
          readonly code = 'MIGRATION_ERROR';
          readonly details = error;
          constructor() {
            super(`Failed to alter table '${tableName}': ${message}`);
            this.name = 'MigrationError';
          }
        })()
      };
    }
  }

  /**
   * Add index
   */
  async addIndex(
    tableNameParam: string,
    index: IndexDefinition
  ): Promise<Result<void, MigrationError>> {
    if (!this.pool) {
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'MIGRATION_ERROR';
          readonly details = undefined;
          constructor() {
            super('Not connected to database');
            this.name = 'MigrationError';
          }
        })()
      };
    }

    try {
      const tableName = tableNameParam;
      const escapedTable = this.translator.escapeIdentifier(tableName);
      const indexName =
        index.name ?? `idx_${tableName}_${index.fields.join('_')}`;
      const escapedIndexName = this.translator.escapeIdentifier(indexName);
      const fields = index.fields
        .map((f) => this.translator.escapeIdentifier(f))
        .join(', ');
      const unique = index.unique ? 'UNIQUE ' : '';
      const using = index.type ? ` USING ${index.type.toUpperCase()}` : '';

      const sql = `CREATE ${unique}INDEX ${escapedIndexName} ON ${escapedTable}${using} (${fields})`;

      await this.pool.query(sql);

      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'MIGRATION_ERROR';
          readonly details = error;
          constructor() {
            super(`Failed to add index on table '${tableNameParam}': ${message}`);
            this.name = 'MigrationError';
          }
        })()
      };
    }
  }

  /**
   * Drop index
   */
  async dropIndex(
    _tableName: string,
    indexName: string
  ): Promise<Result<void, MigrationError>> {
    if (!this.pool) {
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'MIGRATION_ERROR';
          readonly details = undefined;
          constructor() {
            super('Not connected to database');
            this.name = 'MigrationError';
          }
        })()
      };
    }

    try {
      const escapedIndexName = this.translator.escapeIdentifier(indexName);
      await this.pool.query(`DROP INDEX IF EXISTS ${escapedIndexName}`);

      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'MIGRATION_ERROR';
          readonly details = error;
          constructor() {
            super(`Failed to drop index '${indexName}': ${message}`);
            this.name = 'MigrationError';
          }
        })()
      };
    }
  }

  /**
   * Get all table names
   */
  async getTables(): Promise<Result<readonly string[], QueryError>> {
    if (!this.pool) {
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'QUERY_ERROR';
          readonly query = undefined;
          readonly sql = undefined;
          readonly details = undefined;
          constructor() {
            super('Not connected to database');
            this.name = 'QueryError';
          }
        })()
      };
    }

    try {
      const result = await this.pool.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
      );

      const tables = result.rows.map((row: { tablename: string }) => row.tablename);
      return { success: true, data: tables };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'QUERY_ERROR';
          readonly query = undefined;
          readonly sql = undefined;
          readonly details = error;
          constructor() {
            super(`Failed to get tables: ${message}`);
            this.name = 'QueryError';
          }
        })()
      };
    }
  }

  /**
   * Get table schema (introspection)
   */
  async getTableSchema(
    tableName: string
  ): Promise<Result<SchemaDefinition, QueryError>> {
    if (!this.pool) {
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'QUERY_ERROR';
          readonly query = undefined;
          readonly sql = undefined;
          readonly details = undefined;
          constructor() {
            super('Not connected to database');
            this.name = 'QueryError';
          }
        })()
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
        [tableName]
      );

      if (columnResult.rows.length === 0) {
        return {
          success: false,
          error: new (class extends Error {
            readonly code = 'QUERY_ERROR';
            readonly query = undefined;
            readonly sql = undefined;
            readonly details = undefined;
            constructor() {
              super(`Table '${tableName}' not found`);
              this.name = 'QueryError';
            }
          })()
        };
      }

      const fields: Record<string, FieldDefinition> = {};

      for (const row of columnResult.rows) {
        const fieldType = this.mapPostgresTypeToFieldType(row.data_type, row.udt_name);

        const fieldDef = {
          type: fieldType,
          required: row.is_nullable === 'NO',
          ...(row.column_default !== null && {
            default: this.parsePostgresDefault(row.column_default)
          })
        } as FieldDefinition;

        fields[row.column_name] = fieldDef;
      }

      return {
        success: true,
        data: {
          name: tableName,
          fields
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'QUERY_ERROR';
          readonly query = undefined;
          readonly sql = undefined;
          readonly details = error;
          constructor() {
            super(`Failed to get table schema for '${tableName}': ${message}`);
            this.name = 'QueryError';
          }
        })()
      };
    }
  }

  /**
   * Map Postgres data type to Forja FieldType
   */
  private mapPostgresTypeToFieldType(_dataType: string, udtName: string): FieldType {
    const type = udtName.toLowerCase();

    if (type.includes('int') || type.includes('float') || type.includes('double') || type.includes('numeric') || type.includes('decimal') || type.includes('real')) {
      return 'number';
    }
    if (type.includes('bool')) {
      return 'boolean';
    }
    if (type.includes('timestamp') || type.includes('date') || type.includes('time')) {
      return 'date';
    }
    if (type.includes('json')) {
      return 'json';
    }
    if (type.startsWith('_')) {
      return 'array';
    }
    if (type === 'uuid' || type === 'text' || type === 'varchar' || type === 'char' || type === 'bpchar') {
      return 'string';
    }

    return 'string'; // Default to string
  }

  /**
   * Parse Postgres default value string
   */
  private parsePostgresDefault(defaultValue: string): unknown {
    if (defaultValue === null) return undefined;

    // Remove type cast (e.g., 'active'::character varying -> 'active')
    let cleaned = defaultValue.split('::')[0];

    // Remove single quotes for strings
    if (cleaned && cleaned.startsWith("'") && cleaned.endsWith("'")) {
      cleaned = cleaned.substring(1, cleaned.length - 1);
    }

    // Common function defaults
    if (cleaned && (cleaned.toUpperCase().includes('NOW()') || cleaned.toUpperCase().includes('CURRENT_TIMESTAMP'))) {
      return 'NOW()';
    }

    // Numeric and boolean defaults
    if (cleaned === 'true') return true;
    if (cleaned === 'false') return false;

    const num = Number(cleaned);
    if (!isNaN(num) && cleaned !== '') return num;

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
        [tableName]
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
    field: FieldDefinition
  ): string {
    const columnName = this.translator.escapeIdentifier(fieldName);
    const pgType = getPostgresTypeWithModifiers(field.type);
    const nullable = field.required ? ' NOT NULL' : '';
    const defaultValue = field.default !== undefined
      ? ` DEFAULT ${this.translator.escapeValue(field.default)}`
      : '';

    return `${columnName} ${pgType}${nullable}${defaultValue}`;
  }
}

/**
 * PostgreSQL transaction implementation
 */
class PostgresTransaction implements Transaction {
  readonly id: string;
  private client: PoolClient;
  private translator: PostgresQueryTranslator;
  private errorMapper: (error: unknown, query?: QueryObject, sql?: string) => QueryError;
  private committed = false;
  private rolledBack = false;
  private aborted = false;

  constructor(
    client: PoolClient,
    translator: PostgresQueryTranslator,
    errorMapper: (error: unknown, query?: QueryObject, sql?: string) => QueryError,
    id: string
  ) {
    this.client = client;
    this.translator = translator;
    this.errorMapper = errorMapper;
    this.id = id;
  }

  /**
   * Execute query within transaction
   */
  async query<TResult>(
    query: QueryObject
  ): Promise<Result<QueryResult<TResult>, QueryError>> {
    if (this.committed || this.rolledBack) {
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'QUERY_ERROR';
          readonly query = query;
          readonly sql = undefined;
          readonly details = undefined;
          constructor() {
            super('Transaction already completed');
            this.name = 'QueryError';
          }
        })()
      };
    }

    if (this.aborted) {
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'QUERY_ERROR';
          readonly query = query;
          readonly sql = undefined;
          readonly details = undefined;
          constructor() {
            super('current transaction is aborted, commands ignored until end of transaction block');
            this.name = 'QueryError';
          }
        })()
      };
    }

    let lastSql: string | undefined;

    try {
      const { sql, params } = this.translator.translate(query);
      lastSql = sql;
      const result = await this.client.query(sql, params as unknown[]);

      const metadata: QueryMetadata = {
        rowCount: result.rowCount ?? 0,
        affectedRows: result.rowCount ?? 0
      };

      return {
        success: true,
        data: {
          rows: result.rows as readonly TResult[],
          metadata
        }
      };
    } catch (error) {
      this.aborted = true;
      return {
        success: false,
        error: this.errorMapper(error, query, lastSql)
      };
    }
  }

  /**
   * Execute raw SQL within transaction
   */
  async rawQuery<TResult>(
    sql: string,
    params: readonly unknown[]
  ): Promise<Result<QueryResult<TResult>, QueryError>> {
    if (this.committed || this.rolledBack) {
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'QUERY_ERROR';
          readonly query = undefined;
          readonly sql = sql;
          readonly details = undefined;
          constructor() {
            super('Transaction already completed');
            this.name = 'QueryError';
          }
        })()
      };
    }

    if (this.aborted) {
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'QUERY_ERROR';
          readonly query = undefined;
          readonly sql = sql;
          readonly details = undefined;
          constructor() {
            super('current transaction is aborted, commands ignored until end of transaction block');
            this.name = 'QueryError';
          }
        })()
      };
    }

    try {
      const result = await this.client.query(sql, params as unknown[]);

      const metadata: QueryMetadata = {
        rowCount: result.rowCount ?? 0,
        affectedRows: result.rowCount ?? 0
      };

      return {
        success: true,
        data: {
          rows: result.rows as readonly TResult[],
          metadata
        }
      };
    } catch (error) {
      this.aborted = true;
      return {
        success: false,
        error: this.errorMapper(error, undefined, sql)
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
        error: new (class extends Error {
          readonly code = 'TRANSACTION_ERROR';
          readonly details = undefined;
          constructor() {
            super('Transaction already committed');
            this.name = 'TransactionError';
          }
        })()
      };
    }

    if (this.rolledBack) {
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'TRANSACTION_ERROR';
          readonly details = undefined;
          constructor() {
            super('Transaction already rolled back');
            this.name = 'TransactionError';
          }
        })()
      };
    }

    try {
      await this.client.query('COMMIT');
      this.committed = true;
      this.client.release();

      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'TRANSACTION_ERROR';
          readonly details = error;
          constructor() {
            super(`Failed to commit transaction: ${message}`);
            this.name = 'TransactionError';
          }
        })()
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
        error: new (class extends Error {
          readonly code = 'TRANSACTION_ERROR';
          readonly details = undefined;
          constructor() {
            super('Transaction already committed');
            this.name = 'TransactionError';
          }
        })()
      };
    }

    if (this.rolledBack) {
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'TRANSACTION_ERROR';
          readonly details = undefined;
          constructor() {
            super('Transaction already rolled back');
            this.name = 'TransactionError';
          }
        })()
      };
    }

    try {
      await this.client.query('ROLLBACK');
      this.rolledBack = true;
      this.client.release();

      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'TRANSACTION_ERROR';
          readonly details = error;
          constructor() {
            super(`Failed to rollback transaction: ${message}`);
            this.name = 'TransactionError';
          }
        })()
      };
    }
  }

  /**
   * Create savepoint
   */
  async savepoint(name: string): Promise<Result<void, TransactionError>> {
    try {
      const escapedName = this.translator.escapeIdentifier(name);
      await this.client.query(`SAVEPOINT ${escapedName}`);
      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'TRANSACTION_ERROR';
          readonly details = error;
          constructor() {
            super(`Failed to create savepoint '${name}': ${message}`);
            this.name = 'TransactionError';
          }
        })()
      };
    }
  }

  /**
   * Rollback to savepoint
   */
  async rollbackTo(name: string): Promise<Result<void, TransactionError>> {
    try {
      const escapedName = this.translator.escapeIdentifier(name);
      await this.client.query(`ROLLBACK TO SAVEPOINT ${escapedName}`);
      this.aborted = false; // Rolling back to a savepoint clears the aborted state for that savepoint
      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'TRANSACTION_ERROR';
          readonly details = error;
          constructor() {
            super(`Failed to rollback to savepoint '${name}': ${message}`);
            this.name = 'TransactionError';
          }
        })()
      };
    }
  }

  /**
   * Release savepoint
   */
  async release(name: string): Promise<Result<void, TransactionError>> {
    try {
      const escapedName = this.translator.escapeIdentifier(name);
      await this.client.query(`RELEASE SAVEPOINT ${escapedName}`);
      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'TRANSACTION_ERROR';
          readonly details = error;
          constructor() {
            super(`Failed to release savepoint '${name}': ${message}`);
            this.name = 'TransactionError';
          }
        })()
      };
    }
  }
}

/**
 * Create PostgreSQL adapter
 */
export function createPostgresAdapter(
  config: PostgresConfig
): PostgresAdapter {
  return new PostgresAdapter(config);
}
