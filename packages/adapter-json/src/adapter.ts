
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AlterOperation,
  ConnectionError,
  ConnectionState,
  DatabaseAdapter,
  MigrationError,
  QueryError,
  QueryResult,
  Transaction,
  TransactionError,
} from 'forja-types/adapter';
import { QueryObject } from 'forja-types/core/query-builder';
import { IndexDefinition, SchemaDefinition } from 'forja-types/core/schema';
import { Result } from 'forja-types/utils';
import { validateQueryObject } from 'forja-core/utils/query';
import { JsonAdapterConfig, JsonTableFile } from './types';
import { JsonQueryRunner } from './runner';
import { SimpleLock } from './lock';
import { JsonPopulator } from './populate';

/**
 * JSON File Adapter
 */
export class JsonAdapter implements DatabaseAdapter<JsonAdapterConfig> {
  readonly name = 'json';
  readonly config: JsonAdapterConfig;
  private state: ConnectionState = 'disconnected';

  constructor(config: JsonAdapterConfig) {
    this.config = config;
  }

  /**
   * Connect involves ensuring the root directory exists
   */
  async connect(): Promise<Result<void, ConnectionError>> {
    if (this.state === 'connected') {
      return { success: true, data: undefined };
    }

    this.state = 'connecting';

    try {
      await fs.mkdir(this.config.root, { recursive: true });
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
            super(`Failed to access root directory: ${message}`);
            this.name = 'ConnectionError';
          }
        })()
      };
    }
  }

  async disconnect(): Promise<Result<void, ConnectionError>> {
    this.state = 'disconnected';
    return { success: true, data: undefined };
  }

  isConnected(): boolean {
    return this.state === 'connected';
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

  async createTable(schema: SchemaDefinition): Promise<Result<void, MigrationError>> {
    if (!this.isConnected()) {
      return this.notConnectedError('MigrationError');
    }

    try {
      const filePath = this.getTablePath(schema.name);

      // Check if exists
      try {
        await fs.access(filePath);
        return {
          success: false,
          error: new (class extends Error {
            readonly code = 'MIGRATION_ERROR';
            readonly details = undefined;
            constructor() {
              super(`Table '${schema.name}' already exists`);
              this.name = 'MigrationError';
            }
          })()
        };
      } catch {
        // File does not exist, proceed
      }

      const initialContent: JsonTableFile = {
        meta: {
          version: 1,
          updatedAt: new Date().toISOString(),
          name: schema.name
        },
        schema: schema,
        data: []
      };

      await fs.writeFile(filePath, JSON.stringify(initialContent, null, 2), 'utf-8');
      return { success: true, data: undefined };
    } catch (error) {
      return this.mapError(error, 'MigrationError');
    }
  }

  async dropTable(tableName: string): Promise<Result<void, MigrationError>> {
    if (!this.isConnected()) {
      return this.notConnectedError('MigrationError');
    }

    try {
      const filePath = this.getTablePath(tableName);
      await fs.unlink(filePath);
      return { success: true, data: undefined };
    } catch (error) {
      return this.mapError(error, 'MigrationError');
    }
  }

  async executeQuery<TResult>(query: QueryObject): Promise<Result<QueryResult<TResult>, QueryError>> {
    const validation = validateQueryObject(query);
    if (!validation.success) {
      return {
        success: false,
        error: new QueryError(`Invalid QueryObject: ${validation.error.message}`, { query })
      };
    }

    if (!this.isConnected()) {
      return this.notConnectedError('QueryError');
    }

    // Determine lock requirement
    const needsLock = ['insert', 'update', 'delete'].includes(query.type);
    const lock = needsLock ? new SimpleLock(this.config.root, this.config.lockTimeout, this.config.staleTimeout) : null;

    if (lock) {
      try {
        await lock.acquire();
      } catch (err) {
        return {
          success: false,
          error: new QueryError(`Failed to acquire lock: ${err instanceof Error ? err.message : String(err)}`, { query })
        };
      }
    }

    try {
      const filePath = this.getTablePath(query.table);

      // 1. Read Data
      let fileContent: string;
      try {
        fileContent = await fs.readFile(filePath, 'utf-8');
      } catch (err) {
        if (lock) await lock.release();
        return {
          success: false,
          error: new (class extends Error {
            readonly code = 'TABLE_NOT_FOUND';
            readonly details = err;
            readonly query = query;
            readonly sql = undefined;
            constructor() {
              super(`Table '${query.table}' not found`);
              this.name = 'QueryError';
            }
          })()
        };
      }

      const tableData: JsonTableFile<any> = JSON.parse(fileContent);
      const runner = new JsonQueryRunner();

      let rows: any[] = [];
      const metadata: any = { rowCount: 0, affectedRows: 0 };
      let shouldWrite = false;

      switch (query.type) {
        case 'select':
        case 'count': {
          rows = runner.run(tableData.data, query);

          if (query.type === 'select' && query.populate) {
            const populator = new JsonPopulator(this.config.root);
            rows = await populator.populate(rows, query);
          }

          if (query.type === 'count') {
            if (lock) await lock.release();
            return {
              success: true,
              data: {
                rows: [{ count: rows.length }] as unknown as TResult[],
                metadata: { rowCount: 1, affectedRows: 0 }
              }
            };
          }
          break;
        }

        case 'insert': {
          if (!query.data) throw new Error("Insert query missing data");
          const newItem = { ...query.data };

          if (!newItem['id']) {
            tableData.meta.lastInsertId = (tableData.meta.lastInsertId ?? 0) + 1;
            newItem['id'] = tableData.meta.lastInsertId;
          }

          tableData.data.push(newItem);
          rows = [newItem];

          if (query.returning) {
            rows = runner.projectData(rows, query.returning);
          }

          metadata.affectedRows = 1;
          metadata.insertId = newItem['id'];
          shouldWrite = true;
          break;
        }

        case 'update': {
          if (!query.data) throw new Error("Update query missing data");
          const updateQuery: QueryObject = { ...query, limit: undefined, offset: undefined, orderBy: undefined } as any;
          const rowsToUpdate = runner.run(tableData.data, updateQuery);

          for (const row of rowsToUpdate) {
            Object.assign(row, query.data);
          }

          rows = rowsToUpdate;

          if (query.returning) {
            rows = runner.projectData(rows, query.returning);
          }

          metadata.affectedRows = rows.length;
          shouldWrite = true;
          break;
        }

        case 'delete': {
          const deleteQuery: QueryObject = { ...query, limit: undefined, offset: undefined, orderBy: undefined } as any;
          const rowsToDelete = runner.run(tableData.data, deleteQuery);
          const idsToDelete = new Set(rowsToDelete.map(r => r['id']));

          const originalLength = tableData.data.length;
          tableData.data = tableData.data.filter(d => !idsToDelete.has(d['id']));

          rows = rowsToDelete;

          if (query.returning) {
            rows = runner.projectData(rows, query.returning);
          }

          metadata.affectedRows = originalLength - tableData.data.length;
          shouldWrite = true;
          break;
        }
      }

      if (shouldWrite) {
        tableData.meta.updatedAt = new Date().toISOString();
        await fs.writeFile(filePath, JSON.stringify(tableData, null, 2), 'utf-8');
      }

      metadata.rowCount = rows.length;

      if (lock) await lock.release();

      return {
        success: true,
        data: {
          rows: rows as TResult[],
          metadata
        }
      };

    } catch (error) {
      if (lock) await lock.release();
      return this.mapError(error, 'QueryError');
    }
  }

  async executeRawQuery<TResult>(sql: string, params: readonly unknown[]): Promise<Result<QueryResult<TResult>, QueryError>> {
    return {
      success: false,
      error: new (class extends Error {
        readonly code = 'QUERY_ERROR';
        readonly query = undefined;
        readonly sql = sql;
        readonly details = undefined;
        constructor() {
          super('executeRawQuery is not supported by JsonAdapter');
          this.name = 'QueryError';
        }
      })()
    };
  }

  async beginTransaction(): Promise<Result<Transaction, TransactionError>> {
    return {
      success: false,
      error: new (class extends Error {
        readonly code = 'TRANSACTION_ERROR';
        readonly details = undefined;
        constructor() {
          super('Transactions are not fully supported by JsonAdapter yet');
          this.name = 'TransactionError';
        }
      })()
    };
  }

  async alterTable(tableName: string, operations: readonly AlterOperation[]): Promise<Result<void, MigrationError>> {
    if (!this.isConnected()) {
      return this.notConnectedError('MigrationError');
    }

    try {
      const filePath = this.getTablePath(tableName);
      const content = await fs.readFile(filePath, 'utf-8');
      const json: JsonTableFile = JSON.parse(content);

      json.meta.updatedAt = new Date().toISOString();
      await fs.writeFile(filePath, JSON.stringify(json, null, 2), 'utf-8');
      return { success: true, data: undefined };
    } catch (error) {
      return this.mapError(error, 'MigrationError');
    }
  }

  async addIndex(tableName: string, index: IndexDefinition): Promise<Result<void, MigrationError>> {
    return { success: true, data: undefined };
  }

  async dropIndex(tableName: string, indexName: string): Promise<Result<void, MigrationError>> {
    return { success: true, data: undefined };
  }

  async getTables(): Promise<Result<readonly string[], QueryError>> {
    if (!this.isConnected()) {
      return this.notConnectedError('QueryError');
    }
    try {
      const files = await fs.readdir(this.config.root);
      const tables = files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
      return { success: true, data: tables };
    } catch (error) {
      return this.mapError(error, 'QueryError');
    }
  }

  async getTableSchema(tableName: string): Promise<Result<SchemaDefinition, QueryError>> {
    if (!this.isConnected()) {
      return this.notConnectedError('QueryError');
    }
    try {
      const filePath = this.getTablePath(tableName);
      const content = await fs.readFile(filePath, 'utf-8');
      const json: JsonTableFile = JSON.parse(content);

      if (json.schema) {
        return { success: true, data: json.schema as SchemaDefinition };
      }

      return {
        success: false,
        error: new (class extends Error {
          readonly code = 'QUERY_ERROR';
          readonly query = undefined;
          readonly sql = undefined;
          readonly details = undefined;
          constructor() {
            super(`Schema not found for table '${tableName}'`);
            this.name = 'QueryError';
          }
        })()
      };
    } catch (error) {
      return this.mapError(error, 'QueryError');
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

  private notConnectedError<T extends 'ConnectionError' | 'QueryError' | 'MigrationError' | 'TransactionError'>(type: T): any {
    return {
      success: false,
      error: new (class extends Error {
        readonly code = 'CONNECTION_ERROR';
        readonly details = undefined;
        constructor() {
          super('Not connected to database');
          this.name = type;
        }
      })()
    };
  }

  private mapError(error: unknown, type: string): any {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: new (class extends Error {
        readonly code = 'ADAPTER_ERROR';
        readonly details = error;
        constructor() {
          super(`Adapter error: ${message}`);
          this.name = type;
        }
      })()
    };
  }
}
