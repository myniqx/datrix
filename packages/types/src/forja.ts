import { DatabaseAdapter } from "./adapter";
import { ParsedQuery } from "./api/parser";
import { DevConfig, ForjaConfig, MigrationConfig } from "./config";
import { QueryBuilder, QueryType, WhereClause } from "./core/query-builder";
import { ForjaEntry, ForjaRecord, SchemaRegistry } from "./core/schema";
import { ForjaError } from "./errors/forja-error";
import { ForjaPlugin } from "./plugin";
import { Result } from "./utils";

/**
 * Raw CRUD operations interface (bypasses plugin hooks)
 *
 * All database entry types must extend ForjaEntry to ensure
 * they include the required fields (id, createdAt, updatedAt).
 */
export interface IRawCrud {
  findOne<T extends ForjaEntry = ForjaEntry>(
    model: string,
    where: WhereClause<T>,
    options?: Pick<ParsedQuery<T>, "select" | "populate">,
  ): Promise<T | null>;
  findById<T extends ForjaEntry = ForjaEntry>(
    model: string,
    id: string | number,
    options?: Pick<ParsedQuery<T>, "select" | "populate">,
  ): Promise<T | null>;
  findMany<T extends ForjaEntry = ForjaEntry>(
    model: string,
    options?: Pick<
      ParsedQuery<T>,
      "where" | "select" | "populate" | "orderBy" | "limit" | "offset"
    >,
  ): Promise<T[]>;
  count<T extends ForjaEntry = ForjaEntry>(
    model: string,
    where?: WhereClause<T>,
  ): Promise<number>;
  create<T extends ForjaEntry = ForjaEntry>(
    model: string,
    data: Record<string, unknown>,
    options?: Pick<ParsedQuery<T>, "select" | "populate">,
  ): Promise<T>;
  update<T extends ForjaEntry = ForjaEntry>(
    model: string,
    id: string | number,
    data: Record<string, unknown>,
    options?: Pick<ParsedQuery<T>, "select" | "populate">,
  ): Promise<T>;
  updateMany<T extends ForjaEntry = ForjaEntry>(
    model: string,
    where: WhereClause<T>,
    data: Record<string, unknown>,
  ): Promise<number>;
  delete<T extends ForjaEntry = ForjaEntry>(
    model: string,
    id: string | number,
    options?: Pick<ParsedQuery<T>, "select" | "populate">,
  ): Promise<boolean>;
  deleteMany<T extends ForjaEntry = ForjaEntry>(
    model: string,
    where: WhereClause<T>,
  ): Promise<number>;
}

/**
 * Forja Main Singleton Class
 *
 * Extends IRawCrud to provide the same CRUD operations with plugin hooks enabled.
 * All database entry types must extend ForjaEntry to ensure
 * they include the required fields (id, createdAt, updatedAt).
 */
export interface IForja extends IRawCrud {
  // Lifecycle & Configuration
  shutdown(): Promise<Result<void, ForjaError>>;
  getConfig(): ForjaConfig;
  getAdapter<T extends DatabaseAdapter = DatabaseAdapter>(): T;
  getPlugins(): readonly ForjaPlugin[];
  getPlugin(name: string): ForjaPlugin | null;
  hasPlugin(name: string): boolean;
  getSchemas(): SchemaRegistry;
  getMigrationConfig(): Required<MigrationConfig>;
  getDevConfig(): Required<DevConfig>;
  isInitialized(): boolean;
  builder<T extends ForjaEntry = ForjaRecord>(model: string, type: QueryType): QueryBuilder<T>;

  /**
   * Raw CRUD operations (bypasses plugin hooks)
   *
   * Use this when you need direct database access without
   * triggering onBeforeQuery/onAfterQuery plugin hooks.
   */
  readonly raw: IRawCrud;
}
