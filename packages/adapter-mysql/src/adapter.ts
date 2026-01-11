/**
 * MySQL Database Adapter
 *
 * Main adapter implementation for MySQL/MariaDB.
 * Handles connection pooling, query execution, transactions, and schema operations.
 */

import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { createPool } from 'mysql2/promise';

import { MySQLQueryTranslator } from './query-translator';
import type { MySQLConfig } from './types';
import { getMySQLTypeWithModifiers, parseConnectionString } from './types';
import { QueryObject } from 'forja-types/core/query-builder';
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
  TransactionError
} from 'forja-types/adapter';
import { Result } from 'forja-types/utils';
import { validateQueryObject } from 'forja-core/utils/query';
import { FieldDefinition, FieldType, IndexDefinition, SchemaDefinition } from 'forja-types/core/schema';

/**
 * MySQL adapter implementation
 */
export class MySQLAdapter implements DatabaseAdapter<MySQLConfig> {
  readonly name = 'mysql';
  readonly config: MySQLConfig;

  private pool: Pool | undefined;
  private state: ConnectionState = 'disconnected';
  private readonly translator: MySQLQueryTranslator;

  constructor(config: MySQLConfig) {
    if (config.connectionString) {
      const parsed = parseConnectionString(config.connectionString);
      this.config = { ...config, ...parsed };
    } else {
      this.config = config;
    }
    this.translator = new MySQLQueryTranslator();
  }

  /**
   * Connect to MySQL
   */
  async connect(): Promise<Result<void, ConnectionError>> {
    if (this.state === 'connected') {
      return { success: true, data: undefined };
    }

    this.state = 'connecting';

    try {
      this.pool = createPool({
        host: this.config.host ?? 'localhost',
        port: this.config.port ?? 3306,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        ssl: this.config.ssl,
        connectionLimit: this.config.connectionLimit ?? 10,
        queueLimit: this.config.queueLimit ?? 0,
        waitForConnections: this.config.waitForConnections ?? true,
        connectTimeout: this.config.connectTimeout ?? 10000,
        charset: this.config.charset ?? 'utf8mb4',
        timezone: this.config.timezone ?? 'local'
      });

      const connection = await this.pool.getConnection();
      connection.release();

      this.state = 'connected';
      return { success: true, data: undefined };
    } catch (error) {
      this.state = 'error';
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new ConnectionError(`Failed to connect to MySQL: ${message}`, error)
      };
    }
  }

  /**
   * Disconnect from MySQL
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
        error: new ConnectionError(`Failed to disconnect from MySQL: ${message}`, error)
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
        error: new QueryError('Not connected to database', { code: 'CONNECTION_ERROR', query })
      };
    }

    let lastSql: string | undefined;

    try {
      const { sql, params } = this.translator.translate(query);
      lastSql = sql;

      const [result] = await this.pool.execute(sql, params as unknown[]);

      let insertId: string | number | undefined;
      let affectedRows = 0;
      let rows: readonly TResult[] = [];

      if (query.type === 'insert' || query.type === 'update' || query.type === 'delete') {
        const resultHeader = result as ResultSetHeader;
        affectedRows = resultHeader.affectedRows ?? 0;
        if (query.type === 'insert') {
          insertId = resultHeader.insertId;
        }
      } else {
        rows = result as readonly TResult[];
        affectedRows = (result as RowDataPacket[]).length;
      }

      const metadata: QueryMetadata = {
        rowCount: affectedRows,
        affectedRows,
        ...(insertId !== undefined && { insertId })
      };

      return {
        success: true,
        data: {
          rows,
          metadata
        }
      };
    } catch (error) {
      return {
        success: false,
        error: this.mapMySQLError(error, query, lastSql)
      };
    }
  }

  /**
   * Map MySQL errors to standardized QueryError
   */
  private mapMySQLError(error: unknown, query?: QueryObject, sql?: string): QueryError {
    const message = error instanceof Error ? error.message : String(error);
    const details = error as { code?: string; errno?: number; sqlState?: string };
    let code = 'QUERY_ERROR';

    if (details && typeof details.errno === 'number') {
      switch (details.errno) {
        case 1062:
          code = 'UNIQUE_VIOLATION';
          break;
        case 1452:
          code = 'FOREIGN_KEY_VIOLATION';
          break;
        case 1048:
          code = 'NOT_NULL_VIOLATION';
          break;
        case 1146:
          code = 'TABLE_NOT_FOUND';
          break;
        case 1054:
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
        error: new QueryError('Not connected to database', { code: 'CONNECTION_ERROR', sql })
      };
    }

    try {
      const [result] = await this.pool.execute(sql, params as unknown[]);

      const isResultSet = Array.isArray(result);
      const rows = isResultSet ? (result as readonly TResult[]) : [];
      const affectedRows = isResultSet
        ? (result as RowDataPacket[]).length
        : (result as ResultSetHeader).affectedRows ?? 0;

      const metadata: QueryMetadata = {
        rowCount: affectedRows,
        affectedRows
      };

      return {
        success: true,
        data: {
          rows,
          metadata
        }
      };
    } catch (error) {
      return {
        success: false,
        error: this.mapMySQLError(error, undefined, sql)
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
        error: new TransactionError('Not connected to database')
      };
    }

    try {
      const connection = await this.pool.getConnection();
      await connection.beginTransaction();

      const transaction = new MySQLTransaction(
        connection,
        this.translator,
        this.mapMySQLError.bind(this),
        `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
      );

      return { success: true, data: transaction };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new TransactionError(`Failed to begin transaction: ${message}`, error)
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
        error: new MigrationError('Not connected to database')
      };
    }

    try {
      const columns: string[] = [];

      for (const [fieldName, field] of Object.entries(schema.fields)) {
        const columnDef = this.buildColumnDefinition(fieldName, field);
        columns.push(columnDef);
      }

      const tableName = this.translator.escapeIdentifier(schema.name);
      const sql = `CREATE TABLE ${tableName} (\n  ${columns.join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

      await this.pool.execute(sql);

      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationError(`Failed to create table '${schema.name}': ${message}`, error)
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
        error: new MigrationError('Not connected to database')
      };
    }

    try {
      const escapedTable = this.translator.escapeIdentifier(tableName);
      await this.pool.execute(`DROP TABLE IF EXISTS ${escapedTable}`);

      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationError(`Failed to drop table '${tableName}': ${message}`, error)
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
        error: new MigrationError('Not connected to database')
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
            const columnName = this.translator.escapeIdentifier(op.column);
            const mysqlType = getMySQLTypeWithModifiers(op.newDefinition.type);
            sql = `ALTER TABLE ${escapedTable} MODIFY COLUMN ${columnName} ${mysqlType}`;
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
          await this.pool.execute(sql);
        }
      }

      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationError(`Failed to alter table '${tableName}': ${message}`, error)
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
        error: new MigrationError('Not connected to database')
      };
    }

    try {
      const tableName = tableNameParam;
      const escapedTable = this.translator.escapeIdentifier(tableName);
      const indexName = index.name ?? `idx_${tableName}_${index.fields.join('_')}`;
      const escapedIndexName = this.translator.escapeIdentifier(indexName);
      const fields = index.fields
        .map((f) => this.translator.escapeIdentifier(f))
        .join(', ');
      const unique = index.unique ? 'UNIQUE ' : '';
      const using = index.type ? ` USING ${index.type.toUpperCase()}` : '';
      const sql = `CREATE ${unique}INDEX ${escapedIndexName} ON ${escapedTable} (${fields})${using}`;
      await this.pool.execute(sql);
      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationError(`Failed to add index on table '${tableNameParam}': ${message}`, error)
      };
    }
  }

  /**
   * Drop index
   */
  async dropIndex(
    tableName: string,
    indexName: string
  ): Promise<Result<void, MigrationError>> {
    if (!this.pool) {
      return {
        success: false,
        error: new MigrationError('Not connected to database')
      };
    }

    try {
      const escapedTable = this.translator.escapeIdentifier(tableName);
      const escapedIndexName = this.translator.escapeIdentifier(indexName);
      await this.pool.execute(`DROP INDEX ${escapedIndexName} ON ${escapedTable}`);

      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationError(`Failed to drop index '${indexName}': ${message}`, error)
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
        error: new QueryError('Not connected to database', { code: 'CONNECTION_ERROR' })
      };
    }

    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT TABLE_NAME as tableName FROM information_schema.tables WHERE table_schema = ? ORDER BY TABLE_NAME`,
        [this.config.database]
      );

      const tables = rows.map((row) => row['tableName'] as string);
      return { success: true, data: tables };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new QueryError(`Failed to get tables: ${message}`, { details: error })
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
        error: new QueryError('Not connected to database', { code: 'CONNECTION_ERROR' })
      };
    }

    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT COLUMN_NAME as column_name, DATA_TYPE as data_type, IS_NULLABLE as is_nullable, COLUMN_DEFAULT as column_default
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ?
         ORDER BY ORDINAL_POSITION`,
        [this.config.database, tableName]
      );

      if (rows.length === 0) {
        return {
          success: false,
          error: new QueryError(`Table '${tableName}' not found`, { code: 'TABLE_NOT_FOUND' })
        };
      }

      const fields: Record<string, FieldDefinition> = {};

      for (const row of rows) {
        const fieldType = this.mapMySQLTypeToFieldType(row['data_type'] as string);

        const fieldDef = {
          type: fieldType,
          required: row['is_nullable'] === 'NO',
          ...(row['column_default'] !== null && {
            default: this.parseMySQLDefault(row['column_default'] as string)
          })
        } as FieldDefinition;

        fields[row['column_name'] as string] = fieldDef;
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
        error: new QueryError(`Failed to get table schema for '${tableName}': ${message}`, { details: error })
      };
    }
  }

  /**
   * Map MySQL data type to Forja FieldType
   */
  private mapMySQLTypeToFieldType(dataType: string): FieldType {
    const type = dataType.toLowerCase();

    if (type.includes('int') || type.includes('float') || type.includes('double') || type.includes('decimal') || type.includes('numeric')) {
      return 'number';
    }
    if (type === 'tinyint') {
      return 'boolean';
    }
    if (type.includes('datetime') || type.includes('timestamp') || type.includes('date')) {
      return 'date';
    }
    if (type === 'json') {
      return 'json';
    }
    if (type.includes('text') || type.includes('char') || type.includes('varchar')) {
      return 'string';
    }

    return 'string';
  }

  /**
   * Parse MySQL default value
   */
  private parseMySQLDefault(defaultValue: string | null): unknown {
    if (defaultValue === null) return undefined;

    if (defaultValue.toUpperCase() === 'CURRENT_TIMESTAMP' || defaultValue.toUpperCase().includes('NOW()')) {
      return 'NOW()';
    }

    if (defaultValue === 'true' || defaultValue === '1') return true;
    if (defaultValue === 'false' || defaultValue === '0') return false;

    const num = Number(defaultValue);
    if (!isNaN(num) && defaultValue !== '') return num;

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
        [this.config.database, tableName]
      );

      return (rows[0]?.['count'] as number) > 0;
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
    const mysqlType = getMySQLTypeWithModifiers(field.type);
    const nullable = field.required ? ' NOT NULL' : '';
    const defaultValue = field.default !== undefined
      ? ` DEFAULT ${this.translator.escapeValue(field.default)}`
      : '';

    return `${columnName} ${mysqlType}${nullable}${defaultValue}`;
  }
}

/**
 * MySQL transaction implementation
 */
class MySQLTransaction implements Transaction {
  readonly id: string;
  private connection: PoolConnection;
  private translator: MySQLQueryTranslator;
  private errorMapper: (error: unknown, query?: QueryObject, sql?: string) => QueryError;
  private committed = false;
  private rolledBack = false;
  private aborted = false;

  constructor(
    connection: PoolConnection,
    translator: MySQLQueryTranslator,
    errorMapper: (error: unknown, query?: QueryObject, sql?: string) => QueryError,
    id: string
  ) {
    this.connection = connection;
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
        error: new QueryError('Transaction already completed', { query })
      };
    }

    if (this.aborted) {
      return {
        success: false,
        error: new QueryError('Transaction is aborted, commands ignored until end of transaction block', { query })
      };
    }

    let lastSql: string | undefined;

    try {
      const { sql, params } = this.translator.translate(query);
      lastSql = sql;
      const [result] = await this.connection.execute(sql, params as unknown[]);

      const isResultSet = Array.isArray(result);
      const rows = isResultSet ? (result as readonly TResult[]) : [];
      const affectedRows = isResultSet
        ? (result as RowDataPacket[]).length
        : (result as ResultSetHeader).affectedRows ?? 0;

      const metadata: QueryMetadata = {
        rowCount: affectedRows,
        affectedRows
      };

      return {
        success: true,
        data: {
          rows,
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
        error: new QueryError('Transaction already completed', { sql })
      };
    }

    if (this.aborted) {
      return {
        success: false,
        error: new QueryError('Transaction is aborted, commands ignored until end of transaction block', { sql })
      };
    }

    try {
      const [result] = await this.connection.execute(sql, params as unknown[]);

      const isResultSet = Array.isArray(result);
      const rows = isResultSet ? (result as readonly TResult[]) : [];
      const affectedRows = isResultSet
        ? (result as RowDataPacket[]).length
        : (result as ResultSetHeader).affectedRows ?? 0;

      const metadata: QueryMetadata = {
        rowCount: affectedRows,
        affectedRows
      };

      return {
        success: true,
        data: {
          rows,
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
        error: new TransactionError('Transaction already committed')
      };
    }

    if (this.rolledBack) {
      return {
        success: false,
        error: new TransactionError('Transaction already rolled back')
      };
    }

    try {
      await this.connection.commit();
      this.committed = true;
      this.connection.release();

      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new TransactionError(`Failed to commit transaction: ${message}`, error)
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
        error: new TransactionError('Transaction already committed')
      };
    }

    if (this.rolledBack) {
      return {
        success: false,
        error: new TransactionError('Transaction already rolled back')
      };
    }

    try {
      await this.connection.rollback();
      this.rolledBack = true;
      this.connection.release();

      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new TransactionError(`Failed to rollback transaction: ${message}`, error)
      };
    }
  }

  /**
   * Create savepoint
   */
  async savepoint(name: string): Promise<Result<void, TransactionError>> {
    try {
      const escapedName = this.translator.escapeIdentifier(name);
      await this.connection.execute(`SAVEPOINT ${escapedName}`);
      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new TransactionError(`Failed to create savepoint '${name}': ${message}`, error)
      };
    }
  }

  /**
   * Rollback to savepoint
   */
  async rollbackTo(name: string): Promise<Result<void, TransactionError>> {
    try {
      const escapedName = this.translator.escapeIdentifier(name);
      await this.connection.execute(`ROLLBACK TO SAVEPOINT ${escapedName}`);
      this.aborted = false;
      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new TransactionError(`Failed to rollback to savepoint '${name}': ${message}`, error)
      };
    }
  }

  /**
   * Release savepoint
   */
  async release(name: string): Promise<Result<void, TransactionError>> {
    try {
      const escapedName = this.translator.escapeIdentifier(name);
      await this.connection.execute(`RELEASE SAVEPOINT ${escapedName}`);
      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new TransactionError(`Failed to release savepoint '${name}': ${message}`, error)
      };
    }
  }
}

/**
 * Create MySQL adapter
 */
export function createMySQLAdapter(
  config: MySQLConfig
): MySQLAdapter {
  return new MySQLAdapter(config);
}
