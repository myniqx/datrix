import fs from "node:fs/promises";
import path from "node:path";
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
} from "forja-types/adapter";
import { QueryObject } from "forja-types/core/query-builder";
import { IndexDefinition, SchemaDefinition } from "forja-types/core/schema";
import { Result } from "forja-types/utils";
import { validateQueryObject } from "forja-core/utils/query";
import { JsonAdapterConfig, JsonTableFile } from "./types";
import { JsonQueryRunner } from "./runner";
import { SimpleLock } from "./lock";
import { JsonPopulator } from "./populate";

interface CacheEntry {
  data: JsonTableFile;
  mtime: number;
}

/**
 * JSON File Adapter
 */
export class JsonAdapter implements DatabaseAdapter<JsonAdapterConfig> {
  readonly name = "json";
  readonly config: JsonAdapterConfig;
  private state: ConnectionState = "disconnected";
  private cache = new Map<string, CacheEntry>();
  private lock: SimpleLock;
  private cacheEnabled: boolean;
  private readLockEnabled: boolean;

  constructor(config: JsonAdapterConfig) {
    this.config = config;
    this.lock = new SimpleLock(
      config.root,
      config.lockTimeout,
      config.staleTimeout,
    );
    this.cacheEnabled = config.cache !== false; // default: true
    this.readLockEnabled = config.readLock === true; // default: false
  }

  /**
   * Connect involves ensuring the root directory exists
   */
  async connect(): Promise<Result<void, ConnectionError>> {
    if (this.state === "connected") {
      return { success: true, data: undefined };
    }

    this.state = "connecting";

    try {
      await fs.mkdir(this.config.root, { recursive: true });
      this.state = "connected";
      return { success: true, data: undefined };
    } catch (error) {
      this.state = "error";
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new ConnectionError(
          `Failed to access root directory: ${message}`,
          error,
        ),
      };
    }
  }

  async disconnect(): Promise<Result<void, ConnectionError>> {
    this.state = "disconnected";
    return { success: true, data: undefined };
  }

  isConnected(): boolean {
    return this.state === "connected";
  }

  getConnectionState(): ConnectionState {
    return this.state;
  }

  /**
   * Validate table name for security
   */
  private validateTableName(tableName: string): Result<void, MigrationError> {
    if (tableName.includes("\x00")) {
      return {
        success: false,
        error: new MigrationError("Invalid table name: contains null byte"),
      };
    }

    if (tableName.includes("/") || tableName.includes("\\")) {
      return {
        success: false,
        error: new MigrationError("Invalid table name: contains path separators"),
      };
    }

    if (tableName.includes("..")) {
      return {
        success: false,
        error: new MigrationError(
          "Invalid table name: contains parent directory reference",
        ),
      };
    }

    return { success: true, data: undefined };
  }

  /**
   * Helper to get file path for a table
   */
  private getTablePath(tableName: string): string {
    return path.join(this.config.root, `${tableName}.json`);
  }

  /**
   * Read table with cache support
   * Uses mtime validation to ensure cache freshness across processes
   * Throws on file not found or parse errors (caller must handle)
   */
  private async readTable(tableName: string): Promise<JsonTableFile> {
    const filePath = this.getTablePath(tableName);

    if (this.cacheEnabled) {
      const stat = await fs.stat(filePath);
      const mtime = stat.mtimeMs;

      const cached = this.cache.get(tableName);
      if (cached && cached.mtime === mtime) {
        return cached.data;
      }

      // Cache miss or stale - read and parse fresh
      const content = await fs.readFile(filePath, "utf-8");
      const data: JsonTableFile = JSON.parse(content);

      this.cache.set(tableName, { data, mtime });
      return data;
    }

    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  }

  /**
   * Get cached table data (for external use like Populate)
   */
  async getCachedTable(tableName: string): Promise<JsonTableFile | null> {
    try {
      return await this.readTable(tableName);
    } catch {
      return null;
    }
  }

  /**
   * Invalidate cache for a specific table
   */
  private invalidateCache(tableName: string): void {
    this.cache.delete(tableName);
  }

  /**
   * Update cache after write operation
   */
  private async updateCache(
    tableName: string,
    data: JsonTableFile,
  ): Promise<void> {
    if (!this.cacheEnabled) return;

    const filePath = this.getTablePath(tableName);
    try {
      const stat = await fs.stat(filePath);
      this.cache.set(tableName, { data, mtime: stat.mtimeMs });
    } catch {
      this.invalidateCache(tableName);
    }
  }

  async createTable(
    schema: SchemaDefinition,
  ): Promise<Result<void, MigrationError>> {
    if (!this.isConnected()) {
      return {
        success: false,
        error: new MigrationError("Not connected to database"),
      };
    }

    const tableName = schema.tableName!;

    const validation = this.validateTableName(tableName);
    if (!validation.success) {
      return validation;
    }

    try {
      const filePath = this.getTablePath(tableName);

      try {
        await fs.access(filePath);
        return {
          success: false,
          error: new MigrationError(`Table '${schema.name}' already exists`),
        };
      } catch {
        // File does not exist, proceed
      }

      const initialContent: JsonTableFile = {
        meta: {
          version: 1,
          updatedAt: new Date().toISOString(),
          name: schema.name,
        },
        schema: schema,
        data: [],
      };

      await fs.writeFile(
        filePath,
        JSON.stringify(initialContent, null, 2),
        "utf-8",
      );
      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationError(`Adapter error: ${message}`, error),
      };
    }
  }

  async dropTable(tableName: string): Promise<Result<void, MigrationError>> {
    if (!this.isConnected()) {
      return {
        success: false,
        error: new MigrationError("Not connected to database"),
      };
    }

    try {
      const filePath = this.getTablePath(tableName);
      await fs.unlink(filePath);
      this.invalidateCache(tableName);
      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationError(`Adapter error: ${message}`, error),
      };
    }
  }

  async executeQuery<TResult>(
    query: QueryObject,
  ): Promise<Result<QueryResult<TResult>, QueryError>> {
    const validation = validateQueryObject(query);
    if (!validation.success) {
      return {
        success: false,
        error: new QueryError(`Invalid QueryObject: ${validation.error.message}`, {
          query,
        }),
      };
    }

    if (!this.isConnected()) {
      return {
        success: false,
        error: new QueryError("Not connected to database", {
          code: "CONNECTION_ERROR",
          query,
        }),
      };
    }

    const isWriteOp = ["insert", "update", "delete"].includes(query.type);
    const needsLock = isWriteOp || this.readLockEnabled;
    let lockAcquired = false;

    if (needsLock) {
      try {
        await this.lock.acquire();
        lockAcquired = true;
      } catch (err) {
        return {
          success: false,
          error: new QueryError(
            `Failed to acquire lock: ${err instanceof Error ? err.message : String(err)}`,
            { query },
          ),
        };
      }
    }

    try {
      const filePath = this.getTablePath(query.table);

      let tableData: JsonTableFile<Record<string, unknown>>;
      let fileContent: string;

      // Step 1: Read file
      try {
        fileContent = await fs.readFile(filePath, "utf-8");
      } catch (err) {
        if (lockAcquired) await this.lock.release();
        return {
          success: false,
          error: new QueryError(`Table '${query.table}' not found`, {
            code: "TABLE_NOT_FOUND",
            query,
            details: err,
          }),
        };
      }

      // Step 2: Parse JSON
      try {
        tableData = JSON.parse(fileContent);
      } catch (parseErr) {
        if (lockAcquired) await this.lock.release();
        this.invalidateCache(query.table);
        return {
          success: false,
          error: new QueryError(
            `Failed to parse JSON file for table '${query.table}': ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
            { query },
          ),
        };
      }

      // Update cache for read operations
      if (!isWriteOp && this.cacheEnabled) {
        try {
          const stat = await fs.stat(filePath);
          this.cache.set(query.table, { data: tableData, mtime: stat.mtimeMs });
        } catch {
          // Ignore cache update errors
        }
      }

      // Handle missing data field
      if (!tableData.data || !Array.isArray(tableData.data)) {
        tableData.data = [];
      }

      const runner = new JsonQueryRunner(tableData);

      let rows: Record<string, unknown>[] = [];
      const metadata: {
        rowCount: number;
        affectedRows: number;
        insertId?: number;
      } = { rowCount: 0, affectedRows: 0 };
      let shouldWrite = false;

      switch (query.type) {
        case "select":
        case "count": {
          // Step 1: Filter and sort (WITHOUT projection - keep all fields for populate)
          if (query.type === "select" && query.populate) {
            rows = runner.filterAndSort(query);
          } else {
            // No populate - use normal flow with projection
            rows = runner.run(query);
          }

          // Step 2: Populate (all fields available)
          if (query.type === "select" && query.populate) {
            const populator = new JsonPopulator(this);
            rows = await populator.populate(rows, query);

            // Step 3: Apply select recursively (preserves populated fields, applies nested selects)
            rows = this.applySelectRecursive(rows, query.select, query.populate);
          }

          if (query.type === "count") {
            if (lockAcquired) await this.lock.release();
            return {
              success: true,
              data: {
                rows: [{ count: rows.length }] as unknown as TResult[],
                metadata: { rowCount: 1, affectedRows: 0 },
              },
            };
          }
          break;
        }

        case "insert": {
          if (!query.data) throw new Error("Insert query missing data");
          const newItem = { ...query.data };

          if (!newItem["id"]) {
            // Auto-generate ID
            tableData.meta.lastInsertId = (tableData.meta.lastInsertId ?? 0) + 1;
            newItem["id"] = tableData.meta.lastInsertId;
          } else {
            // Manual ID provided - update lastInsertId to avoid future conflicts
            const manualId = Number(newItem["id"]);
            if (!isNaN(manualId) && manualId > (tableData.meta.lastInsertId ?? 0)) {
              tableData.meta.lastInsertId = manualId;
            }
          }

          // Check unique constraints before inserting
          this.checkUniqueConstraints(tableData, newItem);

          tableData.data.push(newItem);
          rows = [newItem];

          if (query.returning) {
            rows = runner.projectData(rows, query.returning);
          }

          metadata.affectedRows = 1;
          metadata.insertId = newItem["id"] as number;
          shouldWrite = true;
          break;
        }

        case "update": {
          if (!query.data) throw new Error("Update query missing data");
          const updateQuery: QueryObject = {
            ...query,
            limit: undefined,
            offset: undefined,
            orderBy: undefined,
          } as QueryObject;
          const rowsToUpdate = runner.run(updateQuery);

          // Check unique constraints for each row being updated
          for (const row of rowsToUpdate) {
            const updatedData = { ...row, ...query.data };
            this.checkUniqueConstraints(tableData, updatedData, row["id"] as number);
          }

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

        case "delete": {
          const deleteQuery: QueryObject = {
            ...query,
            limit: undefined,
            offset: undefined,
            orderBy: undefined,
          } as QueryObject;
          const rowsToDelete = runner.run(deleteQuery);
          const idsToDelete = new Set(rowsToDelete.map((r) => r["id"]));

          const originalLength = tableData.data.length;
          tableData.data = tableData.data.filter((d) => !idsToDelete.has(d["id"]));

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
        await fs.writeFile(filePath, JSON.stringify(tableData, null, 2), "utf-8");
        await this.updateCache(query.table, tableData);
      }

      metadata.rowCount = rows.length;

      if (lockAcquired) await this.lock.release();

      return {
        success: true,
        data: {
          rows: rows as TResult[],
          metadata,
        },
      };
    } catch (error) {
      if (lockAcquired) await this.lock.release();
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new QueryError(`Adapter error: ${message}`, { details: error }),
      };
    }
  }

  async executeRawQuery<TResult>(
    sql: string,
  ): Promise<Result<QueryResult<TResult>, QueryError>> {
    return {
      success: false,
      error: new QueryError("executeRawQuery is not supported by JsonAdapter", {
        sql,
      }),
    };
  }

  async beginTransaction(): Promise<Result<Transaction, TransactionError>> {
    return {
      success: false,
      error: new TransactionError(
        "Transactions are not fully supported by JsonAdapter yet",
      ),
    };
  }

  async alterTable(
    tableName: string,
    _operations: readonly AlterOperation[],
  ): Promise<Result<void, MigrationError>> {
    if (!this.isConnected()) {
      return {
        success: false,
        error: new MigrationError("Not connected to database"),
      };
    }

    try {
      const filePath = this.getTablePath(tableName);
      const content = await fs.readFile(filePath, "utf-8");
      const json: JsonTableFile = JSON.parse(content);

      json.meta.updatedAt = new Date().toISOString();
      await fs.writeFile(filePath, JSON.stringify(json, null, 2), "utf-8");
      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new MigrationError(`Adapter error: ${message}`, error),
      };
    }
  }

  async addIndex(
    _tableName: string,
    _index: IndexDefinition,
  ): Promise<Result<void, MigrationError>> {
    return { success: true, data: undefined };
  }

  async dropIndex(
    _tableName: string,
    _indexName: string,
  ): Promise<Result<void, MigrationError>> {
    return { success: true, data: undefined };
  }

  async getTables(): Promise<Result<readonly string[], QueryError>> {
    if (!this.isConnected()) {
      return {
        success: false,
        error: new QueryError("Not connected to database", {
          code: "CONNECTION_ERROR",
        }),
      };
    }
    try {
      const files = await fs.readdir(this.config.root);
      const tables = files
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(".json", ""));
      return { success: true, data: tables };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new QueryError(`Adapter error: ${message}`, { details: error }),
      };
    }
  }

  async getTableSchema(
    tableName: string,
  ): Promise<Result<SchemaDefinition, QueryError>> {
    if (!this.isConnected()) {
      return {
        success: false,
        error: new QueryError("Not connected to database", {
          code: "CONNECTION_ERROR",
        }),
      };
    }
    try {
      const filePath = this.getTablePath(tableName);
      const content = await fs.readFile(filePath, "utf-8");
      const json: JsonTableFile = JSON.parse(content);

      if (json.schema) {
        return { success: true, data: json.schema as SchemaDefinition };
      }

      return {
        success: false,
        error: new QueryError(`Schema not found for table '${tableName}'`),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new QueryError(`Adapter error: ${message}`, { details: error }),
      };
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

  /**
   * Apply SELECT recursively (preserves populated fields)
   * This ensures that:
   * 1. Top-level select keeps populated relation fields
   * 2. Nested populate selects are applied to related data
   *
   * @param rows - Data rows (may contain populated relations)
   * @param select - Fields to select at this level
   * @param populate - Populate configuration (contains nested selects)
   * @returns Rows with select applied recursively
   */
  private applySelectRecursive(
    rows: Record<string, unknown>[],
    select?: readonly string[] | "*",
    populate?: QueryObject["populate"],
  ): Record<string, unknown>[] {
    if (!rows || rows.length === 0) {
      return rows;
    }

    let result = rows;

    // Apply top-level select (but preserve populated fields)
    if (select && select !== "*") {
      const fieldsToKeep = new Set(select);

      // Add populated relation fields to keep them
      if (populate) {
        for (const relationName of Object.keys(populate)) {
          fieldsToKeep.add(relationName);
        }
      }

      // Project fields
      result = rows.map((row) => {
        const projected: Record<string, unknown> = {};
        for (const field of fieldsToKeep) {
          if (field in row) {
            projected[field] = row[field];
          }
        }
        return projected;
      });
    }

    // Apply nested select to populated relations
    if (populate) {
      for (const [relationName, options] of Object.entries(populate)) {
        if (typeof options === "boolean") continue;

        const nestedSelect = options.select;
        const nestedPopulate = options.populate;

        for (const row of result) {
          const relationValue = row[relationName];
          if (!relationValue) continue;

          if (Array.isArray(relationValue)) {
            // hasMany relation
            row[relationName] = this.applySelectRecursive(
              relationValue as Record<string, unknown>[],
              nestedSelect,
              nestedPopulate,
            );
          } else {
            // belongsTo/hasOne relation
            row[relationName] = this.applySelectRecursive(
              [relationValue as Record<string, unknown>],
              nestedSelect,
              nestedPopulate,
            )[0];
          }
        }
      }
    }

    return result;
  }

  /**
   * Check unique constraints before insert/update
   *
   * @param tableData - Table data with schema and existing records
   * @param newData - Data to be inserted/updated
   * @param excludeId - For updates, exclude current record from check
   * @throws Error if unique constraint violated
   */
  private checkUniqueConstraints(
    tableData: JsonTableFile,
    newData: Record<string, unknown>,
    excludeId?: number | string,
  ): void {
    const schema = tableData.schema!;
    const existingData = tableData.data;

    // 1. Check unique fields (field.unique === true)
    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
      if (!(fieldDef as { unique: boolean }).unique) continue;

      const value = newData[fieldName];
      if (value === undefined || value === null) continue;

      const duplicate = existingData.find(
        (row) => row[fieldName] === value && row["id"] !== excludeId,
      );

      if (duplicate) {
        throw new Error(
          `Duplicate value '${value}' for unique field '${fieldName}'`,
        );
      }
    }

    // 2. Check unique indexes
    if (!schema.indexes) return;

    for (const index of schema.indexes) {
      if (!index.unique) continue;

      // Get values for all fields in index
      const indexValues = index.fields.map((f) => newData[f]);

      // Skip if any value is undefined
      if (indexValues.some((v) => v === undefined || v === null)) continue;

      // Check if combination exists
      const duplicate = existingData.find(
        (row) =>
          index.fields.every((f) => row[f] === newData[f]) &&
          row["id"] !== excludeId,
      );

      if (duplicate) {
        throw new Error(
          `Duplicate value for unique index [${index.fields.join(", ")}]`,
        );
      }
    }
  }
}
